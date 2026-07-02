import { cocCheck, displaySkillName, normalizeSkillName, validateTarget } from "../coc.js";
import { DiceError, rollExpression, type RandomSource } from "../dice.js";
import type { BotStorage, SkillInput } from "../storage.js";
import type { AiReplyClient } from "../ai/client.js";
import { buildLocalModuleKnowledgeInstructions } from "../moduleKnowledge.js";
import {
  appendTrainingNote,
  buildNpcLiveRoleplayInstructions,
  buildNpcReplyPrompt,
  buildTrainingPrompt,
  formatTrainingLogExcerpt,
  loadNpcLiveRoleplaySkill
} from "../npcSkill.js";

export interface CommandContext {
  scopeType: "group" | "c2c";
  scopeId: string;
  userId: string;
}

export interface CommandDeps {
  storage: BotStorage;
  rng?: RandomSource;
  aiClient?: AiReplyClient;
  npcSkillRoot?: string;
  moduleImportsRoot?: string;
}

export async function handleCommand(rawText: string, context: CommandContext, deps: CommandDeps): Promise<string | null> {
  const text = rawText.trim();
  if (!text.startsWith(".")) return null;

  const match = text.match(/^\.([a-zA-Z]+|[\u4e00-\u9fa5]+)\s*(.*)$/);
  if (!match) return helpText();

  const command = match[1].toLowerCase();
  const rest = match[2].trim();
  const rng = deps.rng ?? Math.random;

  try {
    switch (command) {
      case "help":
      case "h":
      case "帮助":
        return helpText();
      case "r":
      case "rd":
        return rollCommand(rest, rng);
      case "ra":
      case "rc":
        return checkCommand(rest, context, deps.storage, rng);
      case "sc":
        return sanCheckCommand(rest, context, deps.storage, rng);
      case "ai":
      case "gpt":
      case "chat":
        return aiCommand(rest, context, deps);
      case "npc":
        return npcCommand(rest, context, deps);
      case "train":
      case "训练":
        return trainingCommand(rest, context, deps);
      case "st":
        return setCharacterCommand(rest, context, deps.storage);
      case "show":
      case "pc":
        return showCharacterCommand(context, deps.storage);
      default:
        return `未知指令：.${command}\n\n${helpText()}`;
    }
  } catch (error) {
    if (error instanceof DiceError || error instanceof Error) {
      return `指令错误：${error.message}`;
    }
    return "指令错误：无法处理这条指令";
  }
}

async function npcCommand(rest: string, context: CommandContext, deps: CommandDeps): Promise<string> {
  if (rest === "") throw new Error("用法：.npc 张管家 玩家问：昨晚钟楼亮灯时你在哪里？");
  if (!deps.aiClient) throw new Error("AI 未启用，请先在 .env 配置 OPENAI_API_KEY，并确认 AI_REPLY_MODE 不是 off");

  const parsed = parseNpcCommand(rest);
  const bundle = loadNpcLiveRoleplaySkill(deps.npcSkillRoot);
  const recentHistory = deps.storage
    .getRecentNarrativeEvents({
      scopeType: context.scopeType,
      scopeId: context.scopeId,
      kind: "npc_reply",
      limit: 12
    })
    .filter((event) => event.actorName === parsed.npcName)
    .slice(-6);
  const reply = await deps.aiClient.createReply({
    text: buildNpcReplyPrompt(parsed.npcName, parsed.playerText, recentHistory),
    scopeType: context.scopeType,
    scopeId: context.scopeId,
    userId: context.userId,
    trigger: "command",
    instructions: buildNpcLiveRoleplayInstructions(bundle, "npc")
  });
  deps.storage.addNarrativeEvent({
    kind: "npc_reply",
    scopeType: context.scopeType,
    scopeId: context.scopeId,
    userId: context.userId,
    actorName: parsed.npcName,
    inputText: parsed.playerText,
    outputText: reply,
    metadata: { command: "npc" }
  });
  return reply;
}

