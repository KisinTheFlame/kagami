import type { Config } from "./config.loader.js";

export type { Config } from "./config.loader.js";

export interface ConfigManager {
  config(): Promise<Config>;
}
