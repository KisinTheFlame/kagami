import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";
import type { QqApp } from "../qq.app.js";

const ListConversationsArgumentsSchema = z.object({});

/**
 * 列出当前已知的 QQ 会话（群 + 私聊），含未读数，并标出当前打开的会话。纯读——不改变
 * 当前焦点（不动 currentConversationId / focused）。想看有哪些会话、谁有未读、自己现在
 * 停在哪个会话时调它；切换会话直接用 open_conversation(id)，无需先"回列表"。
 */
export class ListConversationsTool extends ZodToolComponent<
  typeof ListConversationsArgumentsSchema
> {
  public readonly name = "list_conversations";
  public readonly description =
    "列出当前已知的 QQ 会话（群 + 私聊），含未读数，并标出你当前打开的会话。纯读，不改变当前焦点。" +
    "切换会话直接用 open_conversation(id)，不必先回列表。";
  public readonly parameters = {
    type: "object",
    properties: {},
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = ListConversationsArgumentsSchema;
  private readonly getApp: () => QqApp;

  public constructor({ getApp }: { getApp: () => QqApp }) {
    super();
    this.getApp = getApp;
  }

  protected async executeTyped(): Promise<ToolExecutionResult> {
    return { content: this.getApp().listConversations() };
  }
}
