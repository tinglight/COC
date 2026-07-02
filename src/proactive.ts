import type { AiImageClient, AiReplyClient } from "./ai/client.js";
import type { AppConfig, ProactiveNarrator } from "./config.js";
import type { QQOpenApiClient } from "./qq/client.js";
import type { BotStorage } from "./storage.js";

type ProactiveConfig = Pick<
  AppConfig,
  | "proactiveChatEnabled"
  | "proactiveGroupOpenids"
  | "proactiveIdleWindowMs"
  | "proactiveCheckIntervalMs"
  | "proactiveMinGapMs"
  | "proactiveChance"
  | "proactivePrompt"
  | "proactiveMarkdownEnabled"
  | "proactiveMarkdownNarrators"
  | "proactiveImageEnabled"
  | "proactiveImagePrompt"
>;

type Logger = Pick<Console, "info" | "warn" | "error">;

type ProactiveStorage = Pick<
  BotStorage,
  "addNarrativeEvent" | "addProactiveLine" | "getProactiveLineCount" | "getRecentProactiveLines"
>;

interface GroupState {
  lastActivityAt: number;
  lastProactiveAt: number;
  sending: boolean;
  recentMessages: string[];
  proactiveLines: string[];
  proactiveTurn: number;
}

const MAX_RECENT_MESSAGES = 12;
const MAX_PROACTIVE_LINES = 10;
const MAX_SNIPPET_CHARS = 180;
const MAX_REPEAT_RETRIES = 2;

interface StoryBeat {
  id: string;
  name: string;
  purpose: string;
  castMove: string;
}

interface StoryPattern {
  id: string;
  label: string;
  beats: readonly StoryBeat[];
}

interface StoryPlan {
  pattern: StoryPattern;
  beat: StoryBeat;
  beatIndex: number;
  cycleNumber: number;
}

