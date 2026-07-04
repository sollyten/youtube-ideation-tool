/**
 * Encryption-at-rest for per-user YouTube OAuth tokens (channel_tokens table).
 *
 * AES-256-GCM with a key derived from TOKEN_ENCRYPTION_KEY. Tokens are
 * decrypted only server-side, at call time, immediately before use — the
 * plaintext never touches the database, logs, or any HTTP response. Treat a
 * token leak as a channel-takeover risk.
 *
 * Wire format: "v1:<iv b64>:<ciphertext b64>:<authTag b64>"
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function deriveKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  // Accept a 64-char hex key verbatim; otherwise derive 32 bytes from the
  // provided secret so any sufficiently long secret works.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  if (raw.length < 16) throw new Error("TOKEN_ENCRYPTION_KEY must be at least 16 characters");
  return createHash("sha256").update(raw).digest();
}

export function encryptToken(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${ciphertext.toString("base64")}:${tag.toString("base64")}`;
}

export function decryptToken(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Unrecognized encrypted token format");
  }
  const [, ivB64, ctB64, tagB64] = parts;
  const key = deriveKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
