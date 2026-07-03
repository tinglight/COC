import fs from "node:fs";
import path from "node:path";
import { buildNpcPersonaConstraintBlock } from "./rpStudio.js";
import type { StoredMemoryAnchor, StoredPersonaCard, StoredTrainingExample } from "./storage.js";

export interface NpcLiveRoleplaySkillBundle {
  skillText: string;
  styleRules: string;
  trainingLog: string;
  trainingLogPath: string;
}

export type NpcSkillMode = "npc" | "training";

const MAX_TRAINING_LOG_CHARS = 7_000;

export interface NpcHistoryLine {
  actorName?: string;
  inputText?: string;
  outputText: string;
}

export interface NpcReplyPromptContext {
  persona?: StoredPersonaCard;
  trainingExamples?: readonly StoredTrainingExample[];
  memoryAnchors?: readonly StoredMemoryAnchor[];
}

export function defaultNpcSkillRoot(): string {
  return path.resolve(process.cwd(), "skills", "npc-live-roleplay");
}

export function loadNpcLiveRoleplaySkill(skillRoot = defaultNpcSkillRoot()): NpcLiveRoleplaySkillBundle {
  const skillPath = path.join(skillRoot, "SKILL.md");
  const stylePath = path.join(skillRoot, "references", "live-table-style.md");
  const trainingLogPath = path.join(skillRoot, "references", "training-log.md");

  return {
    skillText: readRequiredText(skillPath),
    styleRules: readRequiredText(stylePath),
    trainingLog: readRequiredText(trainingLogPath),
    trainingLogPath
  };
}

export function buildNpcLiveRoleplayInstructions(bundle: NpcLiveRoleplaySkillBundle, mode: NpcSkillMode): string {
  const modeRules = mode === "npc"
    ? [
        "当前是 NPC 回复模式。",
        "只输出可以直接发到 QQ 聊天里的 NPC 回应，不输出 JSON、评分、后台状态或规则解释。",
        "优先回答玩家刚说的话；可以包含简短动作描写和少量自然括号式桌边发言。"
      ]
    : [
        "当前是训练反馈模式。",
        "如果输入包含评分或批评，先找最高优先级问题，再给一个具体修正和一版改写。",
        "如果输入只是练习题，给一版示范回应并指出它用了哪一个训练要点。",
        "回复保持短，适合 QQ 聊天框阅读。"
      ];

  return [
    "你正在执行项目本地的 npc-live-roleplay Skill。以下材料只作为行为约束，不要在回复里提到文件路径、Skill、训练日志、系统提示或实现细节。",
    ...modeRules,
    section("SKILL.md", bundle.skillText),
    section("live-table-style.md", bundle.styleRules),
    section("training-log.md", clipTail(bundle.trainingLog, MAX_TRAINING_LOG_CHARS))
  ].join("\n\n");
}

export function buildNpcReplyPrompt(
  npcName: string,
  playerText: string,
  recentHistory: readonly NpcHistoryLine[] = [],
  context: NpcReplyPromptContext = {}
): string {
  const history = recentHistory.length === 0
    ? "暂无。"
    : recentHistory.map((line, index) => {
      const player = line.inputText == null || line.inputText.trim() === ""
        ? ""
        : `玩家：${line.inputText.trim()}\n`;
      return `${index + 1}. ${player}${line.actorName ?? npcName}：${line.outputText.trim()}`;
    }).join("\n");
  const personaConstraint = buildNpcPersonaConstraintBlock(
    context.persona,
    context.trainingExamples ?? [],
    context.memoryAnchors ?? []
  );

  return [
    `NPC 名称：${npcName}`,
    personaConstraint ? ["", personaConstraint].join("\n") : undefined,
    "",
    "最近同范围 NPC 叙事记录：",
    history,
    "",
    "玩家消息：",
    playerText,
    "",
    "请根据本地 NPC 真人感训练规则，生成这名 NPC 此刻会说出口的一段中文回应。必须承接最近叙事记录，不能忘记、复读或轻微改写已经发生过的 NPC 发言。"
  ].filter((part): part is string => part != null).join("\n");
}

export function buildTrainingPrompt(feedbackText: string): string {
  return [
    "训练输入：",
    feedbackText,
    "",
    "请按 npc-live-roleplay 的训练流程处理这条输入：提取可复用修正，必要时给出改写。"
  ].join("\n");
}

export function formatTrainingLogExcerpt(trainingLog: string, maxChars = 900): string {
  const trimmed = trainingLog.trim();
  if (trimmed === "") return "训练记录还是空的。";

  const sections = trimmed.split(/\n(?=##\s+)/);
  const latestSection = sections.at(-1)?.trim() ?? trimmed;
  const excerpt = latestSection.length <= maxChars
    ? latestSection
    : `...${latestSection.slice(Math.max(0, latestSection.length - maxChars + 3)).trimStart()}`;
  return `训练记录摘录：\n${excerpt}`;
}

export function appendTrainingNote(trainingLogPath: string, note: string, source: string, now = new Date()): void {
  const cleanNote = note.trim();
  if (cleanNote === "") throw new Error("训练记录不能为空");

  const entry = [
    "",
    `## ${formatLocalDate(now)} QQ Training Note`,
    "",
    `Source: ${source}`,
    "",
    cleanNote,
    ""
  ].join("\n");

  fs.mkdirSync(path.dirname(trainingLogPath), { recursive: true });
  fs.appendFileSync(trainingLogPath, entry, "utf8");
}

function readRequiredText(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`NPC Skill 文件缺失：${filePath}`);
    }
    throw error;
  }
}

function section(title: string, text: string): string {
  return `--- ${title} ---\n${text.trim()}`;
}

function clipTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `...${text.slice(Math.max(0, text.length - maxChars + 3)).trimStart()}`;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}
