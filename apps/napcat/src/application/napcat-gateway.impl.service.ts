import { z } from "zod";
import type { ConfigManager } from "@kagami/kernel/config/config.manager";
import type { Config } from "@kagami/kernel/config/config.loader";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { type NapcatGatewayPersistenceWriter } from "./napcat-gateway/event-persistence-writer.js";
import { NapcatForwardMessageReader } from "./napcat-gateway/forward-message-reader.js";
import { NapcatFriendListManager } from "./napcat-gateway/friend-list-manager.js";
import { NapcatGroupFileClient } from "./napcat-gateway/group-file-client.js";
import { NapcatGroupMessageProcessor } from "./napcat-gateway/group-message-processor.js";
import type { NapcatImageMessageAnalyzer } from "./napcat-gateway/image-message-analyzer.js";
import type { NapcatQqMessageDao } from "../infra/napcat-group-message.dao.js";
import { NapcatGatewayInboundMessageRouter } from "./napcat-gateway/inbound-message-router.js";
import { NapcatOrderedEventFlusher } from "./napcat-gateway/ordered-event-flusher.js";
import {
  buildOutgoingImageSegments,
  buildOutgoingMessageSegments,
  type WebSocketLike,
} from "./napcat-gateway/shared.js";
import { NapcatGatewayTransport } from "./napcat-gateway/transport.js";
import {
  NonEmptyStringSchema,
  NonNegativeIntSchema,
  PositiveIntSchema,
  extractMessageId,
  parseOrThrow,
} from "./napcat-gateway/wire-schemas.js";
import type {
  NapcatAgentEvent,
  NapcatForwardMessagePage,
  NapcatFriendInfo,
  NapcatGetGroupInfoInput,
  NapcatGetGroupInfoResult,
  NapcatGroupFileListing,
  NapcatGroupMessageData,
  NapcatGatewayService,
  NapcatPersistableQqMessage,
  NapcatPrivateMessageEvent,
  NapcatSendPrivateMessageInput,
  NapcatSendPrivateMessageResult,
  NapcatSendGroupMessageInput,
  NapcatSendGroupMessageResult,
  NapcatSendImageInput,
  NapcatSendImageResult,
} from "./napcat-gateway.service.js";

type CreateNapcatGatewayOptions = {
  configManager: ConfigManager;
  enqueueGroupMessageEvent: (event: NapcatAgentEvent) => number | Promise<number>;
  persistenceWriter: NapcatGatewayPersistenceWriter;
  imageMessageAnalyzer: NapcatImageMessageAnalyzer;
  qqMessageDao: NapcatQqMessageDao;
  createWebSocket?: (url: string) => WebSocketLike;
};

type NapcatGatewayOptions = {
  config: Config["server"]["napcat"];
  enqueueGroupMessageEvent: (event: NapcatAgentEvent) => number | Promise<number>;
  persistenceWriter: NapcatGatewayPersistenceWriter;
  imageMessageAnalyzer: NapcatImageMessageAnalyzer;
  qqMessageDao: NapcatQqMessageDao;
  createWebSocket?: (url: string) => WebSocketLike;
};

const GroupMessageHistoryResponseSchema = z.object({
  messages: z.array(z.record(z.string(), z.unknown())),
});
const GroupInfoResponseSchema = z.object({
  group_all_shut: z.union([z.boolean(), NonNegativeIntSchema]),
  group_remark: z.string().optional().default(""),
  group_id: z.union([NonEmptyStringSchema, PositiveIntSchema]).transform(value => String(value)),
  group_name: NonEmptyStringSchema,
  member_count: NonNegativeIntSchema,
  max_member_count: NonNegativeIntSchema,
});
// shut_up_timestamp：成员禁言到期的 epoch 秒；0 / 缺失 / 过去时间都视为未禁言。
const GroupMemberInfoShutUpResponseSchema = z.object({
  shut_up_timestamp: z.union([z.number(), z.string()]).optional(),
});
const logger = new AppLogger({ source: "service.napcat-gateway" });

