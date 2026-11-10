import { describe, expect, it } from "vitest";
import {
  cleanProjectId,
  cleanTenantId,
  formatObjectKey,
  generateApiKeyId,
  generateProjectId,
  generateTenantId,
  parseObjectKey,
  validatePath,
} from "@/lib/storage/keys";

describe("Storage Keys & Path Safety", () => {
  it("generates correctly prefixed time-ordered IDs", () => {
    const t1 = generateTenantId();
    const t2 = generateTenantId();
    expect(t1).toMatch(/^t_[0-9a-z]+$/);
    expect(t2).toMatch(/^t_[0-9a-z]+$/);
    expect(t1).not.toBe(t2);

    const p = generateProjectId();
    expect(p).toMatch(/^p_[0-9a-z]+$/);

    const k = generateApiKeyId();
    expect(k).toMatch(/^key_[0-9a-z]+$/);
  });

  it("cleans tenant and project prefixes cleanly", () => {
    expect(cleanTenantId("t_12345")).toBe("12345");
    expect(cleanTenantId("12345")).toBe("12345");

    expect(cleanProjectId("p_abcdef")).toBe("abcdef");
    expect(cleanProjectId("abcdef")).toBe("abcdef");
  });

  it("validates and normalizes valid paths", () => {
    const r1 = validatePath("images/avatar.png");
    expect(r1.valid).toBe(true);
    if (r1.valid) {
      expect(r1.normalized).toBe("images/avatar.png");
    }

    const r2 = validatePath("a/b/c/d/file.json");
    expect(r2.valid).toBe(true);
    if (r2.valid) {
      expect(r2.normalized).toBe("a/b/c/d/file.json");
    }
  });

  it("strictly rejects path traversal and malicious vectors", () => {
    // Relative traversal
    expect(validatePath("../etc/passwd").valid).toBe(false);
    expect(validatePath("images/../../etc/passwd").valid).toBe(false);
    expect(validatePath("..").valid).toBe(false);

    // Encoded traversal
    expect(validatePath("%2e%2e/secret").valid).toBe(false);
    expect(validatePath("folder/%2e%2e/secret").valid).toBe(false);

    // Leading slash
    expect(validatePath("/root/file.txt").valid).toBe(false);

    // Backslashes
    expect(validatePath("folder\\file.txt").valid).toBe(false);

    // Null bytes
    expect(validatePath("folder/file\0.txt").valid).toBe(false);
    expect(validatePath("folder/file%00.txt").valid).toBe(false);

    // Empty and double slashes
    expect(validatePath("").valid).toBe(false);
    expect(validatePath("   ").valid).toBe(false);
    expect(validatePath("folder//file.txt").valid).toBe(false);
  });

  it("formats and parses tenancy object keys accurately", () => {
    const formatted = formatObjectKey("t_tenant123", "p_media", "avatars/user.jpg");
    expect(formatted).toBe("t_tenant123/media/avatars/user.jpg");

    const parsed = parseObjectKey(formatted);
    expect(parsed).not.toBeNull();
    expect(parsed?.tenantId).toBe("t_tenant123");
    expect(parsed?.projectId).toBe("p_media");
    expect(parsed?.path).toBe("avatars/user.jpg");
  });
});
