export interface AgentMessageService {
  sendGroupMessage(input: { groupId: string; message: string }): Promise<{ messageId: number }>;
  sendPrivateMessage(input: { userId: string; message: string }): Promise<{ messageId: number }>;
}
