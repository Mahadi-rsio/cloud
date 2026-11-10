import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatBytes } from "../lib/storage-client";

describe("Storage UI and Client Helpers", () => {
  it("formatBytes formats B, KB, MB, GB accurately", () => {
    assert.equal(formatBytes(0), "0 B");
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(1024), "1 KB");
    assert.equal(formatBytes(1024 * 1024), "1 MB");
    assert.equal(formatBytes(536_870_912), "512 MB");
    assert.equal(formatBytes(1024 * 1024 * 1024), "1 GB");
    assert.equal(formatBytes(1536 * 1024), "1.5 MB");
  });

  it("handles decimal precision in formatBytes", () => {
    assert.equal(formatBytes(1234567, 2), "1.18 MB");
    assert.equal(formatBytes(1234567, 0), "1 MB");
  });
});