const STORY_PATTERNS: readonly StoryPattern[] = [
  {
    id: "slow_burn_reversal",
    label: "slow-burn clue / rise / reveal / reversal",
    beats: [
      {
        id: "quiet_grounding",
        name: "平淡铺底",
        purpose: "写一个具体、日常、可观察的状态，让故事有落脚点，不制造大惊吓。",
        castMove: "可以用新地点、新物件或新旁观者打开视角。"
      },
      {
        id: "quiet_distortion",
        name: "平淡变形",
        purpose: "延续日常，但让一个细节轻微不合常理，留下因果空隙。",
        castMove: "不要让最近两个人同时重复出场；让其中一人离场、误读或只留下痕迹。"
      },
      {
        id: "foreshadow",
        name: "伏笔",
        purpose: "埋下可回收的线索，具体到物件、话语、位置或时间差。",
        castMove: "优先引入一个与线索有关的新角色、组织或地点。"
      },
      {
        id: "rise",
        name: "上升",
        purpose: "让线索产生压力：有人做出选择、关系偏移，或现场出现后果。",
        castMove: "让人物之间的关系发生微小变化，而不是只让他们再次出现。"
      },
      {
        id: "burst",
        name: "爆点",
        purpose: "给出一个清晰的可见事件或惊人发现，但不要一次性解释真相。",
        castMove: "可以让新人物闯入，也可以让缺席人物造成后果。"
      },
      {
        id: "fallout",
        name: "下降余波",
        purpose: "写爆点后的沉默、清理、否认、代价或错误解释，让故事能继续。",
        castMove: "把视角移到受影响的第三方、场所或物证。"
      },
      {
        id: "new_normal",
        name: "新平淡",
        purpose: "恢复表面平静，但展示世界已经被改变的一处小证据。",
        castMove: "让一个旧人物暂时退场，给人物池留出生长空间。"
      },
      {
        id: "second_foreshadow",
        name: "二次伏笔",
        purpose: "把之前的线索换角度重现，让它看起来属于更大的模式。",
        castMove: "把线索交给不同人物、地点或组织承接。"
      },
      {
        id: "twist_burst",
        name: "反转爆点",
        purpose: "反转前面的理解：不是推翻一切，而是让旧细节突然有新意义。",
        castMove: "让此前边缘化的角色、物件或地点成为关键。"
      }
    ]
  },
  {
    id: "freytag_compact",
    label: "compact Freytag / three-act dramatic arc",
    beats: [
      {
        id: "exposition",
        name: "开端陈列",
        purpose: "交代此刻谁在何处、什么状态被视为正常。",
        castMove: "补一个角色、地点、组织或物件进入人物池。"
      },
      {
        id: "inciting_incident",
        name: "触发事件",
        purpose: "让正常状态被一个小事件打破，形成需要回应的问题。",
        castMove: "让触发事件来自最近两人之外的来源。"
      },
      {
        id: "rising_action",
        name: "紧张上升",
        purpose: "增加阻碍、误会、时间压力或关系压力。",
        castMove: "让人物目标产生分歧，避免单纯聊天。"
      },
      {
        id: "crisis",
        name: "危机选择",
        purpose: "逼出一个选择或风险，但不要替玩家做不可逆决定。",
        castMove: "让某个角色选择沉默、撒谎、求助或离开。"
      },
      {
        id: "climax",
        name: "高潮显现",
        purpose: "给出本轮最强的可见变化或揭露，保留更大的谜底。",
        castMove: "让场景本身或物证承担冲击，不一定靠同两个人登场。"
      },
      {
        id: "falling_action",
        name: "回落后果",
        purpose: "展示高潮之后的代价、误判或短暂安静。",
        castMove: "把后果分配给旁观者、地点或组织。"
      },
      {
        id: "denouement_hook",
        name: "收束新钩子",
        purpose: "收束当前微循环，同时留下下一轮能追的钩子。",
        castMove: "用新名字、新地点或新物件收尾。"
      }
    ]
  },
  {
    id: "heroic_investigation",
    label: "hero's-journey investigation loop",
    beats: [
      {
        id: "ordinary_world",
        name: "日常世界",
        purpose: "呈现调查者或场景原本的秩序，以及他们以为自己知道的事。",
        castMove: "让人物池里出现一个能代表日常秩序的人或地点。"
      },
      {
        id: "call",
        name: "召唤",
        purpose: "给出离开舒适区的线索、邀请、警告或异常请求。",
        castMove: "召唤最好来自新人物、陌生信号、组织或旧物件。"
      },
      {
        id: "refusal_or_doubt",
        name: "迟疑",
        purpose: "让人物或环境表现出抗拒、怀疑、拖延或误判。",
        castMove: "让最近的核心人物之一退一步，把焦点交给不同反应者。"
      },
      {
        id: "threshold",
        name: "越界",
        purpose: "让故事越过一道边界：门槛、规则、关系、时间或认知。",
        castMove: "用新地点、新身份或新组织标记边界。"
      },
      {
        id: "tests_allies_shadows",
        name: "试炼与盟友",
        purpose: "给出一次小测试、临时盟友、可疑帮助或错误敌人。",
        castMove: "至少让一个非核心人物带来帮助或麻烦。"
      },
      {
        id: "ordeal_revelation",
        name: "试炼揭示",
        purpose: "让角色付出小代价后得到一块真相碎片。",
        castMove: "让真相碎片来自行动后果，而不是叙述者直接解释。"
      },
      {
        id: "return_with_clue",
        name: "携线索归来",
        purpose: "把获得的线索带回日常世界，改变下一次行动的方向。",
        castMove: "把一个旧场所或旧人物重新解释，形成下一轮钩子。"
      }
    ]
  },
  {
    id: "kishotenketsu_contrast",
    label: "kishotenketsu contrast / turn / reconciliation",
    beats: [
      {
        id: "ki",
        name: "起",
        purpose: "引入一个安静主题：人物、地点、习惯、物件或传闻。",
        castMove: "最好引入一个新元素，但保持低冲突。"
      },
      {
        id: "sho",
        name: "承",
        purpose: "发展这个主题，增加细节和情感连接，不急着制造冲突。",
        castMove: "让人物池里的不同元素产生并置关系。"
      },
      {
        id: "ten",
        name: "转",
        purpose: "放入意外转向或异质信息，让前两步被重新看待。",
        castMove: "用边缘人物、远处地点或被忽略物件完成转向。"
      },
      {
        id: "ketsu",
        name: "结",
        purpose: "把转向与开头调和，得到一个新的理解或下一步疑问。",
        castMove: "不要只回到原来两个人；让新理解落到世界状态上。"
      }
    ]
  }
];

