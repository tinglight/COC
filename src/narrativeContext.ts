import { buildLocalModuleKnowledgeInstructions } from "./moduleKnowledge.js";
import type { BotStorage, StoredNarrativeEvent, StoredPlayerMemory } from "./storage.js";
import { DEFAULT_MEMBER_ROLE, formatMemberRole, type MemberRole } from "./roles.js";

export interface NarrativeContext {
  scopeType: "group" | "c2c";
  scopeId: string;
  userId?: string;
}

export interface AiContextInstructionInput {
  userText: string;
  storage: BotStorage;
  context: NarrativeContext;
  speakerRole?: MemberRole;
  moduleImportsRoot?: string;
}

const RECENT_CONTEXT_LIMIT = 12;
const MAX_RECENT_CONTEXT_CHARS = 3_600;
const PLAYER_MEMORY_LIMIT = 12;
const OTHER_PLAYER_MEMORY_LIMIT = 10;
const MAX_PLAYER_MEMORY_CONTEXT_CHARS = 1_800;
const MAX_EVENT_CHARS = 260;
const MAX_MEMORY_CHARS = 220;

export interface MemorySkillNote {
  category: string;
  memoryText: string;
  usageHint?: string;
}

export function buildAiContextInstructions(input: AiContextInstructionInput): string | undefined {
  const speakerRole = input.speakerRole ?? DEFAULT_MEMBER_ROLE;
  const parts = [
    buildRoleBoundaryInstructions(speakerRole),
    speakerRole === "kp" ? buildLocalModuleKnowledgeInstructions(input.userText, input.moduleImportsRoot) : undefined,
    buildPlayerMemoryInstructions(input.storage, input.context, speakerRole),
    buildRecentNarrativeContextInstructions(input.storage, input.context, speakerRole)
  ].filter((part): part is string => part != null && part.trim() !== "");

  return parts.length === 0 ? undefined : parts.join("\n\n");
}

function buildRoleBoundaryInstructions(role: MemberRole): string {
  const lines = [
    `当前说话者身份：${formatMemberRole(role)}。`,
    "KP 是管理者/守密人，可以查看 keeper-only、全团记录和所有命令结果；回答时仍要区分“给KP看的信息”和“可转述给PL/OB的信息”。",
    "PL 是参与者，只能获得已经公开、自己已收到或KP明确传递的信息；可以给浅提示和引导，但不能泄露隐藏真相、结局、暗线或其他PL的聊天/记忆。",
    "OB 是围观者，不参与游戏；如果因为兜底路径进入AI，应拒绝提供剧情秘密、规则裁定、NPC私聊和其他AI推进。"
  ];
  if (role === "kp") return lines.join("\n");
  if (role === "pl") {
    return [
      lines[0],
      lines[2],
      "不要使用本地模组 keeper-only/canon 秘密资料，也不要总结其他PL的聊天记录或私人记忆。"
    ].join("\n");
  }
  return [
    lines[0],
    lines[3],
    "只允许给非剧透的旁观说明；不要推进剧情或透露任何秘密。"
  ].join("\n");
}

export function rememberImportantPlayerStatement(
  storage: BotStorage,
  context: Required<NarrativeContext>,
  text: string,
  sourceKind: string
): boolean {
  const extracted = parseMemorySkillNote(text);
  if (!extracted) return false;

  return storage.addPlayerMemory({
    scopeType: context.scopeType,
    scopeId: context.scopeId,
    userId: context.userId,
    category: extracted.category,
    memoryText: extracted.memoryText,
    usageHint: extracted.usageHint,
    sourceKind,
    metadata: { autoCaptured: true }
  });
}

export function isMemorySkillText(text: string): boolean {
  return memorySkillPrefixPattern().test(text.trim());
}

