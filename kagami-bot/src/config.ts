import * as fs from "fs";
import * as yaml from "yaml";
import { ProviderConfig } from "./llm_providers/types.js";

// 重新导出类型
export { ProviderConfig } from "./llm_providers/types.js";

export function findProviderByModel(providers: Record<string, ProviderConfig>, model: string): string | null {
    for (const [providerName, config] of Object.entries(providers)) {
        if (config.models.includes(model)) {
            return providerName;
        }
    }
    return null;
}

export function getProviderForModel(providers: Record<string, ProviderConfig>, model: string): ProviderConfig {
    const providerName = findProviderByModel(providers, model);
    if (!providerName) {
        throw new Error(`未找到支持模型 "${model}" 的提供商`);
    }
    return providers[providerName];
}


export interface LlmConfig {
    model: string;
}

export interface NapcatReconnectionConfig {
    enable: boolean;
    attempts: number;
    delay: number;
}

export interface NapcatConfig {
    base_url: string;
    access_token: string;
    reconnection: NapcatReconnectionConfig;
    groups: number[];
    bot_qq: number;
}

export interface AgentConfig {
    history_turns: number;
}

export interface BehaviorConfig {
    energy_max: number;              // 体力值上限
    energy_cost: number;             // 每次回复消耗体力
    energy_recovery_rate: number;    // 体力恢复速度（每60秒）
    energy_recovery_interval: number; // 体力恢复间隔（秒）
    message_handler_type: "active" | "passive"; // 消息处理策略
}

export interface MasterConfig {
    qq: number;
    nickname: string;
}

export interface Config {
    llm_providers?: Record<string, ProviderConfig>;
    llm: LlmConfig;
    napcat: NapcatConfig;
    master?: MasterConfig;
    agent?: AgentConfig;
    behavior?: BehaviorConfig;
}

export function loadConfig(): Config {
    const configIndex = process.argv.indexOf("--config");
    const configFile = configIndex !== -1 ? process.argv[configIndex + 1] : "env.yaml";
  
    if (!fs.existsSync(configFile)) {
        throw new Error(`配置文件不存在: ${configFile}`);
    }
  
    const configContent = fs.readFileSync(configFile, "utf8");
    const config = yaml.parse(configContent) as Config;
  

    config.behavior ??= {} as BehaviorConfig;

    // 设置 behavior 默认值
    const defaultBehavior: BehaviorConfig = {
        energy_max: 100,
        energy_cost: 1,
        energy_recovery_rate: 5,
        energy_recovery_interval: 60,
        message_handler_type: "active",
    };

    config.behavior = { ...defaultBehavior, ...(config.behavior ?? {}) };

    console.log(`config: ${JSON.stringify(config, null, 4)}`);

    return config;
}
