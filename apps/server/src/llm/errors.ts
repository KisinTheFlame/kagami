import type { LlmProviderId } from "./types.js";

export class LlmProviderResponseError extends Error {
  public readonly provider: LlmProviderId;

  public constructor(provider: LlmProviderId, message: string) {
    super(message);
    this.name = "LlmProviderResponseError";
    this.provider = provider;
  }
}