export function parseMemorySkillNote(text: string, fallbackCategory = "玩家记忆"): MemorySkillNote | undefined {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length < 4) return undefined;

  const explicit = memorySkillPrefixPattern().exec(normalized);
  const withoutPrefix = explicit
    ? normalized.slice(explicit[0].length).trim()
    : normalized.replace(/^(?:note|add|save|记一条|保存|追加)\s+/i, "").trim();
  const parsed = splitMemoryAndUsage(withoutPrefix);
  const memoryText = parsed.memoryText.replace(/^[:：\s]+/, "").trim();
  const usageHint = parsed.usageHint?.replace(/^[:：\s]+/, "").trim();
  if (memoryText.length < 4) return undefined;

  const category = categorizePlayerMemory(memoryText) ?? (explicit ? "手动记录" : fallbackCategory);
  if (!explicit && category === fallbackCategory && fallbackCategory === "玩家记忆" && !categorizePlayerMemory(memoryText)) {
    return undefined;
  }

  return {
    category,
    memoryText: `${category}：${clipMemory(memoryText)}`,
    usageHint: usageHint === "" ? undefined : usageHint
  };
}

export function buildPlayerMemoryInstructions(
  storage: BotStorage,
  context: NarrativeContext,
  speakerRole: MemberRole = DEFAULT_MEMBER_ROLE
): string | undefined {
  const currentMemories = context.userId
    ? storage.getRecentPlayerMemories({
        scopeType: context.scopeType,
        scopeId: context.scopeId,
        userId: context.userId,
        limit: PLAYER_MEMORY_LIMIT
      })
    : [];
  const otherMemories = speakerRole === "kp"
    ? storage.getRecentScopePlayerMemories({
        scopeType: context.scopeType,
        scopeId: context.scopeId,
        excludeUserId: context.userId,
        limit: OTHER_PLAYER_MEMORY_LIMIT
      })
    : [];
  if (currentMemories.length === 0 && otherMemories.length === 0) return undefined;

  const lines = [
    "长期桌边记忆（旧到新）：",
    "这些是玩家明确提醒或系统从群聊中识别出的关键设定、重大决定、关系羁绊或剧情推进。回答当前发言者时优先使用“当前发言者记忆”，再参考“同团其他玩家/全团记忆”；只有当问题、场景或使用时机相关时才主动带出，不要把其他玩家的私密/未公开信息说成当前角色已知。",
    ...formatMemorySection("当前发言者记忆", currentMemories, false),
    ...formatMemorySection("同团其他玩家/全团记忆", otherMemories, true)
  ];
  return truncate(lines.join("\n"), MAX_PLAYER_MEMORY_CONTEXT_CHARS);
}

export function buildRecentNarrativeContextInstructions(
  storage: BotStorage,
  context: NarrativeContext,
  speakerRole: MemberRole = DEFAULT_MEMBER_ROLE
): string | undefined {
  const events = filterNarrativeEventsForRole(storage.getRecentNarrativeEvents({
    scopeType: context.scopeType,
    scopeId: context.scopeId,
    limit: RECENT_CONTEXT_LIMIT
  }), context, speakerRole);
  if (events.length === 0) return undefined;

  const lines = [
    "最近同一跑团上下文（旧到新）：",
    "这些内容只代表已经在当前范围内出现过的桌面消息、AI/NPC回复或主动故事。回答时可以承接它们，但不要把未出现的内容当作事实，也不要泄露未公开剧情。",
    ...events.map(formatNarrativeEvent)
  ];
  return truncate(lines.join("\n"), MAX_RECENT_CONTEXT_CHARS);
}

function filterNarrativeEventsForRole(
  events: StoredNarrativeEvent[],
  context: NarrativeContext,
  speakerRole: MemberRole
): StoredNarrativeEvent[] {
  if (speakerRole === "kp") return events;
  return events.filter((event) => {
    if (event.kind === "proactive_story") return true;
    if (context.userId && event.userId === context.userId) return true;
    return false;
  });
}

function formatNarrativeEvent(event: StoredNarrativeEvent, index: number): string {
  const prefix = `${index + 1}.`;
  const actor = event.actorName?.trim();
  const input = event.inputText?.trim();
  const output = event.outputText.trim();
  const speaker = event.userId === "proactive-scheduler" ? "" : `${shortUserId(event.userId)} `;

  switch (event.kind) {
    case "table_message":
      return `${prefix} ${speaker}桌面消息：${clip(output)}`;
    case "ai_reply":
      return input
        ? `${prefix} ${speaker}玩家问：${clip(input)} / AI答：${clip(output)}`
        : `${prefix} AI答：${clip(output)}`;
    case "npc_reply":
      return input
        ? `${prefix} ${actor ?? "NPC"}回应“${clip(input)}”：${clip(output)}`
        : `${prefix} ${actor ?? "NPC"}：${clip(output)}`;
    case "proactive_story":
      return `${prefix} ${actor ?? "叙述者"}主动故事：${clip(output)}`;
    default:
      return `${prefix} ${event.kind}：${clip(output)}`;
  }
}

