import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigError } from "../src/errors.js";
import {
  assertSecretWhitelist,
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

describe("assertSecretWhitelist", () => {
  const allowed = ["server.tavily.apiKey", "server.bot.creator", "server.napcat.listenGroupIds"];

  it("passes when every secret leaf is within an allowed prefix", () => {
    expect(() =>
      assertSecretWhitelist(
        {
          server: {
            tavily: { apiKey: "x" },
            bot: { creator: { name: "n", qq: "1" } },
            napcat: { listenGroupIds: ["1"] },
          },
        },
        allowed,
        "config.secret.yaml",
      ),
    ).not.toThrow();
  });

  it("passes for an empty secret object", () => {
    expect(() => assertSecretWhitelist({}, allowed, "config.secret.yaml")).not.toThrow();
  });

  it("throws CONFIG_SECRET_FORBIDDEN_KEY for a key outside the whitelist", () => {
    try {
      assertSecretWhitelist({ services: { agent: { port: 9999 } } }, allowed, "config.secret.yaml");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).meta).toMatchObject({
        key: "services.agent.port",
        reason: "CONFIG_SECRET_FORBIDDEN_KEY",
      });
    }
  });

  it("throws CONFIG_SECRET_INVALID when the root is not an object", () => {
    try {
      assertSecretWhitelist("nope", allowed, "config.secret.yaml");
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as ConfigError).meta).toMatchObject({ reason: "CONFIG_SECRET_INVALID" });
    }
  });

  it("rejects a nested __proto__ leaf even under an allowed prefix", () => {
    // server.bot.creator is whitelisted; server.bot.creator.__proto__.polluted would
    // otherwise slip past the prefix check — the segment guard must catch it.
    const evil = JSON.parse(
      '{"server":{"bot":{"creator":{"__proto__":{"polluted":"y"}}}}}',
    ) as unknown;
    try {
      assertSecretWhitelist(evil, allowed, "config.secret.yaml");
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as ConfigError).meta).toMatchObject({ reason: "CONFIG_SECRET_FORBIDDEN_KEY" });
    }
  });

  it("enforces the dot boundary: a prefix-lookalike key is rejected", () => {
    expect(() =>
      assertSecretWhitelist({ server: { bot: { qq: "1" } } }, ["server.bot.qq"], "s"),
    ).not.toThrow();
    try {
      assertSecretWhitelist({ server: { bot: { qqExtra: "1" } } }, ["server.bot.qq"], "s");
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as ConfigError).meta).toMatchObject({ reason: "CONFIG_SECRET_FORBIDDEN_KEY" });
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
      "config.yaml": "server:\n  tavily:\n    apiKey: base\n  keep: base-only\n",
      "config.secret.yaml": "server:\n  tavily:\n    apiKey: secret\n",
    });

    const { raw } = await loadMergedRawConfig({
      configPath,
      secret: { required: true, allowedPaths: ["server.tavily.apiKey"] },
    });

    expect(raw).toEqual({ server: { tavily: { apiKey: "secret" }, keep: "base-only" } });
  });

  it("throws CONFIG_SECRET_NOT_FOUND when the secret file is missing and required", async () => {
    const configPath = await writeFiles({ "config.yaml": "server: {}\n" });

    await expect(
      loadMergedRawConfig({ configPath, secret: { required: true, allowedPaths: [] } }),
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
      secret: { required: true, allowedPaths: ["server.tavily.apiKey"] },
    });

    expect(raw).toEqual({ server: { port: 1 } });
  });

  it("rejects a forbidden key in the secret file", async () => {
    const configPath = await writeFiles({
      "config.yaml": "server: {}\n",
      "config.secret.yaml": "services:\n  agent:\n    port: 9999\n",
    });

    await expect(
      loadMergedRawConfig({
        configPath,
        secret: { required: true, allowedPaths: ["server.tavily.apiKey"] },
      }),
    ).rejects.toMatchObject({ meta: { reason: "CONFIG_SECRET_FORBIDDEN_KEY" } });
  });
});
