import crypto from "node:crypto";
import { cocCheck, displaySkillName, normalizeSkillName, validateTarget } from "../coc.js";
import { DiceError, rollExpression, type RandomSource } from "../dice.js";
import type { BotStorage, PrivateGroupRecipient, SkillInput } from "../storage.js";
import type { AiReplyClient } from "../ai/client.js";
import { buildAiContextInstructions, parseMemorySkillNote, rememberImportantPlayerStatement } from "../narrativeContext.js";
import {
  DEFAULT_MEMBER_ROLE,
  canUseAiCommands,
  canUseKeeperCommands,
  describeMemberRole,
  formatMemberRole,
  normalizeMemberRole,
  roleUsageText,
  type MemberRole
} from "../roles.js";
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

export interface EffectiveCommandContext extends CommandContext {
  boundFromC2c?: boolean;
  privateUserId?: string;
  role?: MemberRole;
}

export interface CommandDeps {
  storage: BotStorage;
  rng?: RandomSource;
  aiClient?: AiReplyClient;
  npcSkillRoot?: string;
  moduleImportsRoot?: string;
  privateMessenger?: PrivateMessageSender;
}

export interface PrivateMessageSendRequest {
  privateUserId: string;
  content: string;
  sourceKind: string;
}

export type PrivateMessageSender = (request: PrivateMessageSendRequest) => Promise<void>;

const PRIVATE_PUSH_WINDOW_MS = 30 * 24 * 60 * 60_000;
const PRIVATE_PUSH_LIMIT_PER_WINDOW = 4;
const PRIVATE_INBOX_LIMIT = 10;

