import { beforeAll, describe, expect, it } from "vitest";
import { encryptToken, decryptToken } from "../src/credentials/tokenCrypto.js";

beforeAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = "test-token-encryption-key-32chars!";
});

describe("tokenCrypto", () => {
  it("round-trips a token", () => {
    const token = JSON.stringify({ refresh_token: "1//abc", access_token: "ya29.xyz" });
    const stored = encryptToken(token);
    expect(stored.startsWith("v1:")).toBe(true);
    expect(stored).not.toContain("ya29");
    expect(decryptToken(stored)).toBe(token);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    expect(encryptToken("same")).not.toBe(encryptToken("same"));
  });

  it("rejects tampered ciphertext", () => {
    const stored = encryptToken("secret");
    const parts = stored.split(":");
    const corrupted = Buffer.from(parts[2], "base64");
    corrupted[0] ^= 0xff;
    parts[2] = corrupted.toString("base64");
    expect(() => decryptToken(parts.join(":"))).toThrow();
  });

  it("rejects unknown formats", () => {
    expect(() => decryptToken("plaintext-token")).toThrow(/format/);
  });
});
