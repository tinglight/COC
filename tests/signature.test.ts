import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { signValidationResponse, verifyWebhookSignature } from "../src/qq/signature.js";

describe("QQ signature helpers", () => {
  it("verifies signatures generated from the documented Ed25519 seed derivation", () => {
    const secret = "naOC0ocQE3shWLAfffVLB1rhYPG7";
    const body = '{"op":0,"d":{},"t":"GATEWAY_EVENT_NAME"}';
    const timestamp = "1725442341";
    const signature = signForTest(secret, `${timestamp}${body}`);
    expect(verifyWebhookSignature(secret, timestamp, body, signature)).toBe(true);
  });

  it("signs validation responses", () => {
    const signature = signValidationResponse("DG5g3B4j9X2KOErG", "1725442341", "Arq0D5A61EgUu4OxUvOp");
    expect(signature).toMatch(/^[a-f0-9]{128}$/);
  });
});

function signForTest(secret: string, message: string): string {
  const prefix = Buffer.from("302e020100300506032b657004220420", "hex");
  let seedText = secret;
  while (Buffer.byteLength(seedText) < 32) seedText += seedText;
  const seed = Buffer.from(seedText).subarray(0, 32);
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([prefix, seed]),
    format: "der",
    type: "pkcs8"
  });
  return crypto.sign(null, Buffer.from(message), privateKey).toString("hex");
}