export interface ProactiveChatSchedulerDeps {
  config: ProactiveConfig;
  qqClient: Pick<QQOpenApiClient, "sendTextMessage"> & Partial<Pick<QQOpenApiClient, "sendMarkdownMessage" | "sendImageMessage">>;
  aiClient?: AiReplyClient;
  imageClient?: AiImageClient;
  storage?: ProactiveStorage;
  logger?: Logger;
  now?: () => number;
  random?: () => number;
}

export class ProactiveChatScheduler {
  private readonly groups = new Map<string, GroupState>();
  private readonly logger: Logger;
  private readonly now: () => number;
  private readonly random: () => number;
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly deps: ProactiveChatSchedulerDeps) {
    this.logger = deps.logger ?? console;
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? Math.random;
  }

  start(): void {
    if (!this.deps.config.proactiveChatEnabled || this.timer) return;

    const now = this.now();
    for (const groupOpenid of this.deps.config.proactiveGroupOpenids) {
      this.ensureGroup(groupOpenid, now);
    }

    this.timer = setInterval(() => {
      void this.tick().catch((error) => {
        this.logger.error({ err: error }, "Proactive chat tick failed");
      });
    }, this.deps.config.proactiveCheckIntervalMs);
    this.timer.unref?.();

    this.logger.info({
      groups: this.groups.size,
      idleWindowMs: this.deps.config.proactiveIdleWindowMs,
      checkIntervalMs: this.deps.config.proactiveCheckIntervalMs
    }, "Proactive chat scheduler started");
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  recordGroupActivity(groupOpenid: string, text?: string): void {
    if (!this.deps.config.proactiveChatEnabled) return;
    const now = this.now();
    const state = this.ensureGroup(groupOpenid, now);
    state.lastActivityAt = now;
    const snippet = normalizeSnippet(text);
    if (snippet !== undefined) {
      pushLimited(state.recentMessages, snippet, MAX_RECENT_MESSAGES);
    }
  }

  async tick(): Promise<void> {
    if (!this.deps.config.proactiveChatEnabled || !this.deps.aiClient) return;

    const now = this.now();
    for (const [groupOpenid, state] of this.groups) {
      if (!this.shouldSend(state, now)) continue;
      await this.sendToGroup(groupOpenid, state, now);
    }
  }

  private shouldSend(state: GroupState, now: number): boolean {
    if (state.sending) return false;
    if (now - state.lastActivityAt < this.deps.config.proactiveIdleWindowMs) return false;
    if (now - state.lastProactiveAt < this.deps.config.proactiveMinGapMs) return false;
    return this.random() <= this.deps.config.proactiveChance;
  }

  private async sendToGroup(groupOpenid: string, state: GroupState, now: number): Promise<void> {
    state.sending = true;
    state.lastProactiveAt = now;

    try {
      const storyPlan = selectProactiveStoryPlan(state.proactiveTurn);
      const text = await this.createStoryText(groupOpenid, state, storyPlan);
      const narrator = await this.sendStoryMessage(groupOpenid, text, state.proactiveTurn);
      await this.sendStoryImage(groupOpenid, text, state).catch((error) => {
        this.logger.warn({ err: error, groupOpenid }, "Proactive story image failed");
      });
      const savedLine = normalizeSnippet(text) ?? text;
      pushLimited(state.proactiveLines, savedLine, MAX_PROACTIVE_LINES);
      this.deps.storage?.addProactiveLine(groupOpenid, savedLine);
      this.deps.storage?.addNarrativeEvent({
        kind: "proactive_story",
        scopeType: "group",
        scopeId: groupOpenid,
        userId: "proactive-scheduler",
        actorName: narrator.name,
        outputText: savedLine,
        metadata: {
          proactiveTurn: state.proactiveTurn,
          narratorSubtitle: narrator.subtitle,
          storyPattern: storyPlan.pattern.id,
          storyPatternLabel: storyPlan.pattern.label,
          storyBeat: storyPlan.beat.id,
          storyBeatName: storyPlan.beat.name,
          storyCycle: storyPlan.cycleNumber
        }
      });
      state.proactiveTurn += 1;
      state.lastActivityAt = now;
      this.logger.info({ groupOpenid }, "Sent proactive group chat message");
    } catch (error) {
      this.logger.error({ err: error, groupOpenid }, "Failed to send proactive group chat message");
    } finally {
      state.sending = false;
    }
  }

  private async createStoryText(groupOpenid: string, state: GroupState, storyPlan: StoryPlan): Promise<string> {
    const rejectedDrafts: string[] = [];
    let latestText = "";

    for (let attempt = 0; attempt <= MAX_REPEAT_RETRIES; attempt += 1) {
      latestText = await this.deps.aiClient!.createReply({
        text: this.buildPrompt(state, rejectedDrafts, storyPlan),
        scopeType: "group",
        scopeId: groupOpenid,
        userId: "proactive-scheduler",
        trigger: "proactive"
      });

      if (!isRepetitiveProactiveLine(latestText, state.proactiveLines)) {
        return latestText;
      }

      rejectedDrafts.push(latestText);
      this.logger.warn({
        groupOpenid,
        attempt: attempt + 1,
        draft: normalizeSnippet(latestText)
      }, "Proactive story repeated recent beats; retrying");
    }

    return latestText;
  }

  private async sendStoryImage(groupOpenid: string, text: string, state: GroupState): Promise<void> {
    if (!this.deps.config.proactiveImageEnabled || !this.deps.imageClient || !this.deps.qqClient.sendImageMessage) {
      return;
    }

    const image = await this.deps.imageClient.createImage({
      prompt: buildProactiveImagePrompt({
        basePrompt: this.deps.config.proactiveImagePrompt,
        storyText: text,
        recentMessages: state.recentMessages,
        proactiveLines: state.proactiveLines
      }),
      userId: "proactive-scheduler"
    });
    await this.deps.qqClient.sendImageMessage({ type: "group", groupOpenid }, { fileData: image.fileData });
  }

  private async sendStoryMessage(groupOpenid: string, text: string, proactiveTurn: number): Promise<ProactiveNarrator> {
    const target = { type: "group" as const, groupOpenid };
    const narrator = selectNarrator(this.deps.config.proactiveMarkdownNarrators, proactiveTurn);
    if (!this.deps.config.proactiveMarkdownEnabled || !this.deps.qqClient.sendMarkdownMessage) {
      await this.deps.qqClient.sendTextMessage(target, text);
      return narrator;
    }

    const markdown = buildProactiveMarkdown(text, narrator);
    try {
      await this.deps.qqClient.sendMarkdownMessage(target, markdown);
    } catch (error) {
      this.logger.warn({ err: error, groupOpenid }, "Markdown proactive message failed; falling back to text");
      await this.deps.qqClient.sendTextMessage(target, text);
    }
    return narrator;
  }

  private ensureGroup(groupOpenid: string, now: number): GroupState {
    const existing = this.groups.get(groupOpenid);
    if (existing) return existing;

    const storedLines = this.deps.storage?.getRecentProactiveLines(groupOpenid, MAX_PROACTIVE_LINES) ?? [];
    const storedLineCount = this.deps.storage?.getProactiveLineCount(groupOpenid) ?? 0;
    const state: GroupState = {
      lastActivityAt: now,
      lastProactiveAt: 0,
      sending: false,
      recentMessages: [],
      proactiveLines: storedLines,
      proactiveTurn: Math.max(1, storedLineCount + 1)
    };
    this.groups.set(groupOpenid, state);
    return state;
  }

  private buildPrompt(state: GroupState, rejectedDrafts: readonly string[] = [], storyPlan = selectProactiveStoryPlan(state.proactiveTurn)): string {
    const proactiveHistory = state.proactiveLines.length === 0
      ? "None yet."
      : state.proactiveLines.map((line, index) => `${index + 1}. ${line}`).join("\n");
    const recentMessages = state.recentMessages.length === 0
      ? "No recent player messages recorded."
      : state.recentMessages.map((line, index) => `${index + 1}. ${line}`).join("\n");
    const rejected = rejectedDrafts.length === 0
      ? "None."
      : rejectedDrafts.map((line, index) => `${index + 1}. ${line}`).join("\n");

    return [
      this.deps.config.proactivePrompt,
      "",
      `Proactive turn: ${state.proactiveTurn}`,
      "",
      "Story structure for this turn (use internally; do not label the output):",
      buildStoryPlanPrompt(storyPlan),
      "",
      "Cast and world growth rules:",
      "- Keep an implicit roster of 3-6 active story elements: people, factions, places, objects, records, debts, rumors, or offscreen forces.",
      "- Do not let the story orbit only two recurring people. If the last few beats seem centered on the same one or two actors, move one offstage and foreground a different actor, place, organization, object, or consequence this turn.",
      "- New people may enter as named characters or clear roles such as 值夜护士, 旧书店老板, 档案室实习生, 失踪者家属, 巡夜保安, or 小报记者; give them one concrete motive, limitation, or trace.",
      "- Do not rotate mechanically A/B/A/B. Let characters arrive late, leave evidence, lie, misunderstand, vanish from the scene, or be talked about by others.",
      `- Turn cast cadence: ${selectCastCadenceDirective(state.proactiveTurn)}`,
      "",
      "Micro-story quality rules:",
      "- Every beat must change something: a choice, relationship, clue state, physical scene, false lead, cost, or risk.",
      "- Avoid empty atmosphere-only prose. Include at least one specific noun and one consequence or question that can matter later.",
      "- Keep CoC/TRPG table boundaries: do not reveal keeper-only truth, decide player actions, invent dice results, or force irreversible campaign outcomes.",
      "",
      "Recent group messages, newest last:",
      recentMessages,
      "",
      "Your previous proactive lines, oldest first:",
      proactiveHistory,
      "",
      "Rejected drafts from this generation attempt:",
      rejected,
      "",
      "Anti-repetition rules:",
      "- Do not repeat, paraphrase, or lightly remix any previous proactive line.",
      "- Do not reuse distinctive recent images, actions, sounds, or sentence shapes. If a recent beat used footsteps, knocking, doors, ceilings, floors, dragging sounds, or three-count beats, move to a different concrete clue or consequence.",
      "- The next beat must advance the situation with a new observable change, not restate the same suspense.",
      "",
      "Continue the same thread. If there is no player context, continue your own quiet monologue or the same background world event. Keep it to 1-2 short Chinese sentences. Do not output story labels, beat names, analysis, JSON, or bullet points."
    ].join("\n");
  }
}

