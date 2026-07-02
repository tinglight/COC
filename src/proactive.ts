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
      const text = await this.createStoryText(groupOpenid, state);
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
          narratorSubtitle: narrator.subtitle
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

  private async createStoryText(groupOpenid: string, state: GroupState): Promise<string> {
    const rejectedDrafts: string[] = [];
    let latestText = "";

    for (let attempt = 0; attempt <= MAX_REPEAT_RETRIES; attempt += 1) {
      latestText = await this.deps.aiClient!.createReply({
        text: this.buildPrompt(state, rejectedDrafts),
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

  private buildPrompt(state: GroupState, rejectedDrafts: readonly string[] = []): string {
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
      "Continue the same thread. If there is no player context, continue your own quiet monologue or the same background world event. Keep it to 1-2 short Chinese sentences."
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
