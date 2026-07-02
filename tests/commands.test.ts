import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AiReplyRequest } from "../src/ai/client.js";
import { handleCommand } from "../src/commands/handler.js";
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

  it("adds local imported module context to ai module questions", async () => {
    const storage = new BotStorage(":memory:");
    const context = { scopeType: "group" as const, scopeId: "g1", userId: "u1" };
    const aiClient = { createReply: vi.fn(async (_request: AiReplyRequest) => "本地模组回答") };
    const moduleImportsRoot = createModuleImportRoot();

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

    await expect(handleCommand(".train show", context, { storage, npcSkillRoot }))
      .resolves.toContain("让尴尬保留一点毛边");
    await expect(handleCommand(".train note 括号不要写成提示词自检。", context, { storage, npcSkillRoot }))
      .resolves.toBe("已追加到 NPC 训练记录。");

    const updatedLog = fs.readFileSync(path.join(npcSkillRoot, "references", "training-log.md"), "utf8");
    expect(updatedLog).toContain("括号不要写成提示词自检。");
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
