import type { ReActKernelExtension, ReActKernelRunRoundInput } from "@kagami/agent-runtime";
import type { LlmMessage } from "../../../../llm/types.js";
import type { RootAgentCompletion, RootAgentToolExecutionData } from "../root-agent-runtime.js";
import type { RootAgentExtensionHost } from "./extension-host.js";

export class RootToolExecutionStateExtension implements ReActKernelExtension<
  LlmMessage,
  "agent",
  RootAgentCompletion,
  RootAgentToolExecutionData
> {
  private readonly host: Pick<RootAgentExtensionHost, "transitionTo">;

  public constructor({ host }: { host: Pick<RootAgentExtensionHost, "transitionTo"> }) {
    this.host = host;
  }

  public onBeforeToolExecution(input: {
    request: ReActKernelRunRoundInput<LlmMessage, "agent">;
    completion: RootAgentCompletion;
    toolCall: {
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    };
  }): void {
    void input;
    this.host.transitionTo("executing_tool");
  }
}
