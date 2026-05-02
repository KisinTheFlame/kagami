import type { ReActKernelExtension, ReActKernelRunRoundInput } from "@kagami/agent-runtime";
import type { LlmMessage } from "../../../../llm/types.js";
import type { RootAgentCompletion, RootAgentToolExecutionData } from "../root-agent-runtime.js";
import type { RootAgentExtensionHost } from "./extension-host.js";

export class RootLlmTelemetryExtension implements ReActKernelExtension<
  LlmMessage,
  "agent",
  RootAgentCompletion,
  RootAgentToolExecutionData
> {
  private readonly host: Pick<RootAgentExtensionHost, "recordLlmCall">;

  public constructor({ host }: { host: Pick<RootAgentExtensionHost, "recordLlmCall"> }) {
    this.host = host;
  }

  public onAfterModel(input: {
    request: ReActKernelRunRoundInput<LlmMessage, "agent">;
    completion: RootAgentCompletion;
  }): void {
    this.host.recordLlmCall(input.completion);
  }
}
