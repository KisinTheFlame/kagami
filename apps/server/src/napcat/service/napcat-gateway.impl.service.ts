import { z } from "zod";
import type { ConfigManager } from "../../config/config.manager.js";
import type { Config } from "../../config/config.loader.js";
import { BizError } from "../../common/errors/biz-error.js";
import { AppLogger } from "../../logger/logger.js";
import { type NapcatGatewayPersistenceWriter } from "./napcat-gateway/event-persistence-writer.js";
import { NapcatGroupMessageProcessor } from "./napcat-gateway/group-message-processor.js";
import type { NapcatImageMessageAnalyzer } from "./napcat-gateway/image-message-analyzer.js";
import { NapcatGatewayInboundMessageRouter } from "./napcat-gateway/inbound-message-router.js";
import { parseOutgoingMessageSegments, type WebSocketLike } from "./napcat-gateway/shared.js";
import { NapcatGatewayTransport } from "./napcat-gateway/transport.js";
import type {
  NapcatGroupMessageData,
  NapcatGatewayService,
  NapcatGroupMessageEvent,
  NapcatSendGroupMessageInput,
  NapcatSendGroupMessageResult,
} from "./napcat-gateway.service.js";

type CreateNapcatGatewayOptions = {
  configManager: ConfigManager;
  enqueueGroupMessageEvent: (event: NapcatGroupMessageEvent) => number | Promise<number>;
  persistenceWriter: NapcatGatewayPersistenceWriter;
  imageMessageAnalyzer: NapcatImageMessageAnalyzer;
  createWebSocket?: (url: string) => WebSocketLike;
};

type NapcatGatewayOptions = {
  config: Config["server"]["napcat"];
  enqueueGroupMessageEvent: (event: NapcatGroupMessageEvent) => number | Promise<number>;
  persistenceWriter: NapcatGatewayPersistenceWriter;
  imageMessageAnalyzer: NapcatImageMessageAnalyzer;
  createWebSocket?: (url: string) => WebSocketLike;
};

const MessageIdSchema = z.number().int().positive();
const PositiveIntSchema = z.number().int().positive();
const NonEmptyStringSchema = z.string().min(1);
const GroupMessageHistoryResponseSchema = z.object({
  messages: z.array(z.record(z.string(), z.unknown())),
});
const logger = new AppLogger({ source: "service.napcat-gateway" });

type OrderedPostTypeEventResult =
  | {
      kind: "processed";
      normalizedEvent: Awaited<
        ReturnType<NapcatGroupMessageProcessor["process"]>
      >["normalizedEvent"];
      groupMessageEvent: Awaited<
        ReturnType<NapcatGroupMessageProcessor["process"]>
      >["groupMessageEvent"];
    }
  | {
      kind: "failed";
    };

export class DefaultNapcatGatewayService implements NapcatGatewayService {
  private readonly listenGroupId: string;
  private readonly transport: NapcatGatewayTransport;
  private readonly groupMessageProcessor: NapcatGroupMessageProcessor;

  public static async create({
    configManager,
    enqueueGroupMessageEvent,
    persistenceWriter,
    imageMessageAnalyzer,
    createWebSocket,
  }: CreateNapcatGatewayOptions): Promise<DefaultNapcatGatewayService> {
    const config = await configManager.config();

    return new DefaultNapcatGatewayService({
      config: config.server.napcat,
      enqueueGroupMessageEvent,
      persistenceWriter,
      imageMessageAnalyzer,
      createWebSocket,
    });
  }

  private constructor({
    config,
    enqueueGroupMessageEvent,
    persistenceWriter,
    imageMessageAnalyzer,
    createWebSocket,
  }: NapcatGatewayOptions) {
    this.listenGroupId = config.listenGroupId;
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
      enqueueGroupMessageEvent,
      imageMessageAnalyzer,
    });
    this.groupMessageProcessor = groupMessageProcessor;
    let nextSequence = 0;
    let nextFlushSequence = 0;
    const completedResults = new Map<number, OrderedPostTypeEventResult>();

    const flushCompletedResults = (): void => {
      while (completedResults.has(nextFlushSequence)) {
        const result = completedResults.get(nextFlushSequence);
        completedResults.delete(nextFlushSequence);
        nextFlushSequence += 1;

        if (!result || result.kind !== "processed") {
          continue;
        }

        if (result.groupMessageEvent) {
          groupMessageProcessor.publishGroupMessageEvent(result.groupMessageEvent);
          persistenceWriter.persistGroupMessage(
            result.groupMessageEvent,
            result.normalizedEvent.eventTime,
          );
        }
        persistenceWriter.persistEvent(result.normalizedEvent);
      }
    };

    const inboundMessageRouter = new NapcatGatewayInboundMessageRouter({
      resolveActionResponse: response => {
        transport.resolveActionResponse(response);
      },
      handlePostTypeEvent: async eventPayload => {
        const sequence = nextSequence;
        nextSequence += 1;

        void groupMessageProcessor
          .process(eventPayload)
          .then(result => {
            completedResults.set(sequence, {
              kind: "processed",
              normalizedEvent: result.normalizedEvent,
              groupMessageEvent: result.groupMessageEvent,
            });
            flushCompletedResults();
          })
          .catch(() => {
            logger.error("Failed to process ordered NapCat post type event", {
              event: "napcat.gateway.post_type_event_handle_failed",
              postType: eventPayload.post_type,
              messageType: eventPayload.message_type,
            });
            completedResults.set(sequence, {
              kind: "failed",
            });
            flushCompletedResults();
          });
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
    message,
  }: NapcatSendGroupMessageInput): Promise<NapcatSendGroupMessageResult> {
    const messageSegments = parseOutgoingMessageSegments(message);
    const data = await this.transport.request("send_group_msg", {
      group_id: this.listenGroupId,
      message: messageSegments,
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

  public async getRecentGroupMessages(input: {
    groupId: string;
    count: number;
  }): Promise<NapcatGroupMessageData[]> {
    const groupIdResult = NonEmptyStringSchema.safeParse(input.groupId);
    if (!groupIdResult.success) {
      throw new BizError({
        message: "groupId 必须是非空字符串",
        meta: {
          reason: "INVALID_GROUP_ID",
        },
      });
    }

    const countResult = PositiveIntSchema.safeParse(input.count);
    if (!countResult.success) {
      throw new BizError({
        message: "count 必须是正整数",
        meta: {
          reason: "INVALID_COUNT",
        },
      });
    }

    const data = await this.transport.request("get_group_msg_history", {
      group_id: groupIdResult.data,
      count: countResult.data,
    });

    const historyResult = GroupMessageHistoryResponseSchema.safeParse(data ?? {});
    if (!historyResult.success) {
      throw new BizError({
        message: "NapCat 返回的群历史消息结构无效",
        meta: {
          reason: "INVALID_GROUP_MESSAGE_HISTORY_RESPONSE",
        },
      });
    }

    return await this.groupMessageProcessor.normalizeHistoricalGroupMessages(
      historyResult.data.messages,
    );
  }
}
