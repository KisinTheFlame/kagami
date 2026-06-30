import type { ConfigManager } from "./config.manager.js";
import type { Config } from "./config.loader.js";

type DefaultConfigManagerOptions = {
  config: Config;
};

export class DefaultConfigManager implements ConfigManager {
  private readonly resolvedConfig: Config;

  public constructor({ config }: DefaultConfigManagerOptions) {
    this.resolvedConfig = config;
  }

  public async config(): Promise<Config> {
    return this.resolvedConfig;
  }
}
