import { describe, expect, it } from "vitest";
import { buildAiReplyContent, buildInstructions } from "../src/ai/client.js";
import { GROUP_CHAT_BOT_PERSONA_INSTRUCTIONS } from "../src/ai/persona.js";

describe("AI client instructions", () => {
  it("builds multimodal reply content with input images", () => {
    const content = buildAiReplyContent({
      text: "what is this?",
      scopeType: "group",
      scopeId: "group1",
      userId: "user1",
      trigger: "mention",
      images: [
        { imageUrl: "https://example.com/clue.png", detail: "auto" }
      ]
    });

    expect(content).toEqual([
      expect.objectContaining({ type: "input_text", text: expect.stringContaining("what is this?") }),
      { type: "input_image", image_url: "https://example.com/clue.png", detail: "auto" }
    ]);
  });

  it("includes the configured group chat persona when enabled", () => {
    const instructions = buildInstructions(undefined);

    expect(instructions).toContain("你是一个接入 QQ 私人 CoC 跑团群的中文助手。");
    if (GROUP_CHAT_BOT_PERSONA_INSTRUCTIONS.trim() !== "") {
      expect(instructions).toContain(GROUP_CHAT_BOT_PERSONA_INSTRUCTIONS);
    }
  });

  it("keeps request-specific context after the default instructions", () => {
    const instructions = buildInstructions("长期桌边记忆：玩家决定保护同伴。");

    expect(instructions).toContain("长期桌边记忆：玩家决定保护同伴。");
    expect(instructions.indexOf("你是一个接入 QQ 私人 CoC 跑团群的中文助手。")).toBeLessThan(instructions.indexOf("长期桌边记忆"));
  });
});
