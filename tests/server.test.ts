import { describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { createApp } from "../src/server.js";
import { BotStorage } from "../src/storage.js";
import type { AppConfig } from "../src/config.js";

function testConfig(): AppConfig {
  return {
    appId: "app",
    appSecret: "secret",
    botSecret: "secret",
    validationSecretSource: "auto",
    allowedGroupOpenids: new Set(),
    databasePath: ":memory:",
    assetDir: ".",
    port: 3000,
    verifySignatures: false,
    apiBaseUrl: "https://api.sgroup.qq.com",
    tokenUrl: "https://bots.qq.com/app/getAppAccessToken",
    userRateLimitMax: 8,
    userRateLimitWindowMs: 30_000,
    groupRateLimitMax: 18,
    groupRateLimitWindowMs: 60_000,
    openaiApiKey: "",
    openaiModel: "gpt-5.5",
    openaiReasoningEffort: "medium",
    openaiBaseUrl: "",
    openaiRequestTimeoutMs: 20_000,
    openaiImageModel: "gpt-image-2",
    openaiImageSize: "1024x1024",
    openaiImageQuality: "low",
    openaiImageOutputFormat: "png",
    openaiImageRequestTimeoutMs: 120_000,
    aiReplyMode: "mention",
    aiMaxReplyChars: 900,
    proactiveChatEnabled: false,
    proactiveGroupOpenids: new Set(),
    proactiveIdleWindowMs: 45 * 60_000,
    proactiveCheckIntervalMs: 5 * 60_000,
    proactiveMinGapMs: 120 * 60_000,
    proactiveChance: 0.35,
    proactivePrompt: "Say something short.",
    proactiveMarkdownEnabled: false,
    proactiveMarkdownNarrators: [],
    proactiveImageEnabled: false,
    proactiveImagePrompt: "Draw the story."
  };
}

describe("server", () => {
  it("responds to validation requests", async () => {
    const storage = new BotStorage(":memory:");
    const app = createApp({ config: testConfig(), storage });
    const response = await app.inject({
      method: "POST",
      url: "/qq/webhook",
      headers: { "content-type": "application/json" },
      payload: { op: 13, d: { plain_token: "token", event_ts: "1" } }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ plain_token: "token" });
    await app.close();
    storage.close();
  });

  it("handles a group command event once", async () => {
    const storage = new BotStorage(":memory:");
    const sendTextMessage = vi.fn(async () => undefined);
    const app = createApp({ config: testConfig(), storage, qqClient: { sendTextMessage } });
    const payload = {
      op: 0,
      t: "GROUP_AT_MESSAGE_CREATE",
      d: {
        id: "msg1",
        content: " .r 1d6",
        group_openid: "group1",
        author: { member_openid: "user1" }
      }
    };

    await app.inject({ method: "POST", url: "/qq/webhook", headers: { "content-type": "application/json" }, payload });
    await app.inject({ method: "POST", url: "/qq/webhook", headers: { "content-type": "application/json" }, payload });
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
    await app.close();
    storage.close();
  });

  it("deduplicates a message once processing starts", async () => {
    const storage = new BotStorage(":memory:");
    let attempts = 0;
    const sendTextMessage = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("send failed");
    });
    const app = createApp({ config: testConfig(), storage, qqClient: { sendTextMessage } });
    const payload = {
      op: 0,
      t: "C2C_MESSAGE_CREATE",
      d: {
        id: "msg-retry-c2c",
        content: ".help",
        author: { user_openid: "user1" }
      }
    };

    const first = await app.inject({ method: "POST", url: "/qq/webhook", headers: { "content-type": "application/json" }, payload });
    const second = await app.inject({ method: "POST", url: "/qq/webhook", headers: { "content-type": "application/json" }, payload });
    const third = await app.inject({ method: "POST", url: "/qq/webhook", headers: { "content-type": "application/json" }, payload });

    expect(first.statusCode).toBe(500);
    expect(second.statusCode).toBe(200);
    expect(third.statusCode).toBe(200);
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
    await app.close();
    storage.close();
  });

  it("does not call AI twice for duplicate webhook retries while the first reply is pending", async () => {
    const storage = new BotStorage(":memory:");
    const sendTextMessage = vi.fn(async () => undefined);
    let resolveAiReply: (reply: string) => void = () => undefined;
    const pendingAiReply = new Promise<string>((resolve) => {
      resolveAiReply = resolve;
    });
    const aiClient = { createReply: vi.fn(async () => pendingAiReply) };
    const app = createApp({ config: testConfig(), storage, qqClient: { sendTextMessage }, aiClient });
    const payload = {
      op: 0,
      t: "GROUP_AT_MESSAGE_CREATE",
      d: {
        id: "msg-ai-duplicate",
        content: "<@!bot> describe the locked study",
        group_openid: "group1",
        author: { member_openid: "user1" }
      }
    };

    const first = app.inject({ method: "POST", url: "/qq/webhook", headers: { "content-type": "application/json" }, payload });
    await waitForAssertion(() => expect(aiClient.createReply).toHaveBeenCalledTimes(1));
    const second = await app.inject({ method: "POST", url: "/qq/webhook", headers: { "content-type": "application/json" }, payload });
    resolveAiReply("AI reply");
    const firstResponse = await first;

    expect(second.statusCode).toBe(200);
    expect(firstResponse.statusCode).toBe(200);
    expect(aiClient.createReply).toHaveBeenCalledTimes(1);
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
    await app.close();
    storage.close();
  });

  it("accepts callback signatures generated with AppSecret when BotSecret differs", async () => {
    const storage = new BotStorage(":memory:");
    const sendTextMessage = vi.fn(async () => undefined);
    const config = {
      ...testConfig(),
      appSecret: "app-secret-for-ed25519",
      botSecret: "legacy-token-secret",
      verifySignatures: true
    };
    const app = createApp({ config, storage, qqClient: { sendTextMessage } });
    const payload = {
      op: 0,
      t: "C2C_MESSAGE_CREATE",
      d: {
        id: "msg-signed-c2c",
        content: ".help",
        author: { user_openid: "user1" }
      }
    };
    const rawBody = JSON.stringify(payload);
    const timestamp = "1725442341";

    const response = await app.inject({
      method: "POST",
      url: "/qq/webhook",
      headers: {
        "content-type": "application/json",
        "x-bot-appid": config.appId,
        "x-signature-ed25519": signForTest(config.appSecret, `${timestamp}${rawBody}`),
        "x-signature-timestamp": timestamp
      },
      payload: rawBody
    });

    expect(response.statusCode).toBe(200);
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
    await app.close();
    storage.close();
  });

  it("handles a group mention with AI when it is not a command", async () => {
    const storage = new BotStorage(":memory:");
    const sendTextMessage = vi.fn(async () => undefined);
    const aiClient = { createReply: vi.fn(async () => "这是 AI 回复") };
    const app = createApp({ config: testConfig(), storage, qqClient: { sendTextMessage }, aiClient });

    await app.inject({
      method: "POST",
      url: "/qq/webhook",
      headers: { "content-type": "application/json" },
      payload: {
        op: 0,
        t: "GROUP_AT_MESSAGE_CREATE",
        d: {
          id: "msg-ai-1",
          content: "<@!bot> 帮我描写一下餐桌气氛",
          group_openid: "group1",
          author: { member_openid: "user1" }
        }
      }
    });

    expect(aiClient.createReply).toHaveBeenCalledWith(expect.objectContaining({
      text: "帮我描写一下餐桌气氛",
      trigger: "mention"
    }));
    expect(sendTextMessage).toHaveBeenCalledWith(
      { type: "group", groupOpenid: "group1" },
      "这是 AI 回复",
      "msg-ai-1",
      1
    );
    const events = storage.getRecentNarrativeEvents({
      scopeType: "group",
      scopeId: "group1",
      kind: "ai_reply",
      limit: 5
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      userId: "user1",
      inputText: "帮我描写一下餐桌气氛",
      outputText: "这是 AI 回复",
      metadata: { trigger: "mention" }
    });
    await app.close();
    storage.close();
  });

  it("blocks OB group mentions from calling AI", async () => {
    const storage = new BotStorage(":memory:");
    const sendTextMessage = vi.fn(async () => undefined);
    const aiClient = { createReply: vi.fn(async () => "不应该调用") };
    storage.setMemberRole("group", "group1", "user1", "ob", "user1");
    const app = createApp({ config: testConfig(), storage, qqClient: { sendTextMessage }, aiClient });

    await app.inject({
      method: "POST",
      url: "/qq/webhook",
      headers: { "content-type": "application/json" },
      payload: {
        op: 0,
        t: "GROUP_AT_MESSAGE_CREATE",
        d: {
          id: "msg-ai-ob",
          content: "<@!bot> can I use AI?",
          group_openid: "group1",
          author: { member_openid: "user1" }
        }
      }
    });

    expect(aiClient.createReply).not.toHaveBeenCalled();
    expect(sendTextMessage).toHaveBeenCalledWith(
      { type: "group", groupOpenid: "group1" },
      expect.stringContaining("OB"),
      "msg-ai-ob",
      1
    );
    await app.close();
    storage.close();
  });

  it("ignores non-mentioned group messages in mention mode", async () => {
    const storage = new BotStorage(":memory:");
    const sendTextMessage = vi.fn(async () => undefined);
    const aiClient = { createReply: vi.fn(async () => "不该发送") };
    const app = createApp({ config: testConfig(), storage, qqClient: { sendTextMessage }, aiClient });

    await app.inject({
      method: "POST",
      url: "/qq/webhook",
      headers: { "content-type": "application/json" },
      payload: {
        op: 0,
        t: "GROUP_MESSAGE_CREATE",
        d: {
          id: "msg-ai-ignored",
          content: "普通群聊",
          group_openid: "group1",
          author: { member_openid: "user1" }
        }
      }
    });

    expect(aiClient.createReply).not.toHaveBeenCalled();
    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(storage.getRecentNarrativeEvents({
      scopeType: "group",
      scopeId: "group1",
      kind: "table_message",
      limit: 5
    })).toHaveLength(1);
    await app.close();
    storage.close();
  });

  it("passes recorded group chatter and player memories into later group AI mentions", async () => {
    const storage = new BotStorage(":memory:");
    const sendTextMessage = vi.fn(async () => undefined);
    const aiClient = { createReply: vi.fn(async () => "记得，你是年轻急诊医生。") };
    const app = createApp({ config: testConfig(), storage, qqClient: { sendTextMessage }, aiClient });

    await app.inject({
      method: "POST",
      url: "/qq/webhook",
      headers: { "content-type": "application/json" },
      payload: {
        op: 0,
        t: "GROUP_MESSAGE_CREATE",
        d: {
          id: "msg-table-memory",
          content: "我的角色是年轻急诊医生，决定保护同车的老朋友。",
          group_openid: "group1",
          author: { member_openid: "user1" }
        }
      }
    });
    await app.inject({
      method: "POST",
      url: "/qq/webhook",
      headers: { "content-type": "application/json" },
      payload: {
        op: 0,
        t: "GROUP_AT_MESSAGE_CREATE",
        d: {
          id: "msg-ai-memory",
          content: "<@!bot> 你还记得我的角色吗",
          group_openid: "group1",
          author: { member_openid: "user1" }
        }
      }
    });

    const [request] = aiClient.createReply.mock.calls[0] as unknown as [{ instructions?: string }];
    expect(request.instructions).toContain("长期桌边记忆");
    expect(request.instructions).toContain("当前发言者记忆");
    expect(request.instructions).toContain("年轻急诊医生");
    expect(request.instructions).toContain("最近同一跑团上下文");
    expect(request.instructions).toContain("保护同车的老朋友");
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
    await app.close();
    storage.close();
  });

  it("handles mentioned memory reminders as a memory skill instead of AI chat", async () => {
    const storage = new BotStorage(":memory:");
    const sendTextMessage = vi.fn(async () => undefined);
    const aiClient = { createReply: vi.fn(async () => "不该调用") };
    const app = createApp({ config: testConfig(), storage, qqClient: { sendTextMessage }, aiClient });

    await app.inject({
      method: "POST",
      url: "/qq/webhook",
      headers: { "content-type": "application/json" },
      payload: {
        op: 0,
        t: "GROUP_AT_MESSAGE_CREATE",
        d: {
          id: "msg-memory-skill",
          content: "<@!bot> 记住：他决定保护同车的老朋友；用在：老朋友遇险时",
          group_openid: "group1",
          author: { member_openid: "user1" }
        }
      }
    });

    expect(aiClient.createReply).not.toHaveBeenCalled();
    expect(sendTextMessage).toHaveBeenCalledWith(
      { type: "group", groupOpenid: "group1" },
      "已记入这个玩家的关键人物记忆。使用时机：老朋友遇险时",
      "msg-memory-skill",
      1
    );
    expect(storage.getRecentPlayerMemories({
      scopeType: "group",
      scopeId: "group1",
      userId: "user1",
      limit: 5
    })).toEqual([
      expect.objectContaining({
        memoryText: expect.stringContaining("保护同车的老朋友"),
        usageHint: "老朋友遇险时"
      })
    ]);
    await app.close();
    storage.close();
  });

  it("uses a bound group context for c2c automatic AI replies", async () => {
    const storage = new BotStorage(":memory:");
    const sendTextMessage = vi.fn(async () => undefined);
    const aiClient = { createReply: vi.fn(async () => "bound answer") };
    storage.setPrivateGroupBinding("private1", "group1", "member1", "kp");
    storage.addTableMessage("group1", "member2", "the basement light turned blue");
    const app = createApp({ config: testConfig(), storage, qqClient: { sendTextMessage }, aiClient });

    await app.inject({
      method: "POST",
      url: "/qq/webhook",
      headers: { "content-type": "application/json" },
      payload: {
        op: 0,
        t: "C2C_MESSAGE_CREATE",
        d: {
          id: "msg-bound-c2c",
          content: "what was the latest clue?",
          author: { user_openid: "private1" }
        }
      }
    });

    expect(aiClient.createReply).toHaveBeenCalledWith(expect.objectContaining({
      scopeType: "group",
      scopeId: "group1",
      userId: "member1",
      trigger: "c2c",
      instructions: expect.stringContaining("the basement light turned blue")
    }));
    expect(sendTextMessage).toHaveBeenCalledWith(
      { type: "c2c", userOpenid: "private1" },
      "bound answer",
      "msg-bound-c2c",
      1
    );
    expect(storage.getRecentNarrativeEvents({
      scopeType: "group",
      scopeId: "group1",
      kind: "ai_reply",
      limit: 5
    }).at(-1)).toMatchObject({
      userId: "member1",
      inputText: "what was the latest clue?",
      metadata: { trigger: "c2c", sourceScopeType: "c2c", boundFromC2c: true }
    });
    await app.close();
    storage.close();
  });

  it("sends KP secret commands to opted-in private chats through the webhook path", async () => {
    const storage = new BotStorage(":memory:");
    const sendTextMessage = vi.fn(async () => undefined);
    storage.setMemberRole("group", "group1", "kp1", "kp", "kp1");
    storage.setPrivateGroupBinding("private1", "group1", "member1");
    storage.setPrivateMessagingEnabled("private1", true);
    const app = createApp({ config: testConfig(), storage, qqClient: { sendTextMessage } });

    await app.inject({
      method: "POST",
      url: "/qq/webhook",
      headers: { "content-type": "application/json" },
      payload: {
        op: 0,
        t: "GROUP_AT_MESSAGE_CREATE",
        d: {
          id: "msg-secret",
          content: "<@!bot> .secret <@!member1> 你看见了只有你认识的旧字。",
          group_openid: "group1",
          author: { member_openid: "kp1" }
        }
      }
    });

    expect(sendTextMessage).toHaveBeenCalledWith(
      { type: "c2c", userOpenid: "private1" },
      expect.stringContaining("你看见了只有你认识的旧字。"),
      undefined,
      1,
      { isWakeup: true }
    );
    expect(sendTextMessage).toHaveBeenCalledWith(
      { type: "group", groupOpenid: "group1" },
      expect.stringContaining("秘密线索处理完成：已发送 1"),
      "msg-secret",
      1
    );
    await app.close();
    storage.close();
  });

  it("records QQ private message reject events as active-message blocks", async () => {
    const storage = new BotStorage(":memory:");
    const app = createApp({ config: testConfig(), storage, qqClient: { sendTextMessage: vi.fn(async () => undefined) } });
    storage.setPrivateMessagingEnabled("private1", true);

    await app.inject({
      method: "POST",
      url: "/qq/webhook",
      headers: { "content-type": "application/json" },
      payload: {
        op: 0,
        t: "C2C_MSG_REJECT",
        d: { user_openid: "private1" }
      }
    });

    expect(storage.getPrivateMessagePermission("private1")?.activeMessagesAllowed).toBe(false);
    await app.close();
    storage.close();
  });
});

function signForTest(secret: string, message: string): string {
  const prefix = Buffer.from("302e020100300506032b657004220420", "hex");
  let seedText = secret;
  while (Buffer.byteLength(seedText) < 32) seedText += seedText;
  const seed = Buffer.from(seedText).subarray(0, 32);
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([prefix, seed]),
    format: "der",
    type: "pkcs8"
  });
  return crypto.sign(null, Buffer.from(message), privateKey).toString("hex");
}

async function waitForAssertion(assertion: () => void): Promise<void> {
  const deadline = Date.now() + 1_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error("Timed out waiting for assertion");
}
