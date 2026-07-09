import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigError } from "../src/errors.js";
import {
  assertSecretShape,
  deepMerge,
  loadMergedRawConfig,
  resolveSecretConfigPath,
} from "../src/source.js";

const tempDirs: string[] = [];

async function writeFiles(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kagami-config-src-"));
  tempDirs.push(dir);
  await Promise.all(
    Object.entries(files).map(([name, content]) =>
      writeFile(path.join(dir, name), content, "utf8"),
    ),
  );
  return path.join(dir, "config.yaml");
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe("deepMerge", () => {
  it("recursively merges nested plain objects", () => {
    expect(deepMerge({ a: { x: 1, y: 2 } }, { a: { y: 3, z: 4 } })).toEqual({
      a: { x: 1, y: 3, z: 4 },
    });
  });

  it("replaces arrays wholesale instead of concatenating", () => {
    expect(deepMerge({ list: [1, 2, 3] }, { list: [9] })).toEqual({ list: [9] });
  });

  it("lets override scalars win and leaves base untouched", () => {
    const base = { a: 1, keep: "yes" };
    expect(deepMerge(base, { a: 2 })).toEqual({ a: 2, keep: "yes" });
    expect(base).toEqual({ a: 1, keep: "yes" });
  });

  it("returns base unchanged when override is an empty object", () => {
    expect(deepMerge({ a: 1, b: { c: 2 } }, {})).toEqual({ a: 1, b: { c: 2 } });
  });

  it("drops __proto__ / constructor / prototype keys (no prototype pollution)", () => {
    const secret = JSON.parse('{"a":{"__proto__":{"polluted":"yes"}},"b":2}') as unknown;
    const merged = deepMerge({ a: { keep: 1 } }, secret) as Record<string, Record<string, unknown>>;
    expect(merged.a.polluted).toBeUndefined();
    expect(merged.b).toBe(2);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("assertSecretShape", () => {
  it("accepts a plain-object secret (any paths allowed — no whitelist)", () => {
    expect(() =>
      assertSecretShape(
        { services: { agent: { port: 9999 } }, server: { demoProvider: { apiKey: "x" } } },
        "config.secret.yaml",
      ),
    ).not.toThrow();
  });

  it("accepts null / undefined / empty secret", () => {
    expect(() => assertSecretShape(null, "config.secret.yaml")).not.toThrow();
    expect(() => assertSecretShape(undefined, "config.secret.yaml")).not.toThrow();
    expect(() => assertSecretShape({}, "config.secret.yaml")).not.toThrow();
  });

  it("throws CONFIG_SECRET_INVALID when the root is not an object", () => {
    try {
      assertSecretShape("nope", "config.secret.yaml");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).meta).toMatchObject({ reason: "CONFIG_SECRET_INVALID" });
    }
  });
});

describe("resolveSecretConfigPath", () => {
  it("returns the sibling config.secret.yaml", () => {
    expect(resolveSecretConfigPath("/repo/config.yaml")).toBe(
      path.join("/repo", "config.secret.yaml"),
    );
  });
});

describe("loadMergedRawConfig", () => {
  it("merges config.yaml with config.secret.yaml (secret wins)", async () => {
    const configPath = await writeFiles({
      "config.yaml": "server:\n  demoProvider:\n    apiKey: base\n  keep: base-only\n",
      "config.secret.yaml": "server:\n  demoProvider:\n    apiKey: secret\n",
    });

    const { raw } = await loadMergedRawConfig({
      configPath,
      secret: { required: true },
    });

    expect(raw).toEqual({ server: { demoProvider: { apiKey: "secret" }, keep: "base-only" } });
  });

  it("throws CONFIG_SECRET_NOT_FOUND when the secret file is missing and required", async () => {
    const configPath = await writeFiles({ "config.yaml": "server: {}\n" });

    await expect(
      loadMergedRawConfig({ configPath, secret: { required: true } }),
    ).rejects.toMatchObject({ meta: { reason: "CONFIG_SECRET_NOT_FOUND" } });
  });

  it("skips the secret merge entirely when secret option is omitted", async () => {
    const configPath = await writeFiles({ "config.yaml": "server:\n  port: 1\n" });

    const { raw } = await loadMergedRawConfig({ configPath });

    expect(raw).toEqual({ server: { port: 1 } });
  });

  it("treats an empty (comments-only) secret file as no-op merge", async () => {
    const configPath = await writeFiles({
      "config.yaml": "server:\n  port: 1\n",
      "config.secret.yaml": "# only a comment, parses to null\n",
    });

    const { raw } = await loadMergedRawConfig({
      configPath,
      secret: { required: true },
    });

    expect(raw).toEqual({ server: { port: 1 } });
  });

  it("merges any key from the secret file (privacy whitelist removed)", async () => {
    const configPath = await writeFiles({
      "config.yaml": "server: {}\n",
      "config.secret.yaml": "services:\n  agent:\n    port: 9999\n",
    });

    const { raw } = await loadMergedRawConfig({ configPath, secret: { required: true } });
    expect(raw).toEqual({ server: {}, services: { agent: { port: 9999 } } });
  });
});