function formatMemorySection(title: string, memories: StoredPlayerMemory[], includeSpeaker: boolean): string[] {
  if (memories.length === 0) return [];
  return [
    `${title}：`,
    ...memories.map((memory, index) => formatPlayerMemory(memory, index, includeSpeaker))
  ];
}

function formatPlayerMemory(memory: StoredPlayerMemory, index: number, includeSpeaker: boolean): string {
  const speaker = includeSpeaker ? `${shortUserId(memory.userId)} ` : "";
  const usage = memory.usageHint ? `；使用时机：${clipMemory(memory.usageHint)}` : "";
  return `${index + 1}. ${speaker}[${memory.category}] ${clipMemory(memory.memoryText)}${usage}`;
}

function memorySkillPrefixPattern(): RegExp {
  return /^(?:请)?(?:帮我)?(?:记住|记一下|记一条|牢记|保存记忆|记录一下|remember|memory)\s*[:：]?\s*/i;
}

function splitMemoryAndUsage(text: string): { memoryText: string; usageHint?: string } {
  const labelMatch = text.match(/^(.*?)\s*(?:[，,；;]\s*)?(?:用在|使用时机|使用场景|用途|后续使用|以后用在|什么时候用)\s*[:：]\s*([\s\S]+)$/);
  if (labelMatch) {
    return {
      memoryText: labelMatch[1].trim(),
      usageHint: labelMatch[2].trim()
    };
  }

  const naturalMatch = text.match(/^(.+?)(?:[，,；;]\s*)(?:以后|之后|后面|后续|将来)(?:可以)?(?:在)?(.+?)(?:的时候|时)?(?:用上|使用|提醒|参考|带上|调用)(?:这个信息|这条信息|它)?[。.]?$/);
  if (naturalMatch) {
    return {
      memoryText: naturalMatch[1].trim(),
      usageHint: naturalMatch[2].trim()
    };
  }

  return { memoryText: text.trim() };
}

function categorizePlayerMemory(text: string): string | undefined {
  if (isLowValueQuestion(text)) return undefined;
  if (/(?:羁绊|关系|队友|朋友|同伴|信任|怀疑|保护|喜欢|讨厌|欠|约定|结盟|翻脸|和.+一起|跟.+一起)/.test(text)) {
    return "关系羁绊";
  }
  if (/(?:角色|调查员|职业|医生|护士|法医|记者|警察|教授|学生|性格|背景|身世|秘密|创伤|家人|亲人|朋友|设定|车一个|车卡)/.test(text)) {
    return "角色设定";
  }
  if (/(?:决定|选择|打算|我要|我会|我们要|我们会|拒绝|接受|保护|隐瞒|告诉|打开|调查|追踪|救|杀|交给|上车|下车|进入|离开)/.test(text)) {
    return "重大决定";
  }
  if (/(?:线索|真相|推进|发现|调查到|拿到|解开|破译|记录|证据|仪式|门|钥匙|档案)/.test(text)) {
    return "剧情推进";
  }
  return undefined;
}

function isLowValueQuestion(text: string): boolean {
  if (!/[?？吗么呢如何怎么样怎么什么为何为什么]/.test(text)) return false;
  return !/(?:我要|我决定|我选择|我的角色|我的调查员|我们决定|我们选择)/.test(text);
}

function clip(text: string): string {
  return truncate(text.replace(/\s+/g, " ").trim(), MAX_EVENT_CHARS);
}

function clipMemory(text: string): string {
  return truncate(text.replace(/\s+/g, " ").trim(), MAX_MEMORY_CHARS);
}

function shortUserId(userId: string): string {
  const compact = userId.replace(/\s+/g, "");
  if (compact.length <= 8) return `玩家${compact}`;
  return `玩家${compact.slice(0, 4)}...${compact.slice(-4)}`;
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}
