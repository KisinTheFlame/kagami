import { z } from "zod";
import type { AgentEventQueue } from "../agent/event.queue.js";
import type { ConfigManager, NapcatBootConfig } from "../config/config.manager.js";
import { BizError } from "../errors/biz-error.js";
import { type NapcatGatewayPersistenceWriter } from "./napcat-gateway/event-persistence-writer.js";
import { NapcatGroupMessageProcessor } from "./napcat-gateway/group-message-processor.js";
import { NapcatGatewayInboundMessageRouter } from "./napcat-gateway/inbound-message-router.js";
import type { WebSocketLike } from "./napcat-gateway/shared.js";
import { NapcatGatewayTransport } from "./napcat-gateway/transport.js";
import type {
  NapcatGatewayService,
  NapcatSendGroupMessageInput,
  NapcatSendGroupMessageResult,
} from "./napcat-gateway.service.js";

type CreateNapcatGatewayOptions = {
  configManager: ConfigManager;
  eventQueue: AgentEventQueue;
  persistenceWriter: NapcatGatewayPersistenceWriter;
  createWebSocket?: (url: string) => WebSocketLike;
};

type NapcatGatewayOptions = {
  config: NapcatBootConfig;
  eventQueue: AgentEventQueue;
  persistenceWriter: NapcatGatewayPersistenceWriter;
  createWebSocket?: (url: string) => WebSocketLike;
};

const MessageIdSchema = z.number().int().positive();

export class DefaultNapcatGatewayService implements NapcatGatewayService {
  private readonly transport: NapcatGatewayTransport;

  public static async create({
    configManager,
    eventQueue,
    persistenceWriter,
    createWebSocket,
  }: CreateNapcatGatewayOptions): Promise<DefaultNapcatGatewayService> {
    const bootConfig = await configManager.getBootConfig();

    return new DefaultNapcatGatewayService({
      config: bootConfig.napcat,
      eventQueue,
      persistenceWriter,
      createWebSocket,
    });
  }

  private constructor({
    config,
    eventQueue,
    persistenceWriter,
    createWebSocket,
  }: NapcatGatewayOptions) {
    const transport = new NapcatGatewayTransport({
      wsUrl: config.wsUrl,
      reconnectMs: config.reconnectMs,
      requestTimeoutMs: config.requestTimeoutMs,
      createWebSocket,
      onMessage: rawData => {
        inboundMessageRouter.handle(rawData);
      },
    });
    const groupMessageProcessor = new NapcatGroupMessageProcessor({
      listenGroupId: config.listenGroupId,
      actionRequester: transport,
      eventQueue,
    });
    const inboundMessageRouter = new NapcatGatewayInboundMessageRouter({
      resolveActionResponse: response => {
        transport.resolveActionResponse(response);
      },
      handlePostTypeEvent: async eventPayload => {
        const { normalizedEvent, groupMessageEvent } =
          await groupMessageProcessor.handle(eventPayload);
        if (groupMessageEvent) {
          persistenceWriter.persistGroupMessage(groupMessageEvent, normalizedEvent.eventTime);
        }
        persistenceWriter.persistEvent(normalizedEvent);
      },
    });

    this.transport = transport;
  }

  public async start(): Promise<void> {
    await this.transport.start();
  }

  public async stop(): Promise<void> {
    await this.transport.stop();
  }

  public async sendGroupMessage({
    groupId,
    message,
  }: NapcatSendGroupMessageInput): Promise<NapcatSendGroupMessageResult> {
    const data = await this.transport.request("send_group_msg", {
      group_id: groupId,
      message: [
        {
          type: "text",
          data: {
            text: message,
          },
        },
      ],
    });

    const messageIdResult = MessageIdSchema.safeParse(data?.message_id);
    if (!messageIdResult.success) {
      throw new BizError({
        message: "NapCat 返回结果缺少 message_id",
        meta: {
          reason: "MISSING_MESSAGE_ID",
        },
      });
    }

    return {
      messageId: messageIdResult.data,
    };
  }
}
