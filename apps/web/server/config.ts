import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { resolveConfigPath } from "@kagami/config/source";

export interface WebServerConfig {
  /** 自身监听端口（来自 services.web.port）。 */
  port: number;
}

interface RawConfig {
  services?: {
    web?: {
      port?: number;
    };
  };
}

/**
 * 只读 config.yaml 的 services.web，不触 config.secret.yaml——静态托管没有任何隐私输入。
 * 定位逻辑收敛到 @kagami/config，与 gateway 同一套。
 */
export function loadWebServerConfig(): WebServerConfig {
  const configPath = resolveConfigPath(import.meta.url);
  const raw = parse(readFileSync(configPath, "utf8")) as RawConfig;
  const web = raw.services?.web;

  if (!web || typeof web.port !== "number") {
    throw new Error("[web] config.yaml 缺少 services.web.port");
  }

  return { port: web.port };
}
