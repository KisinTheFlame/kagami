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

  public async listProviders(): Promise<LlmProviderListResponse> {
    return {
      providers: await this.llmClient.listAvailableProviders({ usage: "agent" }),
    };
  }

  public async chat(input: LlmPlaygroundChatRequest): Promise<LlmPlaygroundChatResponse> {
    return this.llmClient.chatDirect(
      {
        ...input.request,
      },
      {
        providerId: input.provider,
        model: input.model,
        recordCall: false,
      },
    );
  }
}
