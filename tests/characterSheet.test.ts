import { describe, expect, it } from "vitest";
import { parseCharacterSheetRows } from "../src/characterSheet.js";

describe("parseCharacterSheetRows", () => {
  it("imports investigator info, attributes, and sheet skills", () => {
    const rows = sheetRows();
    setCell(rows, "E3", "李力力");
    setCell(rows, "E4", "鼠");
    setCell(rows, "E5", "厨师/餐馆老板");
    setCell(rows, "E6", 31);
    setCell(rows, "M6", "男");

    setCell(rows, "U3", 80);
    setCell(rows, "AA3", 45);
    setCell(rows, "AG3", 35);
    setCell(rows, "U5", 70);
    setCell(rows, "AA5", 85);
    setCell(rows, "AG5", 55);
    setCell(rows, "U7", 70);
    setCell(rows, "AA7", 40);
    setCell(rows, "AG7", 5);
    setCell(rows, "G10", 14);
    setCell(rows, "P10", 99);
    setCell(rows, "Y10", 7);
    setCell(rows, "AF10", 8);

    setCell(rows, "F20", "技艺①");
    setCell(rows, "D20", "厨艺");
    setCell(rows, "R20", 37);
    setCell(rows, "F27", "克苏鲁神话");
    setCell(rows, "R27", 0);
    setCell(rows, "F34", "格斗：");
    setCell(rows, "H34", "斗殴");
    setCell(rows, "R34", 90);
    setCell(rows, "F35", "格斗①");
    setCell(rows, "R35", 0);
    setCell(rows, "AB35", "侦查");
    setCell(rows, "AN35", 85);

    const result = parseCharacterSheetRows(rows);
    const skill = (name: string) => result.skills.find((item) => item.name === name)?.value;

    expect(result.identity).toMatchObject({
      name: "李力力",
      player: "鼠",
      occupation: "厨师/餐馆老板",
      age: 31,
      gender: "男"
    });
    expect(skill("力量")).toBe(80);
    expect(skill("SAN")).toBe(99);
    expect(skill("厨艺")).toBe(37);
    expect(skill("斗殴")).toBe(90);
    expect(skill("侦查")).toBe(85);
    expect(skill("克苏鲁神话")).toBe(0);
    expect(result.skills.some((item) => item.name === "格斗①")).toBe(false);
    expect(result.warnings).toEqual([]);
  });
});

function sheetRows(): (string | number | boolean | null)[][] {
  return Array.from({ length: 60 }, () => Array.from({ length: 42 }, () => null));
}

function setCell(rows: (string | number | boolean | null)[][], address: string, value: string | number | boolean): void {
  const match = address.match(/^([A-Z]+)(\d+)$/u);
  if (!match) throw new Error(`Invalid address ${address}`);
  let column = 0;
  for (const char of match[1]) {
    column = column * 26 + char.charCodeAt(0) - 64;
  }
  rows[Number(match[2]) - 1][column - 1] = value;
}
