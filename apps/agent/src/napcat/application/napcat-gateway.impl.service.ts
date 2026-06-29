import { z } from "zod";
import type { ConfigManager } from "@kagami/server-core/config/config.manager";
import type { Config } from "@kagami/server-core/config/config.loader";
import { BizError } from "@kagami/server-core/common/errors/biz-error";
import { AppLogger } from "@kagami/server-core/logger/logger";
import { type NapcatGatewayPersistenceWriter } from "./napcat-gateway/event-persistence-writer.js";
import { NapcatGroupMessageProcessor } from "./napcat-gateway/group-message-processor.js";
import type { NapcatImageMessageAnalyzer } from "./napcat-gateway/image-message-analyzer.js";
import type { NapcatQqMessageDao } from "@kagami/server-core/dao/napcat-group-message.dao";
import { NapcatGatewayInboundMessageRouter } from "./napcat-gateway/inbound-message-router.js";
import {
  buildOutgoingImageSegments,
  buildOutgoingMessageSegments,
  type NapcatGatewayActionResponseData,
  type WebSocketLike,
} from "./napcat-gateway/shared.js";
import { NapcatGatewayTransport } from "./napcat-gateway/transport.js";
import type {
  NapcatAgentEvent,
  NapcatForwardMessageNode,
  NapcatForwardMessagePage,
  NapcatFriendInfo,
  NapcatGetGroupInfoInput,
  NapcatGetGroupInfoResult,
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

const MessageIdSchema = z.number().int().positive();
const PositiveIntSchema = z.number().int().positive();
const NonNegativeIntSchema = z.number().int().nonnegative();
const NonEmptyStringSchema = z.string().min(1);
const GroupMessageHistoryResponseSchema = z.object({
  messages: z.array(z.record(z.string(), z.unknown())),
});
const FriendListResponseSchema = z.array(
  z.object({
    user_id: z.union([NonEmptyStringSchema, PositiveIntSchema]).transform(value => String(value)),
    nickname: z.string().default(""),
    remark: z
      .string()
      .nullable()
      .optional()
      .transform(value => {
        const normalized = value?.trim() ?? "";
        return normalized.length > 0 ? normalized : null;
      }),
  }),
);
const GroupInfoResponseSchema = z.object({
  group_all_shut: z.union([z.boolean(), NonNegativeIntSchema]),
  group_remark: z.string().optional().default(""),
  group_id: z.union([NonEmptyStringSchema, PositiveIntSchema]).transform(value => String(value)),
  group_name: NonEmptyStringSchema,
  member_count: NonNegativeIntSchema,
  max_member_count: NonNegativeIntSchema,
});
// get_forward_msg 返回结构对齐 node-napcat-ts（规范 TS 客户端）：节点只挂在 messages 下。
const ForwardMessageResponseSchema = z.object({
  messages: z.array(z.record(z.string(), z.unknown())).optional(),
});
// get_msg 主路径：容器消息的 forward 段自带内联 content（节点形态与 get_forward_msg 的 messages 一致），
// 比 get_forward_msg（resId→getMsgHistory 多一跳）更稳。这里只取 message 段数组，逐段挑出 forward。
const GetMsgResponseSchema = z.object({
  message: z.array(z.unknown()).optional(),
});
const ForwardSegmentWithContentSchema = z.object({
  type: z.literal("forward"),
  data: z
    .object({
      content: z.array(z.record(z.string(), z.unknown())).optional(),
    })
    .passthrough(),
});
const logger = new AppLogger({ source: "service.napcat-gateway" });
const FRIEND_LIST_REFRESH_INTERVAL_MS = 10_000;
const FORWARD_MESSAGE_CACHE_TTL_MS = 10 * 60 * 1000;
// 转发刚到达 / 内层是旧消息时，NapCat 对 get_msg / get_forward_msg 会瞬时返回空（内层尚未解析），
// 稍候即有（实测）。一次取空就重试几次带退避；仍空则不缓存，留给下次调用再试，避免把瞬时空固化成永久失败。
const FORWARD_FETCH_MAX_ATTEMPTS = 3;
const FORWARD_FETCH_RETRY_BACKOFF_MS = 400;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

type OrderedPostTypeEventResult =
  | {
      kind: "processed";
      normalizedEvent: Awaited<
        ReturnType<NapcatGroupMessageProcessor["process"]>
      >["normalizedEvent"];
      qqMessage: Awaited<ReturnType<NapcatGroupMessageProcessor["process"]>>["qqMessage"];
      groupMessageEvent: Awaited<
        ReturnType<NapcatGroupMessageProcessor["process"]>
      >["groupMessageEvent"];
      privateMessageEvent: NapcatPrivateMessageEvent | null;
    }
  | {
      kind: "failed";
    };

export class DefaultNapcatGatewayService implements NapcatGatewayService {
  private readonly transport: NapcatGatewayTransport;
  private readonly groupMessageProcessor: NapcatGroupMessageProcessor;
  private readonly enqueueAgentEvent: (event: NapcatAgentEvent) => number | Promise<number>;
  private friendInfoByUserId: Map<string, NapcatFriendInfo> | null = null;
  private friendListRefreshTimer: NodeJS.Timeout | null = null;
  private friendListRefreshPromise: Promise<void> | null = null;
  // 转发原始节点缓存（按 res_id）：翻页时不重复调 get_forward_msg。
  private readonly forwardRawNodeCache = new Map<
    string,
    { nodes: Record<string, unknown>[]; expiresAt: number }
  >();
  // 转发当页已渲染结果缓存（按 res_id+offset+limit）：避免同一页来回翻时重复跑 vision。
  private readonly forwardPageCache = new Map<
    string,
    { nodes: NapcatForwardMessageNode[]; total: number; expiresAt: number }
  >();

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
      listenGroupIds: config.listenGroupIds,
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
    this.groupMessageProcessor = groupMessageProcessor;
    this.enqueueAgentEvent = enqueueGroupMessageEvent;
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

        if (result.qqMessage) {
          persistenceWriter.persistQqMessage(result.qqMessage, result.normalizedEvent.eventTime);
        }
        if (result.groupMessageEvent) {
          groupMessageProcessor.publishGroupMessageEvent(result.groupMessageEvent);
        }
        if (result.privateMessageEvent) {
          this.publishAgentEvent(result.privateMessageEvent);
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
          .then(async result => {
            const privateMessageEvent = await this.toPrivateMessageEvent(result.normalizedEvent);
            completedResults.set(sequence, {
              kind: "processed",
              normalizedEvent: result.normalizedEvent,
              qqMessage: result.qqMessage,
              groupMessageEvent: result.groupMessageEvent,
              privateMessageEvent,
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
    this.startFriendListRefreshTimer();
  }

  public async stop(): Promise<void> {
    this.stopFriendListRefreshTimer();
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

    const messageIdSource = Array.isArray(data) ? undefined : data?.message_id;
    const messageIdResult = MessageIdSchema.safeParse(messageIdSource);
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

    const messageIdSource = Array.isArray(data) ? undefined : data?.message_id;
    const messageIdResult = MessageIdSchema.safeParse(messageIdSource);
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

    const messageIdSource = Array.isArray(data) ? undefined : data?.message_id;
    const messageIdResult = MessageIdSchema.safeParse(messageIdSource);
    if (!messageIdResult.success) {
      throw new BizError({
        message: "NapCat 返回结果缺少 message_id",
        meta: { reason: "MISSING_MESSAGE_ID" },
      });
    }

    return { messageId: messageIdResult.data };
  }

  public async getFriendList(): Promise<NapcatFriendInfo[]> {
    return [...(await this.loadFriendInfoByUserId()).values()].map(friend => ({ ...friend }));
  }

  public async getGroupInfo({
    groupId,
  }: NapcatGetGroupInfoInput): Promise<NapcatGetGroupInfoResult> {
    const groupIdResult = NonEmptyStringSchema.safeParse(groupId);
    if (!groupIdResult.success) {
      throw new BizError({
        message: "groupId 必须是非空字符串",
        meta: {
          reason: "INVALID_GROUP_ID",
        },
      });
    }

    const data = await this.transport.request("get_group_info", {
      group_id: groupIdResult.data,
    });

    const groupInfoResult = GroupInfoResponseSchema.safeParse(data ?? {});
    if (!groupInfoResult.success) {
      throw new BizError({
        message: "NapCat 返回的群信息结构无效",
        meta: {
          reason: "INVALID_GROUP_INFO_RESPONSE",
        },
      });
    }

    return {
      groupId: groupInfoResult.data.group_id,
      groupName: groupInfoResult.data.group_name,
      memberCount: groupInfoResult.data.member_count,
      maxMemberCount: groupInfoResult.data.max_member_count,
      groupRemark: groupInfoResult.data.group_remark,
      groupAllShut: Boolean(groupInfoResult.data.group_all_shut),
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

  public async getRecentPrivateMessages(input: {
    userId: string;
    count: number;
    messageSeq?: number;
  }): Promise<NapcatPersistableQqMessage[]> {
    const userIdResult = NonEmptyStringSchema.safeParse(input.userId);
    if (!userIdResult.success) {
      throw new BizError({
        message: "userId 必须是非空字符串",
        meta: {
          reason: "INVALID_USER_ID",
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

    const params: Record<string, unknown> = {
      user_id: userIdResult.data,
      count: countResult.data,
    };

    if (typeof input.messageSeq === "number" && Number.isFinite(input.messageSeq)) {
      params.message_seq = Math.trunc(input.messageSeq);
    }

    const data = await this.transport.request("get_friend_msg_history", params);
    const historyResult = GroupMessageHistoryResponseSchema.safeParse(data ?? {});
    if (!historyResult.success) {
      throw new BizError({
        message: "NapCat 返回的私聊历史消息结构无效",
        meta: {
          reason: "INVALID_PRIVATE_MESSAGE_HISTORY_RESPONSE",
        },
      });
    }

    return await this.groupMessageProcessor.normalizeHistoricalPrivateMessages(
      historyResult.data.messages,
    );
  }

  public async getForwardMessages({
    id,
    offset,
    limit,
  }: {
    id: string;
    offset: number;
    limit: number;
  }): Promise<NapcatForwardMessagePage> {
    const idResult = NonEmptyStringSchema.safeParse(id);
    if (!idResult.success) {
      throw new BizError({
        message: "合并转发 id 必须是非空字符串",
        meta: {
          reason: "INVALID_FORWARD_ID",
        },
      });
    }

    const offsetResult = NonNegativeIntSchema.safeParse(offset);
    if (!offsetResult.success) {
      throw new BizError({
        message: "offset 必须是非负整数",
        meta: {
          reason: "INVALID_FORWARD_OFFSET",
        },
      });
    }

    const limitResult = PositiveIntSchema.safeParse(limit);
    if (!limitResult.success) {
      throw new BizError({
        message: "limit 必须是正整数",
        meta: {
          reason: "INVALID_FORWARD_LIMIT",
        },
      });
    }

    const forwardId = idResult.data;
    const pageOffset = offsetResult.data;
    const pageLimit = limitResult.data;

    const pageCacheKey = `${forwardId}:${pageOffset}:${pageLimit}`;
    const cachedPage = this.forwardPageCache.get(pageCacheKey);
    if (cachedPage && cachedPage.expiresAt > Date.now()) {
      return { nodes: cachedPage.nodes, total: cachedPage.total, offset: pageOffset };
    }
    if (cachedPage) {
      this.forwardPageCache.delete(pageCacheKey);
    }

    const rawNodes = await this.loadForwardRawNodes(forwardId);
    const total = rawNodes.length;
    const pageRawNodes = rawNodes.slice(pageOffset, pageOffset + pageLimit);
    const nodes = await this.groupMessageProcessor.normalizeForwardMessages(pageRawNodes);

    // 同样不缓存空结果（total 为 0 多是瞬时未解析）：缓存空会让 TTL 内的重试都命中空，下次本可成功也读不到。
    if (total > 0) {
      this.forwardPageCache.set(pageCacheKey, {
        nodes,
        total,
        expiresAt: Date.now() + FORWARD_MESSAGE_CACHE_TTL_MS,
      });
    }

    return { nodes, total, offset: pageOffset };
  }

  private async loadForwardRawNodes(forwardId: string): Promise<Record<string, unknown>[]> {
    const cached = this.forwardRawNodeCache.get(forwardId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.nodes;
    }
    if (cached) {
      this.forwardRawNodeCache.delete(forwardId);
    }

    const nodes = await this.fetchForwardRawNodesWithRetry(forwardId);
    // 只缓存非空结果：空往往是 NapCat 的瞬时未解析，缓存空会把它固化成 TTL 内（10 分钟）永久失败，
    // 下次调用本可成功却被空缓存挡住。空就不写缓存，留给下次 view_forward 重新拉。
    if (nodes.length > 0) {
      this.forwardRawNodeCache.set(forwardId, {
        nodes,
        expiresAt: Date.now() + FORWARD_MESSAGE_CACHE_TTL_MS,
      });
    }
    return nodes;
  }

  /** 取一条合并转发的原始节点，空就重试带退避（NapCat 对刚到达 / 内层旧消息会瞬时返回空，稍候即有）。 */
  private async fetchForwardRawNodesWithRetry(
    forwardId: string,
  ): Promise<Record<string, unknown>[]> {
    for (let attempt = 1; attempt <= FORWARD_FETCH_MAX_ATTEMPTS; attempt += 1) {
      const nodes = await this.requestForwardRawNodes(forwardId);
      if (nodes.length > 0) {
        return nodes;
      }
      if (attempt < FORWARD_FETCH_MAX_ATTEMPTS) {
        logger.info("Forward fetch returned empty, retrying", {
          event: "napcat.gateway.forward_fetch_empty_retry",
          forwardId,
          attempt,
        });
        await delay(FORWARD_FETCH_RETRY_BACKOFF_MS * attempt);
      }
    }
    logger.warn("Forward fetch still empty after retries", {
      event: "napcat.gateway.forward_fetch_empty",
      forwardId,
      attempts: FORWARD_FETCH_MAX_ATTEMPTS,
    });
    return [];
  }

  /**
   * 单次拉取转发节点：主路径走 get_msg（容器消息的 forward 段自带内联 content，更稳），
   * 拿不到再兜底 get_forward_msg（resId→getMsgHistory，会瞬时返回空的那条）。
   */
  private async requestForwardRawNodes(forwardId: string): Promise<Record<string, unknown>[]> {
    const viaGetMsg = await this.loadForwardNodesViaGetMsg(forwardId);
    if (viaGetMsg.length > 0) {
      return viaGetMsg;
    }
    return await this.loadForwardNodesViaGetForwardMsg(forwardId);
  }

  /** 主路径：get_msg(forwardId) 拿容器消息，挑出 forward 段的内联 content 作为节点。失败/无内容返回空。 */
  private async loadForwardNodesViaGetMsg(forwardId: string): Promise<Record<string, unknown>[]> {
    let data: NapcatGatewayActionResponseData;
    try {
      data = await this.transport.request("get_msg", { message_id: forwardId });
    } catch (error) {
      // get_msg 失败不致命，交给 get_forward_msg 兜底。
      logger.info("get_msg path for forward failed, will fall back", {
        event: "napcat.gateway.forward_get_msg_failed",
        forwardId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }

    const parsed = GetMsgResponseSchema.safeParse(data ?? {});
    if (!parsed.success) {
      return [];
    }
    for (const segment of parsed.data.message ?? []) {
      const forwardSegment = ForwardSegmentWithContentSchema.safeParse(segment);
      if (forwardSegment.success && forwardSegment.data.data.content) {
        return forwardSegment.data.data.content;
      }
    }
    return [];
  }

  /** 兜底路径：get_forward_msg（入参对齐 node-napcat-ts，只传 message_id）。 */
  private async loadForwardNodesViaGetForwardMsg(
    forwardId: string,
  ): Promise<Record<string, unknown>[]> {
    const data = await this.transport.request("get_forward_msg", {
      message_id: forwardId,
    });

    const responseResult = ForwardMessageResponseSchema.safeParse(data ?? {});
    if (!responseResult.success) {
      throw new BizError({
        message: "NapCat 返回的合并转发结构无效",
        meta: {
          reason: "INVALID_FORWARD_MESSAGE_RESPONSE",
        },
      });
    }

    return responseResult.data.messages ?? [];
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

    const friendInfo = await this.findFriendByUserId(input.userId);
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

  private async findFriendByUserId(userId: string): Promise<NapcatFriendInfo | null> {
    const hadCachedFriendList = this.friendInfoByUserId !== null;
    const cachedFriend = (await this.loadFriendInfoByUserId()).get(userId);
    if (cachedFriend) {
      return cachedFriend;
    }

    if (!hadCachedFriendList) {
      return null;
    }

    return (await this.loadFriendInfoByUserId({ refresh: true })).get(userId) ?? null;
  }

  private async loadFriendInfoByUserId(input?: {
    refresh?: boolean;
  }): Promise<Map<string, NapcatFriendInfo>> {
    if (!input?.refresh && this.friendInfoByUserId) {
      return this.friendInfoByUserId;
    }

    const data = await this.transport.request("get_friend_list", {});
    const friendListResult = FriendListResponseSchema.safeParse(data ?? []);
    if (!friendListResult.success) {
      throw new BizError({
        message: "NapCat 返回的好友列表结构无效",
        meta: {
          reason: "INVALID_FRIEND_LIST_RESPONSE",
        },
      });
    }

    const normalizedFriendList = normalizeFriendList(
      friendListResult.data.map(friend => ({
        userId: friend.user_id,
        nickname: friend.nickname.trim(),
        remark: friend.remark,
      })),
    );
    const previousFriendInfoByUserId = this.friendInfoByUserId;
    this.friendInfoByUserId = new Map(normalizedFriendList.map(friend => [friend.userId, friend]));

    if (hasFriendListChanged(previousFriendInfoByUserId, this.friendInfoByUserId)) {
      this.publishAgentEvent({
        type: "napcat_friend_list_updated",
        data: {
          friends: normalizedFriendList.map(friend => ({ ...friend })),
        },
      });
    }

    return this.friendInfoByUserId;
  }

  private startFriendListRefreshTimer(): void {
    if (this.friendListRefreshTimer) {
      return;
    }

    this.friendListRefreshTimer = setInterval(() => {
      void this.refreshFriendList({
        force: true,
        reason: "interval",
      });
    }, FRIEND_LIST_REFRESH_INTERVAL_MS);
  }

  private stopFriendListRefreshTimer(): void {
    if (!this.friendListRefreshTimer) {
      return;
    }

    clearInterval(this.friendListRefreshTimer);
    this.friendListRefreshTimer = null;
  }

  private async refreshFriendList(input?: { force?: boolean; reason?: "interval" }): Promise<void> {
    if (this.friendListRefreshPromise) {
      return await this.friendListRefreshPromise;
    }

    const refreshPromise = this.loadFriendInfoByUserId({
      refresh: input?.force ?? false,
    })
      .then(() => undefined)
      .catch(error => {
        logger.warn("Failed to refresh NapCat friend list", {
          event: "napcat.gateway.friend_list_refresh_failed",
          reason: input?.reason ?? "interval",
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        if (this.friendListRefreshPromise === refreshPromise) {
          this.friendListRefreshPromise = null;
        }
      });

    this.friendListRefreshPromise = refreshPromise;
    await refreshPromise;
  }

  private publishAgentEvent(event: NapcatAgentEvent): void {
    try {
      const result = this.enqueueAgentEvent(event);
      void Promise.resolve(result).catch(error => {
        logger.errorWithCause("Failed to publish agent message event", error, {
          event: "napcat.gateway.agent_message_publish_failed",
          messageType: toAgentEventMessageType(event),
          groupId: event.type === "napcat_group_message" ? event.data.groupId : null,
          userId: event.type === "napcat_friend_list_updated" ? null : event.data.userId,
          messageId: event.type === "napcat_friend_list_updated" ? null : event.data.messageId,
        });
      });
    } catch (error) {
      logger.errorWithCause("Failed to publish agent message event", error, {
        event: "napcat.gateway.agent_message_publish_failed",
        messageType: toAgentEventMessageType(event),
        groupId: event.type === "napcat_group_message" ? event.data.groupId : null,
        userId: event.type === "napcat_friend_list_updated" ? null : event.data.userId,
        messageId: event.type === "napcat_friend_list_updated" ? null : event.data.messageId,
      });
    }
  }
}

function normalizeFriendList(friendList: NapcatFriendInfo[]): NapcatFriendInfo[] {
  return [...friendList]
    .map(friend => ({
      userId: friend.userId,
      nickname: friend.nickname.trim(),
      remark: normalizeRemark(friend.remark),
    }))
    .sort((left, right) => left.userId.localeCompare(right.userId));
}

function hasFriendListChanged(
  previous: Map<string, NapcatFriendInfo> | null,
  current: Map<string, NapcatFriendInfo>,
): boolean {
  if (!previous) {
    return true;
  }

  if (previous.size !== current.size) {
    return true;
  }

  for (const [userId, currentFriend] of current.entries()) {
    const previousFriend = previous.get(userId);
    if (!previousFriend) {
      return true;
    }

    if (
      previousFriend.nickname !== currentFriend.nickname ||
      normalizeRemark(previousFriend.remark) !== normalizeRemark(currentFriend.remark)
    ) {
      return true;
    }
  }

  return false;
}

function normalizeRemark(remark: string | null): string | null {
  const normalized = remark?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function toAgentEventMessageType(event: NapcatAgentEvent): "group" | "private" | "friend_list" {
  if (event.type === "napcat_group_message") {
    return "group";
  }

  if (event.type === "napcat_private_message") {
    return "private";
  }

  return "friend_list";
}
