import crypto from "node:crypto";

const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export function signValidationResponse(appSecret: string, eventTs: string, plainToken: string): string {
  const privateKey = privateKeyFromSecret(appSecret);
  return crypto.sign(null, Buffer.from(`${eventTs}${plainToken}`), privateKey).toString("hex");
}

export function verifyWebhookSignature(appSecret: string, timestamp: string, rawBody: string, signatureHex: string): boolean {
  if (timestamp === "" || signatureHex === "") return false;
  let signature: Buffer;
  try {
    signature = Buffer.from(signatureHex, "hex");
  } catch {
    return false;
  }
  if (signature.length !== 64 || (signature[63] & 224) !== 0) return false;

  const privateKey = privateKeyFromSecret(appSecret);
  const publicKey = crypto.createPublicKey(privateKey);
  const message = Buffer.concat([Buffer.from(timestamp), Buffer.from(rawBody)]);
  return crypto.verify(null, message, publicKey, signature);
}

function privateKeyFromSecret(appSecret: string): crypto.KeyObject {
  const seed = seedFromSecret(appSecret);
  return crypto.createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8"
  });
}

function seedFromSecret(appSecret: string): Buffer {
  if (appSecret === "") throw new Error("QQ_APP_SECRET is required for webhook signatures");
  const secret = Buffer.from(appSecret);
  const chunks: Buffer[] = [];
  let total = 0;
  while (total < 32) {
    chunks.push(secret);
    total += secret.length;
  }
  return Buffer.concat(chunks).subarray(0, 32);
}
