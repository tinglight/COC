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
});