export async function handleCommand(rawText: string, context: CommandContext, deps: CommandDeps): Promise<string | null> {
  const text = rawText.trim();
  if (!text.startsWith(".")) return null;

  const match = text.match(/^\.([a-zA-Z]+|[\u4e00-\u9fa5]+)\s*(.*)$/);
  if (!match) return helpText();

  const command = match[1].toLowerCase();
  const rest = match[2].trim();
  const rng = deps.rng ?? Math.random;
  const effectiveContext = shouldUseActualContext(command)
    ? context
    : resolveEffectiveCommandContext(context, deps.storage);

  try {
    assertCommandPermission(command, rest, effectiveContext, deps.storage);
    switch (command) {
      case "help":
      case "h":
      case "帮助":
        return helpText();
      case "bind":
      case "绑定":
      case "綁定":
        return bindCommand(rest, context, deps.storage);
      case "unbind":
      case "解绑":
      case "解綁":
        return unbindCommand(context, deps.storage);
      case "context":
      case "ctx":
      case "上下文":
        return contextCommand(context, deps.storage);
      case "register":
      case "role":
      case "whoami":
      case "身份":
      case "注册":
        return roleCommand(rest, context, deps.storage);
      case "pm":
      case "私聊":
      case "私信":
        return privateMessagingCommand(rest, context, deps.storage);
      case "inbox":
      case "收件箱":
        return inboxCommand(context, deps.storage);
      case "r":
      case "rd":
        return rollCommand(rest, rng);
      case "ra":
      case "rc":
        return checkCommand(rest, effectiveContext, deps.storage, rng);
      case "sc":
        return sanCheckCommand(rest, effectiveContext, deps.storage, rng);
      case "ai":
      case "gpt":
      case "chat":
        return aiCommand(rest, effectiveContext, deps);
      case "npc":
        return npcCommand(rest, effectiveContext, deps);
      case "secret":
      case "秘密":
        return secretCommand(rest, effectiveContext, deps);
      case "npcdm":
      case "npc私聊":
        return npcDirectMessageCommand(rest, effectiveContext, deps);
      case "train":
      case "训练":
        return trainingCommand(rest, effectiveContext, deps);
      case "mem":
      case "memory":
      case "记忆":
      case "remember":
      case "记住":
      case "牢记":
        return playerMemoryCommand(rest, effectiveContext, deps.storage);
      case "st":
        return setCharacterCommand(rest, effectiveContext, deps.storage);
      case "show":
      case "pc":
        return showCharacterCommand(effectiveContext, deps.storage);
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

const BIND_CODE_TTL_MS = 10 * 60_000;

export function resolveEffectiveCommandContext(context: CommandContext, storage: BotStorage): EffectiveCommandContext {
  if (context.scopeType !== "c2c") return context;
  const binding = storage.getPrivateGroupBinding(context.userId);
  if (!binding) return context;
  return {
    scopeType: "group",
    scopeId: binding.groupOpenid,
    userId: binding.groupUserId ?? context.userId,
    boundFromC2c: true,
    privateUserId: context.userId,
    role: binding.role
  };
}

function shouldUseActualContext(command: string): boolean {
  return [
    "bind",
    "绑定",
    "綁定",
    "unbind",
    "解绑",
    "解綁",
    "context",
    "ctx",
    "上下文",
    "register",
    "role",
    "whoami",
    "身份",
    "注册",
    "pm",
    "私聊",
    "私信",
    "inbox",
    "收件箱"
  ].includes(command);
}

export function getContextRole(context: CommandContext, storage: BotStorage): MemberRole {
  const explicitRole = (context as EffectiveCommandContext).role;
  if (explicitRole) return explicitRole;
  if (context.scopeType === "group") {
    return storage.getMemberRole("group", context.scopeId, context.userId) ?? DEFAULT_MEMBER_ROLE;
  }
  const binding = storage.getPrivateGroupBinding(context.userId);
  if (binding?.groupUserId) return binding.role;
  return storage.getMemberRole("c2c", context.scopeId, context.userId) ?? DEFAULT_MEMBER_ROLE;
}

function assertCommandPermission(command: string, rest: string, context: CommandContext, storage: BotStorage): void {
  const role = getContextRole(context, storage);
  if (isKeeperOnlyCommand(command) && !canUseKeeperCommands(role)) {
    throw new Error(`只有 KP 身份可以使用这个指令。当前身份：${formatMemberRole(role)}。请先让KP用 .role @成员 KP/PL/OB 调整身份。`);
  }
  if (isAiCommand(command) && !canUseAiCommands(role)) {
    throw new Error("OB 身份不能调用 AI 指令。请先由KP调整身份，或只使用 .help/.context/.bind/.pm/.inbox 等基础指令。");
  }
  if (isCrossPlayerMemoryRead(command, rest) && !canUseKeeperCommands(role)) {
    throw new Error(`只有 KP 可以查看全团或其他PL的记录。当前身份：${formatMemberRole(role)}。`);
  }
}

function isAiCommand(command: string): boolean {
  return ["ai", "gpt", "chat"].includes(command);
}

function isKeeperOnlyCommand(command: string): boolean {
  return [
    "npc",
    "secret",
    "秘密",
    "npcdm",
    "npc私聊",
    "train",
    "训练"
  ].includes(command);
}

function isCrossPlayerMemoryRead(command: string, rest: string): boolean {
  if (!["mem", "memory", "记忆", "remember", "记住", "牢记"].includes(command)) return false;
  return /^(?:show|list|查看|列表)\s+(?:all|全部|全团|所有人)\b/i.test(rest.trim());
}

function roleCommand(rest: string, context: CommandContext, storage: BotStorage): string {
  if (rest.trim() === "") return roleStatusText(context, storage);

  const parsed = parseRoleAssignment(rest);
  if (context.scopeType === "group") {
    return assignScopedRole({
      storage,
      scopeType: "group",
      scopeId: context.scopeId,
      actorUserId: context.userId,
      targetUserId: parsed.targetUserId ?? context.userId,
      role: parsed.role
    });
  }

  const binding = storage.getPrivateGroupBinding(context.userId);
  if (binding?.groupUserId) {
    const targetUserId = parsed.targetUserId ?? binding.groupUserId;
    const result = assignScopedRole({
      storage,
      scopeType: "group",
      scopeId: binding.groupOpenid,
      actorUserId: binding.groupUserId,
      targetUserId,
      role: parsed.role
    });
    if (targetUserId === binding.groupUserId) {
      storage.setPrivateGroupBinding(context.userId, binding.groupOpenid, binding.groupUserId, parsed.role);
    }
    return `${result}\n私聊上下文已同步到群身份。`;
  }

  if (parsed.targetUserId && parsed.targetUserId !== context.userId) {
    throw new Error("未绑定群上下文的私聊只能登记自己的身份。请先在群里 .bind 后再私聊绑定。");
  }
  storage.setMemberRole("c2c", context.scopeId, context.userId, parsed.role, context.userId);
  return `已登记私聊身份：${describeMemberRole(parsed.role)}`;
}

function assignScopedRole(input: {
  storage: BotStorage;
  scopeType: "group" | "c2c";
  scopeId: string;
  actorUserId: string;
  targetUserId: string;
  role: MemberRole;
}): string {
  const actorRole = input.storage.getMemberRole(input.scopeType, input.scopeId, input.actorUserId) ?? DEFAULT_MEMBER_ROLE;
  const isSelf = input.actorUserId === input.targetUserId;
  const hasKeeper = input.storage.scopeHasRole(input.scopeType, input.scopeId, "kp");
  if (!isSelf && !canUseKeeperCommands(actorRole)) {
    throw new Error("只有 KP 可以调整其他成员的身份。");
  }
  if (input.role === "kp" && hasKeeper && !canUseKeeperCommands(actorRole)) {
    throw new Error("本团已经有 KP。只有现有 KP 可以继续授权新的 KP。");
  }

  input.storage.setMemberRole(input.scopeType, input.scopeId, input.targetUserId, input.role, input.actorUserId);
  return `已登记身份：${input.targetUserId} = ${describeMemberRole(input.role)}`;
}

function parseRoleAssignment(rest: string): { targetUserId?: string; role: MemberRole } {
  const parts = rest.trim().split(/\s+/).filter(Boolean);
  const role = normalizeMemberRole(parts.at(-1));
  if (!role) throw new Error(roleUsageText());
  const targetText = parts.slice(0, -1).join(" ").trim();
  const targetUserId = targetText === "" ? undefined : normalizeRecipientId(targetText, true) ?? targetText;
  return { targetUserId, role };
}

function roleStatusText(context: CommandContext, storage: BotStorage): string {
  if (context.scopeType === "group") {
    const role = getContextRole(context, storage);
    return `当前群身份：${describeMemberRole(role)}\n${roleUsageText()}`;
  }

  const binding = storage.getPrivateGroupBinding(context.userId);
  if (binding?.groupUserId) {
    return `当前私聊已绑定群成员 ${binding.groupUserId}，群身份：${describeMemberRole(binding.role)}\n${roleUsageText()}`;
  }

  const role = getContextRole(context, storage);
  return `当前私聊身份：${describeMemberRole(role)}\n${roleUsageText()}`;
}

function bindRoleFromRest(rest: string, fallbackRole: MemberRole): MemberRole {
  if (rest.trim() === "") return fallbackRole;
  const role = normalizeMemberRole(rest);
  if (!role) throw new Error(roleUsageText());
  return role;
}

function bindCommand(rest: string, context: CommandContext, storage: BotStorage): string {
  if (context.scopeType === "group") {
    const code = crypto.randomBytes(4).toString("hex");
    const role = bindRoleFromRest(rest, getContextRole(context, storage));
    assignScopedRole({
      storage,
      scopeType: "group",
      scopeId: context.scopeId,
      actorUserId: context.userId,
      targetUserId: context.userId,
      role
    });
    storage.createContextBindingCode({
      code,
      groupOpenid: context.scopeId,
      groupUserId: context.userId,
      role,
      expiresAtMs: Date.now() + BIND_CODE_TTL_MS
    });
    return [
      `私聊上下文绑定码：${code}`,
      "10 分钟内私聊我发送：.bind " + code,
      `绑定身份：${formatMemberRole(role)}。绑定后，私聊里的 .ai/.npc/.ra/.show 会使用这个群的跑团上下文；如需接收秘密私聊，再发送 .pm on。`
    ].join("\n");
  }

  if (rest === "") return contextCommand(context, storage);

  const groupMatch = rest.match(/^group\s+(\S+)(?:\s+(\S+))?$/i);
  if (groupMatch) {
    const role = groupMatch[2] ? normalizeMemberRole(groupMatch[2]) : DEFAULT_MEMBER_ROLE;
    if (!role) throw new Error(roleUsageText());
    if (role === "kp") throw new Error("KP 身份必须先在群里发送 .bind KP 生成绑定码，再私聊绑定。");
    storage.setPrivateGroupBinding(context.userId, groupMatch[1], undefined, role);
    return `已绑定到群上下文：${maskOpenid(groupMatch[1])}，身份：${formatMemberRole(role)}。如需接收 KP 秘密私聊，请继续发送 .pm on。`;
  }

  const codeMatch = rest.match(/^(?:code\s+)?([a-z0-9]{6,16})(?:\s+(\S+))?$/i);
  if (!codeMatch) {
    throw new Error("用法：在群里发送 .bind KP/PL/OB 生成绑定码；再私聊发送 .bind 绑定码。也可私聊 .bind group 群openid PL");
  }

  const bindingCode = storage.consumeContextBindingCode(codeMatch[1]);
  if (!bindingCode) throw new Error("绑定码无效或已过期，请回群里重新发送 .bind 生成新码");

  const role = codeMatch[2] ? normalizeMemberRole(codeMatch[2]) : bindingCode.role ?? DEFAULT_MEMBER_ROLE;
  if (!role) throw new Error(roleUsageText());
  assignScopedRole({
    storage,
    scopeType: "group",
    scopeId: bindingCode.groupOpenid,
    actorUserId: bindingCode.groupUserId,
    targetUserId: bindingCode.groupUserId,
    role
  });
  storage.setPrivateGroupBinding(context.userId, bindingCode.groupOpenid, bindingCode.groupUserId, role);
  return `已绑定到群上下文：${maskOpenid(bindingCode.groupOpenid)}，身份：${formatMemberRole(role)}。如需接收 KP 秘密私聊，请继续发送 .pm on。`;
}

function unbindCommand(context: CommandContext, storage: BotStorage): string {
  if (context.scopeType !== "c2c") return "群聊本身已经是群上下文，不需要解绑。";
  const cleared = storage.clearPrivateGroupBinding(context.userId);
  if (cleared) storage.setPrivateMessagingEnabled(context.userId, false);
  return cleared
    ? "已解除私聊群上下文绑定，并停止接收 KP 秘密私聊。"
    : "当前私聊没有绑定群上下文。";
}

function contextCommand(context: CommandContext, storage: BotStorage): string {
  if (context.scopeType === "group") {
    return `当前上下文：这个QQ群。当前身份：${formatMemberRole(getContextRole(context, storage))}。私聊绑定请先在群里发送 .bind KP/PL/OB 生成绑定码。`;
  }

  const binding = storage.getPrivateGroupBinding(context.userId);
  if (!binding) {
    return "当前上下文：C2C私聊。还没有绑定群；请先在群里发送 .bind，再私聊我 .bind 绑定码。";
  }

  const groupUserNote = binding.groupUserId ? "，会沿用你在群里的成员身份" : "，未记录群成员身份";
  const roleNote = `，身份 ${formatMemberRole(binding.role)}`;
  const permission = storage.getPrivateMessagePermission(context.userId);
  const pmNote = permission?.enabled ? "，已允许 KP 秘密私聊" : "，未开启 KP 秘密私聊";
  return `当前上下文：已绑定QQ群 ${maskOpenid(binding.groupOpenid)}${groupUserNote}${roleNote}${pmNote}。`;
}

function privateMessagingCommand(rest: string, context: CommandContext, storage: BotStorage): string {
  if (context.scopeType !== "c2c") {
    return "请先私聊机器人：先用 .bind 绑定群上下文，再发送 .pm on 开启 KP 秘密私聊。";
  }

  const action = rest.trim().toLowerCase();
  if (action === "" || action === "status" || action === "状态") {
    const binding = storage.getPrivateGroupBinding(context.userId);
    const permission = storage.getPrivateMessagePermission(context.userId);
    const pendingCount = storage.getPendingPrivateOutboxMessages(context.userId, PRIVATE_INBOX_LIMIT).length;
    if (!binding) return "当前没有绑定群上下文。请先在群里发送 .bind，再私聊我 .bind 绑定码。";
    const enabled = permission?.enabled ? "已开启" : "未开启";
    const active = permission?.activeMessagesAllowed === false ? "QQ 主动私聊当前不可用" : "QQ 主动私聊可用";
    const inboxNote = pendingCount > 0 ? `；有 ${pendingCount} 条待取消息，可发送 .inbox` : "";
    return `KP 秘密私聊：${enabled}，${active}${inboxNote}。回复 .pm on 开启，.pm off 关闭。`;
  }

  if (action === "on" || action === "开启" || action === "订阅") {
    const binding = storage.getPrivateGroupBinding(context.userId);
    if (!binding) return "请先绑定群上下文：在群里发送 .bind，再私聊我 .bind 绑定码。";
    if (!binding.groupUserId) return "当前绑定缺少群成员身份。请在群里重新发送 .bind 生成绑定码，再私聊绑定。";
    storage.setPrivateMessagingEnabled(context.userId, true);
    const pendingCount = storage.getPendingPrivateOutboxMessages(context.userId, PRIVATE_INBOX_LIMIT).length;
    const inboxNote = pendingCount > 0 ? ` 当前有 ${pendingCount} 条待取消息，可发送 .inbox。` : "";
    return `已开启 KP 秘密私聊。之后 KP 可以向你的私聊发送秘密线索或 NPC 私聊；回复 .pm off 可随时关闭。${inboxNote}`;
  }

  if (action === "off" || action === "关闭" || action === "退订") {
    storage.setPrivateMessagingEnabled(context.userId, false);
    return "已关闭 KP 秘密私聊。之后不会主动私聊你；已存入收件箱的消息仍可用 .inbox 自取。";
  }

  if (action === "inbox" || action === "收件箱") {
    return inboxCommand(context, storage);
  }

  return "用法：.pm on 开启；.pm off 关闭；.pm status 查看；.inbox 领取待取私密消息。";
}

function inboxCommand(context: CommandContext, storage: BotStorage): string {
  if (context.scopeType !== "c2c") return "请私聊机器人发送 .inbox 领取待取私密消息。";

  const messages = storage.getPendingPrivateOutboxMessages(context.userId, PRIVATE_INBOX_LIMIT);
  if (messages.length === 0) return "当前没有待领取的私密消息。";
  storage.markPrivateOutboxMessagesSent(messages.map((message) => message.id));
  return [
    `待领取私密消息（${messages.length}）：`,
    ...messages.map((message, index) => {
      const title = message.sourceKind === "npcdm"
        ? `NPC私聊${message.actorName ? `｜${message.actorName}` : ""}`
        : "秘密线索";
      return `${index + 1}. 【${title}】${message.content}`;
    }),
    "",
    "已标记为领取。回复 .pm off 可停止接收 KP 秘密私聊。"
  ].join("\n");
}

function maskOpenid(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 10) return trimmed;
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

async function secretCommand(rest: string, context: EffectiveCommandContext, deps: CommandDeps): Promise<string> {
  if (context.scopeType !== "group") throw new Error("请在群里使用 .secret，或先私聊 .bind 到群上下文后再使用。");
  const parsed = parsePrivateMessageArgs(rest, "用法：.secret @成员 你在镜子背后看到一行旧字。多个目标可写 @成员1,@成员2");
  return deliverPrivateMessages({
    context,
    deps,
    sourceKind: "secret",
    eventKind: "private_secret",
    rawContent: parsed.text,
    sendContent: buildPrivateMessageContent("秘密线索", parsed.text),
    recipientIds: parsed.recipientIds
  });
}

async function npcDirectMessageCommand(rest: string, context: EffectiveCommandContext, deps: CommandDeps): Promise<string> {
  if (context.scopeType !== "group") throw new Error("请在群里使用 .npcdm，或先私聊 .bind 到群上下文后再使用。");
  if (!deps.aiClient) throw new Error("AI 未启用，请先在 .env 配置 OPENAI_API_KEY，并确认 AI_REPLY_MODE 不是 off");

  const match = rest.match(/^(\S+)\s+([\s\S]+)$/);
  if (!match) throw new Error("用法：.npcdm 张管家 @成员 玩家问：你为什么怕钟声？");
  const npcName = match[1].trim();
  const parsed = parsePrivateMessageArgs(match[2], "用法：.npcdm 张管家 @成员 玩家问：你为什么怕钟声？");
  const bundle = loadNpcLiveRoleplaySkill(deps.npcSkillRoot);
  const recentHistory = deps.storage
    .getRecentNarrativeEvents({
      scopeType: context.scopeType,
      scopeId: context.scopeId,
      limit: 24
    })
    .filter((event) => (event.kind === "npc_reply" || event.kind === "npc_private_reply") && event.actorName === npcName)
    .slice(-6);
  const reply = await deps.aiClient.createReply({
    text: buildNpcReplyPrompt(npcName, parsed.text, recentHistory),
    scopeType: context.scopeType,
    scopeId: context.scopeId,
    userId: context.userId,
    trigger: "command",
    instructions: buildNpcLiveRoleplayInstructions(bundle, "npc")
  });

  return deliverPrivateMessages({
    context,
    deps,
    sourceKind: "npcdm",
    eventKind: "npc_private_reply",
    actorName: npcName,
    inputText: parsed.text,
    rawContent: reply,
    sendContent: buildPrivateMessageContent(`NPC私聊｜${npcName}`, reply),
    recipientIds: parsed.recipientIds
  });
}

interface ParsedPrivateMessageArgs {
  recipientIds: string[];
  text: string;
}

function parsePrivateMessageArgs(rest: string, usage: string): ParsedPrivateMessageArgs {
  const parts = rest.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) throw new Error(usage);

  const recipientIds: string[] = [];
  let textStartIndex = 0;
  for (let index = 0; index < parts.length; index += 1) {
    if (index > 0 && !looksLikeExplicitRecipientToken(parts[index])) break;
    const ids = extractRecipientIds(parts[index], index === 0);
    if (ids.length === 0) break;
    recipientIds.push(...ids);
    textStartIndex = index + 1;
  }

  const text = parts.slice(textStartIndex).join(" ").trim();
  const uniqueRecipientIds = [...new Set(recipientIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueRecipientIds.length === 0 || text === "") throw new Error(usage);
  return { recipientIds: uniqueRecipientIds, text };
}

function looksLikeExplicitRecipientToken(token: string): boolean {
  return /^<@!?[^>]+>$/.test(token)
    || /^@/.test(token)
    || /^(?:member|pc|pl|user):/i.test(token)
    || /[,，、;；]/.test(token);
}

function extractRecipientIds(token: string, isFirstToken: boolean): string[] {
  const pieces = token.split(/[,，、;；]+/).map((piece) => piece.trim()).filter(Boolean);
  const ids = pieces
    .map((piece) => normalizeRecipientId(piece, isFirstToken))
    .filter((piece): piece is string => piece != null && piece !== "");
  if (!isFirstToken && ids.length !== pieces.length) return [];
  return ids;
}

function normalizeRecipientId(raw: string, allowBare: boolean): string | undefined {
  const mention = raw.match(/^<@!?([^>]+)>$/);
  if (mention) return mention[1].trim();
  const prefixed = raw.match(/^(?:member|pc|pl|user):(.+)$/i);
  if (prefixed) return prefixed[1].trim();
  if (raw.startsWith("@")) return raw.slice(1).trim();
  return allowBare ? raw.trim() : undefined;
}

interface PrivateDeliveryInput {
  context: EffectiveCommandContext;
  deps: CommandDeps;
  sourceKind: "secret" | "npcdm";
  eventKind: "private_secret" | "npc_private_reply";
  actorName?: string;
  inputText?: string;
  rawContent: string;
  sendContent: string;
  recipientIds: string[];
}

interface PrivateDeliveryReport {
  groupUserId: string;
  privateUserId?: string;
  status: "sent" | "queued" | "missing";
  reason?: string;
}

async function deliverPrivateMessages(input: PrivateDeliveryInput): Promise<string> {
  const reports: PrivateDeliveryReport[] = [];
  const now = Date.now();

  for (const groupUserId of input.recipientIds) {
    const recipient = input.deps.storage.getPrivateRecipientByGroupMember(input.context.scopeId, groupUserId);
    if (!recipient) {
      reports.push({ groupUserId, status: "missing", reason: "该群成员还没有完成 .bind 和 .pm on" });
      continue;
    }

    const blockReason = privatePushBlockReason(input.deps.storage, recipient, now);
    const outboxId = input.deps.storage.addPrivateOutboxMessage({
      privateUserId: recipient.privateUserId,
      groupOpenid: input.context.scopeId,
      groupUserId,
      sourceKind: input.sourceKind,
      actorName: input.actorName,
      content: input.rawContent,
      createdByUserId: input.context.userId,
      metadata: {
        createdByScopeType: input.context.scopeType,
        inputText: input.inputText
      }
    });

    let status: PrivateDeliveryReport["status"] = "queued";
    let reason = blockReason;
    if (!reason && input.deps.privateMessenger && outboxId != null) {
      try {
        await input.deps.privateMessenger({
          privateUserId: recipient.privateUserId,
          content: input.sendContent,
          sourceKind: input.sourceKind
        });
        input.deps.storage.markPrivateOutboxSent(outboxId);
        input.deps.storage.addPrivateDelivery({
          privateUserId: recipient.privateUserId,
          groupOpenid: input.context.scopeId,
          groupUserId,
          sourceKind: input.sourceKind,
          sentAtMs: now
        });
        status = "sent";
      } catch (error) {
        reason = `发送失败，已留在收件箱：${errorMessage(error)}`;
      }
    } else if (!reason && !input.deps.privateMessenger) {
      reason = "当前运行环境未接入私聊发送器，已留在收件箱";
    }

    input.deps.storage.addNarrativeEvent({
      kind: input.eventKind,
      scopeType: "group",
      scopeId: input.context.scopeId,
      userId: groupUserId,
      actorName: input.actorName,
      inputText: input.inputText,
      outputText: input.rawContent,
      metadata: {
        command: input.sourceKind,
        createdByUserId: input.context.userId,
        privateUserId: recipient.privateUserId,
        outboxId,
        deliveryStatus: status,
        deliveryReason: reason
      }
    });

    reports.push({
      groupUserId,
      privateUserId: recipient.privateUserId,
      status,
      reason
    });
  }

  return formatPrivateDeliverySummary(input.sourceKind, reports);
}

function privatePushBlockReason(storage: BotStorage, recipient: PrivateGroupRecipient, now: number): string | undefined {
  if (!recipient.privateMessagesEnabled) return "玩家未私聊发送 .pm on，已留在收件箱";
  if (!recipient.activeMessagesAllowed) return "玩家 QQ 主动私聊开关不可用，已留在收件箱";
  if (recipient.lastPrivateActivityAtMs == null) return "没有玩家 C2C 互动记录，已留在收件箱";
  if (now - recipient.lastPrivateActivityAtMs > PRIVATE_PUSH_WINDOW_MS) {
    return "超过 30 天 C2C 互动窗口，已留在收件箱";
  }
  const deliveries = storage.countPrivateDeliveriesSince(recipient.privateUserId, now - PRIVATE_PUSH_WINDOW_MS);
  if (deliveries >= PRIVATE_PUSH_LIMIT_PER_WINDOW) {
    return "30 天主动私聊保护额度已用完，已留在收件箱";
  }
  return undefined;
}

function formatPrivateDeliverySummary(sourceKind: "secret" | "npcdm", reports: readonly PrivateDeliveryReport[]): string {
  const label = sourceKind === "npcdm" ? "NPC私聊" : "秘密线索";
  const sent = reports.filter((report) => report.status === "sent");
  const queued = reports.filter((report) => report.status === "queued");
  const missing = reports.filter((report) => report.status === "missing");
  return [
    `${label}处理完成：已发送 ${sent.length}，待玩家私聊 .inbox 领取 ${queued.length}，未找到 ${missing.length}。`,
    ...sent.map((report) => `已发送：${report.groupUserId}`),
    ...queued.map((report) => `待领取：${report.groupUserId}（${report.reason ?? "已留在收件箱"}）`),
    ...missing.map((report) => `未找到：${report.groupUserId}（${report.reason ?? "未绑定"}）`)
  ].join("\n");
}

function buildPrivateMessageContent(title: string, content: string): string {
  return [
    `【${title}】`,
    content.trim(),
    "",
    "回复 .pm off 可停止接收 KP 秘密私聊。"
  ].join("\n");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  const speakerRole = getContextRole(context, deps.storage);
  const reply = await deps.aiClient.createReply({
    text: rest,
    scopeType: context.scopeType,
    scopeId: context.scopeId,
    userId: context.userId,
    speakerRole,
    trigger: "command",
    instructions: buildAiContextInstructions({
      userText: rest,
      storage: deps.storage,
      context,
      speakerRole,
      moduleImportsRoot: deps.moduleImportsRoot
    })
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
  rememberImportantPlayerStatement(deps.storage, context, rest, "ai_command");
  return reply;
}

function playerMemoryCommand(rest: string, context: CommandContext, storage: BotStorage): string {
  if (rest === "" || /^(help|h|帮助)$/i.test(rest)) return playerMemoryHelpText();

  const showMatch = rest.match(/^(show|list|查看|列表)(?:\s+(all|全部|全团|所有人))?$/i);
  if (showMatch) {
    const memories = showMatch[2]
      ? storage.getRecentScopePlayerMemories({
          scopeType: context.scopeType,
          scopeId: context.scopeId,
          limit: 20
        })
      : storage.getRecentPlayerMemories({
          scopeType: context.scopeType,
          scopeId: context.scopeId,
          userId: context.userId,
          limit: 12
        });
    if (memories.length === 0) return "还没有记录这个玩家的关键人物记忆。";
    return [
      showMatch[2] ? "这个跑团的关键人物记忆：" : "这个玩家的关键人物记忆：",
      ...memories.map((memory, index) => {
        const usage = memory.usageHint ? `；使用时机：${memory.usageHint}` : "";
        const owner = showMatch[2] ? `玩家${maskOpenid(memory.userId)} ` : "";
        return `${index + 1}. ${owner}[${memory.category}] ${memory.memoryText}${usage}`;
      })
    ].join("\n");
  }

  const note = parseMemorySkillNote(rest, "手动记录");
  if (!note) throw new Error("用法：.mem note 角色决定保护同伴；用在：同伴遇险时");
  const inserted = storage.addPlayerMemory({
    scopeType: context.scopeType,
    scopeId: context.scopeId,
    userId: context.userId,
    category: note.category,
    memoryText: note.memoryText,
    usageHint: note.usageHint,
    sourceKind: "manual_command"
  });
  if (!inserted) return "这条人物记忆已经记录过了。";
  return note.usageHint
    ? `已记入这个玩家的关键人物记忆。使用时机：${note.usageHint}`
    : "已记入这个玩家的关键人物记忆。";
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

function playerMemoryHelpText(): string {
  return [
    "桌边记忆技能：",
    ".记住 角色决定保护同伴；用在：同伴遇险时",
    ".mem show 查看这个玩家的关键人物记忆",
    ".mem show all 查看这个跑团的关键人物记忆"
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
    ".secret @成员 秘密线索 / .npcdm 张管家 @成员 玩家问：...",
    ".pm on / .pm off / .inbox（私聊中使用）",
    ".记住 角色决定保护同伴；用在：同伴遇险时 / .mem show",
    ".train show / .train note 训练教训",
    ".register KP|PL|OB / .role @成员 KP|PL|OB",
    ".bind KP|PL|OB / .bind 绑定码 / .context / .unbind",
    ".st 侦查60 聆听50 san60",
    ".show"
  ].join("\n");
}