/** 一条入站事件处理完的产物，按到达序提交（见 NapcatOrderedEventFlusher）。 */
type ProcessedPostTypeEvent = Awaited<ReturnType<NapcatGroupMessageProcessor["process"]>> & {
  privateMessageEvent: NapcatPrivateMessageEvent | null;
};

/**
 * NapCat 网关：进程与 NapCat 之间的门面。自身只保留「连接生命周期 + 消息收发 + 事件发布」，
 * 其余职责拆给协作对象——好友表（{@link NapcatFriendListManager}）、合并转发读取与缓存
 * （{@link NapcatForwardMessageReader}）、群文件（{@link NapcatGroupFileClient}）、
 * 入站事件保序提交（{@link NapcatOrderedEventFlusher}）。
 */
export class DefaultNapcatGatewayService implements NapcatGatewayService {
  private readonly transport: NapcatGatewayTransport;
  private readonly groupMessageProcessor: NapcatGroupMessageProcessor;
  private readonly enqueueAgentEvent: (event: NapcatAgentEvent) => number | Promise<number>;
  private readonly friendListManager: NapcatFriendListManager;
  private readonly forwardMessageReader: NapcatForwardMessageReader;
  private readonly groupFileClient: NapcatGroupFileClient;

  public static async create({
    configManager,
    enqueueGroupMessageEvent,
    persistenceWriter,
    imageMessageAnalyzer,
    qqMessageDao,
    createWebSocket,
  }: CreateNapcatGatewayOptions): Promise<DefaultNapcatGatewayService> {
    const config = await configManager.config();

    return new DefaultNapcatGatewayService({
      config: config.server.napcat,
      enqueueGroupMessageEvent,
      persistenceWriter,
      imageMessageAnalyzer,
      qqMessageDao,
      createWebSocket,
    });
  }

  private constructor({
    config,
    enqueueGroupMessageEvent,
    persistenceWriter,
    imageMessageAnalyzer,
    qqMessageDao,
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
      blockedGroupIds: config.blockedGroupIds,
      actionRequester: {
        request: async (action, params) => {
          const data = await transport.request(action, params);
          return Array.isArray(data) ? null : (data ?? null);
        },
      },
      enqueueGroupMessageEvent,
      imageMessageAnalyzer,
      qqMessageDao,
    });
    // 直传（不加 async/await 包装）：多一层 async 会给每次请求多插一个微任务 tick，
    // 改变 get_msg → get_forward_msg 这类链式回退的时序。
    const request: NapcatGatewayTransport["request"] = (action, params) =>
      transport.request(action, params);

    this.transport = transport;
    this.groupMessageProcessor = groupMessageProcessor;
    this.enqueueAgentEvent = enqueueGroupMessageEvent;
    this.friendListManager = new NapcatFriendListManager({
      request,
      publishAgentEvent: event => {
        this.publishAgentEvent(event);
      },
    });
    this.forwardMessageReader = new NapcatForwardMessageReader({
      request,
      normalizeForwardMessages: rawNodes =>
        groupMessageProcessor.normalizeForwardMessages(rawNodes),
    });
    this.groupFileClient = new NapcatGroupFileClient({ request });

    const orderedEventFlusher = new NapcatOrderedEventFlusher<ProcessedPostTypeEvent>({
      onFlush: result => {
        if (result.qqMessage) {
          persistenceWriter.persistQqMessage(result.qqMessage, result.normalizedEvent.eventTime);
        }
        if (result.groupMessageEvent) {
          groupMessageProcessor.publishGroupMessageEvent(result.groupMessageEvent);
        }
        if (result.privateMessageEvent) {
          this.publishAgentEvent(result.privateMessageEvent);
        }
        if (result.groupBanEvent) {
          this.publishAgentEvent({ type: "napcat_group_ban", data: result.groupBanEvent });
        }
        persistenceWriter.persistEvent(result.normalizedEvent);
      },
    });

