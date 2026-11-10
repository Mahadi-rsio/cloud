import { describe, expect, it } from "vitest";
import {
  generateApiKey,
  hasScope,
  hashApiKey,
  parseScopes,
  timingSafeEqual,
  verifyApiKeyHash,
} from "@/lib/storage/auth";

describe("Storage Auth & Scopes", () => {
  it("generates random prefixed API keys and valid hashes", async () => {
    const live = await generateApiKey("live");
    expect(live.key).toMatch(/^sk_live_[0-9a-f]{64}$/);
    expect(live.prefix).toMatch(/^sk_live_[0-9a-f]{8}$/);
    expect(live.keyHash).toMatch(/^[0-9a-f]{64}$/);

    const testKey = await generateApiKey("test");
    expect(testKey.key).toMatch(/^sk_test_[0-9a-f]{64}$/);
  });

  it("verifies API key hash and protects against timing attacks", async () => {
    const { key, keyHash } = await generateApiKey("live");

    expect(await verifyApiKeyHash(key, keyHash)).toBe(true);
    expect(await verifyApiKeyHash("sk_live_wrongwrongwrong", keyHash)).toBe(false);

    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });

  it("parses and checks scopes correctly", () => {
    const s1 = parseScopes("storage:read, storage:write");
    expect(s1.has("storage:read")).toBe(true);
    expect(s1.has("storage:write")).toBe(true);
    expect(s1.has("storage:delete")).toBe(false);

    expect(hasScope("storage:read", "storage:read")).toBe(true);
    expect(hasScope("storage:read", "storage:write")).toBe(false);

    // write grants read
    expect(hasScope("storage:write", "storage:read")).toBe(true);

    // wildcard grants everything
    expect(hasScope("*", "storage:delete")).toBe(true);
    expect(hasScope(["*"], "storage:admin")).toBe(true);
  });
});
