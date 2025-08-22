import * as fs from "fs";
import * as yaml from "yaml";

export interface LlmConfig {
    base_url: string;
    api_key: string;
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

export interface Config {
    llm: LlmConfig;
    napcat: NapcatConfig;
    agent?: AgentConfig;
}

export function loadConfig(): Config {
    const configIndex = process.argv.indexOf("--config");
    const configFile = configIndex !== -1 ? process.argv[configIndex + 1] : "env.dev.yaml";
  
    if (!fs.existsSync(configFile)) {
        throw new Error(`配置文件不存在: ${configFile}`);
    }
  
    const configContent = fs.readFileSync(configFile, "utf8");
    const config = yaml.parse(configContent) as Config;
  
    if (!config.llm.api_key || !config.llm.base_url || !config.llm.model) {
        throw new Error("配置文件缺少必要的 LLM 配置项");
    }
  
    if (!config.napcat.base_url || !config.napcat.access_token || !config.napcat.groups.length || !config.napcat.bot_qq) {
        throw new Error("配置文件缺少必要的 napcat 配置项");
    }
  
    return config;
}
