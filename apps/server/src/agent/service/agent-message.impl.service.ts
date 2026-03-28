import type { NapcatGatewayService } from "../../napcat/service/napcat-gateway.service.js";
import type { AgentMessageService } from "./agent-message.service.js";

export class DefaultAgentMessageService implements AgentMessageService {
  private readonly napcatGatewayService: NapcatGatewayService;
  private readonly targetGroupId: string;

  public constructor({
    napcatGatewayService,
    targetGroupId,
  }: {
    napcatGatewayService: NapcatGatewayService;
    targetGroupId: string;
  }) {
    this.napcatGatewayService = napcatGatewayService;
    this.targetGroupId = targetGroupId;
  }

  public async sendGroupMessage(input: { message: string }): Promise<{ messageId: number }> {
    return await this.napcatGatewayService.sendGroupMessage({
      groupId: this.targetGroupId,
      message: input.message,
    });
  }
}
