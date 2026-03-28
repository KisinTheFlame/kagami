export interface AgentMessageService {
  sendGroupMessage(input: { groupId: string; message: string }): Promise<{ messageId: number }>;
}
