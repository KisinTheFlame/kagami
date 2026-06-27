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
}
