import { describe, expect, it } from "vitest";
import {
  blobShard,
  formatObjectKey,
  isTempArtifactName,
  parseObjectKey,
  shouldDeleteBlobAfterUnref,
} from "../src/store/object-store-logic.js";

describe("formatObjectKey / parseObjectKey", () => {
  it("round-trips id → key → id", () => {
    for (const id of [1, 2, 42, 999, Number.MAX_SAFE_INTEGER]) {
      expect(parseObjectKey(formatObjectKey(id))).toBe(id);
    }
  });

  it("formats as res-<id>", () => {
    expect(formatObjectKey(1)).toBe("res-1");
    expect(formatObjectKey(12345)).toBe("res-12345");
  });

  it("parses valid keys", () => {
    expect(parseObjectKey("res-1")).toBe(1);
    expect(parseObjectKey("res-42")).toBe(42);
  });

  it("rejects wrong/absent prefix", () => {
    expect(parseObjectKey("42")).toBeNull();
    expect(parseObjectKey("obj-42")).toBeNull();
    expect(parseObjectKey("")).toBeNull();
    expect(parseObjectKey("res")).toBeNull();
  });

  it("rejects non-positive-integer bodies", () => {
    expect(parseObjectKey("res-")).toBeNull(); // 空 body
    expect(parseObjectKey("res-0")).toBeNull(); // id 必须 > 0
    expect(parseObjectKey("res--1")).toBeNull(); // 负号不匹配 [0-9]+
    expect(parseObjectKey("res-1.5")).toBeNull();
    expect(parseObjectKey("res-abc")).toBeNull();
    expect(parseObjectKey("res-1a")).toBeNull();
    expect(parseObjectKey("res- 1")).toBeNull();
  });

  it("rejects ids beyond the safe-integer range (no silent overflow)", () => {
    expect(parseObjectKey("res-99999999999999999999")).toBeNull();
  });

  it("is lenient on leading zeros (decimal parse, current behavior)", () => {
    expect(parseObjectKey("res-01")).toBe(1);
  });
});

describe("blobShard", () => {
  it("takes the first two hex chars as the shard dir", () => {
    expect(blobShard("abcdef0123456789")).toBe("ab");
    expect(blobShard("00ffee")).toBe("00");
  });
});

describe("isTempArtifactName", () => {
  it("flags in-progress/crash temp files by their .tmp- marker", () => {
    expect(isTempArtifactName("3f2a.tmp-9c11")).toBe(true);
    expect(isTempArtifactName("x.tmp-y")).toBe(true);
  });

  it("does not flag a real blob file name (bare sha256)", () => {
    expect(isTempArtifactName("a".repeat(64))).toBe(false);
    expect(isTempArtifactName("deadbeef")).toBe(false);
  });
});

describe("shouldDeleteBlobAfterUnref", () => {
  it("deletes the blob when this was the last reference", () => {
    expect(shouldDeleteBlobAfterUnref(1)).toBe(true);
  });

  it("keeps the blob when other objects still reference it", () => {
    expect(shouldDeleteBlobAfterUnref(2)).toBe(false);
    expect(shouldDeleteBlobAfterUnref(100)).toBe(false);
  });

  it("deletes defensively for non-positive refcounts (should never happen)", () => {
    expect(shouldDeleteBlobAfterUnref(0)).toBe(true);
    expect(shouldDeleteBlobAfterUnref(-1)).toBe(true);
  });
});
