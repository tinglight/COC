import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AiReplyRequest } from "../src/ai/client.js";
import { handleCommand, type PrivateMessageSendRequest } from "../src/commands/handler.js";
import { BotStorage } from "../src/storage.js";

describe("handleCommand", () => {
  it("sets and checks a character skill", async () => {
    const storage = new BotStorage(":memory:");
    const context = { scopeType: "group" as const, scopeId: "g1", userId: "u1" };

    await expect(handleCommand(".st 侦查60 克苏鲁神话0 san55", context, { storage })).resolves.toContain("已保存");
    await expect(handleCommand(".ra 侦查", context, { storage, rng: () => 0.2 })).resolves.toContain("1D100=21/60");
    await expect(handleCommand(".show", context, { storage })).resolves.toContain("侦查60");
    storage.close();
  });

  it("runs san check", async () => {
    const storage = new BotStorage(":memory:");
    const context = { scopeType: "group" as const, scopeId: "g1", userId: "u1" };
    const values = [0.8, 0.5];
    const result = await handleCommand(".sc 0/1d6 60", context, { storage, rng: () => values.shift() ?? 0 });
    expect(result).toContain("失败");
    expect(result).toContain("损失 4");
    storage.close();
  });

  it("runs ai command when an AI client is provided", async () => {
    const storage = new BotStorage(":memory:");
    const context = { scopeType: "group" as const, scopeId: "g1", userId: "u1" };
    const aiClient = { createReply: vi.fn(async () => "AI 回答") };

    await expect(handleCommand(".ai 帮我描写餐桌", context, { storage, aiClient })).resolves.toBe("AI 回答");
    expect(aiClient.createReply).toHaveBeenCalledWith(expect.objectContaining({
      text: "帮我描写餐桌",
      trigger: "command"
    }));
    expect(storage.getRecentNarrativeEvents({
      scopeType: "group",
      scopeId: "g1",
      kind: "ai_reply",
      limit: 5
    })).toHaveLength(1);
    storage.close();
  });

  it("adds recent table context and player memories to ai command prompts", async () => {
    const storage = new BotStorage(":memory:");
    const context = { scopeType: "group" as const, scopeId: "g1", userId: "u1" };
    const aiClient = { createReply: vi.fn(async (_request: AiReplyRequest) => "AI 回答") };
    storage.setMemberRole("group", "g1", "u1", "kp", "u1");
    storage.addTableMessage("g1", "u2", "另一名调查员提到了第七节车厢的广播。");
    storage.addPlayerMemory({
      scopeType: "group",
      scopeId: "g1",
      userId: "u1",
      category: "角色设定",
      memoryText: "角色是年轻急诊医生，乘 W 列车去见很久没见的家人。",
      usageHint: "讨论角色动机时",
      sourceKind: "test"
    });
    storage.addPlayerMemory({
      scopeType: "group",
      scopeId: "g1",
      userId: "u2",
      category: "关系羁绊",
      memoryText: "另一名调查员答应在车上照应这名医生。",
      usageHint: "讨论同伴关系时",
      sourceKind: "test"
    });

    await expect(handleCommand(".ai 你觉得我的角色设计如何", context, { storage, aiClient })).resolves.toBe("AI 回答");

    const [request] = aiClient.createReply.mock.calls[0] as unknown as [AiReplyRequest];
    expect(request.instructions).toContain("长期桌边记忆");
    expect(request.instructions).toContain("当前发言者记忆");
    expect(request.instructions).toContain("年轻急诊医生");
    expect(request.instructions).toContain("使用时机：讨论角色动机时");
    expect(request.instructions).toContain("同团其他玩家/全团记忆");
    expect(request.instructions).toContain("另一名调查员");
    expect(request.instructions).toContain("最近同一跑团上下文");
    expect(request.instructions).toContain("第七节车厢");
    storage.close();
  });

  it("keeps PL ai prompts from seeing other players records", async () => {
    const storage = new BotStorage(":memory:");
    const context = { scopeType: "group" as const, scopeId: "g1", userId: "u1" };
    const aiClient = { createReply: vi.fn(async (_request: AiReplyRequest) => "PL answer") };
    storage.setMemberRole("group", "g1", "u1", "pl", "u1");
    storage.addTableMessage("g1", "u2", "other-player-only clue");
    storage.addPlayerMemory({
      scopeType: "group",
      scopeId: "g1",
      userId: "u2",
      category: "test",
      memoryText: "other-player-only memory",
      sourceKind: "test"
    });

    await expect(handleCommand(".ai what can I safely know?", context, { storage, aiClient })).resolves.toBe("PL answer");

    const [request] = aiClient.createReply.mock.calls[0] as unknown as [AiReplyRequest];
    expect(request.speakerRole).toBe("pl");
    expect(request.instructions).toContain("当前说话者身份：PL");
    expect(request.instructions).not.toContain("other-player-only clue");
    expect(request.instructions).not.toContain("other-player-only memory");
    storage.close();
  });

  it("blocks OB from calling ai commands", async () => {
    const storage = new BotStorage(":memory:");
    const context = { scopeType: "group" as const, scopeId: "g1", userId: "u1" };
    const aiClient = { createReply: vi.fn(async () => "should not be called") };
    storage.setMemberRole("group", "g1", "u1", "ob", "u1");

    await expect(handleCommand(".ai hello", context, { storage, aiClient })).resolves.toContain("OB");
    expect(aiClient.createReply).not.toHaveBeenCalled();
    storage.close();
  });

  it("records important player statements and manual memory notes", async () => {
    const storage = new BotStorage(":memory:");
    const context = { scopeType: "group" as const, scopeId: "g1", userId: "u1" };
    const aiClient = { createReply: vi.fn(async () => "AI 回答") };
    storage.setMemberRole("group", "g1", "u1", "kp", "u1");

    await expect(handleCommand(".ai 那我要这个年轻急诊医生，他长期高压工作，乘W列车去见家人。", context, {
      storage,
      aiClient
    })).resolves.toBe("AI 回答");
    await expect(handleCommand(".记住 他决定保护同车的老朋友；用在：老朋友遇险时", context, { storage }))
      .resolves.toBe("已记入这个玩家的关键人物记忆。使用时机：老朋友遇险时");

    const memories = storage.getRecentPlayerMemories({
      scopeType: "group",
      scopeId: "g1",
      userId: "u1",
      limit: 5
    });
    expect(memories.map((memory) => memory.memoryText).join("\n")).toContain("年轻急诊医生");
    expect(memories.map((memory) => memory.memoryText).join("\n")).toContain("保护同车的老朋友");
    expect(memories.at(-1)?.usageHint).toBe("老朋友遇险时");
    await expect(handleCommand(".mem show", context, { storage })).resolves.toContain("保护同车的老朋友");
    await expect(handleCommand(".mem show all", context, { storage })).resolves.toContain("玩家u1");
    storage.close();
  });

  it("adds local imported module context to ai module questions", async () => {
    const storage = new BotStorage(":memory:");
    const context = { scopeType: "group" as const, scopeId: "g1", userId: "u1" };
    const aiClient = { createReply: vi.fn(async (_request: AiReplyRequest) => "本地模组回答") };
    const moduleImportsRoot = createModuleImportRoot();
    storage.setMemberRole("group", "g1", "u1", "kp", "u1");

    await expect(handleCommand(".ai 粗略介绍一下W列车这个模组", context, {
      storage,
      aiClient,
      moduleImportsRoot
    })).resolves.toBe("本地模组回答");

    expect(aiClient.createReply).toHaveBeenCalledWith(expect.objectContaining({
      text: "粗略介绍一下W列车这个模组",
      instructions: expect.stringContaining("本地已导入模组资料命中")
    }));
    const [moduleRequest] = aiClient.createReply.mock.calls[0] as unknown as [{ instructions?: string }];
    expect(moduleRequest.instructions).toContain("不要使用外部网站");
    expect(moduleRequest.instructions).toContain("模组：Warp列车");
    storage.close();
  });

  it("runs npc command with local roleplay skill instructions", async () => {
    const storage = new BotStorage(":memory:");
    const context = { scopeType: "group" as const, scopeId: "g1", userId: "u1" };
    const aiClient = { createReply: vi.fn(async () => "张管家低声回答。") };
    const npcSkillRoot = createNpcSkillRoot("训练教训：括号不要解释写作策略。");
    storage.setMemberRole("group", "g1", "u1", "kp", "u1");
    storage.addNarrativeEvent({
      kind: "npc_reply",
      scopeType: "group",
      scopeId: "g1",
      userId: "u1",
      actorName: "张管家",
      inputText: "玩家问：你听见什么？",
      outputText: "张管家说他只听见钟声。",
      metadata: { command: "npc" }
    });

    await expect(handleCommand(".npc 张管家 玩家问：昨晚钟楼亮灯时你在哪里？", context, {
      storage,
      aiClient,
      npcSkillRoot
    })).resolves.toBe("张管家低声回答。");

    expect(aiClient.createReply).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining("NPC 名称：张管家"),
      instructions: expect.stringContaining("训练教训：括号不要解释写作策略。"),
      trigger: "command"
    }));
    const [npcRequest] = aiClient.createReply.mock.calls[0] as unknown as [{ text: string }];
    expect(npcRequest.text).toContain("张管家说他只听见钟声。");
    const npcEvents = storage.getRecentNarrativeEvents({
      scopeType: "group",
      scopeId: "g1",
      kind: "npc_reply",
      limit: 5
    });
    expect(npcEvents).toHaveLength(2);
    expect(npcEvents.at(-1)).toMatchObject({
      actorName: "张管家",
      outputText: "张管家低声回答。",
      metadata: { command: "npc" }
    });
    storage.close();
  });

  it("can show and append npc training notes", async () => {
    const storage = new BotStorage(":memory:");
    const context = { scopeType: "group" as const, scopeId: "g1", userId: "u1" };
    const npcSkillRoot = createNpcSkillRoot("最新记录：让尴尬保留一点毛边。");
    storage.setMemberRole("group", "g1", "u1", "kp", "u1");

    await expect(handleCommand(".train show", context, { storage, npcSkillRoot }))
      .resolves.toContain("让尴尬保留一点毛边");
    await expect(handleCommand(".train note 括号不要写成提示词自检。", context, { storage, npcSkillRoot }))
      .resolves.toBe("已追加到 NPC 训练记录。");

    const updatedLog = fs.readFileSync(path.join(npcSkillRoot, "references", "training-log.md"), "utf8");
    expect(updatedLog).toContain("括号不要写成提示词自检。");
    storage.close();
  });

  it("binds a private chat to a group context with a one-time code", async () => {
    const storage = new BotStorage(":memory:");
    const groupContext = { scopeType: "group" as const, scopeId: "group1", userId: "member1" };
    const privateContext = { scopeType: "c2c" as const, scopeId: "private1", userId: "private1" };

    const bindPrompt = await handleCommand(".bind", groupContext, { storage });
    const code = bindPrompt?.match(/[a-f0-9]{8}/)?.[0];
    expect(code).toBeTruthy();

    await expect(handleCommand(`.bind ${code}`, privateContext, { storage }))
      .resolves.toContain("已绑定");
    expect(storage.getPrivateGroupBinding("private1")).toMatchObject({
      groupOpenid: "group1",
      groupUserId: "member1"
    });

    storage.setSkills("group", "group1", "member1", [{ key: "spot", name: "spot", value: 60 }]);
    await expect(handleCommand(".show", privateContext, { storage })).resolves.toContain("spot60");
    await expect(handleCommand(`.bind ${code}`, privateContext, { storage }))
      .resolves.toContain("绑定码无效或已过期");
    storage.close();
  });

  it("binds a private chat with the role registered by the group bind code", async () => {
    const storage = new BotStorage(":memory:");
    const groupContext = { scopeType: "group" as const, scopeId: "group1", userId: "member1" };
    const privateContext = { scopeType: "c2c" as const, scopeId: "private1", userId: "private1" };

    const bindPrompt = await handleCommand(".bind KP", groupContext, { storage });
    const code = bindPrompt?.match(/[a-f0-9]{8}/)?.[0];
    expect(code).toBeTruthy();
    expect(storage.getMemberRole("group", "group1", "member1")).toBe("kp");

    await expect(handleCommand(`.bind ${code}`, privateContext, { storage }))
      .resolves.toContain("身份：KP");
    expect(storage.getPrivateGroupBinding("private1")).toMatchObject({
      groupOpenid: "group1",
      groupUserId: "member1",
      role: "kp"
    });
    await expect(handleCommand(".context", privateContext, { storage })).resolves.toContain("身份 KP");
    storage.close();
  });

  it("uses bound group narrative context for private ai commands", async () => {
    const storage = new BotStorage(":memory:");
    const privateContext = { scopeType: "c2c" as const, scopeId: "private1", userId: "private1" };
    const aiClient = { createReply: vi.fn(async (_request: AiReplyRequest) => "AI answer") };
    storage.setPrivateGroupBinding("private1", "group1", "member1", "kp");
    storage.addTableMessage("group1", "member2", "the locked door glowed blue");

    await expect(handleCommand(".ai what did we just learn?", privateContext, { storage, aiClient }))
      .resolves.toBe("AI answer");

    expect(aiClient.createReply).toHaveBeenCalledWith(expect.objectContaining({
      scopeType: "group",
      scopeId: "group1",
      userId: "member1",
      instructions: expect.stringContaining("the locked door glowed blue")
    }));
    expect(storage.getRecentNarrativeEvents({
      scopeType: "group",
      scopeId: "group1",
      kind: "ai_reply",
      limit: 5
    }).at(-1)).toMatchObject({
      userId: "member1",
      inputText: "what did we just learn?"
    });
    storage.close();
  });

  it("lets a bound player opt into KP private messages", async () => {
    const storage = new BotStorage(":memory:");
    const privateContext = { scopeType: "c2c" as const, scopeId: "private1", userId: "private1" };
    storage.setPrivateGroupBinding("private1", "group1", "member1");

    await expect(handleCommand(".pm on", privateContext, { storage }))
      .resolves.toContain("已开启 KP 秘密私聊");
    expect(storage.getPrivateMessagePermission("private1")).toMatchObject({
      enabled: true,
      activeMessagesAllowed: true
    });
    await expect(handleCommand(".pm status", privateContext, { storage }))
      .resolves.toContain("已开启");
    await expect(handleCommand(".pm off", privateContext, { storage }))
      .resolves.toContain("已关闭");
    expect(storage.getPrivateMessagePermission("private1")?.enabled).toBe(false);
    storage.close();
  });

  it("sends a KP secret to an opted-in bound player's private chat", async () => {
    const storage = new BotStorage(":memory:");
    const groupContext = { scopeType: "group" as const, scopeId: "group1", userId: "kp1" };
    const privateMessenger = vi.fn(async (_request: PrivateMessageSendRequest) => undefined);
    storage.setMemberRole("group", "group1", "kp1", "kp", "kp1");
    storage.setPrivateGroupBinding("private1", "group1", "member1");
    storage.setPrivateMessagingEnabled("private1", true);

    const result = await handleCommand(".secret <@!member1> 你在镜子背后看到了一行旧字。", groupContext, {
      storage,
      privateMessenger
    });

    expect(result).toContain("已发送 1");
    expect(privateMessenger).toHaveBeenCalledWith(expect.objectContaining({
      privateUserId: "private1",
      sourceKind: "secret",
      content: expect.stringContaining("你在镜子背后看到了一行旧字。")
    }));
    expect(storage.getPendingPrivateOutboxMessages("private1", 5)).toEqual([]);
    expect(storage.getRecentNarrativeEvents({
      scopeType: "group",
      scopeId: "group1",
      kind: "private_secret",
      limit: 5
    })).toEqual([
      expect.objectContaining({
        userId: "member1",
        outputText: "你在镜子背后看到了一行旧字。",
        metadata: expect.objectContaining({
          command: "secret",
          createdByUserId: "kp1",
          deliveryStatus: "sent"
        })
      })
    ]);
    storage.close();
  });

  it("blocks PL from keeper-only private message commands", async () => {
    const storage = new BotStorage(":memory:");
    const groupContext = { scopeType: "group" as const, scopeId: "group1", userId: "pl1" };
    const privateMessenger = vi.fn(async (_request: PrivateMessageSendRequest) => undefined);
    storage.setMemberRole("group", "group1", "pl1", "pl", "pl1");

    await expect(handleCommand(".secret member1 hidden clue", groupContext, {
      storage,
      privateMessenger
    })).resolves.toContain("只有 KP");
    expect(privateMessenger).not.toHaveBeenCalled();
    storage.close();
  });

  it("queues a KP secret when active private push protection blocks sending", async () => {
    const storage = new BotStorage(":memory:");
    const groupContext = { scopeType: "group" as const, scopeId: "group1", userId: "kp1" };
    const privateMessenger = vi.fn(async (_request: PrivateMessageSendRequest) => undefined);
    storage.setMemberRole("group", "group1", "kp1", "kp", "kp1");
    storage.setPrivateGroupBinding("private1", "group1", "member1");
    storage.setPrivateMessagingEnabled("private1", true);
    for (let index = 0; index < 4; index += 1) {
      storage.addPrivateDelivery({
        privateUserId: "private1",
        groupOpenid: "group1",
        groupUserId: "member1",
        sourceKind: "secret",
        sentAtMs: Date.now()
      });
    }

    const result = await handleCommand(".secret member1 这条线索先存起来。", groupContext, {
      storage,
      privateMessenger
    });

    expect(result).toContain("待玩家私聊 .inbox 领取 1");
    expect(privateMessenger).not.toHaveBeenCalled();
    expect(storage.getPendingPrivateOutboxMessages("private1", 5)).toEqual([
      expect.objectContaining({
        content: "这条线索先存起来。",
        status: "pending"
      })
    ]);

    const privateContext = { scopeType: "c2c" as const, scopeId: "private1", userId: "private1" };
    const inbox = await handleCommand(".inbox", privateContext, { storage });
    expect(inbox).toContain("这条线索先存起来。");
    expect(storage.getPendingPrivateOutboxMessages("private1", 5)).toEqual([]);
    storage.close();
  });

  it("generates and sends an NPC private message", async () => {
    const storage = new BotStorage(":memory:");
    const groupContext = { scopeType: "group" as const, scopeId: "group1", userId: "kp1" };
    const aiClient = { createReply: vi.fn(async (_request: AiReplyRequest) => "张管家压低声音：今晚别去钟楼。") };
    const privateMessenger = vi.fn(async (_request: PrivateMessageSendRequest) => undefined);
    const npcSkillRoot = createNpcSkillRoot("私聊也要像真实 NPC 发言。");
    storage.setMemberRole("group", "group1", "kp1", "kp", "kp1");
    storage.setPrivateGroupBinding("private1", "group1", "member1");
    storage.setPrivateMessagingEnabled("private1", true);

    const result = await handleCommand(".npcdm 张管家 @member1 玩家问：你为什么怕钟声？", groupContext, {
      storage,
      aiClient,
      privateMessenger,
      npcSkillRoot
    });

    expect(result).toContain("NPC私聊处理完成：已发送 1");
    expect(aiClient.createReply).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining("NPC 名称：张管家"),
      instructions: expect.stringContaining("私聊也要像真实 NPC 发言")
    }));
    expect(privateMessenger).toHaveBeenCalledWith(expect.objectContaining({
      privateUserId: "private1",
      sourceKind: "npcdm",
      content: expect.stringContaining("【NPC私聊｜张管家】")
    }));
    expect(storage.getRecentNarrativeEvents({
      scopeType: "group",
      scopeId: "group1",
      kind: "npc_private_reply",
      limit: 5
    }).at(-1)).toMatchObject({
      actorName: "张管家",
      userId: "member1",
      inputText: "玩家问：你为什么怕钟声？",
      outputText: "张管家压低声音：今晚别去钟楼。",
      metadata: expect.objectContaining({ deliveryStatus: "sent" })
    });
    storage.close();
  });
});

