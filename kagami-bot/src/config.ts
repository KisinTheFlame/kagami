import * as fs from "fs";
import * as yaml from "yaml";
import { ProviderConfig } from "./llm_providers/types.js";

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
    models: string[];
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

export interface MasterConfig {
    qq: number;
    nickname: string;
}

export interface Config {
    llm_providers: Record<string, ProviderConfig>;
    llm: LlmConfig;
    napcat: NapcatConfig;
    master?: MasterConfig;
    agent?: AgentConfig;
}

export function loadConfig(): Config {
    const configIndex = process.argv.indexOf("--config");
    const configFile = configIndex !== -1 ? process.argv[configIndex + 1] : "env.yaml";

    if (!fs.existsSync(configFile)) {
        throw new Error(`配置文件不存在: ${configFile}`);
    }

    const configContent = fs.readFileSync(configFile, "utf8");
    const config = yaml.parse(configContent) as Config;



    console.log(`config: ${JSON.stringify(config, null, 4)}`);

    // 验证所有配置的模型都有对应的提供商
    for (const model of config.llm.models) {
        const providerName = findProviderByModel(config.llm_providers, model);
        if (!providerName) {
            throw new Error(`未找到支持模型 "${model}" 的提供商`);
        }
    }

    return config;
}
