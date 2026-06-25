import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";
import type { QqApp } from "../qq.app.js";

const BackToConversationListArgumentsSchema = z.object({});

/** 离开当前 QQ 会话，回到会话列表（清空当前会话）。 */
export class BackToConversationListTool extends ZodToolComponent<
  typeof BackToConversationListArgumentsSchema
> {
  public readonly name = "back_to_conversation_list";
  public readonly description = "离开当前打开的 QQ 会话，回到 QQ 会话列表。";
  public readonly parameters = {
    type: "object",
    properties: {},
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = BackToConversationListArgumentsSchema;
  private readonly getApp: () => QqApp;

  public constructor({ getApp }: { getApp: () => QqApp }) {
    super();
    this.getApp = getApp;
  }

  protected async executeTyped(): Promise<ToolExecutionResult> {
    const result = this.getApp().backToConversationList();
    return { content: result.content };
  }
}