    const inboundMessageRouter = new NapcatGatewayInboundMessageRouter({
      resolveActionResponse: response => {
        transport.resolveActionResponse(response);
      },
      handlePostTypeEvent: async eventPayload => {
        orderedEventFlusher.submit({
          run: async () => {
            const result = await groupMessageProcessor.process(eventPayload);
            const privateMessageEvent = await this.toPrivateMessageEvent(result.normalizedEvent);
            return { ...result, privateMessageEvent };
          },
          onError: () => {
            logger.error("Failed to process ordered NapCat post type event", {
              event: "napcat.gateway.post_type_event_handle_failed",
              postType: eventPayload.post_type,
              messageType: eventPayload.message_type,
            });
          },
        });
      },
    });
  }

  public async start(): Promise<void> {
    await this.transport.start();
    this.friendListManager.startRefreshTimer();
  }

  public async stop(): Promise<void> {
    this.friendListManager.stopRefreshTimer();
    await this.transport.stop();
  }

  public async sendGroupMessage({
    groupId,
    message,
    replyToMessageId,
  }: NapcatSendGroupMessageInput): Promise<NapcatSendGroupMessageResult> {
    const messageSegments = buildOutgoingMessageSegments(message, replyToMessageId);
    const data = await this.transport.request("send_group_msg", {
      group_id: groupId,
      message: messageSegments,
    });

    return { messageId: extractMessageId(data) };
  }

  public async sendPrivateMessage({
    userId,
    message,
    replyToMessageId,
  }: NapcatSendPrivateMessageInput): Promise<NapcatSendPrivateMessageResult> {
    const messageSegments = buildOutgoingMessageSegments(message, replyToMessageId);
    const data = await this.transport.request("send_private_msg", {
      user_id: userId,
      message: messageSegments,
    });

    return { messageId: extractMessageId(data) };
  }

  /**
   * 出站发图：单一入口，按 target.chatType 分发到 send_group_msg / send_private_msg。
   * 段用 base64:// 形态（自包含，不依赖 napcat 访问 OSS）。**不记录 fileRef**——
   * base64 串落库/日志会爆。
   */
  public async sendImage({
    target,
    fileRef,
    summary,
    replyToMessageId,
  }: NapcatSendImageInput): Promise<NapcatSendImageResult> {
    const messageSegments = buildOutgoingImageSegments({ fileRef, summary, replyToMessageId });
    const data =
      target.chatType === "group"
        ? await this.transport.request("send_group_msg", {
            group_id: target.groupId,
            message: messageSegments,
          })
        : await this.transport.request("send_private_msg", {
            user_id: target.userId,
            message: messageSegments,
          });

    return { messageId: extractMessageId(data) };
  }

  public async getFriendList(): Promise<NapcatFriendInfo[]> {
    return await this.friendListManager.list();
  }

  public async getGroupInfo({
    groupId,
  }: NapcatGetGroupInfoInput): Promise<NapcatGetGroupInfoResult> {
    const normalizedGroupId = parseOrThrow(NonEmptyStringSchema, groupId, {
      message: "groupId 必须是非空字符串",
      reason: "INVALID_GROUP_ID",
    });

    const data = await this.transport.request("get_group_info", {
      group_id: normalizedGroupId,
    });

    const groupInfo = parseOrThrow(GroupInfoResponseSchema, data ?? {}, {
      message: "NapCat 返回的群信息结构无效",
      reason: "INVALID_GROUP_INFO_RESPONSE",
    });

    return {
      groupId: groupInfo.group_id,
      groupName: groupInfo.group_name,
      memberCount: groupInfo.member_count,
      maxMemberCount: groupInfo.max_member_count,
      groupRemark: groupInfo.group_remark,
      groupAllShut: Boolean(groupInfo.group_all_shut),
    };
  }

  public async getRecentGroupMessages(input: {
    groupId: string;
    count: number;
  }): Promise<NapcatGroupMessageData[]> {
    const groupId = parseOrThrow(NonEmptyStringSchema, input.groupId, {
      message: "groupId 必须是非空字符串",
      reason: "INVALID_GROUP_ID",
    });
    const count = parseOrThrow(PositiveIntSchema, input.count, {
      message: "count 必须是正整数",
      reason: "INVALID_COUNT",
    });

    const data = await this.transport.request("get_group_msg_history", {
      group_id: groupId,
      // message_seq=0 = 从最新一条往前取（OneBot/NapCat 约定）。缺省时 NapCat 会按
      // undefined 去定位锚点消息、报「消息undefined不存在」，故必须显式给锚点。
      message_seq: 0,
      count,
    });

    const history = parseOrThrow(GroupMessageHistoryResponseSchema, data ?? {}, {
      message: "NapCat 返回的群历史消息结构无效",
      reason: "INVALID_GROUP_MESSAGE_HISTORY_RESPONSE",
    });

    return await this.groupMessageProcessor.normalizeHistoricalGroupMessages(history.messages);
  }

  public async getRecentPrivateMessages(input: {
    userId: string;
    count: number;
    messageSeq?: number;
  }): Promise<NapcatPersistableQqMessage[]> {
    const userId = parseOrThrow(NonEmptyStringSchema, input.userId, {
      message: "userId 必须是非空字符串",
      reason: "INVALID_USER_ID",
    });
    const count = parseOrThrow(PositiveIntSchema, input.count, {
      message: "count 必须是正整数",
      reason: "INVALID_COUNT",
    });

    const params: Record<string, unknown> = {
      user_id: userId,
      count,
      // 同 get_group_msg_history：缺省 message_seq 会让 NapCat 按 undefined 查锚点报错，
      // 未显式指定时以 0 = 从最新一条往前取。
      message_seq:
        typeof input.messageSeq === "number" && Number.isFinite(input.messageSeq)
          ? Math.trunc(input.messageSeq)
          : 0,
    };

    const data = await this.transport.request("get_friend_msg_history", params);
    const history = parseOrThrow(GroupMessageHistoryResponseSchema, data ?? {}, {
      message: "NapCat 返回的私聊历史消息结构无效",
      reason: "INVALID_PRIVATE_MESSAGE_HISTORY_RESPONSE",
    });

    return await this.groupMessageProcessor.normalizeHistoricalPrivateMessages(history.messages);
  }

  public async getForwardMessages(input: {
    id: string;
    offset: number;
    limit: number;
  }): Promise<NapcatForwardMessagePage> {
    return await this.forwardMessageReader.getPage(input);
  }

  public async listGroupFiles(input: {
    groupId: string;
    folderId?: string;
    fileCount?: number;
  }): Promise<NapcatGroupFileListing> {
    return await this.groupFileClient.list(input);
  }

  public async getGroupFileUrl(input: {
    groupId: string;
    fileId: string;
  }): Promise<{ url: string }> {
    return await this.groupFileClient.getUrl(input);
  }

  public async uploadGroupFile(input: {
    groupId: string;
    fileRef: string;
    name: string;
    folderId?: string;
  }): Promise<void> {
    await this.groupFileClient.upload(input);
  }

  /**
   * 查某群成员禁言到期时间（get_group_member_info.shut_up_timestamp，epoch 秒）。返回该
   * 毫秒时间戳；未禁言（0 / 过去 / 缺失 / 畸形响应 / 请求失败）返回 null。发送失败兜底用，
   * 不抛错——判定失败时保守当作「未确认禁言」，让原始发送错误照旧冒泡。no_cache 取实时值。
   */
  public async getGroupMemberShutUp({
    groupId,
    userId,
  }: {
    groupId: string;
    userId: string;
  }): Promise<number | null> {
    const groupIdResult = NonEmptyStringSchema.safeParse(groupId);
    const userIdResult = NonEmptyStringSchema.safeParse(userId);
    if (!groupIdResult.success || !userIdResult.success) {
      return null;
    }

    const data = await this.transport.request("get_group_member_info", {
      group_id: groupIdResult.data,
      user_id: userIdResult.data,
      no_cache: true,
    });
    const parsed = GroupMemberInfoShutUpResponseSchema.safeParse(data ?? {});
    if (!parsed.success) {
      return null;
    }

    const rawSeconds = parsed.data.shut_up_timestamp;
    const seconds =
      typeof rawSeconds === "number"
        ? rawSeconds
        : typeof rawSeconds === "string"
          ? Number(rawSeconds)
          : NaN;
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return null;
    }
    const untilMs = Math.trunc(seconds) * 1000;
    return untilMs > Date.now() ? untilMs : null;
  }

  private async toPrivateMessageEvent(input: {
    postType: string;
    messageType: string | null;
    userId: string | null;
    selfId: string | null;
    nickname: string | null;
    rawMessage: string | null;
    messageSegments: NapcatPersistableQqMessage["messageSegments"];
    messageId: number | null;
    time: number | null;
  }): Promise<NapcatPrivateMessageEvent | null> {
    if (input.postType !== "message" || input.messageType !== "private") {
      return null;
    }

    if (!input.userId || input.rawMessage === null) {
      return null;
    }

    if (input.selfId !== null && input.selfId === input.userId) {
      return null;
    }

    const friendInfo = await this.friendListManager.findByUserId(input.userId);
    if (!friendInfo) {
      logger.info("Ignoring NapCat private message from non-friend user", {
        event: "napcat.gateway.private_message_ignored_non_friend",
        userId: input.userId,
        messageId: input.messageId,
      });
      return null;
    }

    const nickname = input.nickname?.trim() || friendInfo.nickname || input.userId;
    return {
      type: "napcat_private_message",
      data: {
        userId: input.userId,
        nickname,
        remark: friendInfo.remark,
        rawMessage: input.rawMessage,
        messageSegments: input.messageSegments,
        messageId: input.messageId,
        time: input.time,
      },
    };
  }

  private publishAgentEvent(event: NapcatAgentEvent): void {
    const meta = {
      event: "napcat.gateway.agent_message_publish_failed",
      messageType: toAgentEventMessageType(event),
      groupId: agentEventGroupId(event),
      userId: agentEventUserId(event),
      messageId: agentEventMessageId(event),
    };
    try {
      const result = this.enqueueAgentEvent(event);
      void Promise.resolve(result).catch(error => {
        logger.errorWithCause("Failed to publish agent message event", error, meta);
      });
    } catch (error) {
      logger.errorWithCause("Failed to publish agent message event", error, meta);
    }
  }
}

function agentEventGroupId(event: NapcatAgentEvent): string | null {
  if (event.type === "napcat_group_message" || event.type === "napcat_group_ban") {
    return event.data.groupId;
  }
  return null;
}

function agentEventUserId(event: NapcatAgentEvent): string | null {
  if (event.type === "napcat_group_message" || event.type === "napcat_private_message") {
    return event.data.userId;
  }
  if (event.type === "napcat_group_ban") {
    return event.data.targetUserId;
  }
  return null;
}

function agentEventMessageId(event: NapcatAgentEvent): number | null {
  if (event.type === "napcat_group_message" || event.type === "napcat_private_message") {
    return event.data.messageId;
  }
  return null;
}

function toAgentEventMessageType(
  event: NapcatAgentEvent,
): "group" | "private" | "friend_list" | "group_ban" {
  if (event.type === "napcat_group_message") {
    return "group";
  }

  if (event.type === "napcat_private_message") {
    return "private";
  }

  if (event.type === "napcat_group_ban") {
    return "group_ban";
  }

  return "friend_list";
}
