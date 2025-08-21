import * as fs from "fs";
import * as yaml from "yaml";

export interface LlmConfig {
    base_url: string;
    api_key: string;
    model: string;
}

export interface Config {
    llm: LlmConfig;
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
  
    return config;
}
