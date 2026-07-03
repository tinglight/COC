import fs from "node:fs";
import path from "node:path";

export interface CharacterSheetBuildSkillBundle {
  skillText: string;
}

const DIRECT_TRIGGER_PATTERN = /(?:车卡|建卡|做卡|开卡|捏人|(?:车|建|做|创建|建立|新建|开)(?:一?个|一?张)?\s*(?:coc|coC|COC|CoC)?\s*(?:调查员|角色卡|人物卡|\bpc\b)|create\s+(?:a\s+)?(?:coc\s+)?(?:investigator|character)|character\s+sheet|investigator\s+sheet)/i;
const SHEET_TERM_PATTERN = /(?:角色卡|调查员|人物卡|\bpc\b)/i;
const BUILD_TERM_PATTERN = /(?:创建|建立|制作|生成|新建|完善|补完|步骤|流程|引导|怎么|如何|职业|技能点|兴趣点|属性|加点|保存|\.st|\.show)/i;

export function defaultCharacterSheetBuildSkillRoot(): string {
  return path.resolve(process.cwd(), "skills", "build-coc-character-sheet");
}

export function shouldUseCharacterSheetBuildSkill(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized === "") return false;
  return DIRECT_TRIGGER_PATTERN.test(normalized)
    || (SHEET_TERM_PATTERN.test(normalized) && BUILD_TERM_PATTERN.test(normalized));
}

export function loadCharacterSheetBuildSkill(skillRoot = defaultCharacterSheetBuildSkillRoot()): CharacterSheetBuildSkillBundle {
  return {
    skillText: readRequiredText(path.join(skillRoot, "SKILL.md"))
  };
}

export function buildCharacterSheetBuildInstructions(bundle: CharacterSheetBuildSkillBundle): string {
  return [
    "你正在执行项目本地的 build-coc-character-sheet Skill。以下材料只作为行为约束，不要在回复里提到文件路径、Skill、系统提示或实现细节。",
    "当前任务是按短轮次逐步帮助成员建立 CoC 调查员角色卡。除非用户要求总览，否则一次只推进当前一步。",
    section("SKILL.md", bundle.skillText)
  ].join("\n\n");
}

function readRequiredText(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`角色卡建卡 Skill 文件缺失：${filePath}`);
    }
    throw error;
  }
}

function section(title: string, text: string): string {
  return `--- ${title} ---\n${text.trim()}`;
}