export function buildProactiveImagePrompt(input: {
  basePrompt: string;
  storyText: string;
  recentMessages: readonly string[];
  proactiveLines: readonly string[];
}): string {
  const recentContext = input.recentMessages.length === 0
    ? "No recent player messages."
    : input.recentMessages.slice(-4).map((line, index) => `${index + 1}. ${line}`).join("\n");
  const previousStory = input.proactiveLines.length === 0
    ? "No previous proactive story beats."
    : input.proactiveLines.slice(-4).map((line, index) => `${index + 1}. ${line}`).join("\n");

  return [
    input.basePrompt,
    "",
    "Latest story beat to illustrate:",
    input.storyText.trim(),
    "",
    "Recent table context:",
    recentContext,
    "",
    "Previous proactive story beats:",
    previousStory,
    "",
    "Make the image understandable without text labels. Do not include written words, UI, chat bubbles, captions, or watermarks."
  ].join("\n");
}

export function buildProactiveMarkdown(text: string, narrator: ProactiveNarrator): string {
  const displayName = escapeMarkdownInline(narrator.name.trim() || "叙述者");
  const subtitle = narrator.subtitle.trim() === "" ? "" : `_${escapeMarkdownInline(narrator.subtitle)}_`;
  const avatar = narrator.avatarUrl.trim() === ""
    ? ""
    : `![${displayName} #72px #72px](${narrator.avatarUrl.trim()})`;

  return [
    avatar,
    `## ${displayName}`,
    subtitle,
    "",
    quoteMarkdownText(text)
  ].filter((line, index, lines) => line !== "" || index > 0 && lines[index - 1] !== "").join("\n").trim();
}

