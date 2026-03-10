import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiCodexAuthStore } from "../../src/llm/providers/openai-codex-auth.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kagami-codex-auth-"));
  tempDirs.push(dir);
  return dir;
}

async function writeAuthFile(params: {
  filePath: string;
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  accountId?: string;
  lastRefresh: string;
}): Promise<void> {
  await writeFile(
    params.filePath,
    `${JSON.stringify(
      {
        auth_mode: "chatgpt",
        tokens: {
          access_token: params.accessToken,
          refresh_token: params.refreshToken,
          ...(params.idToken ? { id_token: params.idToken } : {}),
          ...(params.accountId ? { account_id: params.accountId } : {}),
        },
        last_refresh: params.lastRefresh,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe("OpenAiCodexAuthStore", () => {
  it("should read auth from the local Codex auth file", async () => {
    const dir = await createTempDir();
    const authFilePath = path.join(dir, "auth.json");
    const lastRefresh = new Date().toISOString();
    await writeAuthFile({
      filePath: authFilePath,
      accessToken: "access-token",
      refreshToken: "refresh-token",
      idToken: "id-token",
      accountId: "account-id",
      lastRefresh,
    });

    const store = new OpenAiCodexAuthStore({
      authFilePath,
      baseUrl: "https://chatgpt.com/backend-api/codex/responses",
      chatModel: "gpt-5.3-codex",
      refreshLeewayMs: 60_000,
      timeoutMs: 5_000,
    });

    await expect(store.hasCredentials()).resolves.toBe(true);
    await expect(store.getAuth()).resolves.toMatchObject({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      idToken: "id-token",
      accountId: "account-id",
      lastRefresh,
    });
  });

  it("should refresh and persist auth when the local token is near expiry", async () => {
    const dir = await createTempDir();
    const authFilePath = path.join(dir, "auth.json");
    await writeAuthFile({
      filePath: authFilePath,
      accessToken: "stale-access",
      refreshToken: "stale-refresh",
      accountId: "account-id",
      lastRefresh: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });

    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          access_token: "fresh-access",
          refresh_token: "fresh-refresh",
          id_token: "fresh-id",
          expires_in: 864000,
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = new OpenAiCodexAuthStore({
      authFilePath,
      baseUrl: "https://chatgpt.com/backend-api/codex/responses",
      chatModel: "gpt-5.3-codex",
      refreshLeewayMs: 60_000,
      timeoutMs: 5_000,
    });

    await expect(store.getAuth()).resolves.toMatchObject({
      accessToken: "fresh-access",
      refreshToken: "fresh-refresh",
      idToken: "fresh-id",
      accountId: "account-id",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const persisted = JSON.parse(await readFile(authFilePath, "utf8")) as {
      tokens: Record<string, string>;
      last_refresh: string;
    };
    expect(persisted.tokens.access_token).toBe("fresh-access");
    expect(persisted.tokens.refresh_token).toBe("fresh-refresh");
    expect(persisted.tokens.id_token).toBe("fresh-id");
    expect(persisted.last_refresh).not.toBeUndefined();
  });

  it("should dedupe concurrent refreshes for the same auth file", async () => {
    const dir = await createTempDir();
    const authFilePath = path.join(dir, "auth.json");
    await writeAuthFile({
      filePath: authFilePath,
      accessToken: "stale-access",
      refreshToken: "stale-refresh",
      accountId: "account-id",
      lastRefresh: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });

    const fetchMock = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 25));
      return new Response(
        JSON.stringify({
          access_token: "fresh-access",
          refresh_token: "fresh-refresh",
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = new OpenAiCodexAuthStore({
      authFilePath,
      baseUrl: "https://chatgpt.com/backend-api/codex/responses",
      chatModel: "gpt-5.3-codex",
      refreshLeewayMs: 60_000,
      timeoutMs: 5_000,
    });

    const first = store.getAuth();
    const second = store.getAuth();

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(firstResult.accessToken).toBe("fresh-access");
    expect(secondResult.accessToken).toBe("fresh-access");
  });
});
