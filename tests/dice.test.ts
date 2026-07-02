import { describe, expect, it } from "vitest";
import { rollExpression } from "../src/dice.js";

describe("rollExpression", () => {
  it("rolls NdM plus modifiers", () => {
    const values = [0, 0.5];
    const result = rollExpression("2d6+3", () => values.shift() ?? 0);
    expect(result.total).toBe(8);
    expect(result.detail).toBe("+2d6[1,4]+3 = 8");
  });

  it("supports subtraction", () => {
    const result = rollExpression("1d10-2", () => 0.9);
    expect(result.total).toBe(8);
  });

  it("rejects unsafe input", () => {
    expect(() => rollExpression("1d6*2")).toThrow();
  });
});
