import type { NapcatGatewayService } from "../../../../napcat/service/napcat-gateway.service.js";
import type { AgentMessageService } from "./agent-message.service.js";

export class DefaultAgentMessageService implements AgentMessageService {
  private readonly napcatGatewayService: NapcatGatewayService;

  public constructor({ napcatGatewayService }: { napcatGatewayService: NapcatGatewayService }) {
    this.napcatGatewayService = napcatGatewayService;
  }

  public async sendGroupMessage(input: {
    groupId: string;
    message: string;
  }): Promise<{ messageId: number }> {
    return await this.napcatGatewayService.sendGroupMessage(input);
  }

  public async sendPrivateMessage(input: {
    userId: string;
    message: string;
  }): Promise<{ messageId: number }> {
    return await this.napcatGatewayService.sendPrivateMessage(input);
  }
}
