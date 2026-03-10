import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OpenAiCodexRuntimeConfig } from "../../config/config.manager.js";

const CODEX_TOKEN_REFRESH_URL = "https://auth.openai.com/oauth/token";
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const TOKEN_LIFETIME_MS = 60 * 60 * 1000;
const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 5_000;
const KEYCHAIN_SERVICE = "Codex Auth";

type PersistedCodexAuth = {
  auth_mode?: string;
  OPENAI_API_KEY?: string;
  tokens?: {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
  };
  last_refresh?: string;
};

export type OpenAiCodexAuth = {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  accountId?: string;
  lastRefresh: string;
  expiresAt: number;
};

type ParsedAuth = OpenAiCodexAuth & {
  source: "file" | "keychain";
};

type RefreshTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
};

const refreshPromises = new Map<string, Promise<OpenAiCodexAuth>>();

export class OpenAiCodexAuthUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "OpenAiCodexAuthUnavailableError";
  }
}

export class OpenAiCodexAuthRefreshError extends Error {
  public readonly status?: number;
  public override readonly cause?: unknown;

  public constructor(message: string, options?: { status?: number; cause?: unknown }) {
    super(message);
    this.name = "OpenAiCodexAuthRefreshError";
    this.status = options?.status;
    this.cause = options?.cause;
  }
}

export class OpenAiCodexAuthStore {
  private readonly config: OpenAiCodexRuntimeConfig;

  public constructor(config: OpenAiCodexRuntimeConfig) {
    this.config = config;
  }

  public async hasCredentials(): Promise<boolean> {
    return (await this.readBestEffort()) !== null;
  }

  public async getAuth(options?: { forceRefresh?: boolean }): Promise<OpenAiCodexAuth> {
    const authFilePath = resolveAuthFilePath(this.config.authFilePath);
    const auth = await this.readBestEffort();
    if (!auth) {
      throw new OpenAiCodexAuthUnavailableError("未找到可用的 OpenAI Codex 登录态");
    }

    if (
      !(options?.forceRefresh ?? false) &&
      !isRefreshRequired(auth, this.config.refreshLeewayMs)
    ) {
      if (auth.source === "keychain" && !(await pathExists(authFilePath))) {
        await this.persistAuth(auth);
      }

      return stripSource(auth);
    }

    const pending = refreshPromises.get(authFilePath);
    if (pending) {
      return await pending;
    }

    const refreshPromise = this.refreshAndPersist(authFilePath, options?.forceRefresh ?? false);
    refreshPromises.set(authFilePath, refreshPromise);

    try {
      return await refreshPromise;
    } finally {
      refreshPromises.delete(authFilePath);
    }
  }

  private async refreshAndPersist(
    authFilePath: string,
    forceRefresh: boolean,
  ): Promise<OpenAiCodexAuth> {
    return await withFileLock(`${authFilePath}.lock`, async () => {
      const auth = await this.readBestEffort();
      if (!auth) {
        throw new OpenAiCodexAuthUnavailableError("OpenAI Codex 凭证不存在，无法刷新");
      }

      if (!forceRefresh && !isRefreshRequired(auth, this.config.refreshLeewayMs)) {
        if (auth.source === "keychain" && !(await pathExists(authFilePath))) {
          await this.persistAuth(auth);
        }

        return stripSource(auth);
      }

      const refreshed = await refreshCodexToken({
        refreshToken: auth.refreshToken,
        timeoutMs: this.config.timeoutMs,
      });
      const nextAuth: OpenAiCodexAuth = {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        idToken: refreshed.idToken ?? auth.idToken,
        accountId: auth.accountId,
        lastRefresh: new Date().toISOString(),
        expiresAt: Date.now() + TOKEN_LIFETIME_MS,
      };

      await this.persistAuth(nextAuth);
      return nextAuth;
    });
  }

  private async readBestEffort(): Promise<ParsedAuth | null> {
    const authFilePath = resolveAuthFilePath(this.config.authFilePath);
    const fromFile = await readCodexAuthFile(authFilePath);
    if (fromFile) {
      return fromFile;
    }

    return readCodexAuthKeychain();
  }

