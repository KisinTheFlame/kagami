import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveConfigPath } from "@kagami/config/source";
import { parse } from "yaml";

export interface GatewayConfig {
  /** gateway 自身监听端口（来自 services.gateway.port）。 */
  port: number;
  /** agent 上游基址（原 API_TARGET），由 services.agent.host/port 拼出。 */
  agentTarget: URL;
  /** console 上游基址（原 CONSOLE_TARGET），由 services.console.host/port 拼出。 */
  consoleTarget: URL;
  /** metric 上游基址，由 services.metric.host/port 拼出（metric-chart 查询走它）。 */
  metricTarget: URL;
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
    metric?: RawServiceEndpoint;
  };
}

/** 从 services 块读取一个端点的 host/port，缺失即响亮失败（地址不容缺省）。 */
function resolveEndpoint(endpoint: RawServiceEndpoint | undefined, name: string): URL {
  if (!endpoint || typeof endpoint.host !== "string" || typeof endpoint.port !== "number") {
    throw new Error(`[gateway] config.yaml 缺少 services.${name}.host / services.${name}.port`);
  }

  return new URL(`http://${endpoint.host}:${endpoint.port}`);
}

export function loadGatewayConfig(): GatewayConfig {
  // 定位逻辑收敛到 @kagami/config；gateway 只读非隐私的 services 块，不触 config.secret.yaml。
  const configPath = resolveConfigPath(import.meta.url);
  const repoRoot = path.dirname(configPath);
  const raw = parse(readFileSync(configPath, "utf8")) as RawConfig;
  const services = raw.services;

  const gateway = services?.gateway;
  if (!gateway || typeof gateway.port !== "number") {
    throw new Error("[gateway] config.yaml 缺少 services.gateway.port");
  }

  return {
    port: gateway.port,
    agentTarget: resolveEndpoint(services?.agent, "agent"),
    consoleTarget: resolveEndpoint(services?.console, "console"),
    metricTarget: resolveEndpoint(services?.metric, "metric"),
    distDir: path.join(repoRoot, "apps/web/dist"),
  };
}