async function trainingCommand(rest: string, context: CommandContext, deps: CommandDeps): Promise<string> {
  if (rest === "" || /^(help|h|帮助)$/i.test(rest)) return trainingHelpText();

  const bundle = loadNpcLiveRoleplaySkill(deps.npcSkillRoot);
  if (/^(show|log|查看|记录)$/i.test(rest)) {
    return formatTrainingLogExcerpt(bundle.trainingLog);
  }

  const noteMatch = rest.match(/^(?:note|save|add|记一条|保存|追加)\s+([\s\S]+)$/i);
  if (noteMatch) {
    appendTrainingNote(bundle.trainingLogPath, noteMatch[1], `QQ ${context.scopeType}`);
    return "已追加到 NPC 训练记录。";
  }

  if (!deps.aiClient) throw new Error("AI 未启用，请先在 .env 配置 OPENAI_API_KEY，并确认 AI_REPLY_MODE 不是 off");
  return deps.aiClient.createReply({
    text: buildTrainingPrompt(rest),
    scopeType: context.scopeType,
    scopeId: context.scopeId,
    userId: context.userId,
    trigger: "command",
    instructions: buildNpcLiveRoleplayInstructions(bundle, "training")
  });
}

async function aiCommand(rest: string, context: CommandContext, deps: CommandDeps): Promise<string> {
  if (rest === "") throw new Error("用法：.ai 你好，或 @机器人 你好");
  if (!deps.aiClient) throw new Error("AI 未启用，请先在 .env 配置 OPENAI_API_KEY，并确认 AI_REPLY_MODE 不是 off");
  const reply = await deps.aiClient.createReply({
    text: rest,
    scopeType: context.scopeType,
    scopeId: context.scopeId,
    userId: context.userId,
    trigger: "command",
    instructions: buildLocalModuleKnowledgeInstructions(rest, deps.moduleImportsRoot)
  });
  deps.storage.addNarrativeEvent({
    kind: "ai_reply",
    scopeType: context.scopeType,
    scopeId: context.scopeId,
    userId: context.userId,
    inputText: rest,
    outputText: reply,
    metadata: { command: "ai" }
  });
  return reply;
}

function rollCommand(rest: string, rng: RandomSource): string {
  if (rest === "") throw new Error("用法：.r 1d100 或 .r 2d6+3 原因");
  const [expression, ...reasonParts] = rest.split(/\s+/);
  const result = rollExpression(expression, rng);
  const reason = reasonParts.join(" ");
  return reason === "" ? `掷骰：${result.detail}` : `掷骰（${reason}）：${result.detail}`;
}

function checkCommand(rest: string, context: CommandContext, storage: BotStorage, rng: RandomSource): string {
  if (rest === "") throw new Error("用法：.ra 侦查 或 .ra 侦查 60");
  const parsed = parseSkillAndOptionalValue(rest);
  let target = parsed.value;
  let skillName = parsed.skillName;

  if (target == null) {
    const stored = storage.getSkill(context.scopeType, context.scopeId, context.userId, normalizeSkillName(skillName));
    if (!stored) throw new Error(`没有找到「${skillName}」的角色卡数值，请用 .ra ${skillName} 60 或先 .st ${skillName}60`);
    target = stored.value;
    skillName = stored.name;
  }

  validateTarget(target);
  const roll = rollExpression("1d100", rng).total;
  const check = cocCheck(target, roll);
  return `${displaySkillName(skillName)}检定：1D100=${roll}/${target}，${check.rank}`;
}