function selectNarrator(narrators: readonly ProactiveNarrator[], proactiveTurn: number): ProactiveNarrator {
  if (narrators.length === 0) {
    return { name: "叙述者", avatarUrl: "", subtitle: "主动故事" };
  }
  return narrators[Math.max(0, proactiveTurn - 1) % narrators.length];
}

function quoteMarkdownText(text: string): string {
  const trimmed = text.trim() || "……";
  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim() === "" ? ">" : `> ${line}`)
    .join("\n");
}

function escapeMarkdownInline(text: string): string {
  return text.replace(/([\\`*_{}\[\]()#+\-.!|>])/g, "\\$1");
}

function selectProactiveStoryPlan(proactiveTurn: number): StoryPlan {
  let remaining = Math.max(0, Math.trunc(proactiveTurn) - 1);
  let cycleIndex = 0;

  while (true) {
    const pattern = STORY_PATTERNS[cycleIndex % STORY_PATTERNS.length];
    if (remaining < pattern.beats.length) {
      return {
        pattern,
        beat: pattern.beats[remaining],
        beatIndex: remaining,
        cycleNumber: cycleIndex + 1
      };
    }
    remaining -= pattern.beats.length;
    cycleIndex += 1;
  }
}

function buildStoryPlanPrompt(storyPlan: StoryPlan): string {
  const sequence = storyPlan.pattern.beats
    .map((beat, index) => `${index + 1}. ${index === storyPlan.beatIndex ? "[current] " : ""}${beat.name}`)
    .join("\n");

  return [
    `- Pattern: ${storyPlan.pattern.label}`,
    `- Cycle: ${storyPlan.cycleNumber}, beat ${storyPlan.beatIndex + 1}/${storyPlan.pattern.beats.length}`,
    `- Current beat: ${storyPlan.beat.name}`,
    `- Beat job: ${storyPlan.beat.purpose}`,
    `- Cast/world move: ${storyPlan.beat.castMove}`,
    "- Full beat sequence:",
    sequence
  ].join("\n");
}

function selectCastCadenceDirective(proactiveTurn: number): string {
  const cadence = [
    "Anchor the beat in a concrete place, object, record, or trace before anyone explains it.",
    "Introduce or foreground someone/something not central in the last two proactive lines.",
    "Let an existing element make a choice, leave a trace, or cause a consequence instead of merely appearing again.",
    "Move the camera away from the most recent two people and show how the event affects another place, faction, witness, or object."
  ];
  return cadence[Math.max(0, Math.trunc(proactiveTurn) - 1) % cadence.length];
}

export function isRepetitiveProactiveLine(text: string, previousLines: readonly string[]): boolean {
  const normalized = normalizeForRepeatCheck(text);
  if (normalized.length < 8) return false;

  return previousLines.some((previous) => {
    const normalizedPrevious = normalizeForRepeatCheck(previous);
    if (normalizedPrevious.length < 8) return false;
    if (normalized === normalizedPrevious) return true;
    if (normalized.includes(normalizedPrevious) || normalizedPrevious.includes(normalized)) return true;
    if (hasRepeatedDistinctiveMotif(text, previous)) return true;
    return shingleSimilarity(normalized, normalizedPrevious) >= 0.34;
  });
}

function normalizeForRepeatCheck(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function shingleSimilarity(left: string, right: string): number {
  const leftShingles = makeShingles(left);
  const rightShingles = makeShingles(right);
  if (leftShingles.size === 0 || rightShingles.size === 0) return 0;

  let intersection = 0;
  for (const item of leftShingles) {
    if (rightShingles.has(item)) intersection += 1;
  }
  return intersection / (leftShingles.size + rightShingles.size - intersection);
}

function makeShingles(text: string): Set<string> {
  const shingles = new Set<string>();
  for (let index = 0; index < text.length - 1; index += 1) {
    shingles.add(text.slice(index, index + 2));
  }
  return shingles;
}

function hasRepeatedDistinctiveMotif(text: string, previous: string): boolean {
  const motifGroups = [
    ["轻轻敲", "敲了敲", "敲门声", "敲了三下", "三下", "lightlyknock", "softlyknock", "knock", "threetimes"],
    ["脚步声停", "脚步声", "脚步"],
    ["拖拽声", "拖拽"],
    ["门口", "门后", "门缝", "门底", "door"],
    ["天花板", "地板", "楼上", "走廊"]
  ];
  const normalizedText = normalizeForRepeatCheck(text);
  const normalizedPrevious = normalizeForRepeatCheck(previous);

  const matchedGroups = motifGroups.filter((group) => {
    return group.some((motif) => normalizedText.includes(motif))
      && group.some((motif) => normalizedPrevious.includes(motif));
  });

  return matchedGroups.some((group) => group.includes("三下") || group.includes("拖拽声") || group.includes("脚步声"))
    || matchedGroups.length >= 2;
}

function pushLimited(items: string[], item: string, maxItems: number): void {
  items.push(item);
  while (items.length > maxItems) items.shift();
}

function normalizeSnippet(text: string | undefined): string | undefined {
  const normalized = text?.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.length > MAX_SNIPPET_CHARS
    ? `${normalized.slice(0, MAX_SNIPPET_CHARS - 3).trimEnd()}...`
    : normalized;
}
