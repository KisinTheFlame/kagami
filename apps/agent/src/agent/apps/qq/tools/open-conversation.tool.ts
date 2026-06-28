import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";
import type { QqApp } from "../qq.app.js";

const OpenConversationArgumentsSchema = z.object({
  id: z.string().trim().min(1),
});

/** 打开一个 QQ 会话（群/私聊），渲染最近消息并把它设为当前会话。 */
export class OpenConversationTool extends ZodToolComponent<typeof OpenConversationArgumentsSchema> {
  public readonly name = "open_conversation";
  public readonly description =
    "打开一个 QQ 会话（群或私聊），看它的最近消息并停在那里；之后 send_message 就发给这个会话。id 取自会话列表。";
  public readonly parameters = {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: '会话 id，例如 "qq_group:123456" 或 "qq_private:123456"，从会话列表里取。',
      },
    },
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = OpenConversationArgumentsSchema;
  private readonly getApp: () => QqApp;

  public constructor({ getApp }: { getApp: () => QqApp }) {
    super();
    this.getApp = getApp;
  }

  protected async executeTyped(
    input: z.infer<typeof OpenConversationArgumentsSchema>,
  ): Promise<ToolExecutionResult> {
    const result = await this.getApp().openConversation(input.id);
    if (!result.ok) {
      return {
        content: JSON.stringify({
          ok: false,
          error: result.error,
          note: "会话不存在。先用 list_conversations 看会话列表拿正确的 id。",
        }),
      };
    }
    return { content: result.content ?? "" };
  }
}
