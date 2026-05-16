import type { LlmMessage } from "../../../../../llm/types.js";
import {
  ROOT_AGENT_INVOKE_TOOLS_BY_STATE,
  type RootAgentInvokeToolName,
  type RootAgentState,
  type RootAgentStateHandleEventResult,
  type RootAgentStateHost,
  type RootAgentStateId,
} from "../state.types.js";

export class TerminalStateNode implements RootAgentState {
  private readonly host: RootAgentStateHost;

  public constructor(host: RootAgentStateHost) {
    this.host = host;
  }

  public getId(): RootAgentStateId {
    return "terminal";
  }

  public getDisplayName(): string {
    return "终端";
  }

  public async getDescription(): Promise<string> {
    const cwd = this.host.terminalService?.getCwd() ?? "(未初始化)";
    return `你在终端里，当前目录：${cwd}`;
  }

  public async listChildren(): Promise<RootAgentState[]> {
    return [];
  }

  public getAvailableInvokeTools(): RootAgentInvokeToolName[] {
    return [...ROOT_AGENT_INVOKE_TOOLS_BY_STATE.terminal];
  }

  public async onFocus(): Promise<LlmMessage[]> {
    return [];
  }

  public async onBlur(): Promise<LlmMessage[]> {
    return [];
  }

  public async handleEvent(): Promise<RootAgentStateHandleEventResult> {
    return {
      shouldTriggerRound: false,
    };
  }

  public buildNotificationSummary(): string | null {
    return null;
  }
}
