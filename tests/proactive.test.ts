import { describe, expect, it, vi } from "vitest";
import { isRepetitiveProactiveLine, ProactiveChatScheduler } from "../src/proactive.js";

describe("ProactiveChatScheduler", () => {
  it("sends a proactive group message after the group has been idle", async () => {
    let now = 1_000;
    const createReply = vi.fn(async () => "idle hello");
    const sendTextMessage = vi.fn(async () => undefined);
    const scheduler = new ProactiveChatScheduler({
      config: {
        proactiveChatEnabled: true,
        proactiveGroupOpenids: new Set(),
        proactiveIdleWindowMs: 60_000,
        proactiveCheckIntervalMs: 60_000,
        proactiveMinGapMs: 60_000,
        proactiveChance: 1,
        proactivePrompt: "Say something short.",
        proactiveMarkdownEnabled: false,
        proactiveMarkdownNarrators: [],
        proactiveImageEnabled: false,
        proactiveImagePrompt: "Draw the story."
      },
      aiClient: { createReply },
      qqClient: { sendTextMessage },
      logger: silentLogger(),
      now: () => now,
      random: () => 0
    });

    scheduler.recordGroupActivity("group1");
    now += 61_000;
    await scheduler.tick();

    expect(createReply).toHaveBeenCalledWith(expect.objectContaining({
      scopeType: "group",
      scopeId: "group1",
      trigger: "proactive"
    }));
    expect(sendTextMessage).toHaveBeenCalledWith(
      { type: "group", groupOpenid: "group1" },
      "idle hello"
    );
  });

  it("does not send before the idle window has elapsed", async () => {
    let now = 1_000;
    const createReply = vi.fn(async () => "idle hello");
    const sendTextMessage = vi.fn(async () => undefined);
    const scheduler = new ProactiveChatScheduler({
      config: {
        proactiveChatEnabled: true,
        proactiveGroupOpenids: new Set(),
        proactiveIdleWindowMs: 60_000,
        proactiveCheckIntervalMs: 60_000,
        proactiveMinGapMs: 60_000,
        proactiveChance: 1,
        proactivePrompt: "Say something short.",
        proactiveMarkdownEnabled: false,
        proactiveMarkdownNarrators: [],
        proactiveImageEnabled: false,
        proactiveImagePrompt: "Draw the story."
      },
      aiClient: { createReply },
      qqClient: { sendTextMessage },
      logger: silentLogger(),
      now: () => now,
      random: () => 0
    });

    scheduler.recordGroupActivity("group1");
    now += 59_000;
    await scheduler.tick();

    expect(createReply).not.toHaveBeenCalled();
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it("passes recent group messages and previous proactive lines into the next prompt", async () => {
    let now = 1_000;
    const createReply = vi
      .fn()
      .mockResolvedValueOnce("first idle line")
      .mockResolvedValueOnce("second idle line");
    const sendTextMessage = vi.fn(async () => undefined);
    const scheduler = new ProactiveChatScheduler({
      config: {
        proactiveChatEnabled: true,
        proactiveGroupOpenids: new Set(),
        proactiveIdleWindowMs: 60_000,
        proactiveCheckIntervalMs: 60_000,
        proactiveMinGapMs: 60_000,
        proactiveChance: 1,
        proactivePrompt: "Continue a small world event.",
        proactiveMarkdownEnabled: false,
        proactiveMarkdownNarrators: [],
        proactiveImageEnabled: false,
        proactiveImagePrompt: "Draw the story."
      },
      aiClient: { createReply },
      qqClient: { sendTextMessage },
      logger: silentLogger(),
      now: () => now,
      random: () => 0
    });

    scheduler.recordGroupActivity("group1", "player asks about the locked door");
    now += 61_000;
    await scheduler.tick();
    now += 61_000;
    await scheduler.tick();

    const secondPrompt = createReply.mock.calls[1][0].text;
    expect(secondPrompt).toContain("player asks about the locked door");
    expect(secondPrompt).toContain("first idle line");
    expect(secondPrompt).toContain("Proactive turn: 2");
  });

  it("retries when a proactive story repeats recent beats", async () => {
    let now = 1_000;
    const createReply = vi
      .fn()
      .mockResolvedValueOnce("Something lightly knocks three times behind the door.")
      .mockResolvedValueOnce("A telephone rings downstairs and stops before the second bell.");
    const sendTextMessage = vi.fn(async () => undefined);
    const addNarrativeEvent = vi.fn();
    const addProactiveLine = vi.fn();
    const scheduler = new ProactiveChatScheduler({
      config: {
        proactiveChatEnabled: true,
        proactiveGroupOpenids: new Set(),
        proactiveIdleWindowMs: 60_000,
        proactiveCheckIntervalMs: 60_000,
        proactiveMinGapMs: 60_000,
        proactiveChance: 1,
        proactivePrompt: "Continue a small world event.",
        proactiveMarkdownEnabled: false,
        proactiveMarkdownNarrators: [],
        proactiveImageEnabled: false,
        proactiveImagePrompt: "Draw the story."
      },
      aiClient: { createReply },
      qqClient: { sendTextMessage },
      storage: {
        addNarrativeEvent,
        addProactiveLine,
        getProactiveLineCount: () => 1,
        getRecentProactiveLines: () => ["Something softly knocked three times above the door."]
      },
      logger: silentLogger(),
      now: () => now,
      random: () => 0
    });

    scheduler.recordGroupActivity("group1");
    now += 61_000;
    await scheduler.tick();

    expect(createReply).toHaveBeenCalledTimes(2);
    expect(createReply.mock.calls[1][0].text).toContain("Rejected drafts");
    expect(sendTextMessage).toHaveBeenCalledWith(
      { type: "group", groupOpenid: "group1" },
      "A telephone rings downstairs and stops before the second bell."
    );
    expect(addProactiveLine).toHaveBeenCalledWith(
      "group1",
      "A telephone rings downstairs and stops before the second bell."
    );
    expect(addNarrativeEvent).toHaveBeenCalledWith(expect.objectContaining({
      kind: "proactive_story",
      scopeType: "group",
      scopeId: "group1",
      userId: "proactive-scheduler",
      actorName: "叙述者",
      outputText: "A telephone rings downstairs and stops before the second bell.",
      metadata: expect.objectContaining({ proactiveTurn: 2 })
    }));
  });

  it("can send proactive stories as narrator markdown cards", async () => {
    let now = 1_000;
    const createReply = vi.fn(async () => "雨在旧宅门廊下停了一瞬。");
    const sendTextMessage = vi.fn(async () => undefined);
    const sendMarkdownMessage = vi.fn(async (_target: { type: "group"; groupOpenid: string }, _content: string) => undefined);
    const scheduler = new ProactiveChatScheduler({
      config: {
        proactiveChatEnabled: true,
        proactiveGroupOpenids: new Set(),
        proactiveIdleWindowMs: 60_000,
        proactiveCheckIntervalMs: 60_000,
        proactiveMinGapMs: 60_000,
        proactiveChance: 1,
        proactivePrompt: "Continue a small world event.",
        proactiveMarkdownEnabled: true,
        proactiveMarkdownNarrators: [
          { name: "黑泽莲", avatarUrl: "https://example.com/avatar.png", subtitle: "午夜叙述者" }
        ],
        proactiveImageEnabled: false,
        proactiveImagePrompt: "Draw the story."
      },
      aiClient: { createReply },
      qqClient: { sendTextMessage, sendMarkdownMessage },
      logger: silentLogger(),
      now: () => now,
      random: () => 0
    });

    scheduler.recordGroupActivity("group1");
    now += 61_000;
    await scheduler.tick();

    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(sendMarkdownMessage).toHaveBeenCalledWith(
      { type: "group", groupOpenid: "group1" },
      expect.stringContaining("## 黑泽莲")
    );
    expect(sendMarkdownMessage.mock.calls[0][1]).toContain("![黑泽莲 #72px #72px](https://example.com/avatar.png)");
    expect(sendMarkdownMessage.mock.calls[0][1]).toContain("> 雨在旧宅门廊下停了一瞬。");
  });

  it("generates and sends an image for proactive stories when enabled", async () => {
    let now = 1_000;
    const createReply = vi.fn(async () => "楼梯尽头的门缝里透出一点蓝光。");
    const createImage = vi.fn(async () => ({ fileData: "base64-image", mimeType: "image/png" as const }));
    const sendTextMessage = vi.fn(async () => undefined);
    const sendImageMessage = vi.fn(async (_target: { type: "group"; groupOpenid: string }, _image: { fileData: string }) => undefined);
    const scheduler = new ProactiveChatScheduler({
      config: {
        proactiveChatEnabled: true,
        proactiveGroupOpenids: new Set(),
        proactiveIdleWindowMs: 60_000,
        proactiveCheckIntervalMs: 60_000,
        proactiveMinGapMs: 60_000,
        proactiveChance: 1,
        proactivePrompt: "Continue a small world event.",
        proactiveMarkdownEnabled: false,
        proactiveMarkdownNarrators: [],
        proactiveImageEnabled: true,
        proactiveImagePrompt: "Draw a moody clue scene."
      },
      aiClient: { createReply },
      imageClient: { createImage },
      qqClient: { sendTextMessage, sendImageMessage },
      logger: silentLogger(),
      now: () => now,
      random: () => 0
    });

    scheduler.recordGroupActivity("group1", "有人提到了楼梯");
    now += 61_000;
    await scheduler.tick();

    expect(createImage).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("楼梯尽头的门缝里透出一点蓝光。"),
      userId: "proactive-scheduler"
    }));
    const [imageRequest] = createImage.mock.calls[0] as unknown as [{ prompt: string; userId?: string }];
    expect(imageRequest.prompt).toContain("有人提到了楼梯");
    expect(sendImageMessage).toHaveBeenCalledWith(
      { type: "group", groupOpenid: "group1" },
      { fileData: "base64-image" }
    );
  });
});

describe("isRepetitiveProactiveLine", () => {
  it("detects repeated distinctive suspense motifs", () => {
    expect(isRepetitiveProactiveLine(
      "随后，有什么东西轻轻敲了三下。",
      ["那声音停在了门口正上方。下一秒，有什么东西轻轻敲了敲天花板——三下。"]
    )).toBe(true);

    expect(isRepetitiveProactiveLine(
      "楼下的电话忽然响起，铃声短促得像有人掐住了线。",
      ["那声音停在了门口正上方。下一秒，有什么东西轻轻敲了敲天花板——三下。"]
    )).toBe(false);
  });
});

function silentLogger(): Pick<Console, "info" | "warn" | "error"> {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  };
}
