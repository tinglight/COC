import { readSheet, type SheetData } from "read-excel-file/node";
import { displaySkillName, normalizeSkillName, validateTarget } from "./coc.js";
import type { SkillInput } from "./storage.js";

export interface CharacterSheetIdentity {
  name?: string;
  player?: string;
  occupation?: string;
  age?: number;
  gender?: string;
  residence?: string;
  hometown?: string;
}

export interface CharacterSheetImport {
  sourceSheet: string;
  identity: CharacterSheetIdentity;
  skills: SkillInput[];
  warnings: string[];
}

interface SkillColumnBlock {
  nameCol: string;
  detailCol?: string;
  markerCol?: string;
  valueCol: string;
}

const DEFAULT_SHEET_NAME = "人物卡";
const SKILL_ROWS = { start: 16, end: 49 };

const ATTRIBUTE_CELLS: Array<{ name: string; cell: string }> = [
  { name: "STR", cell: "U3" },
  { name: "DEX", cell: "AA3" },
  { name: "POW", cell: "AG3" },
  { name: "CON", cell: "U5" },
  { name: "APP", cell: "AA5" },
  { name: "EDU", cell: "AG5" },
  { name: "SIZ", cell: "U7" },
  { name: "INT", cell: "AA7" },
  { name: "Luck", cell: "AG7" },
  { name: "HP", cell: "G10" },
  { name: "SAN", cell: "P10" },
  { name: "MP", cell: "Y10" },
  { name: "MOV", cell: "AF10" }
];

const SKILL_BLOCKS: SkillColumnBlock[] = [
  { markerCol: "D", nameCol: "F", detailCol: "H", valueCol: "R" },
  { markerCol: "Z", nameCol: "AB", detailCol: "AD", valueCol: "AN" }
];

const SPECIAL_PLACEHOLDER = /^(?:技艺|格斗|射击|外语|科学|学识|生存)(?:[①②③]|\d+)$/u;
const MARKER_VALUES = new Set(["0", "★", "——", "-", "☐", "□", "√", "×"]);

export async function parseCharacterSheetXlsx(
  filePath: string,
  options: { sheetName?: string } = {}
): Promise<CharacterSheetImport> {
  const sourceSheet = options.sheetName ?? DEFAULT_SHEET_NAME;
  const rows = await readSheet(filePath, sourceSheet);
  return parseCharacterSheetRows(rows, sourceSheet);
}

export function parseCharacterSheetRows(rows: SheetData, sourceSheet = DEFAULT_SHEET_NAME): CharacterSheetImport {
  const warnings: string[] = [];
  const skillsByKey = new Map<string, SkillInput>();

  const addSkill = (rawName: string | undefined, value: number | undefined, cellHint: string): void => {
    if (!rawName || value == null) return;
    try {
      validateTarget(value);
    } catch (error) {
      warnings.push(`${cellHint}: ${error instanceof Error ? error.message : "数值无效"}`);
      return;
    }
    const key = normalizeSkillName(rawName);
    skillsByKey.set(key, { key, name: displaySkillName(rawName), value });
  };

  for (const attribute of ATTRIBUTE_CELLS) {
    addSkill(attribute.name, numberAt(rows, attribute.cell), attribute.cell);
  }

  for (const block of SKILL_BLOCKS) {
    for (let row = SKILL_ROWS.start; row <= SKILL_ROWS.end; row += 1) {
      const baseName = textAt(rows, `${block.nameCol}${row}`);
      const marker = block.markerCol ? textAt(rows, `${block.markerCol}${row}`) : undefined;
      const detail = block.detailCol ? textAt(rows, `${block.detailCol}${row}`) : undefined;
      const value = numberAt(rows, `${block.valueCol}${row}`);
      const skillName = resolveSkillName(baseName, detail, marker);
      if (!shouldImportSkill(skillName, value)) continue;
      addSkill(skillName, value, `${block.nameCol}${row}/${block.valueCol}${row}`);
    }
  }

  return {
    sourceSheet,
    identity: {
      name: textAt(rows, "E3"),
      player: textAt(rows, "E4"),
      occupation: textAt(rows, "E5"),
      age: numberAt(rows, "E6"),
      gender: textAt(rows, "M6"),
      residence: textAt(rows, "E7"),
      hometown: textAt(rows, "M7")
    },
    skills: [...skillsByKey.values()].sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN")),
    warnings
  };
}

export function formatImportedSkillsForSetCommand(skills: SkillInput[], maxLength = 450): string[] {
  const chunks: string[] = [];
  let current = ".st";
  for (const skill of skills) {
    const item = ` ${skill.name}${skill.value}`;
    if (current.length > 3 && current.length + item.length > maxLength) {
      chunks.push(current);
      current = ".st";
    }
    current += item;
  }
  if (current.length > 3) chunks.push(current);
  return chunks;
}

function resolveSkillName(
  baseName: string | undefined,
  detail: string | undefined,
  marker: string | undefined
): string | undefined {
  const base = cleanSkillText(baseName);
  if (!base) return undefined;

  const cleanDetail = cleanSkillText(detail);
  if (cleanDetail) {
    return cleanDetail;
  }

  const markerText = cleanSkillText(marker);
  if (SPECIAL_PLACEHOLDER.test(base) && markerText && !MARKER_VALUES.has(markerText)) {
    return markerText;
  }

  return stripTrailingSkillColon(base);
}

function shouldImportSkill(name: string | undefined, value: number | undefined): boolean {
  if (!name || value == null) return false;
  if (value > 0) return true;
  if (name === "克苏鲁神话") return true;
  return !SPECIAL_PLACEHOLDER.test(name) && name !== "自定义技能";
}

function cleanSkillText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const text = value.replace(/Ω/g, "").replace(/\s+/g, "").trim();
  if (text === "") return undefined;
  return text;
}

function stripTrailingSkillColon(value: string): string {
  return value.replace(/[：:]+$/u, "");
}

function textAt(rows: SheetData, address: string): string | undefined {
  const value = valueAt(rows, address);
  if (value == null) return undefined;
  const text = String(value).trim();
  return text === "" ? undefined : text;
}

function numberAt(rows: SheetData, address: string): number | undefined {
  const value = valueAt(rows, address);
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value.trim())) {
    return Math.trunc(Number(value));
  }
  return undefined;
}

function valueAt(rows: SheetData, address: string): unknown {
  const { row, column } = parseAddress(address);
  return rows[row - 1]?.[column - 1] ?? undefined;
}

function parseAddress(address: string): { row: number; column: number } {
  const match = address.match(/^([A-Z]+)(\d+)$/u);
  if (!match) throw new Error(`Invalid cell address: ${address}`);
  let column = 0;
  for (const char of match[1]) {
    column = column * 26 + char.charCodeAt(0) - 64;
  }
  return { row: Number(match[2]), column };
}
