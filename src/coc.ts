export type SuccessRank = "大成功" | "极难成功" | "困难成功" | "成功" | "失败" | "大失败";

export interface CocCheckResult {
  roll: number;
  target: number;
  rank: SuccessRank;
  success: boolean;
}

export function cocCheck(target: number, roll: number): CocCheckResult {
  validateTarget(target);
  if (!Number.isInteger(roll) || roll < 1 || roll > 100) {
    throw new Error("D100 roll must be between 1 and 100");
  }

  const fumble = target < 50 ? roll >= 96 : roll === 100;
  if (fumble) return { roll, target, rank: "大失败", success: false };
  if (roll === 1) return { roll, target, rank: "大成功", success: true };
  if (roll <= Math.floor(target / 5)) return { roll, target, rank: "极难成功", success: true };
  if (roll <= Math.floor(target / 2)) return { roll, target, rank: "困难成功", success: true };
  if (roll <= target) return { roll, target, rank: "成功", success: true };
  return { roll, target, rank: "失败", success: false };
}

export function validateTarget(target: number): void {
  if (!Number.isInteger(target) || target < 0 || target > 100) {
    throw new Error("技能/SAN 数值需在 0-100 之间");
  }
}

const aliases = new Map<string, string>([
  ["san", "san"],
  ["san值", "san"],
  ["理智", "san"],
  ["理智值", "san"],
  ["侦查", "侦查"],
  ["偵查", "侦查"],
  ["聆听", "聆听"],
  ["聆聽", "聆听"],
  ["图书馆", "图书馆"],
  ["圖書館", "图书馆"],
  ["图书馆使用", "图书馆"],
  ["圖書館使用", "图书馆"],
  ["hp", "hp"],
  ["体力", "hp"],
  ["生命值", "hp"],
  ["mp", "mp"],
  ["魔法", "mp"],
  ["魔法值", "mp"],
  ["mov", "mov"],
  ["移动力", "mov"],
  ["str", "力量"],
  ["力量", "力量"],
  ["con", "体质"],
  ["体质", "体质"],
  ["siz", "体型"],
  ["体型", "体型"],
  ["dex", "敏捷"],
  ["敏捷", "敏捷"],
  ["app", "外貌"],
  ["外貌", "外貌"],
  ["pow", "意志"],
  ["意志", "意志"],
  ["int", "智力"],
  ["智力", "智力"],
  ["灵感", "智力"],
  ["edu", "教育"],
  ["教育", "教育"],
  ["知识", "教育"],
  ["luck", "幸运"],
  ["幸运", "幸运"]
]);

export function normalizeSkillName(name: string): string {
  const normalized = name.trim().toLowerCase();
  return aliases.get(normalized) ?? normalized;
}

export function displaySkillName(name: string): string {
  const key = normalizeSkillName(name);
  if (key === "san") return "SAN";
  if (key === "hp") return "HP";
  if (key === "mp") return "MP";
  if (key === "mov") return "MOV";
  return key;
}
