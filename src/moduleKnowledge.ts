import fs from "node:fs";
import path from "node:path";

interface ModuleIndex {
  module_id?: string;
  aliases?: string[];
  metadata?: Record<string, string>;
  stats?: Record<string, number>;
  entities?: {
    organizations?: EntityRef[];
    npcs?: EntityRef[];
    places?: EntityRef[];
  };
  branch_hooks?: BranchHook[];
  mutable_hooks?: TextHit[];
  rule_candidates?: TextHit[];
  import_warnings?: string[];
}

interface BranchHook {
  id?: string;
  hook_type?: string;
  section_title?: string;
  trigger_text?: string[];
}

interface EntityRef {
  name?: string;
}

interface TextHit {
  text?: string;
}

interface SessionState {
  scene_log?: unknown[];
  npcs?: Record<string, unknown>;
  relationships?: Record<string, unknown>;
  world_changes?: unknown[];
}

interface SourceText {
  module_id?: string;
  blocks?: SourceBlock[];
  sections?: SourceSection[];
}

interface SourceBlock {
  index?: number;
  text?: string;
}

interface SourceSection {
  id?: string;
  title?: string;
  categories?: string[];
  start_block?: number;
  end_block?: number;
  summary_candidate?: string;
  paragraphs?: string[];
  blocks?: number[];
}

interface ModuleManifest {
  module_id?: string;
  aliases?: string[];
}

interface ModuleLoad {
  index: ModuleIndex;
  sessionState?: SessionState;
  warnings: string[];
}

interface AliasCandidate {
  value: string;
  weight: number;
}

const DEFAULT_IMPORT_ROOT = path.join(process.cwd(), "data", "module_imports");
const MAX_CONTEXT_CHARS = 5200;
const METADATA_NAME_KEYS = ["模组名称", "模组名", "名称", "标题"];
const PLAYER_COUNT_KEYS = ["建议人数", "推荐人数", "玩家人数", "PL人数", "调查员人数"];
const RULE_KEYWORDS = ["使用规则", "推荐技能", "建议人数", "模组难度", "检定", "SAN", "理智", "秘密团", "注意事项", "规则", "密码", "条件"];
const MUTABLE_KEYWORDS = ["自定义", "守秘人可以", "建议守秘人", "可以改", "改版", "原创", "DIY", "新增", "分发给不同"];

export function buildLocalModuleKnowledgeInstructions(
  userText: string,
  moduleImportsRoot = DEFAULT_IMPORT_ROOT
): string | undefined {
  const match = findMatchingModule(userText, moduleImportsRoot);
  if (!match) return undefined;

  const { index, sessionState, warnings } = match;
  const metadata = index.metadata ?? {};
  const moduleName = firstValue(metadata, ["模组名称", "模组名"]) ?? index.module_id ?? "未命名模组";
  const lines = [
    "本地已导入模组资料命中。回答该模组相关问题时，必须优先使用下面的项目内资料；不要使用外部网站、百科、搜索结果或未导入资料来补全。",
    "如果下面资料不足以回答，就明确说“本地模组索引里没有这部分信息”，不要编造。",
    "",
    `模组：${moduleName}`,
    formatPerspectiveGuidance(userText),
    formatPlayerCountGuidance(userText, metadata),
    formatLoadWarnings([...warnings, ...(index.import_warnings ?? [])]),
    formatMetadata(metadata),
    formatStats(index.stats),
    formatBranchHooks(index.branch_hooks),
    formatEntities(index.entities),
    formatMutableHooks(index.mutable_hooks),
    formatRuleCandidates(index.rule_candidates),
    formatSessionState(sessionState)
  ].filter((part) => part.trim() !== "");

  return truncate(lines.join("\n\n"), MAX_CONTEXT_CHARS);
}

function findMatchingModule(userText: string, moduleImportsRoot: string): ModuleLoad | undefined {
  const root = path.resolve(moduleImportsRoot);
  if (!fs.existsSync(root)) return undefined;

  const normalizedUserText = normalizeForMatch(userText);
  if (!normalizedUserText) return undefined;
  const moduleDirs = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name));

  const matches: Array<ModuleLoad & { score: number }> = [];
  for (const moduleDir of moduleDirs) {
    const loaded = loadModuleImport(moduleDir);
    if (!loaded) continue;
    const { index } = loaded;
    const aliases = buildAliases(index, path.basename(moduleDir));
    const score = scoreModuleMatch(normalizedUserText, aliases);
    if (score <= 0) continue;
    matches.push({ ...loaded, score });
  }

  matches.sort((a, b) => b.score - a.score);
  return matches[0];
}

