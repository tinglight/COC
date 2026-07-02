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

  it("does not deduplicate a message until its reply is sent", async () => {
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
    expect(sendTextMessage).toHaveBeenCalledTimes(2);
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
