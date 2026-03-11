export interface AgentMessageService {
  sendGroupMessage(input: { message: string }): Promise<{ messageId: number }>;
}
