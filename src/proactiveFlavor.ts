import fs from "node:fs";
import path from "node:path";
import type { ProactiveGroupSettings } from "./storage.js";

interface ModuleIndex {
  module_id?: string;
  aliases?: string[];
  metadata?: Record<string, string>;
}

interface ResolvedModuleFlavor {
  moduleId: string;
  moduleName: string;
  flavorText: string;
  source: "proactive_flavor" | "metadata";
  sourcePath?: string;
  warnings: string[];
}

interface ModuleCandidate {
  dir: string;
  folderName: string;
  index?: ModuleIndex;
  aliases: string[];
}

const DEFAULT_IMPORT_ROOT = path.join(process.cwd(), "data", "module_imports");
const MAX_FLAVOR_CHARS = 3000;
const MAX_PROMPT_FLAVOR_CHARS = 3600;
const METADATA_FLAVOR_KEYS = [
  "模组名称",
  "模组名",
  "名称",
  "标题",
  "使用规则",
  "时代背景",
  "模组舞台",
  "导入背景",
  "建议人数",
  "推荐技能",
  "警告"
];

export const PROACTIVE_FLAVOR_RULE_PROMPT = [
  "Module flavor rule: Treat the story as a player-safe background side incident tied to the current module's public era, place, institutions, and social pressures.",
  "Use ordinary social scenes such as bureaucracy, labor, medicine, rumors, family reputation, religion, transport, lodging, commerce, education, or archives.",
  "Do not reveal keeper-only truth, required clues, culprit logic, endings, private NPC motives, or anything that would solve or alter the main plot.",
  "Give one concrete era-appropriate trace and one small consequence/question that can inspire player characterization."
].join(" ");

export function resolveProactiveModuleFlavor(
  moduleQuery: string,
  moduleImportsRoot = DEFAULT_IMPORT_ROOT
): ResolvedModuleFlavor | undefined {
  const query = moduleQuery.trim();
  if (query === "") return undefined;
  const root = path.resolve(moduleImportsRoot);
  if (!fs.existsSync(root)) return undefined;

  const candidate = findModuleCandidate(query, root);
  if (!candidate) return undefined;

  const moduleId = candidate.index?.module_id?.trim() || candidate.folderName;
  const moduleName = readModuleName(candidate.index) ?? moduleId;
  const flavorPath = path.join(candidate.dir, "campaign", "proactive_flavor.md");
  const warnings: string[] = [];
  if (fs.existsSync(flavorPath)) {
    const flavorText = readText(flavorPath);
    if (flavorText.trim() !== "") {
      return {
        moduleId,
        moduleName,
        flavorText: truncateFlavor(flavorText),
        source: "proactive_flavor",
        sourcePath: flavorPath,
        warnings
      };
    }
    warnings.push("campaign/proactive_flavor.md 为空，已改用公开元数据。");
  } else {
    warnings.push("未找到 campaign/proactive_flavor.md，已只使用模组公开元数据生成保守风味。");
  }

  const metadataFlavor = buildMetadataFlavor(candidate.index, moduleName);
  return {
    moduleId,
    moduleName,
    flavorText: metadataFlavor,
    source: "metadata",
    warnings
  };
}

export function buildProactiveFlavorPrompt(settings: ProactiveGroupSettings | undefined): string | undefined {
  if (!settings?.enabled) return undefined;
  const moduleLabel = [settings.moduleName, settings.moduleId && settings.moduleId !== settings.moduleName ? `(${settings.moduleId})` : ""]
    .filter(Boolean)
    .join(" ");
  const flavorText = settings.flavorText?.trim();

  const lines = [
    "Active module flavor packet (use internally; do not label the output):",
    moduleLabel ? `- Active module: ${moduleLabel}` : undefined,
    `- ${PROACTIVE_FLAVOR_RULE_PROMPT}`,
    flavorText ? "Player-safe flavor context:" : undefined,
    flavorText ? truncateFlavor(flavorText, MAX_PROMPT_FLAVOR_CHARS) : "- No specific module flavor text is active; keep the proactive story generic and player-safe."
  ].filter((line): line is string => line != null && line.trim() !== "");

  return lines.join("\n");
}

