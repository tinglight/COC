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
    expect(secondPrompt).toContain("Story structure for this turn");
    expect(secondPrompt).toContain("Current beat: 平淡变形");
    expect(secondPrompt).toContain("Cast and world growth rules");
    expect(secondPrompt).toContain("Turn cast cadence");
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
        getEnabledProactiveGroups: () => ["group1"],
        getProactiveGroupSettings: () => ({ groupOpenid: "group1", enabled: true, updatedAt: "now" }),
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
      metadata: expect.objectContaining({
        proactiveTurn: 2,
        storyPattern: "slow_burn_reversal",
        storyBeat: "quiet_distortion"
      })
    }));
  });

  it("rotates narrative structures after a full slow-burn cycle", async () => {
    let now = 1_000;
    const createReply = vi.fn(async () => "档案室实习生发现第十页被撕走，只剩订书针生锈的痕迹。");
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
        getEnabledProactiveGroups: () => ["group1"],
        getProactiveGroupSettings: () => ({ groupOpenid: "group1", enabled: true, updatedAt: "now" }),
        getProactiveLineCount: () => 9,
        getRecentProactiveLines: () => ["上一轮反转让旧钥匙指向了错误的房间。"]
      },
      logger: silentLogger(),
      now: () => now,
      random: () => 0
    });

    scheduler.recordGroupActivity("group1");
    now += 61_000;
    await scheduler.tick();

    const [request] = createReply.mock.calls[0] as unknown as [{ text: string }];
    const prompt = request.text;
    expect(prompt).toContain("Pattern: compact Freytag / three-act dramatic arc");
    expect(prompt).toContain("Current beat: 开端陈列");
    expect(prompt).toContain("Do not let the story orbit only two recurring people");
    expect(addNarrativeEvent).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        proactiveTurn: 10,
        storyPattern: "freytag_compact",
        storyBeat: "exposition",
        storyBeatName: "开端陈列",
        storyCycle: 2
      })
    }));
  });

  it("does not send when storage has not enabled proactive broadcasts for the group", async () => {
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
      storage: {
        addNarrativeEvent: vi.fn(),
        addProactiveLine: vi.fn(),
        getEnabledProactiveGroups: () => [],
        getProactiveGroupSettings: () => undefined,
        getProactiveLineCount: () => 0,
        getRecentProactiveLines: () => []
      },
      logger: silentLogger(),
      now: () => now,
      random: () => 0
    });

    scheduler.recordGroupActivity("group1");
    now += 61_000;
    await scheduler.tick();

    expect(createReply).not.toHaveBeenCalled();
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it("discovers enabled proactive groups from storage without a fresh group message", async () => {
    let now = 1_000;
    const createReply = vi.fn(async () => "stored group hello");
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
      storage: {
        addNarrativeEvent: vi.fn(),
        addProactiveLine: vi.fn(),
        getEnabledProactiveGroups: () => ["group-from-command"],
        getProactiveGroupSettings: (groupOpenid: string) => ({
          groupOpenid,
          enabled: groupOpenid === "group-from-command",
          updatedAt: "now"
        }),
        getProactiveLineCount: () => 0,
        getRecentProactiveLines: () => []
      },
      logger: silentLogger(),
      now: () => now,
      random: () => 0
    });

    now += 61_000;
    await scheduler.tick();
    expect(sendTextMessage).not.toHaveBeenCalled();
    now += 61_000;
    await scheduler.tick();

    expect(sendTextMessage).toHaveBeenCalledWith(
      { type: "group", groupOpenid: "group-from-command" },
      "stored group hello"
    );
  });

  it("injects active module flavor into proactive story prompts", async () => {
    let now = 1_000;
    const createReply = vi.fn(async () => "车站报童把晚报最下面一行剪掉，才敢沿着月台叫卖。");
    const sendTextMessage = vi.fn(async () => undefined);
    const addNarrativeEvent = vi.fn();
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
        addProactiveLine: vi.fn(),
        getEnabledProactiveGroups: () => ["group1"],
        getProactiveGroupSettings: () => ({
          groupOpenid: "group1",
          enabled: true,
          moduleId: "w-train",
          moduleName: "W列车",
          flavorText: "公开风味：车站、报馆、票根和旅行者的家族名誉压力。",
          updatedAt: "now"
        }),
        getProactiveLineCount: () => 0,
        getRecentProactiveLines: () => []
      },
      logger: silentLogger(),
      now: () => now,
      random: () => 0
    });

    scheduler.recordGroupActivity("group1");
    now += 61_000;
    await scheduler.tick();

    const [request] = createReply.mock.calls[0] as unknown as [{ text: string }];
    expect(request.text).toContain("Active module flavor packet");
    expect(request.text).toContain("W列车");
    expect(request.text).toContain("车站、报馆、票根");
    expect(request.text).toContain("would solve or alter the main plot");
    expect(addNarrativeEvent).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        proactiveFlavorModuleId: "w-train",
        proactiveFlavorModuleName: "W列车"
      })
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
