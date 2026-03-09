import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const GaiaConfigFileSchema = z.object({
  baseUrl: z.string().url(),
});

const GaiaGetConfigResponseSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  updatedAt: z.string().optional(),
});

const GaiaErrorResponseSchema = z.object({
  error: z.string().min(1),
});

type GaiaConfigRecord = {
  key: string;
  value: string;
  updatedAt: string;
};

let cachedBaseUrl: string | null = null;

export async function readGaiaConfigValue(key: string): Promise<GaiaConfigRecord> {
  const baseUrl = await getGaiaBaseUrl();
  const requestUrl = new URL("/get", ensureTrailingSlash(baseUrl));
  requestUrl.searchParams.set("key", key);

  const response = await fetch(requestUrl);
  const payload = await safeParseJson(response);

  if (!response.ok) {
    const parsedError = GaiaErrorResponseSchema.safeParse(payload);
    throw new Error(
      parsedError.success ? parsedError.data.error : `Gaia 配置请求失败（HTTP ${response.status}）`,
    );
  }

  const parsed = GaiaGetConfigResponseSchema.parse(payload);

  return {
    key: parsed.key,
    value: parsed.value,
    updatedAt: parsed.updatedAt ?? new Date().toISOString(),
  };
}

async function getGaiaBaseUrl(): Promise<string> {
  if (cachedBaseUrl) {
    return cachedBaseUrl;
  }

  const configPath = resolveGaiaConfigPath();
  const fileContent = await readFile(configPath, "utf8");
  const match = fileContent.match(/^\s*baseUrl\s*:\s*(.+?)\s*$/m);

  if (!match) {
    throw new Error(`gaia.config.yml 缺少 baseUrl: ${configPath}`);
  }

  const rawBaseUrl = stripWrappingQuotes(match[1]!.trim());
  const parsed = GaiaConfigFileSchema.parse({
    baseUrl: rawBaseUrl,
  });

  cachedBaseUrl = parsed.baseUrl;
  return cachedBaseUrl;
}

function resolveGaiaConfigPath(): string {
  const candidates = [
    path.resolve(process.cwd(), "gaia.config.yml"),
    path.resolve(process.cwd(), "../../gaia.config.yml"),
    new URL("../../gaia.config.yml", import.meta.url).pathname,
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("未找到 gaia.config.yml");
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

async function safeParseJson(response: Response): Promise<unknown> {
  const responseText = await response.text();

  try {
    return JSON.parse(responseText);
  } catch {
    throw new Error(`Gaia 返回了无法解析的 JSON：${responseText}`);
  }
}