function loadModuleImport(moduleDir: string): ModuleLoad | undefined {
  const warnings: string[] = [];
  const indexPath = path.join(moduleDir, "canon", "module_index.json");
  const sessionState = readJson<SessionState>(path.join(moduleDir, "campaign", "session_state.json"));
  const index = readJson<ModuleIndex>(indexPath);
  if (index) return { index, sessionState, warnings };

  if (fs.existsSync(indexPath)) {
    warnings.push("canon/module_index.json 无法按 JSON 读取，已降级使用 source_text.json/module_manifest.json 恢复可用摘要。");
  } else {
    warnings.push("canon/module_index.json 缺失，已降级使用 source_text.json/module_manifest.json 恢复可用摘要。");
  }

  const sourceText = readJson<SourceText>(path.join(moduleDir, "canon", "source_text.json"));
  const manifest = readJson<ModuleManifest>(path.join(moduleDir, "module_manifest.json"));
  const fallbackIndex = buildFallbackIndex(sourceText, manifest, path.basename(moduleDir));
  if (!fallbackIndex) return undefined;
  return { index: fallbackIndex, sessionState, warnings };
}

function buildFallbackIndex(sourceText: SourceText | undefined, manifest: ModuleManifest | undefined, folderName: string): ModuleIndex | undefined {
  if (!sourceText && !manifest) return undefined;

  const blocks = sourceText?.blocks ?? [];
  const sections = sourceText?.sections ?? [];
  const metadata = extractMetadataFromSourceBlocks(blocks);
  return {
    module_id: sourceText?.module_id ?? manifest?.module_id ?? folderName,
    aliases: manifest?.aliases,
    metadata,
    stats: {
      blocks: blocks.length,
      sections: sections.length,
      rule_candidates: findTextHits(blocks, RULE_KEYWORDS).length,
      mutable_hooks: findTextHits(blocks, MUTABLE_KEYWORDS).length,
      branch_hooks: sections.filter(isBranchSection).length
    },
    branch_hooks: sections.filter(isBranchSection).slice(0, 50).map((section, index) => ({
      id: `branch-${String(index + 1).padStart(3, "0")}`,
      hook_type: section.categories?.includes("mutable_hook") ? "customization_policy" : "pc_hook",
      section_title: section.title,
      trigger_text: [section.title ?? "", ...(section.paragraphs ?? []).filter((line) => includesAny(line, [...MUTABLE_KEYWORDS, "调查员", "职业", "角色卡", "背景故事"])).slice(0, 2)].filter(Boolean)
    })),
    mutable_hooks: findTextHits(blocks, MUTABLE_KEYWORDS).slice(0, 80),
    rule_candidates: findTextHits(blocks, RULE_KEYWORDS).slice(0, 80),
    import_warnings: ["module_index.json 不可用时仅提供从 source_text.json 恢复的候选摘要；精确规则请以 canon/source_text.json 源块为准。"]
  };
}

function buildAliases(index: ModuleIndex, folderName: string): AliasCandidate[] {
  const metadata = index.metadata ?? {};
  const aliases = new Map<string, number>();

  addAlias(aliases, index.module_id, 40);
  addAlias(aliases, folderName, 35);
  for (const alias of index.aliases ?? []) addAlias(aliases, alias, 90);
  for (const key of METADATA_NAME_KEYS) addAlias(aliases, metadata[key], 110);
  for (const key of Object.keys(metadata)) {
    if (looksLikeNamedMetadataKey(key)) addAlias(aliases, key, 60);
  }
  for (const entity of index.entities?.organizations ?? []) addAlias(aliases, entity.name, 50);
  for (const entity of index.entities?.places ?? []) addAlias(aliases, entity.name, 45);

  return [...aliases.entries()].map(([value, weight]) => ({ value, weight })).filter((alias) => alias.value.length >= 2);
}

function addAlias(aliases: Map<string, number>, value: string | undefined, weight: number): void {
  if (typeof value !== "string" || value.trim() === "") return;
  const normalized = normalizeForMatch(value);
  if (!normalized) return;
  aliases.set(normalized, Math.max(aliases.get(normalized) ?? 0, weight));
  if (/warp\s*列车/i.test(value) || normalized.includes("warp列车")) {
    aliases.set("w列车", Math.max(aliases.get("w列车") ?? 0, weight));
  }
}

function scoreModuleMatch(normalizedUserText: string, aliases: AliasCandidate[]): number {
  let score = 0;
  for (const alias of aliases) {
    if (normalizedUserText === alias.value) {
      score = Math.max(score, 200 + alias.weight + alias.value.length);
    } else if (normalizedUserText.includes(alias.value)) {
      score = Math.max(score, 100 + alias.weight + alias.value.length);
    } else if (alias.value.includes(normalizedUserText) && normalizedUserText.length >= 3) {
      score = Math.max(score, 50 + alias.weight + normalizedUserText.length);
    }
  }
  return score;
}

