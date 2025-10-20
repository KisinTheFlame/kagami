import * as fs from "fs";
import * as yaml from "yaml";
import { ProviderConfig } from "./llm_providers/types.js";

export type LlmConfig = {
    models: string[],
};

export type NapcatReconnectionConfig = {
    enable: boolean,
    attempts: number,
    delay: number,
};

export type NapcatConfig = {
    base_url: string,
    access_token: string,
    reconnection: NapcatReconnectionConfig,
    groups: number[],
    bot_qq: number,
};

export type AgentConfig = {
    history_turns: number,
};

export type MasterConfig = {
    qq: number,
    nickname: string,
};

export type CorsConfig = {
    allowed_origins: string[],
};

export type HttpConfig = {
    port: number,
    cors: CorsConfig,
};

export type Config = {
    llm_providers: Record<string, ProviderConfig>,
    llm: LlmConfig,
    napcat: NapcatConfig,
    http: HttpConfig,
    master?: MasterConfig,
    agent?: AgentConfig,
};

export class ConfigManager {
    private config: Config;

    constructor(configPath: string) {
        if (!fs.existsSync(configPath)) {
            throw new Error(`配置文件不存在: ${configPath}`);
        }

        const configContent = fs.readFileSync(configPath, "utf8");
        this.config = yaml.parse(configContent) as Config;

        console.log(`config: ${JSON.stringify(this.config, null, 4)}`);

        // 验证所有配置的模型都有对应的提供商
        for (const model of this.config.llm.models) {
            const providerName = this.findProviderByModel(model);
            if (!providerName) {
                throw new Error(`未找到支持模型 "${model}" 的提供商`);
            }
        }
    }

    getNapcatConfig(): NapcatConfig {
        return this.config.napcat;
    }

    getLlmConfig(): LlmConfig {
        return this.config.llm;
    }

    getLlmProvidersConfig(): Record<string, ProviderConfig> {
        return this.config.llm_providers;
    }

    getMasterConfig(): MasterConfig | undefined {
        return this.config.master;
    }

    getAgentConfig(): AgentConfig | undefined {
        return this.config.agent;
    }

    getHttpConfig(): HttpConfig {
        return this.config.http;
    }

    getProviderForModel(model: string): ProviderConfig {
        const providerName = this.findProviderByModel(model);
        if (!providerName) {
            throw new Error(`未找到支持模型 "${model}" 的提供商`);
        }
        return this.config.llm_providers[providerName];
    }

    private findProviderByModel(model: string): string | null {
        for (const [providerName, config] of Object.entries(this.config.llm_providers)) {
            if (config.models.includes(model)) {
                return providerName;
            }
        }
        return null;
    }
}

export const newConfigManager = (configPath: string) => {
    return new ConfigManager(configPath);
};
