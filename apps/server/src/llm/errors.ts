import type { LlmProviderId } from "./types.js";

type LlmProviderResponseErrorOptions = {
  provider: LlmProviderId;
  message: string;
};

export class LlmProviderResponseError extends Error {
  public readonly provider: LlmProviderId;

  public constructor({ provider, message }: LlmProviderResponseErrorOptions) {
    super(message);
    this.name = "LlmProviderResponseError";
    this.provider = provider;
  }
}
