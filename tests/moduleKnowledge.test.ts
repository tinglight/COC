import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildLocalModuleKnowledgeInstructions } from "../src/moduleKnowledge.js";

describe("module knowledge", () => {
  it("loads matching imported module context from local files", () => {
    const root = createModuleImportRoot();

    const instructions = buildLocalModuleKnowledgeInstructions("粗略介绍一下W列车这个模组", root);

    expect(instructions).toContain("本地已导入模组资料命中");
    expect(instructions).toContain("不要使用外部网站");
    expect(instructions).toContain("模组：Warp列车");
    expect(instructions).toContain("COC 7th");
    expect(instructions).toContain("branch-001");
    expect(instructions).toContain("幸存乘客");
  });

  it("returns undefined when no imported module matches", () => {
    const root = createModuleImportRoot();

    expect(buildLocalModuleKnowledgeInstructions("今天晚饭吃什么", root)).toBeUndefined();
  });
});

function createModuleImportRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qq-coc-module-imports-"));
  const moduleRoot = path.join(root, "w-train-v2-demo");
  fs.mkdirSync(path.join(moduleRoot, "canon"), { recursive: true });
  fs.mkdirSync(path.join(moduleRoot, "campaign"), { recursive: true });
  fs.writeFileSync(path.join(moduleRoot, "canon", "module_index.json"), JSON.stringify({
    module_id: "w-train-v2-demo",
    metadata: {
      "模组名称": "Warp列车",
      "使用规则": "COC 7th",
      "建议人数": "1-3人"
    },
    stats: {
      sections: 141,
      branch_hooks: 11,
      rule_candidates: 63,
      mutable_hooks: 7
    },
    entities: {
      organizations: [{ name: "WARP列车" }],
      npcs: [{ name: "萝丝" }],
      places: [{ name: "第2车厢" }]
    },
    branch_hooks: [{
      id: "branch-001",
      hook_type: "customization_policy",
      section_title: "自定义普通车厢的剧本",
      trigger_text: ["调查员职业、技能和背景故事会影响普通车厢"]
    }],
    mutable_hooks: [{ text: "守秘人可以自定义普通车厢。" }],
    rule_candidates: [{ text: "推荐技能：侦查、聆听、医学。" }]
  }), "utf8");
  fs.writeFileSync(path.join(moduleRoot, "campaign", "session_state.json"), JSON.stringify({
    scene_log: [{}],
    npcs: { "幸存乘客": {} },
    relationships: { "PC_A <-> 幸存乘客": {} },
    world_changes: [{}]
  }), "utf8");
  return root;
}
