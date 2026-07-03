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

  it("writes stored san check loss back to the character sheet and session log", async () => {
    const storage = new BotStorage(":memory:");
    const context = { scopeType: "group" as const, scopeId: "g1", userId: "u1" };
    const values = [0.8, 0.5];
    storage.setSkills("group", "g1", "u1", [{ key: "san", name: "SAN", value: 60 }]);

    const result = await handleCommand(".sc 0/1d6", context, { storage, rng: () => values.shift() ?? 0 });

    expect(result).toContain("剩余 56（已写回角色卡）");
    expect(storage.getSkill("group", "g1", "u1", "san")?.value).toBe(56);
    expect(storage.getRecentNarrativeEvents({
      scopeType: "group",
      scopeId: "g1",
      kind: "character_update",
      limit: 5
    })).toEqual([
      expect.objectContaining({
        actorName: "SAN",
        outputText: expect.stringContaining("SAN 60 -> 56（-4）"),
        metadata: expect.objectContaining({
          command: "sc",
          attributeKey: "san",
          oldValue: 60,
          newValue: 56,
          delta: -4,
          visibility: "public"
        })
      })
    ]);
    storage.close();
  });

  it("adjusts hp and records character changes in the session log", async () => {
    const storage = new BotStorage(":memory:");
    const context = { scopeType: "group" as const, scopeId: "g1", userId: "u1" };
    storage.setSkills("group", "g1", "u1", [{ key: "hp", name: "HP", value: 12 }]);

    await expect(handleCommand(".hp -3 被咬伤", context, { storage }))
      .resolves.toContain("HP 12 -> 9（-3）");
    await expect(handleCommand(".show", context, { storage })).resolves.toContain("HP9");

    const log = await handleCommand(".log show", context, { storage });
    expect(log).toContain("[属性变化]");
    expect(log).toContain("被咬伤");
    storage.close();
  });

  it("records manual character sheet updates as character changes", async () => {
    const storage = new BotStorage(":memory:");
    const context = { scopeType: "group" as const, scopeId: "g1", userId: "u1" };

    await handleCommand(".st hp12 san60", context, { storage });
    await expect(handleCommand(".st hp9 san56", context, { storage })).resolves.toContain("已保存");

    const log = await handleCommand(".log show", context, { storage });
    expect(log).toContain("HP 12 -> 9（-3）");
    expect(log).toContain("SAN 60 -> 56（-4）");
    storage.close();
  });

  it("records major events and module progress", async () => {
    const storage = new BotStorage(":memory:");
    const context = { scopeType: "group" as const, scopeId: "g1", userId: "kp1" };

    await expect(handleCommand(".log 事件 调查员打开钟楼门", context, { storage }))
      .resolves.toBe("已记录重大事件：调查员打开钟楼门");
    await expect(handleCommand(".log 进度 第一幕结束，进入旧宅", context, { storage }))
      .resolves.toBe("已记录模组进度：第一幕结束，进入旧宅");

    const log = await handleCommand(".log show 5", context, { storage });
    expect(log).toContain("[重大事件] 调查员打开钟楼门");
    expect(log).toContain("[模组进度] 第一幕结束，进入旧宅");
    storage.close();
  });

  it("keeps public help limited to basic commands", async () => {
    const storage = new BotStorage(":memory:");
    const context = { scopeType: "group" as const, scopeId: "g1", userId: "u1" };

    const help = await handleCommand(".help", context, { storage });

    expect(help).toContain(".r 1d100");
    expect(help).toContain(".ra 侦查");
    expect(help).toContain(".sc 0/1d6");
    expect(help).toContain(".ai 你好");
    expect(help).toContain(".st 侦查60");
    expect(help).toContain(".hp -3");
    expect(help).toContain(".log 事件");
    expect(help).toContain(".show");
    expect(help).not.toMatch(/\.(?:npc|secret|npcdm|pm|inbox|train|mem)\b/);
    expect(help).not.toContain(".播报");
    expect(help).not.toContain(".记住");
    expect(help).not.toContain("秘密");
    expect(help).not.toContain("训练");
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

  it("turns async ai command failures into command error replies", async () => {
    const storage = new BotStorage(":memory:");
    const context = { scopeType: "group" as const, scopeId: "g1", userId: "u1" };
    const aiClient = { createReply: vi.fn(async () => { throw new Error("AI backend down"); }) };

    await expect(handleCommand(".ai hello", context, { storage, aiClient })).resolves.toContain("AI backend down");
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

  it("adds local character sheet build skill to ai character creation prompts", async () => {
    const storage = new BotStorage(":memory:");
    const context = { scopeType: "group" as const, scopeId: "g1", userId: "u1" };
    const aiClient = { createReply: vi.fn(async (_request: AiReplyRequest) => "先从第 0 步开始。") };

    await expect(handleCommand(".ai 带我车一张调查员角色卡", context, { storage, aiClient }))
      .resolves.toBe("先从第 0 步开始。");

    const [request] = aiClient.createReply.mock.calls[0] as unknown as [AiReplyRequest];
    expect(request.instructions).toContain("build-coc-character-sheet");
    expect(request.instructions).toContain("逐步流程");
    expect(request.instructions).toContain(".st");
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

  it("enables proactive module flavor with a keeper command", async () => {
    const storage = new BotStorage(":memory:");
    const context = { scopeType: "group" as const, scopeId: "g1", userId: "kp1" };
    const moduleImportsRoot = createModuleImportRoot();
    storage.setMemberRole("group", "g1", "kp1", "kp", "kp1");

    const result = await handleCommand(".播报 模组 W列车 风味：多写车站小报、票根和普通乘客的名誉压力。", context, {
      storage,
      moduleImportsRoot
    });

    expect(result).toContain("已开启本群主动播报");
    expect(result).toContain("Warp列车");
    expect(result).toContain("campaign/proactive_flavor.md");
    expect(storage.getProactiveGroupSettings("g1")).toMatchObject({
      enabled: true,
      moduleId: "w-train-v2-demo",
      moduleName: "Warp列车",
      updatedByUserId: "kp1"
    });
    expect(storage.getProactiveGroupSettings("g1")?.flavorText).toContain("车站小报");
    expect(storage.getProactiveGroupSettings("g1")?.flavorText).toContain("KP补充风味");

    await expect(handleCommand(".播报 off", context, { storage }))
      .resolves.toContain("已关闭");
    expect(storage.getProactiveGroupSettings("g1")?.enabled).toBe(false);
    storage.close();
  });

  it("blocks PL from changing proactive broadcast flavor", async () => {
    const storage = new BotStorage(":memory:");
    const context = { scopeType: "group" as const, scopeId: "g1", userId: "pl1" };
    storage.setMemberRole("group", "g1", "pl1", "pl", "pl1");

    await expect(handleCommand(".播报 模组 W列车", context, { storage }))
      .resolves.toContain("只有 KP");
    expect(storage.getProactiveGroupSettings("g1")).toBeUndefined();
    storage.close();
  });

  it("runs npc command with local roleplay skill instructions", async () => {
    const storage = new BotStorage(":memory:");
    const context = { scopeType: "group" as const, scopeId: "g1", userId: "u1" };
    const aiClient = { createReply: vi.fn(async () => "张管家低声回答。") };
    const npcSkillRoot = createNpcSkillRoot("训练教训：括号不要解释写作策略。");
    storage.setMemberRole("group", "g1", "u1", "kp", "u1");
    storage.savePersonaCard({
      name: "张管家",
      speechStyle: "说话克制，像旧宅里真的管家。",
      privateNotes: "KP-only：真正的钥匙在二楼。",
      patiencePolicy: "玩家重复追问三次后，他会停止配合。"
    });
    storage.saveTrainingExample({
      npcName: "张管家",
      issueType: "太像 AI",
      correction: "不要解释扮演策略。",
      goodReply: "张管家把手套慢慢拉平：您已经问过一次了。"
    });
    storage.saveMemoryAnchor({
      npcName: "张管家",
      anchorType: "object",
      label: "钟楼钥匙",
      content: "玩家已经公开见过张管家腰间的旧钥匙串。",
      visibility: "player",
      status: "confirmed"
    });
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
    expect(npcRequest.text).toContain("说话克制，像旧宅里真的管家。");
    expect(npcRequest.text).toContain("张管家把手套慢慢拉平");
    expect(npcRequest.text).toContain("钟楼钥匙");
    expect(npcRequest.text).not.toContain("真正的钥匙在二楼");
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

  it("previews ai context without calling the model", async () => {
    const storage = new BotStorage(":memory:");
    const context = { scopeType: "group" as const, scopeId: "g1", userId: "u1" };
    const aiClient = { createReply: vi.fn(async (_request: AiReplyRequest) => "should not be called") };
    storage.setMemberRole("group", "g1", "u1", "kp", "u1");
    storage.addTableMessage("g1", "u2", "第七节车厢广播突然变成了倒放。");
    storage.addPlayerMemory({
      scopeType: "group",
      scopeId: "g1",
      userId: "u1",
      category: "角色设定",
      memoryText: "调查员是急诊医生。",
      sourceKind: "test"
    });

    const result = await handleCommand(".aictx 帮我判断现在该提示什么", context, { storage, aiClient });

    expect(aiClient.createReply).not.toHaveBeenCalled();
    expect(result).toContain("AI 上下文预览");
    expect(result).toContain("长期桌边记忆");
    expect(result).toContain("急诊医生");
    expect(result).toContain("第七节车厢");
    expect(result).toContain("模型输入消息");
    storage.close();
  });

  it("generates npc drafts without recording narrative history", async () => {
    const storage = new BotStorage(":memory:");
    const context = { scopeType: "group" as const, scopeId: "g1", userId: "u1" };
    const aiClient = { createReply: vi.fn(async () => "1. 候选一\n2. 候选二\n3. 候选三") };
    const npcSkillRoot = createNpcSkillRoot("候选也要短。");
    storage.setMemberRole("group", "g1", "u1", "kp", "u1");

    await expect(handleCommand(".npcdraft 张管家 玩家问：你为什么不看钟楼？", context, {
      storage,
      aiClient,
      npcSkillRoot
    })).resolves.toContain("候选一");

    expect(aiClient.createReply).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining("3 个可直接复制到 QQ 的 NPC 回复候选"),
      instructions: expect.stringContaining("NPC 候选回复模式")
    }));
    expect(storage.getRecentNarrativeEvents({
      scopeType: "group",
      scopeId: "g1",
      kind: "npc_reply",
      limit: 5
    })).toHaveLength(0);
    storage.close();
  });

  it("saves a keeper-edited npc reply into narrative history", async () => {
    const storage = new BotStorage(":memory:");
    const context = { scopeType: "group" as const, scopeId: "g1", userId: "u1" };
    const npcSkillRoot = createNpcSkillRoot("修正版要被后续参考。");
    storage.setMemberRole("group", "g1", "u1", "kp", "u1");

    await expect(handleCommand(".npcsave 张管家 玩家问：昨晚你在哪里？ || 张管家垂下眼：我在钟楼门外。", context, {
      storage
    })).resolves.toContain("已记录 张管家");

    const events = storage.getRecentNarrativeEvents({
      scopeType: "group",
      scopeId: "g1",
      kind: "npc_reply",
      limit: 5
    });
    expect(events).toEqual([
      expect.objectContaining({
        actorName: "张管家",
        inputText: "玩家问：昨晚你在哪里？",
        outputText: "张管家垂下眼：我在钟楼门外。",
        metadata: { command: "npcsave", manuallyEdited: true }
      })
    ]);

    const preview = await handleCommand(".npctx 张管家 玩家问：你还记得钟楼吗？", context, {
      storage,
      npcSkillRoot
    });
    expect(preview).toContain("NPC 上下文预览");
    expect(preview).toContain("张管家垂下眼");
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
  fs.writeFileSync(path.join(moduleRoot, "campaign", "proactive_flavor.md"), [
    "# W列车主动播报风味",
    "",
    "- 公开时代/地点：一列被乘客视为日常交通工具的异常列车。",
    "- 社会情景：车站小报、旧票根、乘客名誉、乘务员交接。",
    "- 禁止：不要透露核心谜底、关键线索链或幕后机制。"
  ].join("\n"), "utf8");
  return root;
}
