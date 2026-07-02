import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BotStorage } from "../src/storage.js";

describe("BotStorage", () => {
  it("stores skills and deduplicates messages", () => {
    const storage = new BotStorage(path.join(os.tmpdir(), `qq-coc-dice-${Date.now()}.sqlite`));
    storage.setSkills("group", "g1", "u1", [{ key: "侦查", name: "侦查", value: 60 }]);
    expect(storage.getSkill("group", "g1", "u1", "侦查")?.value).toBe(60);
    expect(storage.isMessageProcessed("m1")).toBe(false);
    expect(storage.markMessageProcessed("m1")).toBe(true);
    expect(storage.isMessageProcessed("m1")).toBe(true);
    expect(storage.markMessageProcessed("m1")).toBe(false);
    storage.close();
  });

  it("stores recent proactive story lines in chronological order", () => {
    const storage = new BotStorage(path.join(os.tmpdir(), `qq-coc-dice-proactive-${Date.now()}.sqlite`));
    storage.addProactiveLine("group1", "first");
    storage.addProactiveLine("group1", "second");
    storage.addProactiveLine("group1", "third");
    storage.addProactiveLine("group2", "other group");

    expect(storage.getProactiveLineCount("group1")).toBe(3);
    expect(storage.getRecentProactiveLines("group1", 2)).toEqual(["second", "third"]);
    expect(storage.getRecentProactiveLines("group2", 2)).toEqual(["other group"]);
    storage.close();
  });

  it("stores narrative events with metadata", () => {
    const storage = new BotStorage(path.join(os.tmpdir(), `qq-coc-dice-narrative-${Date.now()}.sqlite`));
    storage.addNarrativeEvent({
      kind: "npc_reply",
      scopeType: "group",
      scopeId: "group1",
      userId: "user1",
      actorName: "张管家",
      inputText: "玩家问门在哪里",
      outputText: "张管家低声回答。",
      metadata: { command: "npc" }
    });
    storage.addNarrativeEvent({
      kind: "proactive_story",
      scopeType: "group",
      scopeId: "group1",
      userId: "proactive-scheduler",
      actorName: "守夜人",
      outputText: "走廊尽头的灯闪了一下。"
    });

    const npcEvents = storage.getRecentNarrativeEvents({
      scopeType: "group",
      scopeId: "group1",
      kind: "npc_reply",
      limit: 5
    });
    expect(npcEvents).toHaveLength(1);
    expect(npcEvents[0]).toMatchObject({
      kind: "npc_reply",
      actorName: "张管家",
      inputText: "玩家问门在哪里",
      outputText: "张管家低声回答。",
      metadata: { command: "npc" }
    });

    const allEvents = storage.getRecentNarrativeEvents({
      scopeType: "group",
      scopeId: "group1",
      limit: 5
    });
    expect(allEvents.map((event) => event.kind)).toEqual(["npc_reply", "proactive_story"]);
    storage.close();
  });

  it("stores player memories without duplicating the same note", () => {
    const storage = new BotStorage(path.join(os.tmpdir(), `qq-coc-dice-memory-${Date.now()}.sqlite`));

    expect(storage.addPlayerMemory({
      scopeType: "group",
      scopeId: "group1",
      userId: "user1",
      category: "角色设定",
      memoryText: "角色是年轻急诊医生，准备乘 W 列车去见家人。",
      usageHint: "讨论 W 列车角色动机时",
      sourceKind: "test"
    })).toBe(true);
    expect(storage.addPlayerMemory({
      scopeType: "group",
      scopeId: "group1",
      userId: "user1",
      category: "角色设定",
      memoryText: "角色是年轻急诊医生，准备乘 W 列车去见家人。",
      usageHint: "讨论 W 列车角色动机时",
      sourceKind: "test"
    })).toBe(false);

    const memories = storage.getRecentPlayerMemories({
      scopeType: "group",
      scopeId: "group1",
      userId: "user1",
      limit: 5
    });
    expect(memories).toHaveLength(1);
    expect(memories[0]).toMatchObject({
      category: "角色设定",
      memoryText: "角色是年轻急诊医生，准备乘 W 列车去见家人。",
      usageHint: "讨论 W 列车角色动机时",
      sourceKind: "test"
    });
    storage.addPlayerMemory({
      scopeType: "group",
      scopeId: "group1",
      userId: "user2",
      category: "关系羁绊",
      memoryText: "另一个玩家决定信任这名急诊医生。",
      sourceKind: "test"
    });
    expect(storage.getRecentScopePlayerMemories({
      scopeType: "group",
      scopeId: "group1",
      excludeUserId: "user1",
      limit: 5
    })).toEqual([
      expect.objectContaining({
        userId: "user2",
        memoryText: "另一个玩家决定信任这名急诊医生。"
      })
    ]);
    storage.close();
  });

  it("stores private group bindings and consumes binding codes once", () => {
    const storage = new BotStorage(path.join(os.tmpdir(), `qq-coc-dice-binding-${Date.now()}.sqlite`));

    storage.createContextBindingCode({
      code: "abc123ef",
      groupOpenid: "group1",
      groupUserId: "member1",
      role: "kp",
      expiresAtMs: 2_000
    });

    expect(storage.consumeContextBindingCode("ABC123EF", 1_000)).toMatchObject({
      groupOpenid: "group1",
      groupUserId: "member1",
      role: "kp"
    });
    expect(storage.consumeContextBindingCode("abc123ef", 1_000)).toBeUndefined();

    storage.setPrivateGroupBinding("private1", "group1", "member1", "pl");
    expect(storage.getPrivateGroupBinding("private1")).toMatchObject({
      groupOpenid: "group1",
      groupUserId: "member1",
      role: "pl"
    });
    expect(storage.getMemberRole("group", "group1", "member1")).toBe("pl");
    storage.setMemberRole("group", "group1", "member1", "ob", "kp1");
    expect(storage.getPrivateGroupBinding("private1")).toMatchObject({ role: "ob" });
    expect(storage.scopeHasRole("group", "group1", "ob")).toBe(true);
    expect(storage.clearPrivateGroupBinding("private1")).toBe(true);
    expect(storage.getPrivateGroupBinding("private1")).toBeUndefined();
    storage.close();
  });

  it("stores private messaging permissions, outbox messages, and delivery counts", () => {
    const storage = new BotStorage(path.join(os.tmpdir(), `qq-coc-dice-private-message-${Date.now()}.sqlite`));

    storage.setPrivateGroupBinding("private1", "group1", "member1");
    storage.recordPrivateActivity("private1", 1_000);
    storage.setPrivateMessagingEnabled("private1", true, 2_000);

    expect(storage.getPrivateMessagePermission("private1")).toMatchObject({
      privateUserId: "private1",
      enabled: true,
      activeMessagesAllowed: true,
      lastPrivateActivityAtMs: 2_000
    });
    expect(storage.getPrivateRecipientByGroupMember("group1", "member1")).toMatchObject({
      privateUserId: "private1",
      privateMessagesEnabled: true,
      activeMessagesAllowed: true,
      lastPrivateActivityAtMs: 2_000
    });

    const outboxId = storage.addPrivateOutboxMessage({
      privateUserId: "private1",
      groupOpenid: "group1",
      groupUserId: "member1",
      sourceKind: "secret",
      content: "你看见了背面的旧字。",
      createdByUserId: "kp1"
    });
    expect(outboxId).toBeTypeOf("number");
    expect(storage.getPendingPrivateOutboxMessages("private1", 5)).toEqual([
      expect.objectContaining({
        sourceKind: "secret",
        content: "你看见了背面的旧字。",
        status: "pending"
      })
    ]);
    expect(storage.markPrivateOutboxSent(outboxId!)).toBe(true);
    expect(storage.getPendingPrivateOutboxMessages("private1", 5)).toEqual([]);

    storage.addPrivateDelivery({
      privateUserId: "private1",
      groupOpenid: "group1",
      groupUserId: "member1",
      sourceKind: "secret",
      sentAtMs: 10_000
    });
    expect(storage.countPrivateDeliveriesSince("private1", 9_000)).toBe(1);
    expect(storage.countPrivateDeliveriesSince("private1", 11_000)).toBe(0);
    storage.setPrivateActiveMessagesAllowed("private1", false);
    expect(storage.getPrivateMessagePermission("private1")?.activeMessagesAllowed).toBe(false);
    storage.close();
  });

  it("stores group table messages as narrative context", () => {
    const storage = new BotStorage(path.join(os.tmpdir(), `qq-coc-dice-table-message-${Date.now()}.sqlite`));

    storage.addTableMessage("group1", "member1", "the hallway clock stopped");

    expect(storage.getRecentNarrativeEvents({
      scopeType: "group",
      scopeId: "group1",
      limit: 5
    })).toEqual([
      expect.objectContaining({
        kind: "table_message",
        userId: "member1",
        inputText: "the hallway clock stopped",
        outputText: "the hallway clock stopped",
        metadata: { source: "group_message" }
      })
    ]);
    storage.close();
  });
});
