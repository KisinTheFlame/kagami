import { type LlmProviderListResponse } from "@kagami/llm-api/llm-chat";
import type { LlmClient } from "@kagami/llm-client";
import type { LlmProviderService } from "./llm-provider.service.js";

type DefaultLlmProviderServiceDeps = {
  llmClient: LlmClient;
};

export class DefaultLlmProviderService implements LlmProviderService {
  private readonly llmClient: LlmClient;

  public constructor({ llmClient }: DefaultLlmProviderServiceDeps) {
    this.llmClient = llmClient;
  }

  public async listProviders(): Promise<LlmProviderListResponse> {
    return {
      providers: await this.llmClient.listAvailableProviders({ usage: "agent" }),
    };
  }
}
