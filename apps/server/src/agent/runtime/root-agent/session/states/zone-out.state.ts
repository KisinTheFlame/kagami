import type { LlmMessage } from "../../../../../llm/types.js";
import {
  createEnterZoneOutMessage,
  createExitZoneOutMessage,
} from "../../../context/context-message-factory.js";
import {
  ROOT_AGENT_INVOKE_TOOLS_BY_STATE,
  type BlurReason,
  type RootAgentInvokeToolName,
  type RootAgentState,
  type RootAgentStateHandleEventResult,
  type RootAgentStateId,
} from "../state.types.js";

export class ZoneOutState implements RootAgentState {
  public getId(): RootAgentStateId {
    return "zone_out";
  }

  public getDisplayName(): string {
    return "神游";
  }

  public async getDescription(): Promise<string> {
    return "进入自由思考状态。";
  }

  public async listChildren(): Promise<RootAgentState[]> {
    return [];
  }

  public getAvailableInvokeTools(): RootAgentInvokeToolName[] {
    return [...ROOT_AGENT_INVOKE_TOOLS_BY_STATE.zone_out];
  }

  public async onFocus(): Promise<LlmMessage[]> {
    return [createEnterZoneOutMessage()];
  }

  public async onBlur(input: { reason: BlurReason }): Promise<LlmMessage[]> {
    return input.reason === "back" ? [createExitZoneOutMessage()] : [];
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
