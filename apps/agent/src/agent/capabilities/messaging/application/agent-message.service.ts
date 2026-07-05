import type { NapcatChatTarget } from "@kagami/napcat-api/message";

export interface AgentMessageService {
  sendGroupMessage(input: {
    groupId: string;
    message: string;
    replyToMessageId?: number;
  }): Promise<{ messageId: number }>;
  sendPrivateMessage(input: {
    userId: string;
    message: string;
    replyToMessageId?: number;
  }): Promise<{ messageId: number }>;
  /**
   * 向 target 发一张图（send_resource 用）。`fileRef` 是 OneBot file 字段（base64:// 形态）。
   * 出站记录只应留 resid 引用，**不要把 fileRef 落库/日志**。
   */
  sendImage(input: {
    target: NapcatChatTarget;
    fileRef: string;
    replyToMessageId?: number;
  }): Promise<{ messageId: number }>;
}