function findModuleCandidate(query: string, moduleImportsRoot: string): ModuleCandidate | undefined {
  const normalizedQuery = normalizeForMatch(query);
  if (normalizedQuery === "") return undefined;
  const candidates = fs.readdirSync(moduleImportsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => loadModuleCandidate(path.join(moduleImportsRoot, entry.name), entry.name));

  let best: { candidate: ModuleCandidate; score: number } | undefined;
  for (const candidate of candidates) {
    const score = candidate.aliases.reduce((maxScore, alias) => Math.max(maxScore, scoreAlias(normalizedQuery, alias)), 0);
    if (score <= 0) continue;
    if (!best || score > best.score) best = { candidate, score };
  }
  return best?.candidate;
}

function loadModuleCandidate(moduleDir: string, folderName: string): ModuleCandidate {
  const index = readJson<ModuleIndex>(path.join(moduleDir, "canon", "module_index.json"));
  const aliases = new Set<string>();
  addAlias(aliases, folderName);
  addAlias(aliases, index?.module_id);
  for (const alias of index?.aliases ?? []) addAlias(aliases, alias);
  for (const value of Object.values(index?.metadata ?? {})) addAlias(aliases, value);
  return {
    dir: moduleDir,
    folderName,
    index,
    aliases: [...aliases]
  };
}

function addAlias(aliases: Set<string>, value: string | undefined): void {
  if (typeof value !== "string" || value.trim() === "") return;
  const normalized = normalizeForMatch(value);
  if (normalized !== "") aliases.add(normalized);
  if (/warp\s*列车/i.test(value) || normalized.includes("warp列车")) aliases.add("w列车");
}

function scoreAlias(normalizedQuery: string, normalizedAlias: string): number {
  if (normalizedQuery === normalizedAlias) return 200 + normalizedAlias.length;
  if (normalizedQuery.includes(normalizedAlias)) return 100 + normalizedAlias.length;
  if (normalizedAlias.includes(normalizedQuery) && normalizedQuery.length >= 3) return 50 + normalizedQuery.length;
  return 0;
}

function buildMetadataFlavor(index: ModuleIndex | undefined, moduleName: string): string {
  const metadata = index?.metadata ?? {};
  const rows = METADATA_FLAVOR_KEYS
    .map((key) => [key, metadata[key]?.trim()] as const)
    .filter(([, value]) => value != null && value !== "")
    .map(([key, value]) => `- ${key}: ${value}`);

  return [
    `模组：${moduleName}`,
    "下面只来自公开元数据；不要补完隐藏真相、关键线索、幕后动机或结局。",
    rows.length > 0 ? "公开世界观锚点：" : "公开世界观锚点：暂无详细元数据；只使用模组名和当前群聊已公开内容。",
    ...rows,
    "风味方向：围绕时代、地点、公共制度、社会压力和普通人的小误会写背景侧闻，不让它成为主线线索。"
  ].join("\n");
}

function readModuleName(index: ModuleIndex | undefined): string | undefined {
  const metadata = index?.metadata ?? {};
  return metadata["模组名称"]?.trim()
    || metadata["模组名"]?.trim()
    || metadata["名称"]?.trim()
    || metadata["标题"]?.trim()
    || index?.module_id?.trim();
}

function readJson<T>(filePath: string): T | undefined {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")) as T;
  } catch {
    return undefined;
  }
}

function readText(filePath: string): string {
  return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
}

function normalizeForMatch(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function truncateFlavor(text: string, maxChars = MAX_FLAVOR_CHARS): string {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 18).trimEnd()}\n...[风味包已截断]`;
}