  private async persistAuth(auth: OpenAiCodexAuth): Promise<void> {
    const authFilePath = resolveAuthFilePath(this.config.authFilePath);
    const existing = await readPersistedEnvelope(authFilePath);
    const nextEnvelope: PersistedCodexAuth = {
      ...existing,
      auth_mode: existing?.auth_mode ?? "chatgpt",
      tokens: {
        ...(existing?.tokens ?? {}),
        ...(auth.idToken ? { id_token: auth.idToken } : {}),
        access_token: auth.accessToken,
        refresh_token: auth.refreshToken,
        ...(auth.accountId ? { account_id: auth.accountId } : {}),
      },
      last_refresh: auth.lastRefresh,
    };

    await mkdir(path.dirname(authFilePath), { recursive: true });
    const tempPath = `${authFilePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(nextEnvelope, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(tempPath, authFilePath);
  }
}

async function refreshCodexToken(params: {
  refreshToken: string;
  timeoutMs: number;
}): Promise<{ accessToken: string; refreshToken: string; idToken?: string }> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
    client_id: CODEX_CLIENT_ID,
  });

  let response: Response;
  try {
    response = await fetch(CODEX_TOKEN_REFRESH_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(params.timeoutMs),
    });
  } catch (error) {
    throw new OpenAiCodexAuthRefreshError("刷新 OpenAI Codex 票据失败", { cause: error });
  }

  const text = await response.text();
  const parsed = safeParseJson<RefreshTokenResponse>(text);

  if (!response.ok) {
    throw new OpenAiCodexAuthRefreshError(`OpenAI Codex 票据刷新失败（HTTP ${response.status}）`, {
      status: response.status,
      cause: parsed ?? text.slice(0, 500),
    });
  }

  if (!parsed?.access_token || !parsed.refresh_token) {
    throw new OpenAiCodexAuthRefreshError(
      "OpenAI Codex 刷新响应缺少 access_token 或 refresh_token",
      {
        status: response.status,
      },
    );
  }

  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    idToken: parsed.id_token,
  };
}

async function readCodexAuthFile(authFilePath: string): Promise<ParsedAuth | null> {
  const envelope = await readPersistedEnvelope(authFilePath);
  if (!envelope) {
    return null;
  }

  return parsePersistedAuth(envelope, "file");
}

async function readPersistedEnvelope(authFilePath: string): Promise<PersistedCodexAuth | null> {
  try {
    const content = await readFile(authFilePath, "utf8");
    return safeParseJson<PersistedCodexAuth>(content);
  } catch {
    return null;
  }
}

function readCodexAuthKeychain(): ParsedAuth | null {
  if (process.platform !== "darwin") {
    return null;
  }

  const codexHome = resolveCodexHomePath();
  const account = computeCodexKeychainAccount(codexHome);

  try {
    const secret = execFileSync(
      "security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"],
      {
        encoding: "utf8",
        timeout: 5_000,
        stdio: ["pipe", "pipe", "pipe"],
      },
    ).trim();

    const envelope = safeParseJson<PersistedCodexAuth>(secret);
    if (!envelope) {
      return null;
    }

    return parsePersistedAuth(envelope, "keychain");
  } catch {
    return null;
  }
}

function parsePersistedAuth(
  envelope: PersistedCodexAuth,
  source: ParsedAuth["source"],
): ParsedAuth | null {
  const accessToken = envelope.tokens?.access_token?.trim();
  const refreshToken = envelope.tokens?.refresh_token?.trim();
  if (!accessToken || !refreshToken) {
    return null;
  }

  const lastRefreshMs = parseLastRefresh(envelope.last_refresh);
  const lastRefresh = new Date(lastRefreshMs).toISOString();

  return {
    source,
    accessToken,
    refreshToken,
    idToken: envelope.tokens?.id_token?.trim() || undefined,
    accountId: envelope.tokens?.account_id?.trim() || undefined,
    lastRefresh,
    expiresAt: lastRefreshMs + TOKEN_LIFETIME_MS,
  };
}

function parseLastRefresh(value: string | undefined): number {
  if (typeof value !== "string" || value.trim().length === 0) {
    return Date.now();
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? Date.now() : timestamp;
}

function isRefreshRequired(auth: OpenAiCodexAuth, refreshLeewayMs: number): boolean {
  return auth.expiresAt - refreshLeewayMs <= Date.now();
}

function stripSource(auth: ParsedAuth): OpenAiCodexAuth {
  return {
    accessToken: auth.accessToken,
    refreshToken: auth.refreshToken,
    idToken: auth.idToken,
    accountId: auth.accountId,
    lastRefresh: auth.lastRefresh,
    expiresAt: auth.expiresAt,
  };
}

function resolveAuthFilePath(authFilePath: string): string {
  if (authFilePath.startsWith("~/")) {
    return path.join(os.homedir(), authFilePath.slice(2));
  }

  return path.resolve(authFilePath);
}

function resolveCodexHomePath(): string {
  const configured = process.env.CODEX_HOME?.trim();
  const candidate = configured && configured.length > 0 ? configured : "~/.codex";
  const resolved = resolveAuthFilePath(candidate);

  return resolved;
}

function computeCodexKeychainAccount(codexHome: string): string {
  const hash = createHash("sha256").update(codexHome).digest("hex");
  return `cli|${hash.slice(0, 16)}`;
}

async function withFileLock<T>(lockPath: string, task: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  while (true) {
    try {
      await mkdir(path.dirname(lockPath), { recursive: true });
      handle = await open(lockPath, "wx");
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }

      if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
        throw new OpenAiCodexAuthRefreshError("等待 OpenAI Codex 凭证锁超时");
      }

      await sleep(LOCK_RETRY_MS);
    }
  }

  try {
    return await task();
  } finally {
    try {
      await handle?.close();
    } finally {
      await unlink(lockPath).catch(() => {});
    }
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function safeParseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}
