import * as fs from "fs";
import * as yaml from "yaml";

export interface LlmConfig {
    base_url: string;
    api_keys: string[];
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
    llm: LlmConfig;
    napcat: NapcatConfig;
    master?: MasterConfig;
    agent?: AgentConfig;
    behavior?: BehaviorConfig;
}

export function loadConfig(): Config {
    const configIndex = process.argv.indexOf("--config");
    const configFile = configIndex !== -1 ? process.argv[configIndex + 1] : "env.dev.yaml";
  
    if (!fs.existsSync(configFile)) {
        throw new Error(`配置文件不存在: ${configFile}`);
    }
  
    const configContent = fs.readFileSync(configFile, "utf8");
    const config = yaml.parse(configContent) as Config;
  
    if (!Array.isArray(config.llm.api_keys) || config.llm.api_keys.length === 0 || !config.llm.base_url || !config.llm.model) {
        throw new Error("配置文件缺少必要的 LLM 配置项");
    }
  
    if (!config.napcat.base_url || !config.napcat.access_token || !config.napcat.groups.length || !config.napcat.bot_qq) {
        throw new Error("配置文件缺少必要的 napcat 配置项");
    }

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
  
    return config;
}