function normalizeForMatch(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function readJson<T>(filePath: string): T | undefined {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")) as T;
  } catch {
    return undefined;
  }
}

function firstValue(metadata: Record<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = metadata[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function looksLikeNamedMetadataKey(key: string): boolean {
  if (METADATA_NAME_KEYS.includes(key) || PLAYER_COUNT_KEYS.includes(key)) return false;
  return /(?:列车|公司|车厢|舱|都市|技术|协议|组织|事务所|人物|NPC)/i.test(key);
}

function extractMetadataFromSourceBlocks(blocks: SourceBlock[]): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const block of blocks.slice(0, 120)) {
    const text = block.text?.trim();
    if (!text) continue;
    const match = /^【?([^】：:】]{2,24})】?[：:]\s*(.+)$/u.exec(text);
    if (!match) continue;
    const key = match[1].replace(/\s+/g, " ").trim();
    const value = match[2].replace(/\s+/g, " ").trim();
    if (value.length <= 500) metadata[key] = value;
  }
  return metadata;
}

function findTextHits(blocks: SourceBlock[], keywords: string[]): TextHit[] {
  return blocks
    .filter((block) => block.text != null && includesAny(block.text, keywords))
    .map((block) => ({ text: block.text }));
}

function isBranchSection(section: SourceSection): boolean {
  const text = [section.title, ...(section.paragraphs ?? [])].filter(Boolean).join("\n");
  return section.categories?.some((category) => category === "pc_branch" || category === "mutable_hook") === true
    || includesAny(text, ["调查员中有", "调查员里有", "职业", "角色卡", "PC", "背景故事", ...MUTABLE_KEYWORDS]);
}

function includesAny(text: string | undefined, keywords: string[]): boolean {
  return typeof text === "string" && keywords.some((keyword) => text.includes(keyword));
}

function formatPerspectiveGuidance(userText: string): string {
  if (/(?:我是|作为|本人是)\s*(?:KP|kp|守秘人)|(?:KP|kp|守秘人)视角/.test(userText)) {
    return "KP视角提醒：用户自称 KP/守秘人。可以使用 keeper-only 真相、分支和备团建议；玩家可见话术要单独标注，不能把 KP 私密信息混成对玩家的公开内容。";
  }
  if (/(?:我是|作为|本人是)\s*(?:PL|pl|玩家|调查员)|(?:PL|pl|玩家|调查员)视角/.test(userText)) {
    return "PL视角提醒：用户自称玩家/调查员。只使用 spoiler-safe 的公开前提、时代、地点、风格、入团钩子和车卡建议；不要透露隐藏真相、幕后时间线、关键结局或私密线索链。";
  }
  return "";
}

function formatPlayerCountGuidance(userText: string, metadata: Record<string, string>): string {
  const requestedCount = extractRequestedPlayerCount(userText);
  const recommendedText = firstValue(metadata, PLAYER_COUNT_KEYS);
  if (requestedCount == null || !recommendedText) return "";

  const recommendedRange = parsePlayerCountRange(recommendedText);
  if (!recommendedRange) return "";
  if (requestedCount > recommendedRange.max) {
    return `人数适配提醒：用户提到 ${requestedCount} 名玩家，但本地模组建议人数是 ${recommendedText}；回答时要明确这是超过原始建议人数，优先给 KP ${requestedCount} 人桌的改造建议，并标明改造属于 campaign/KP 调整，不是 canon。`;
  }
  if (requestedCount < recommendedRange.min) {
    return `人数适配提醒：用户提到 ${requestedCount} 名玩家，但本地模组建议人数是 ${recommendedText}；回答时要说明低于原始建议人数，并给 KP 合并角色职责或线索承载的建议。`;
  }
  return "";
}

function formatLoadWarnings(warnings: string[]): string {
  const uniqueWarnings = [...new Set(warnings.filter((warning) => warning.trim() !== ""))];
  return uniqueWarnings.length === 0 ? "" : ["导入读取提醒：", ...uniqueWarnings.map((warning) => `- ${warning}`)].join("\n");
}

function extractRequestedPlayerCount(userText: string): number | undefined {
  const normalized = userText.normalize("NFKC");
  const digitMatch = /([0-9]{1,2})\s*(?:个)?(?:人|名|位|玩家|PL|pl|调查员)/.exec(normalized);
  if (digitMatch) return Number(digitMatch[1]);

  const chineseMatch = /([一二两三四五六七八九十]{1,3})\s*(?:个)?(?:人|名|位|玩家|调查员)/.exec(normalized);
  if (!chineseMatch) return undefined;
  return chineseNumberToInt(chineseMatch[1]);
}

