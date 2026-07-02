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

  it("adds KP and player-count guidance when a request conflicts with module metadata", () => {
    const root = createModuleImportRoot();

    const instructions = buildLocalModuleKnowledgeInstructions("我是KP，给我介绍下W列车这个模组，我要带4个人一起玩这个模组", root);

    expect(instructions).toContain("KP视角提醒");
    expect(instructions).toContain("keeper-only 真相");
    expect(instructions).toContain("人数适配提醒");
    expect(instructions).toContain("用户提到 4 名玩家");
    expect(instructions).toContain("建议人数是 1-3人");
    expect(instructions).toContain("campaign/KP 调整");
  });

  it("uses source_text fallback when module_index.json is unreadable", () => {
    const root = createModuleImportRoot({ invalidIndex: true });

    const instructions = buildLocalModuleKnowledgeInstructions("粗略介绍一下W列车这个模组", root);

    expect(instructions).toContain("模组：Warp列车");
    expect(instructions).toContain("canon/module_index.json 无法按 JSON 读取");
    expect(instructions).toContain("从 source_text.json 恢复的候选摘要");
    expect(instructions).toContain("COC 7th");
    expect(instructions).toContain("导入统计：章节 1");
  });

  it("prefers a module-name match over a weaker entity alias match", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "qq-coc-module-imports-"));
    createModuleImportRoot({
      root,
      moduleId: "aaa-test-fixture",
      moduleName: "测试夹具",
      organizationName: "WARP列车"
    });
    createModuleImportRoot({
      root,
      moduleId: "w-train-v2-demo",
      moduleName: "Warp列车",
      organizationName: "WARP列车"
    });

    const instructions = buildLocalModuleKnowledgeInstructions("粗略介绍一下W列车这个模组", root);

    expect(instructions).toContain("模组：Warp列车");
    expect(instructions).not.toContain("模组：测试夹具");
  });

  it("keeps player-facing requests spoiler safe", () => {
    const root = createModuleImportRoot();

    const instructions = buildLocalModuleKnowledgeInstructions("我是PL，想玩W列车，帮我车卡", root);

    expect(instructions).toContain("PL视角提醒");
    expect(instructions).toContain("spoiler-safe");
    expect(instructions).toContain("不要透露隐藏真相");
  });

  it("returns undefined when no imported module matches", () => {
    const root = createModuleImportRoot();

    expect(buildLocalModuleKnowledgeInstructions("今天晚饭吃什么", root)).toBeUndefined();
  });
});

function createModuleImportRoot(options: {
  root?: string;
  moduleId?: string;
  moduleName?: string;
  organizationName?: string;
  invalidIndex?: boolean;
} = {}): string {
  const root = options.root ?? fs.mkdtempSync(path.join(os.tmpdir(), "qq-coc-module-imports-"));
  const moduleId = options.moduleId ?? "w-train-v2-demo";
  const moduleName = options.moduleName ?? "Warp列车";
  const organizationName = options.organizationName ?? "WARP列车";
  const moduleRoot = path.join(root, moduleId);
  fs.mkdirSync(path.join(moduleRoot, "canon"), { recursive: true });
  fs.mkdirSync(path.join(moduleRoot, "campaign"), { recursive: true });
  const moduleIndex = {
    module_id: moduleId,
    metadata: {
      "模组名称": moduleName,
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
      organizations: [{ name: organizationName }],
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
  };
  fs.writeFileSync(
    path.join(moduleRoot, "canon", "module_index.json"),
    options.invalidIndex ? "{ invalid json" : JSON.stringify(moduleIndex),
    "utf8"
  );
  fs.writeFileSync(path.join(moduleRoot, "canon", "source_text.json"), JSON.stringify({
    module_id: moduleId,
    blocks: [
      { index: 0, text: `【模组名称】：${moduleName}` },
      { index: 1, text: "【使用规则】：COC 7th" },
      { index: 2, text: "【建议人数】：1-3人" },
      { index: 3, text: "特别说明：自定义普通车厢的剧本" }
    ],
    sections: [{
      id: "sec-001",
      title: "特别说明：自定义普通车厢的剧本",
      categories: ["pc_branch", "mutable_hook"],
      start_block: 3,
      end_block: 3,
      paragraphs: ["调查员职业、技能和背景故事会影响普通车厢"]
    }]
  }), "utf8");
  fs.writeFileSync(path.join(moduleRoot, "module_manifest.json"), JSON.stringify({
    module_id: moduleId
  }), "utf8");
  fs.writeFileSync(path.join(moduleRoot, "campaign", "session_state.json"), JSON.stringify({
    scene_log: [{}],
    npcs: { "幸存乘客": {} },
    relationships: { "PC_A <-> 幸存乘客": {} },
    world_changes: [{}]
  }), "utf8");
  return root;
}
