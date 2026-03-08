import type {
  LlmPlaygroundChatRequest,
  LlmPlaygroundChatResponse,
  LlmProviderListResponse,
} from "@kagami/shared";
import type { LlmClient } from "../llm/client.js";
import type { LlmPlaygroundService } from "./llm-playground.service.js";

type DefaultLlmPlaygroundServiceDeps = {
  llmClient: LlmClient;
};

export class DefaultLlmPlaygroundService implements LlmPlaygroundService {
  private readonly llmClient: LlmClient;

  public constructor({ llmClient }: DefaultLlmPlaygroundServiceDeps) {
    this.llmClient = llmClient;
  }

  public listProviders(): LlmProviderListResponse {
    return {
      providers: this.llmClient.listAvailableProviders(),
    };
  }

  public async chat(input: LlmPlaygroundChatRequest): Promise<LlmPlaygroundChatResponse> {
    return this.llmClient.chat(
      {
        ...input.request,
        model: input.model ?? input.request.model,
      },
      {
        providerId: input.provider,
        recordCall: false,
      },
    );
  }
}