function sanCheckCommand(rest: string, context: CommandContext, storage: BotStorage, rng: RandomSource): string {
  const match = rest.match(/^(\S+)\/(\S+)(?:\s+(\d{1,3}))?$/);
  if (!match) throw new Error("用法：.sc 0/1d6 60");

  const successLossExpression = match[1];
  const failureLossExpression = match[2];
  const explicitSan = match[3] == null ? undefined : Number(match[3]);
  const storedSan = storage.getSkill(context.scopeType, context.scopeId, context.userId, "san");
  const san = explicitSan ?? storedSan?.value;
  if (san == null) throw new Error("缺少 SAN 数值，请用 .sc 0/1d6 60 或先 .st san60");
  validateTarget(san);

  const roll = rollExpression("1d100", rng).total;
  const check = cocCheck(san, roll);
  const lossExpression = check.success ? successLossExpression : failureLossExpression;
  const loss = rollExpression(lossExpression, rng);
  const remaining = Math.max(0, san - loss.total);
  return `SAN Check：1D100=${roll}/${san}，${check.rank}，损失 ${loss.total}（${loss.detail}），剩余参考 ${remaining}`;
}

function setCharacterCommand(rest: string, context: CommandContext, storage: BotStorage): string {
  const skills = parseSkillAssignments(rest);
  if (skills.length === 0) throw new Error("用法：.st 侦查60 聆听50 san60");
  storage.setSkills(context.scopeType, context.scopeId, context.userId, skills);
  return `已保存：${skills.map((skill) => `${displaySkillName(skill.name)}${skill.value}`).join("，")}`;
}

function showCharacterCommand(context: CommandContext, storage: BotStorage): string {
  const skills = storage.getSkills(context.scopeType, context.scopeId, context.userId);
  if (skills.length === 0) return "还没有角色卡。可用 .st 侦查60 聆听50 san60 保存。";
  return `角色卡：${skills.map((skill) => `${displaySkillName(skill.name)}${skill.value}`).join("，")}`;
}

function parseSkillAndOptionalValue(rest: string): { skillName: string; value?: number } {
  const compactMatch = rest.match(/^(.+?)(\d{1,3})$/);
  if (compactMatch) {
    return { skillName: compactMatch[1].trim(), value: Number(compactMatch[2]) };
  }

  const parts = rest.split(/\s+/);
  const last = parts.at(-1);
  if (last != null && /^\d{1,3}$/.test(last) && parts.length > 1) {
    return { skillName: parts.slice(0, -1).join(" "), value: Number(last) };
  }
  return { skillName: rest.trim() };
}

function parseSkillAssignments(rest: string): SkillInput[] {
  const normalized = rest.replace(/([^\s\d])\s+(\d{1,3})(?=\s|$)/g, "$1$2");
  const matches = [...normalized.matchAll(/([^\s\d]+)(\d{1,3})(?=\s|$)/g)];
  return matches.map((match) => {
    const rawName = match[1].trim();
    const value = Number(match[2]);
    validateTarget(value);
    const key = normalizeSkillName(rawName);
    return { key, name: displaySkillName(rawName), value };
  });
}

function parseNpcCommand(rest: string): { npcName: string; playerText: string } {
  const match = rest.match(/^(\S+)[\s:：]+([\s\S]+)$/);
  if (!match) throw new Error("用法：.npc 张管家 玩家问：昨晚钟楼亮灯时你在哪里？");
  return {
    npcName: match[1].trim(),
    playerText: match[2].trim()
  };
}

function trainingHelpText(): string {
  return [
    "NPC 训练命令：",
    ".npc 张管家 玩家问：昨晚钟楼亮灯时你在哪里？",
    ".train 回复太像 AI，3/10，请改得更像真人桌边扮演",
    ".train show 查看训练记录摘录",
    ".train note 这次教训：括号不要解释写作策略"
  ].join("\n");
}

function helpText(): string {
  return [
    "CoC 骰娘指令：",
    ".r 1d100 / .r 2d6+3 原因",
        ".ra 侦查 或 .ra 侦查 60",
        ".sc 0/1d6 60",
        ".ai 你好",
        ".npc 张管家 玩家问：昨晚钟楼亮灯时你在哪里？",
        ".train show / .train note 训练教训",
        ".st 侦查60 聆听50 san60",
        ".show"
  ].join("\n");
}
