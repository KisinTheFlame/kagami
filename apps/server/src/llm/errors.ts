import type { LlmProviderId } from "./types.js";

type LlmProviderResponseErrorOptions = {
  provider: LlmProviderId;
  message: string;
};

type LlmProviderUnavailableErrorOptions = {
  provider: LlmProviderId;
};

type LlmProviderUpstreamErrorOptions = {
  provider: LlmProviderId;
  message: string;
  cause?: unknown;
};

type LlmModelNotConfiguredErrorOptions = {
  provider: LlmProviderId;
  model: string;
};

export class LlmProviderResponseError extends Error {
  public readonly provider: LlmProviderId;

  public constructor({ provider, message }: LlmProviderResponseErrorOptions) {
    super(message);
    this.name = "LlmProviderResponseError";
    this.provider = provider;
  }
}

export class LlmProviderUnavailableError extends Error {
  public readonly provider: LlmProviderId;

  public constructor({ provider }: LlmProviderUnavailableErrorOptions) {
    super(`Provider ${provider} is not available`);
    this.name = "LlmProviderUnavailableError";
    this.provider = provider;
  }
}

export class LlmProviderUpstreamError extends Error {
  public readonly provider: LlmProviderId;
  public override readonly cause?: unknown;

  public constructor({ provider, message, cause }: LlmProviderUpstreamErrorOptions) {
    super(message);
    this.name = "LlmProviderUpstreamError";
    this.provider = provider;
    this.cause = cause;
  }
}

export class LlmModelNotConfiguredError extends Error {
  public readonly provider: LlmProviderId;
  public readonly model: string;

  public constructor({ provider, model }: LlmModelNotConfiguredErrorOptions) {
    super(`Model ${model} is not configured for provider ${provider}`);
    this.name = "LlmModelNotConfiguredError";
    this.provider = provider;
    this.model = model;
  }
}
