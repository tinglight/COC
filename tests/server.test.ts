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
    aiChatImageEnabled: false,
    aiChatImageChance: 0.08,
    aiChatImageMinGapMs: 20 * 60_000,
    aiChatImagePrompt: "Draw a reaction sticker.",
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

  it("records incoming and outgoing webhook messages in the chat audit", async () => {
    const storage = new BotStorage(":memory:");
    const sendTextMessage = vi.fn(async () => undefined);
    const app = createApp({ config: testConfig(), storage, qqClient: { sendTextMessage } });

    await app.inject({
      method: "POST",
      url: "/qq/webhook",
      headers: { "content-type": "application/json" },
      payload: {
        op: 0,
        t: "C2C_MESSAGE_CREATE",
        d: {
          id: "msg-audit-c2c",
          content: ".help",
          author: { user_openid: "private1" }
        }
      }
    });

    expect(storage.getRecentChatAuditEntries({ scopeType: "c2c", scopeId: "private1", limit: 5 })).toEqual([
      expect.objectContaining({
        direction: "incoming",
        messageId: "msg-audit-c2c",
        content: ".help"
      }),
      expect.objectContaining({
        direction: "outgoing",
        messageId: "msg-audit-c2c",
        eventType: "command_reply"
      })
    ]);
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
      1,
      groupReplyOptions("msg-ai-1", "user1")
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

  it("passes image attachments from an image-only group mention to AI", async () => {
    const storage = new BotStorage(":memory:");
    const sendTextMessage = vi.fn(async () => undefined);
    const aiClient = { createReply: vi.fn(async () => "I can see the image.") };
    const app = createApp({ config: testConfig(), storage, qqClient: { sendTextMessage }, aiClient });

    await app.inject({
      method: "POST",
      url: "/qq/webhook",
      headers: { "content-type": "application/json" },
      payload: {
        op: 0,
        t: "GROUP_MESSAGE_CREATE",
        d: {
          id: "msg-ai-image-only",
          content: "<@!bot> ",
          group_openid: "group1",
          attachments: [
            {
              content_type: "image/png",
              filename: "clue.png",
              width: 640,
              height: 480,
              size: 12345,
              url: "https://example.com/clue.png"
            }
          ],
          author: { member_openid: "user1" }
        }
      }
    });

    expect(aiClient.createReply).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining("User sent 1 image attachment"),
      trigger: "mention",
      images: [
        expect.objectContaining({
          imageUrl: "https://example.com/clue.png",
          contentType: "image/png",
          filename: "clue.png",
          width: 640,
          height: 480,
          size: 12345
        })
      ]
    }));
    expect(sendTextMessage).toHaveBeenCalledWith(
      { type: "group", groupOpenid: "group1" },
      "I can see the image.",
      "msg-ai-image-only",
      1,
      groupReplyOptions("msg-ai-image-only", "user1")
    );
    expect(storage.getRecentChatAuditEntries({ scopeType: "group", scopeId: "group1", direction: "incoming", limit: 5 })).toEqual([
      expect.objectContaining({
        messageId: "msg-ai-image-only",
        content: "",
        metadata: expect.objectContaining({
          attachmentCount: 1,
          imageAttachments: [
            expect.objectContaining({
              imageUrl: "https://example.com/clue.png",
              contentType: "image/png"
            })
          ]
        })
      })
    ]);
    await app.close();
    storage.close();
  });

  it("passes text and image attachments from a group mention to AI", async () => {
    const storage = new BotStorage(":memory:");
    const sendTextMessage = vi.fn(async () => undefined);
    const aiClient = { createReply: vi.fn(async () => "The screenshot shows a clue.") };
    const app = createApp({ config: testConfig(), storage, qqClient: { sendTextMessage }, aiClient });

    await app.inject({
      method: "POST",
      url: "/qq/webhook",
      headers: { "content-type": "application/json" },
      payload: {
        op: 0,
        t: "GROUP_AT_MESSAGE_CREATE",
        d: {
          id: "msg-ai-text-image",
          content: "<@!bot> what is in this screenshot?",
          group_openid: "group1",
          attachments: [
            {
              contentType: "image/jpeg",
              fileUrl: "https://example.com/screenshot.jpg"
            }
          ],
          author: { member_openid: "user1" }
        }
      }
    });

    expect(aiClient.createReply).toHaveBeenCalledWith(expect.objectContaining({
      text: "what is in this screenshot?",
      trigger: "mention",
      images: [
        expect.objectContaining({
          imageUrl: "https://example.com/screenshot.jpg",
          contentType: "image/jpeg"
        })
      ]
    }));
    await app.close();
    storage.close();
  });

  it("can send an occasional image reaction after a group AI chat reply", async () => {
    const storage = new BotStorage(":memory:");
    const sendTextMessage = vi.fn(async () => undefined);
    const sendImageMessage = vi.fn(async () => undefined);
    const aiClient = { createReply: vi.fn(async () => "先别急，我已经开始翻档案了。") };
    const imageClient = { createImage: vi.fn(async () => ({ fileData: "base64-meme", mimeType: "image/png" as const })) };
    const app = createApp({
      config: {
        ...testConfig(),
        aiChatImageEnabled: true,
        aiChatImageChance: 1,
        aiChatImagePrompt: "Draw a cute owl reaction sticker."
      },
      storage,
      qqClient: { sendTextMessage, sendImageMessage },
      aiClient,
      imageClient,
      random: () => 0
    });

    await app.inject({
      method: "POST",
      url: "/qq/webhook",
      headers: { "content-type": "application/json" },
      payload: {
        op: 0,
        t: "GROUP_AT_MESSAGE_CREATE",
        d: {
          id: "msg-ai-image-reaction",
          content: "<@!bot> 帮我看看这条线索哪里怪",
          group_openid: "group1",
          author: { member_openid: "user1" }
        }
      }
    });

    expect(sendTextMessage).toHaveBeenCalledWith(
      { type: "group", groupOpenid: "group1" },
      "先别急，我已经开始翻档案了。",
      "msg-ai-image-reaction",
      1,
      groupReplyOptions("msg-ai-image-reaction", "user1")
    );
    await waitForAssertion(() => expect(imageClient.createImage).toHaveBeenCalledTimes(1));
    const [imageRequest] = imageClient.createImage.mock.calls[0] as unknown as [{ prompt: string; userId?: string }];
    expect(imageRequest.prompt).toContain("帮我看看这条线索哪里怪");
    expect(imageRequest.prompt).toContain("先别急，我已经开始翻档案了。");
    expect(imageRequest.prompt).toContain("Caption candidates:");
    expect(imageRequest.prompt).toContain("Do not use process labels");
    expect(imageRequest.prompt).not.toContain("understandable without text");
    expect(imageRequest.userId).toBe("ai-chat-reaction");
    await waitForAssertion(() => expect(sendImageMessage).toHaveBeenCalledWith(
      { type: "group", groupOpenid: "group1" },
      { fileData: "base64-meme" }
    ));
    expect(storage.getRecentChatAuditEntries({ scopeType: "group", scopeId: "group1", direction: "outgoing", limit: 5 })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "ai_reply" }),
        expect.objectContaining({ eventType: "ai_image_reaction", content: "AI chat image reaction" })
      ])
    );
    await app.close();
    storage.close();
  });

  it("does not send an automatic image reaction for low-atmosphere AI chat", async () => {
    const storage = new BotStorage(":memory:");
    const sendTextMessage = vi.fn(async () => undefined);
    const sendImageMessage = vi.fn(async () => undefined);
    const aiClient = { createReply: vi.fn(async () => "晚上八点。") };
    const imageClient = { createImage: vi.fn(async () => ({ fileData: "base64-low", mimeType: "image/png" as const })) };
    const app = createApp({
      config: {
        ...testConfig(),
        aiChatImageEnabled: true,
        aiChatImageChance: 1
      },
      storage,
      qqClient: { sendTextMessage, sendImageMessage },
      aiClient,
      imageClient,
      random: () => 0
    });

    await app.inject({
      method: "POST",
      url: "/qq/webhook",
      headers: { "content-type": "application/json" },
      payload: {
        op: 0,
        t: "GROUP_AT_MESSAGE_CREATE",
        d: {
          id: "msg-ai-image-low-atmosphere",
          content: "<@!bot> 明天几点开始",
          group_openid: "group1",
          author: { member_openid: "user1" }
        }
      }
    });

    await waitForAssertion(() => expect(sendTextMessage).toHaveBeenCalledTimes(1));
    expect(imageClient.createImage).not.toHaveBeenCalled();
    expect(sendImageMessage).not.toHaveBeenCalled();
    await app.close();
    storage.close();
  });

  it("cools down automatic image reactions after one is sent", async () => {
    const storage = new BotStorage(":memory:");
    const sendTextMessage = vi.fn(async () => undefined);
    const sendImageMessage = vi.fn(async () => undefined);
    const aiClient = { createReply: vi.fn(async () => "先别急，我已经开始翻档案了。") };
    const imageClient = { createImage: vi.fn(async () => ({ fileData: "base64-cooldown", mimeType: "image/png" as const })) };
    const app = createApp({
      config: {
        ...testConfig(),
        aiChatImageEnabled: true,
        aiChatImageChance: 1,
        aiChatImageMinGapMs: 20 * 60_000
      },
      storage,
      qqClient: { sendTextMessage, sendImageMessage },
      aiClient,
      imageClient,
      random: () => 0
    });

    for (const id of ["msg-ai-image-cooldown-1", "msg-ai-image-cooldown-2"]) {
      await app.inject({
        method: "POST",
        url: "/qq/webhook",
        headers: { "content-type": "application/json" },
        payload: {
          op: 0,
          t: "GROUP_AT_MESSAGE_CREATE",
          d: {
            id,
            content: "<@!bot> 笑死，侦查又大失败了，这算线索吗",
            group_openid: "group1",
            author: { member_openid: "user1" }
          }
        }
      });
      if (id.endsWith("-1")) {
        await waitForAssertion(() => expect(imageClient.createImage).toHaveBeenCalledTimes(1));
      }
    }

    await waitForAssertion(() => expect(sendTextMessage).toHaveBeenCalledTimes(2));
    expect(imageClient.createImage).toHaveBeenCalledTimes(1);
    expect(sendImageMessage).toHaveBeenCalledTimes(1);
    await app.close();
    storage.close();
  });

  it("always sends an image reaction for explicit group image requests", async () => {
    const storage = new BotStorage(":memory:");
    const sendTextMessage = vi.fn(async () => undefined);
    const sendImageMessage = vi.fn(async () => undefined);
    const aiClient = { createReply: vi.fn(async () => "我没有真实自拍，给你整张小鹰表情包。") };
    const imageClient = { createImage: vi.fn(async () => ({ fileData: "base64-explicit-image", mimeType: "image/png" as const })) };
    const app = createApp({
      config: {
        ...testConfig(),
        aiChatImageEnabled: true,
        aiChatImageChance: 0
      },
      storage,
      qqClient: { sendTextMessage, sendImageMessage },
      aiClient,
      imageClient,
      random: () => 0.99
    });

    await app.inject({
      method: "POST",
      url: "/qq/webhook",
      headers: { "content-type": "application/json" },
      payload: {
        op: 0,
        t: "GROUP_AT_MESSAGE_CREATE",
        d: {
          id: "msg-explicit-image-reaction",
          content: "<@!bot> 发个照片看看",
          group_openid: "group1",
          author: { member_openid: "user1" }
        }
      }
    });

    expect(aiClient.createReply).toHaveBeenCalledWith(expect.objectContaining({
      text: "发个照片看看",
      instructions: expect.stringContaining("不要说自己完全不能发图")
    }));
    await waitForAssertion(() => expect(imageClient.createImage).toHaveBeenCalledTimes(1));
    const [imageRequest] = imageClient.createImage.mock.calls[0] as unknown as [{ prompt: string; userId?: string }];
    expect(imageRequest.prompt).toContain("发个照片看看");
    expect(sendImageMessage).toHaveBeenCalledWith(
      { type: "group", groupOpenid: "group1" },
      { fileData: "base64-explicit-image" }
    );
    await app.close();
    storage.close();
  });

  it("handles a leading mention delivered as a normal group message", async () => {
    const storage = new BotStorage(":memory:");
    const sendTextMessage = vi.fn(async () => undefined);
    const aiClient = { createReply: vi.fn(async () => "plain group mention reply") };
    const app = createApp({ config: testConfig(), storage, qqClient: { sendTextMessage }, aiClient });

    await app.inject({
      method: "POST",
      url: "/qq/webhook",
      headers: { "content-type": "application/json" },
      payload: {
        op: 0,
        t: "GROUP_MESSAGE_CREATE",
        d: {
          id: "msg-ai-plain-group-mention",
          content: "<@!bot> are you there?",
          group_openid: "group1",
          author: { member_openid: "user1" }
        }
      }
    });

    expect(aiClient.createReply).toHaveBeenCalledWith(expect.objectContaining({
      text: "are you there?",
      trigger: "mention"
    }));
    expect(sendTextMessage).toHaveBeenCalledWith(
      { type: "group", groupOpenid: "group1" },
      "plain group mention reply",
      "msg-ai-plain-group-mention",
      1,
      groupReplyOptions("msg-ai-plain-group-mention", "user1")
    );
    expect(storage.getRecentNarrativeEvents({
      scopeType: "group",
      scopeId: "group1",
      kind: "table_message",
      limit: 5
    })).toHaveLength(0);
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
      1,
      groupReplyOptions("msg-ai-ob", "user1")
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

  it("selectively answers group questions in all mode", async () => {
    const storage = new BotStorage(":memory:");
    const sendTextMessage = vi.fn(async () => undefined);
    const aiClient = { createReply: vi.fn(async () => "先查抽屉，再看票根。") };
    const app = createApp({
      config: { ...testConfig(), aiReplyMode: "all" },
      storage,
      qqClient: { sendTextMessage },
      aiClient
    });

    await app.inject({
      method: "POST",
      url: "/qq/webhook",
      headers: { "content-type": "application/json" },
      payload: {
        op: 0,
        t: "GROUP_MESSAGE_CREATE",
        d: {
          id: "msg-all-question",
          content: "这个线索该怎么查？",
          group_openid: "group1",
          author: { member_openid: "user1" }
        }
      }
    });

    expect(aiClient.createReply).toHaveBeenCalledWith(expect.objectContaining({
      text: "这个线索该怎么查？",
      trigger: "all",
      instructions: expect.stringContaining("全量群聊模式")
    }));
    expect(aiClient.createReply).toHaveBeenCalledWith(expect.objectContaining({
      instructions: expect.stringContaining("人格优先")
    }));
    expect(sendTextMessage).toHaveBeenCalledWith(
      { type: "group", groupOpenid: "group1" },
      "先查抽屉，再看票根。",
      "msg-all-question",
      1,
      groupReplyOptions("msg-all-question", "user1")
    );
    await app.close();
    storage.close();
  });

  it("keeps low-signal group chatter quiet but recorded in all mode", async () => {
    const storage = new BotStorage(":memory:");
    const sendTextMessage = vi.fn(async () => undefined);
    const aiClient = { createReply: vi.fn(async () => "不该发") };
    const app = createApp({
      config: { ...testConfig(), aiReplyMode: "all" },
      storage,
      qqClient: { sendTextMessage },
      aiClient
    });

    await app.inject({
      method: "POST",
      url: "/qq/webhook",
      headers: { "content-type": "application/json" },
      payload: {
        op: 0,
        t: "GROUP_MESSAGE_CREATE",
        d: {
          id: "msg-all-chatter",
          content: "哈哈哈",
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

  it("answers direct bot address in all mode", async () => {
    const storage = new BotStorage(":memory:");
    const sendTextMessage = vi.fn(async () => undefined);
    const aiClient = { createReply: vi.fn(async () => "收到收到，我来捋。") };
    const app = createApp({
      config: { ...testConfig(), aiReplyMode: "all" },
      storage,
      qqClient: { sendTextMessage },
      aiClient
    });

    await app.inject({
      method: "POST",
      url: "/qq/webhook",
      headers: { "content-type": "application/json" },
      payload: {
        op: 0,
        t: "GROUP_MESSAGE_CREATE",
        d: {
          id: "msg-all-direct-address",
          content: "小豆包，帮我总结一下",
          group_openid: "group1",
          author: { member_openid: "user1" }
        }
      }
    });

    expect(aiClient.createReply).toHaveBeenCalledWith(expect.objectContaining({
      text: "小豆包，帮我总结一下",
      trigger: "all"
    }));
    expect(sendTextMessage).toHaveBeenCalledWith(
      { type: "group", groupOpenid: "group1" },
      "收到收到，我来捋。",
      "msg-all-direct-address",
      1,
      groupReplyOptions("msg-all-direct-address", "user1")
    );
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
      1,
      groupReplyOptions("msg-memory-skill", "user1")
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
      1,
      c2cReplyOptions("msg-bound-c2c")
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
      1,
      groupReplyOptions("msg-secret", "kp1")
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

function groupReplyOptions(messageId: string, userId: string) {
  return expect.objectContaining({
    mentionUserIds: [userId],
    messageReference: {
      messageId,
      ignoreGetMessageError: true
    }
  });
}

function c2cReplyOptions(messageId: string) {
  return expect.objectContaining({
    messageReference: {
      messageId,
      ignoreGetMessageError: true
    }
  });
}

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
