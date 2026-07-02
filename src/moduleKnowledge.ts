import fs from "node:fs";
import path from "node:path";

interface ModuleIndex {
  module_id?: string;
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

const DEFAULT_IMPORT_ROOT = path.join(process.cwd(), "data", "module_imports");
const MAX_CONTEXT_CHARS = 5200;

export function buildLocalModuleKnowledgeInstructions(
  userText: string,
  moduleImportsRoot = DEFAULT_IMPORT_ROOT
): string | undefined {
  const match = findMatchingModule(userText, moduleImportsRoot);
  if (!match) return undefined;

  const { index, sessionState } = match;
  const metadata = index.metadata ?? {};
  const moduleName = firstValue(metadata, ["模组名称", "模组名"]) ?? index.module_id ?? "未命名模组";
  const lines = [
    "本地已导入模组资料命中。回答该模组相关问题时，必须优先使用下面的项目内资料；不要使用外部网站、百科、搜索结果或未导入资料来补全。",
    "如果下面资料不足以回答，就明确说“本地模组索引里没有这部分信息”，不要编造。",
    "",
    `模组：${moduleName}`,
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

function findMatchingModule(userText: string, moduleImportsRoot: string): { index: ModuleIndex; sessionState?: SessionState } | undefined {
  const root = path.resolve(moduleImportsRoot);
  if (!fs.existsSync(root)) return undefined;

  const normalizedUserText = normalizeForMatch(userText);
  const moduleDirs = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name));

  for (const moduleDir of moduleDirs) {
    const indexPath = path.join(moduleDir, "canon", "module_index.json");
    if (!fs.existsSync(indexPath)) continue;

    const index = readJson<ModuleIndex>(indexPath);
    if (!index) continue;

    const aliases = buildAliases(index, path.basename(moduleDir));
    if (!aliases.some((alias) => normalizedUserText.includes(alias))) continue;

    const sessionState = readJson<SessionState>(path.join(moduleDir, "campaign", "session_state.json"));
    return { index, sessionState };
  }

  return undefined;
}

function buildAliases(index: ModuleIndex, folderName: string): string[] {
  const metadata = index.metadata ?? {};
  const rawAliases = [
    index.module_id,
    folderName,
    metadata["模组名称"],
    metadata["模组名"],
    metadata["WARP列车"],
    ...(index.entities?.organizations ?? []).map((entity) => entity.name),
    ...(index.entities?.places ?? []).map((entity) => entity.name)
  ].filter((value): value is string => typeof value === "string" && value.trim() !== "");

  const aliases = new Set<string>();
  for (const alias of rawAliases) {
    addAlias(aliases, alias);
    if (/warp\s*列车/i.test(alias)) addAlias(aliases, "W列车");
  }
  return [...aliases].filter((alias) => alias.length >= 2);
}

function addAlias(aliases: Set<string>, value: string): void {
  const normalized = normalizeForMatch(value);
  if (normalized) aliases.add(normalized);
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
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
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