function createNpcSkillRoot(trainingLog: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qq-coc-npc-skill-"));
  const references = path.join(root, "references");
  fs.mkdirSync(references, { recursive: true });
  fs.writeFileSync(path.join(root, "SKILL.md"), "# NPC Live Roleplay\n\nUse table-like NPC replies.", "utf8");
  fs.writeFileSync(path.join(references, "live-table-style.md"), "# Live Table Style\n\nKeep OOC human.", "utf8");
  fs.writeFileSync(path.join(references, "training-log.md"), `# Training Log\n\n## Latest\n\n${trainingLog}\n`, "utf8");
  return root;
}

function createModuleImportRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qq-coc-module-imports-"));
  const moduleRoot = path.join(root, "w-train-v2-demo");
  fs.mkdirSync(path.join(moduleRoot, "canon"), { recursive: true });
  fs.mkdirSync(path.join(moduleRoot, "campaign"), { recursive: true });
  fs.writeFileSync(path.join(moduleRoot, "canon", "module_index.json"), JSON.stringify({
    module_id: "w-train-v2-demo",
    metadata: {
      "模组名称": "Warp列车",
      "使用规则": "COC 7th"
    },
    entities: {
      organizations: [{ name: "WARP列车" }],
      npcs: [],
      places: []
    },
    branch_hooks: []
  }), "utf8");
  fs.writeFileSync(path.join(moduleRoot, "campaign", "session_state.json"), JSON.stringify({
    scene_log: [],
    npcs: {},
    relationships: {},
    world_changes: []
  }), "utf8");
  return root;
}