function parsePlayerCountRange(value: string): { min: number; max: number } | undefined {
  const normalized = value.normalize("NFKC");
  const rangeMatch = /([0-9]{1,2})\s*(?:-|~|–|—|至|到)\s*([0-9]{1,2})\s*(?:人|名|位|玩家|PL)?/i.exec(normalized);
  if (rangeMatch) {
    return { min: Number(rangeMatch[1]), max: Number(rangeMatch[2]) };
  }

  const singleMatch = /([0-9]{1,2})\s*(?:人|名|位|玩家|PL)/i.exec(normalized);
  if (singleMatch) {
    const count = Number(singleMatch[1]);
    return { min: count, max: count };
  }
  return undefined;
}

function chineseNumberToInt(value: string): number | undefined {
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9
  };
  if (value === "十") return 10;
  if (value.includes("十")) {
    const [left, right] = value.split("十");
    const tens = left === "" ? 1 : digits[left];
    const ones = right === "" ? 0 : digits[right];
    if (tens == null || ones == null) return undefined;
    return tens * 10 + ones;
  }
  return digits[value];
}

function formatMetadata(metadata: Record<string, string>): string {
  const keys = [
    "模组作者",
    "原作",
    "使用规则",
    "模组难度",
    "模组长度",
    "时代背景",
    "模组舞台",
    "建议人数",
    "推荐技能",
    "导入背景",
    "警告"
  ];
  const rows = keys
    .map((key) => [key, metadata[key]] as const)
    .filter(([, value]) => value != null && value.trim() !== "")
    .map(([key, value]) => `- ${key}: ${value}`);
  return rows.length === 0 ? "" : ["基础信息：", ...rows].join("\n");
}

function formatStats(stats: Record<string, number> | undefined): string {
  if (!stats) return "";
  return `导入统计：章节 ${stats.sections ?? "未知"}，PC钩子 ${stats.branch_hooks ?? "未知"}，规则候选 ${stats.rule_candidates ?? "未知"}，KP可改写提示 ${stats.mutable_hooks ?? "未知"}。`;
}

function formatBranchHooks(hooks: BranchHook[] | undefined): string {
  const rows = (hooks ?? []).slice(0, 12).map((hook) => {
    const trigger = (hook.trigger_text ?? []).slice(0, 2).join(" / ");
    return `- ${hook.id ?? "branch"} [${hook.hook_type ?? "pc_hook"}] ${hook.section_title ?? ""}${trigger ? `：${trigger}` : ""}`;
  });
  return rows.length === 0 ? "" : ["PC/DIY分支钩子：", ...rows].join("\n");
}

function formatEntities(entities: ModuleIndex["entities"]): string {
  if (!entities) return "";
  const parts = [
    compactList("组织", entities.organizations),
    compactList("NPC", entities.npcs),
    compactList("地点", entities.places)
  ].filter(Boolean);
  return parts.length === 0 ? "" : ["实体索引：", ...parts].join("\n");
}

function compactList(label: string, values: EntityRef[] | undefined): string {
  const names = (values ?? []).map((item) => item.name).filter((name): name is string => Boolean(name)).slice(0, 10);
  return names.length === 0 ? "" : `- ${label}: ${names.join("、")}`;
}

function formatMutableHooks(hooks: TextHit[] | undefined): string {
  const rows = (hooks ?? []).slice(0, 5).map((hook) => `- ${hook.text}`);
  return rows.length === 0 ? "" : ["KP可改写/自定义提示：", ...rows].join("\n");
}

function formatRuleCandidates(rules: TextHit[] | undefined): string {
  const rows = (rules ?? []).slice(0, 8).map((rule) => `- ${rule.text}`);
  return rows.length === 0 ? "" : ["规则/检定候选：", ...rows].join("\n");
}

function formatSessionState(state: SessionState | undefined): string {
  if (!state) return "";
  return [
    "当前跑团状态：",
    `- 已记录事件: ${state.scene_log?.length ?? 0}`,
    `- 已跟踪NPC: ${Object.keys(state.npcs ?? {}).join("、") || "无"}`,
    `- 已跟踪关系: ${Object.keys(state.relationships ?? {}).join("、") || "无"}`,
    `- 世界变化数: ${state.world_changes?.length ?? 0}`
  ].join("\n");
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 20).trimEnd()}\n...[本地模组资料已截断]`;
}
