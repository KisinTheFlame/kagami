import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

export interface GatewayConfig {
  /** gateway 自身监听端口（来自 services.gateway.port）。 */
  port: number;
  /** agent 上游基址（原 API_TARGET），由 services.agent.host/port 拼出。 */
  agentTarget: URL;
  /** console 上游基址（原 CONSOLE_TARGET），由 services.console.host/port 拼出。 */
  consoleTarget: URL;
  /** 静态资源目录：仓库根下的 apps/web/dist。 */
  distDir: string;
}

interface RawServiceEndpoint {
  host?: string;
  port?: number;
}

interface RawConfig {
  services?: {
    agent?: RawServiceEndpoint;
    console?: RawServiceEndpoint;
    gateway?: RawServiceEndpoint;
  };
}

/**
 * 复刻 oss 的锚点法定位仓库根，保证静态目录与上游地址都基于仓库根而非 PM2 给的 cwd（apps/gateway）。
 * 候选顺序：当前 cwd → cwd/../../（PM2 以 apps/gateway 为 cwd 时命中）→ 相对本文件 dist 位置上溯。
 * 找不到 config.yaml 时**响亮失败**，绝不静默回退到 cwd。
 */
function resolveRepoRoot(): string {
  const candidates = [
    path.resolve(process.cwd(), "config.yaml"),
    path.resolve(process.cwd(), "../../config.yaml"),
    fileURLToPath(new URL("../../../../config.yaml", import.meta.url)),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return path.dirname(candidate);
    }
  }

  throw new Error(
    "[gateway] 未找到 config.yaml，无法确定仓库根与上游地址。请在仓库根或 apps/gateway 下启动。",
  );
}

/** 从 services 块读取一个端点的 host/port，缺失即响亮失败（地址不容缺省）。 */
function resolveEndpoint(endpoint: RawServiceEndpoint | undefined, name: string): URL {
  if (!endpoint || typeof endpoint.host !== "string" || typeof endpoint.port !== "number") {
    throw new Error(`[gateway] config.yaml 缺少 services.${name}.host / services.${name}.port`);
  }

  return new URL(`http://${endpoint.host}:${endpoint.port}`);
}

export function loadGatewayConfig(): GatewayConfig {
  const repoRoot = resolveRepoRoot();
  const raw = parse(readFileSync(path.join(repoRoot, "config.yaml"), "utf8")) as RawConfig;
  const services = raw.services;

  const gateway = services?.gateway;
  if (!gateway || typeof gateway.port !== "number") {
    throw new Error("[gateway] config.yaml 缺少 services.gateway.port");
  }

  return {
    port: gateway.port,
    agentTarget: resolveEndpoint(services?.agent, "agent"),
    consoleTarget: resolveEndpoint(services?.console, "console"),
    distDir: path.join(repoRoot, "apps/web/dist"),
  };
}
