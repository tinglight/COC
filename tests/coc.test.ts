import { describe, expect, it } from "vitest";
import { cocCheck, normalizeSkillName } from "../src/coc.js";

describe("cocCheck", () => {
  it("computes success ranks", () => {
    expect(cocCheck(60, 1).rank).toBe("大成功");
    expect(cocCheck(60, 12).rank).toBe("极难成功");
    expect(cocCheck(60, 30).rank).toBe("困难成功");
    expect(cocCheck(60, 60).rank).toBe("成功");
    expect(cocCheck(60, 61).rank).toBe("失败");
    expect(cocCheck(60, 100).rank).toBe("大失败");
  });

  it("uses low-skill fumble rules", () => {
    expect(cocCheck(40, 96).rank).toBe("大失败");
    expect(cocCheck(50, 96).rank).toBe("失败");
  });

  it("normalizes common aliases", () => {
    expect(normalizeSkillName("SAN")).toBe("san");
    expect(normalizeSkillName("偵查")).toBe("侦查");
  });
});
