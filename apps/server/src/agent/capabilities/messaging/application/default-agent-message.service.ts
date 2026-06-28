import type {
  NapcatChatTarget,
  NapcatGatewayService,
} from "../../../../napcat/application/napcat-gateway.service.js";
import type { AgentMessageService } from "./agent-message.service.js";

export class DefaultAgentMessageService implements AgentMessageService {
  private readonly napcatGatewayService: NapcatGatewayService;

  public constructor({ napcatGatewayService }: { napcatGatewayService: NapcatGatewayService }) {
    this.napcatGatewayService = napcatGatewayService;
  }

  public async sendGroupMessage(input: {
    groupId: string;
    message: string;
    replyToMessageId?: number;
  }): Promise<{ messageId: number }> {
    return await this.napcatGatewayService.sendGroupMessage(input);
  }

  public async sendPrivateMessage(input: {
    userId: string;
    message: string;
    replyToMessageId?: number;
  }): Promise<{ messageId: number }> {
    return await this.napcatGatewayService.sendPrivateMessage(input);
  }

  public async sendImage(input: {
    target: NapcatChatTarget;
    fileRef: string;
    summary?: string;
    replyToMessageId?: number;
  }): Promise<{ messageId: number }> {
    return await this.napcatGatewayService.sendImage(input);
  }
}
