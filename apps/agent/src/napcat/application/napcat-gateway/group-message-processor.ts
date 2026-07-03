import { AppLogger } from "@kagami/kernel/logger/logger";
import type {
  NapcatForwardMessageNode,
  NapcatGroupBanData,
  NapcatGroupMessageData,
  NapcatGroupMessageEvent,
  NapcatPersistableGroupMessageEvent,
  NapcatPersistableQqMessage,
} from "../napcat-gateway.service.js";
import {
  GROUP_MEMBER_DISPLAY_NAME_CACHE_TTL_MS,
  extractDisplayNameFromGroupMemberInfo,
  extractSenderNickname,
  formatImageSegmentText,
  parseMessageSegments,
  renderSupportedMessageSegments,
  toEventTime,
  toNullableNumber,
  toNullablePositiveInt,
  toNullableString,
  toNullableId,
  withAtSegmentName,
  withReplyHydration,
  type NapcatGatewayNormalizedPostTypeEvent,
  type NapcatGatewayPostTypeEventPayload,
  type NapcatReceiveMessageSegment,
} from "./shared.js";
import { isNapcatReceiveImageSegment } from "../../domain/napcat-segment.js";
import { truncateWithEllipsis } from "@kagami/kernel/utils/text";
import type { NapcatQqMessageDao } from "@kagami/persistence/dao/napcat-group-message.dao";
import type {
  NapcatImageAnalysisResult,
  NapcatImageMessageAnalyzer,
} from "./image-message-analyzer.js";

type GroupMemberDisplayNameCacheEntry = {
  displayName: string;
  expiresAt: number;
};

type NapcatActionRequester = {
  request(action: string, params: Record<string, unknown>): Promise<Record<string, unknown> | null>;
};

type NapcatGroupMessageProcessorOptions = {
  listenGroupIds: string[];
  actionRequester: NapcatActionRequester;
  enqueueGroupMessageEvent: (event: NapcatGroupMessageEvent) => number | Promise<number>;
  imageMessageAnalyzer: NapcatImageMessageAnalyzer;
  qqMessageDao: NapcatQqMessageDao;
};

const logger = new AppLogger({ source: "service.napcat-gateway" });
const LIVE_GROUP_MESSAGE_POST_TYPES = new Set<string>(["message"]);
const HISTORICAL_GROUP_MESSAGE_POST_TYPES = new Set<string>(["message", "message_sent"]);

export class NapcatGroupMessageProcessor {
  private readonly listenGroupIds: Set<string>;
  private readonly actionRequester: NapcatActionRequester;
  private readonly enqueueGroupMessageEvent: (
    event: NapcatGroupMessageEvent,
  ) => number | Promise<number>;
  private readonly imageMessageAnalyzer: NapcatImageMessageAnalyzer;
  private readonly qqMessageDao: NapcatQqMessageDao;
  private readonly groupMemberDisplayNameCache = new Map<
    string,
    GroupMemberDisplayNameCacheEntry
  >();

  public constructor({
    listenGroupIds,
    actionRequester,
    enqueueGroupMessageEvent,
    imageMessageAnalyzer,
    qqMessageDao,
  }: NapcatGroupMessageProcessorOptions) {
    this.listenGroupIds = new Set(listenGroupIds);
    this.actionRequester = actionRequester;
    this.enqueueGroupMessageEvent = enqueueGroupMessageEvent;
    this.imageMessageAnalyzer = imageMessageAnalyzer;
    this.qqMessageDao = qqMessageDao;
  }

  public async handle(eventPayload: NapcatGatewayPostTypeEventPayload): Promise<{
    normalizedEvent: NapcatGatewayNormalizedPostTypeEvent;
    qqMessage: NapcatPersistableQqMessage | null;
    groupMessageEvent: NapcatPersistableGroupMessageEvent | null;
    groupBanEvent: NapcatGroupBanData | null;
  }> {
    const result = await this.process(eventPayload);
    const { groupMessageEvent } = result;
    if (groupMessageEvent) {
      this.publishGroupMessage(groupMessageEvent);
    }

    return result;
  }

  public async process(eventPayload: NapcatGatewayPostTypeEventPayload): Promise<{
    normalizedEvent: NapcatGatewayNormalizedPostTypeEvent;
    qqMessage: NapcatPersistableQqMessage | null;
    groupMessageEvent: NapcatPersistableGroupMessageEvent | null;
    groupBanEvent: NapcatGroupBanData | null;
  }> {
    const normalizedEvent = await this.normalize(eventPayload);
    this.logPrivateMessage(normalizedEvent);

    const qqMessage = this.toPersistableQqMessage(normalizedEvent);
    const groupMessageEvent = this.toPersistableGroupMessageEvent(normalizedEvent);
    const groupBanEvent = await this.toGroupBanEvent(normalizedEvent);

    return {
      normalizedEvent,
      qqMessage,
      groupMessageEvent,
      groupBanEvent,
    };
  }

  /**
   * 归一化 group_ban notice → 禁言事件（其余 notice 返回 null，照旧只落 persistEvent）。
   * 识别条件：postType=notice 且 notice_type=group_ban 且 sub_type∈{ban,lift_ban} 且群在
   * listenGroupIds。丢弃条件收窄（spec D5）：仅 groupId / sub_type 不可用时整条丢弃；
   * duration 畸形降级为 0（事件保留、通知照发、不写 mute 态）。operator/target 名解析
   * 复用成员名缓存，失败不阻塞（名字置 null，渲染退化裸号）。
   */
  private async toGroupBanEvent(
    event: NapcatGatewayNormalizedPostTypeEvent,
  ): Promise<NapcatGroupBanData | null> {
    if (event.postType !== "notice") {
      return null;
    }
    if (toNullableString(event.payload.notice_type) !== "group_ban") {
      return null;
    }
    const subType = event.subType;
    // 显式比较（而非 Set.has）以让 TS 收窄到 "ban" | "lift_ban"。
    if (subType !== "ban" && subType !== "lift_ban") {
      logger.warn("Dropping group_ban notice with invalid sub_type", {
        event: "napcat.gateway.group_ban_invalid_sub_type",
        groupId: event.groupId,
        subType,
      });
      return null;
    }
    if (!event.groupId) {
      logger.warn("Dropping group_ban notice without group id", {
        event: "napcat.gateway.group_ban_missing_group_id",
        subType,
      });
      return null;
    }
    if (!this.listenGroupIds.has(event.groupId)) {
      return null;
    }

    // user_id=0（NapCat 全员禁言约定）归一化为 targetUserId=null；operator_id=0
    // （系统 / 匿名操作者）同样归一化为 null，渲染层退化为「管理员」而非裸 "0"。
    const rawTarget = event.userId;
    const targetUserId = rawTarget === null || rawTarget === "0" ? null : rawTarget;
    const rawOperator = toNullableId(event.payload.operator_id);
    const operatorUserId = rawOperator === "0" ? null : rawOperator;

    let durationSeconds = 0;
    if (subType === "ban") {
      // duration 用 string-tolerant 解析（与 group_id/user_id/time 同款）：NapCat 某些版本
      // 会把 duration 发成字符串 "600"，若只认 number 会静默降级 0 → self 禁言态不写入。
      // toNullablePositiveInt 接受 number|数字串、拒绝 0/负/畸形（→null → 降级 0）。
      const parsedDuration = toNullablePositiveInt(event.payload.duration);
      if (parsedDuration === null) {
        logger.warn("group_ban notice has invalid duration, degrading to 0", {
          event: "napcat.gateway.group_ban_invalid_duration",
          groupId: event.groupId,
          duration: event.payload.duration,
        });
      } else {
        durationSeconds = parsedDuration;
      }
    }

    // 名解析并行；失败不阻塞（queryGroupMemberDisplayName 内部已吞错返回 null）。
    const [targetName, operatorName] = await Promise.all([
      targetUserId
        ? this.queryGroupMemberDisplayName({ groupId: event.groupId, userId: targetUserId })
        : Promise.resolve(null),
      operatorUserId
        ? this.queryGroupMemberDisplayName({ groupId: event.groupId, userId: operatorUserId })
        : Promise.resolve(null),
    ]);

    return {
      groupId: event.groupId,
      subType,
      targetUserId,
      targetName,
      operatorUserId,
      operatorName,
      durationSeconds,
      time: event.time,
    };
  }

  public async normalizeHistoricalGroupMessages(
    messagePayloads: Record<string, unknown>[],
  ): Promise<NapcatGroupMessageData[]> {
    return await this.normalizeHistoricalMessages(messagePayloads, {
      messageType: "group",
      skipReasonEvent: "napcat.gateway.history_message_skipped",
    });
  }

  public async normalizeHistoricalPrivateMessages(
    messagePayloads: Record<string, unknown>[],
  ): Promise<NapcatPersistableQqMessage[]> {
    const normalizedEntries = await Promise.all(
      messagePayloads.map(async (messagePayload, index) => {
        const normalizedEvent = await this.normalize({
          post_type: "message",
          message_type: "private",
          ...messagePayload,
        });
        const qqMessage = this.toHistoricalQqMessage(normalizedEvent);

        if (!qqMessage) {
          logger.warn("Skipping malformed NapCat private history message", {
            event: "napcat.gateway.private_history_message_skipped",
            userId: toNullableId(messagePayload.user_id),
            messageId: toNullablePositiveInt(messagePayload.message_id),
            payload: messagePayload,
          });
          return null;
        }

        return {
          index,
          data: qqMessage,
        };
      }),
    );

    return normalizedEntries
      .filter(
        (entry): entry is { index: number; data: NapcatPersistableQqMessage } => entry !== null,
      )
      .sort((left, right) => compareMessageOrder(left, right))
      .map(entry => entry.data);
  }

  /**
   * 把合并转发里的每个节点当作一条普通消息，复用同一条 normalize 管线（@名字 → reply →
   * 图片 vision → 渲染）。这样转发里的图片自动走和普通消息相同的 analyzeImageSegment，
   * 无需另起一条 vision 路径；嵌套的合并转发段经渲染器变成 [forward_id: ...] 占位，不递归。
   * 转发节点没有 groupId，所以 @ 名字若未 baked-in 就退化为 @qq，reply 查不到则退化为引用占位。
   */
  public async normalizeForwardMessages(
    rawNodes: Record<string, unknown>[],
  ): Promise<NapcatForwardMessageNode[]> {
    return await Promise.all(
      rawNodes.map(async rawNode => {
        const normalizedEvent = await this.normalize({
          post_type: "message",
          message_type: "private",
          ...toForwardNodePayload(rawNode),
        });
        const senderName = normalizedEvent.nickname?.trim() || normalizedEvent.userId || "未知用户";
        return {
          senderName,
          senderUserId: normalizedEvent.userId,
          rawMessage: normalizedEvent.rawMessage ?? "",
          time: normalizedEvent.time,
        };
      }),
    );
  }

  public publishGroupMessageEvent(event: NapcatPersistableGroupMessageEvent): void {
    this.publishGroupMessage(event);
  }

  private async normalize(
    eventPayload: NapcatGatewayPostTypeEventPayload,
  ): Promise<NapcatGatewayNormalizedPostTypeEvent> {
    const userId = toNullableId(eventPayload.user_id);
    const selfId = toNullableId(eventPayload.self_id);
    const groupId = toNullableId(eventPayload.group_id);
    const payload: Record<string, unknown> = eventPayload;
    const { rawMessage, messageSegments } = await this.normalizeMessageContent({
      payload,
      groupId,
    });

    return {
      postType: eventPayload.post_type,
      messageType: toNullableString(eventPayload.message_type),
      subType: toNullableString(eventPayload.sub_type),
      userId,
      selfId,
      groupId,
      nickname: extractSenderNickname(payload),
      rawMessage,
      messageSegments,
      messageId: toNullablePositiveInt(eventPayload.message_id),
      time: toNullablePositiveInt(eventPayload.time),
      eventTime: toEventTime(eventPayload.time),
      payload,
    };
  }

  private logPrivateMessage(event: NapcatGatewayNormalizedPostTypeEvent): void {
    if (event.postType !== "message" || event.messageType !== "private") {
      return;
    }

    logger.info("Received NapCat private message event", {
      event: "napcat.gateway.private_message_received",
      userId: event.userId,
      messageId: event.messageId ?? toNullableNumber(event.payload.message_id),
      rawMessage: event.payload.raw_message,
      time: event.payload.time,
      subType: event.subType,
    });
  }

  private toPersistableGroupMessageEvent(
    event: NapcatGatewayNormalizedPostTypeEvent,
  ): NapcatPersistableGroupMessageEvent | null {
    const groupMessageData = this.toGroupMessageData(event, {
      requireListenedGroup: true,
      includeSelfMessages: false,
      acceptedPostTypes: LIVE_GROUP_MESSAGE_POST_TYPES,
    });
    if (!groupMessageData) {
      return null;
    }

    return {
      ...groupMessageData,
      payload: event.payload,
    };
  }

  private toPersistableQqMessage(
    event: NapcatGatewayNormalizedPostTypeEvent,
  ): NapcatPersistableQqMessage | null {
    if (!HISTORICAL_GROUP_MESSAGE_POST_TYPES.has(event.postType)) {
      return null;
    }

    return this.toHistoricalQqMessage(event);
  }

  private toHistoricalQqMessage(
    event: NapcatGatewayNormalizedPostTypeEvent,
  ): NapcatPersistableQqMessage | null {
    if (!HISTORICAL_GROUP_MESSAGE_POST_TYPES.has(event.postType)) {
      return null;
    }

    if (event.messageType !== "group" && event.messageType !== "private") {
      return null;
    }

    if (event.rawMessage === null) {
      return null;
    }

    if (event.messageType === "group" && !event.groupId) {
      return null;
    }

    return {
      messageType: event.messageType,
      subType: event.subType ?? defaultSubTypeForMessageType(event.messageType),
      groupId: event.groupId,
      userId: event.userId,
      nickname: event.nickname,
      rawMessage: event.rawMessage,
      messageSegments: event.messageSegments,
      messageId: event.messageId,
      time: event.time,
      payload: event.payload,
    };
  }

  private toGroupMessageData(
    event: NapcatGatewayNormalizedPostTypeEvent,
    options: {
      requireListenedGroup: boolean;
      includeSelfMessages: boolean;
      acceptedPostTypes: ReadonlySet<string>;
    },
  ): NapcatGroupMessageData | null {
    if (!options.acceptedPostTypes.has(event.postType) || event.messageType !== "group") {
      return null;
    }

    if (!event.groupId) {
      return null;
    }

    if (options.requireListenedGroup && !this.listenGroupIds.has(event.groupId)) {
      return null;
    }

    if (event.rawMessage === null) {
      return null;
    }

    if (!event.userId || !event.nickname) {
      return null;
    }

    if (!options.includeSelfMessages && event.selfId !== null && event.selfId === event.userId) {
      return null;
    }

    return {
      groupId: event.groupId,
      userId: event.userId,
      nickname: event.nickname,
      rawMessage: event.rawMessage,
      messageSegments: event.messageSegments,
      messageId: event.messageId,
      time: event.time,
    };
  }

  private publishGroupMessage(
    event: NapcatGroupMessageEvent | NapcatPersistableGroupMessageEvent,
  ): void {
    try {
      const data = "data" in event ? event.data : event;
      const { groupId, userId, nickname, rawMessage, messageSegments, messageId, time } = data;
      const result = this.enqueueGroupMessageEvent({
        type: "napcat_group_message",
        data: {
          groupId,
          userId,
          nickname,
          rawMessage,
          messageSegments,
          messageId,
          time,
        },
      });
      void Promise.resolve(result).catch(error => {
        logger.errorWithCause("Failed to publish group message event", error, {
          event: "napcat.gateway.group_message_publish_failed",
          groupId,
          userId,
          messageId,
        });
      });
    } catch (error) {
      logger.errorWithCause("Failed to publish group message event", error, {
        event: "napcat.gateway.group_message_publish_failed",
        groupId: "data" in event ? event.data.groupId : event.groupId,
        userId: "data" in event ? event.data.userId : event.userId,
        messageId: "data" in event ? event.data.messageId : event.messageId,
      });
    }
  }

  private async normalizeMessageContent({
    payload,
    groupId,
  }: {
    payload: Record<string, unknown>;
    groupId: string | null;
  }): Promise<{
    rawMessage: string | null;
    messageSegments: NapcatReceiveMessageSegment[];
  }> {
    const messageSegments = parseMessageSegments(payload.message);

    if (!messageSegments || messageSegments.length === 0) {
      return {
        rawMessage: null,
        messageSegments: [],
      };
    }

    const atHydratedSegments = await this.hydrateAtSegmentNames({
      groupId,
      messageSegments,
    });
    const hydratedSegments = await this.hydrateReplySegments(atHydratedSegments);
    const renderedImageSegments = await this.renderImageSegments(hydratedSegments);
    const normalizedSegments = this.hydrateImageSegmentSummaries({
      messageSegments: hydratedSegments,
      renderedImageSegments,
    });
    const renderedMessage = renderSupportedMessageSegments(hydratedSegments, {
      renderImageSegment: segment => {
        const analyzed = renderedImageSegments.get(segment);
        return analyzed ? formatImageSegmentText(analyzed.description, analyzed.resid) : "[图片]";
      },
    });

    return {
      rawMessage: renderedMessage,
      messageSegments: normalizedSegments,
    };
  }

  private async renderImageSegments(
    messageSegments: NapcatReceiveMessageSegment[],
  ): Promise<Map<NapcatReceiveMessageSegment, NapcatImageAnalysisResult>> {
    const imageEntries = await Promise.all(
      messageSegments.map(async segment => {
        if (!isNapcatReceiveImageSegment(segment)) {
          return null;
        }

        const analyzed = await this.imageMessageAnalyzer.analyzeImageSegment(segment);
        return [segment, analyzed] as const;
      }),
    );

    return new Map(
      imageEntries.filter(
        (
          entry,
        ): entry is readonly [
          Extract<NapcatReceiveMessageSegment, { type: "image" }>,
          NapcatImageAnalysisResult,
        ] => entry !== null,
      ),
    );
  }

  private hydrateImageSegmentSummaries({
    messageSegments,
    renderedImageSegments,
  }: {
    messageSegments: NapcatReceiveMessageSegment[];
    renderedImageSegments: Map<NapcatReceiveMessageSegment, NapcatImageAnalysisResult>;
  }): NapcatReceiveMessageSegment[] {
    return messageSegments.map(segment => {
      if (!isNapcatReceiveImageSegment(segment)) {
        return segment;
      }

      const analyzed = renderedImageSegments.get(segment);
      if (!analyzed) {
        return segment;
      }

      const description = analyzed.description.trim();
      if (!description && !analyzed.resid) {
        return segment;
      }

      // 把 vision 描述 + OSS resid 回填进消息段，持久化进消息记录，让重渲染（如 open
      // conversation 拉历史）也能稳定显示 [图片: 描述, resid: res-N]。
      return {
        ...segment,
        data: {
          ...segment.data,
          summary: description || segment.data.summary,
          resid: analyzed.resid ?? segment.data.resid,
        },
      };
    });
  }

  private async hydrateAtSegmentNames({
    groupId,
    messageSegments,
  }: {
    groupId: string | null;
    messageSegments: NapcatReceiveMessageSegment[];
  }): Promise<NapcatReceiveMessageSegment[]> {
    return await Promise.all(
      messageSegments.map(async segment => {
        if (segment.type !== "at") {
          return segment;
        }

        const currentName = toNullableString(segment.data.name);
        if (currentName) {
          return segment;
        }

        const displayName = await this.resolveAtDisplayName({
          groupId,
          qq: segment.data.qq,
        });
        if (!displayName) {
          return segment;
        }

        return withAtSegmentName(segment, displayName);
      }),
    );
  }

  private async hydrateReplySegments(
    messageSegments: NapcatReceiveMessageSegment[],
  ): Promise<NapcatReceiveMessageSegment[]> {
    return await Promise.all(
      messageSegments.map(async segment => {
        if (segment.type !== "reply") {
          return segment;
        }

        try {
          const messageId = Number(segment.data.id);
          if (!Number.isFinite(messageId) || messageId <= 0) {
            return segment;
          }

          const message = await this.qqMessageDao.findByNapcatMessageId(messageId);
          if (!message) {
            return segment;
          }

          const nickname = message.nickname ?? message.userId ?? null;
          const userId = message.userId;
          if (!nickname || !userId) {
            return segment;
          }

          const rawMessage = toNullableString(message.payload?.raw_message as string) ?? "";
          // 按码点截断（truncateWithEllipsis 内部先剥除落单代理项）：绝不从 emoji 代理对中间
          // 切开留下半个字符——否则这条引用预览进上下文后会让每轮 LLM 请求体非法 JSON、整条会话打挂。
          const preview = truncateWithEllipsis(rawMessage, 50);

          return withReplyHydration(segment, {
            senderNickname: nickname,
            senderUserId: userId,
            messagePreview: preview,
          });
        } catch (error) {
          logger.errorWithCause("Failed to hydrate reply segment", error, {
            event: "napcat.gateway.reply_hydration_failed",
            replyMessageId: segment.data.id,
          });
          return segment;
        }
      }),
    );
  }

  private async resolveAtDisplayName({
    groupId,
    qq,
  }: {
    groupId: string | null;
    qq: string;
  }): Promise<string | null> {
    if (qq === "all") {
      return "全体成员";
    }

    if (!groupId) {
      return null;
    }

    return await this.queryGroupMemberDisplayName({
      groupId,
      userId: qq,
    });
  }

  private async queryGroupMemberDisplayName({
    groupId,
    userId,
  }: {
    groupId: string;
    userId: string;
  }): Promise<string | null> {
    const cacheKey = `${groupId}:${userId}`;
    const now = Date.now();
    const cachedEntry = this.groupMemberDisplayNameCache.get(cacheKey);
    if (cachedEntry && cachedEntry.expiresAt > now) {
      return cachedEntry.displayName;
    }

    if (cachedEntry) {
      this.groupMemberDisplayNameCache.delete(cacheKey);
    }

    try {
      const data = await this.actionRequester.request("get_group_member_info", {
        group_id: groupId,
        user_id: userId,
        no_cache: false,
      });
      const displayName = extractDisplayNameFromGroupMemberInfo(data);

      if (displayName) {
        this.groupMemberDisplayNameCache.set(cacheKey, {
          displayName,
          expiresAt: now + GROUP_MEMBER_DISPLAY_NAME_CACHE_TTL_MS,
        });
      }

      return displayName;
    } catch (error) {
      logger.warn("Failed to query NapCat group member info", {
        event: "napcat.gateway.group_member_info_query_failed",
        groupId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async normalizeHistoricalMessages(
    messagePayloads: Record<string, unknown>[],
    options: {
      messageType: "group";
      skipReasonEvent: string;
    },
  ): Promise<NapcatGroupMessageData[]> {
    const normalizedEntries = await Promise.all(
      messagePayloads.map(async (messagePayload, index) => {
        const normalizedEvent = await this.normalize({
          post_type: "message",
          message_type: options.messageType,
          ...messagePayload,
        });
        const groupMessageData = this.toGroupMessageData(normalizedEvent, {
          requireListenedGroup: false,
          includeSelfMessages: true,
          acceptedPostTypes: HISTORICAL_GROUP_MESSAGE_POST_TYPES,
        });

        if (!groupMessageData) {
          logger.warn("Skipping malformed NapCat history message", {
            event: options.skipReasonEvent,
            groupId: toNullableId(messagePayload.group_id),
            messageId: toNullablePositiveInt(messagePayload.message_id),
            skipReasons: explainSkippedHistoricalMessageReasons(normalizedEvent),
            payload: messagePayload,
          });
          return null;
        }

        return {
          index,
          data: groupMessageData,
        };
      }),
    );

    return normalizedEntries
      .filter((entry): entry is { index: number; data: NapcatGroupMessageData } => entry !== null)
      .sort((left, right) => compareMessageOrder(left, right))
      .map(entry => entry.data);
  }
}

function compareMessageOrder(
  left: { index: number; data: { time: number | null; messageId: number | null } },
  right: { index: number; data: { time: number | null; messageId: number | null } },
): number {
  if (left.data.time !== null && right.data.time !== null && left.data.time !== right.data.time) {
    return left.data.time - right.data.time;
  }

  if (
    left.data.messageId !== null &&
    right.data.messageId !== null &&
    left.data.messageId !== right.data.messageId
  ) {
    return left.data.messageId - right.data.messageId;
  }

  return left.index - right.index;
}

function defaultSubTypeForMessageType(messageType: "group" | "private"): string {
  return messageType === "private" ? "friend" : "normal";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * 把 get_forward_msg 的一个节点压平成 normalize 能吃的 message-like payload。兼容两种形态：
 * 扁平 `{ sender, message, time, user_id }` 与 OneBot 包裹 `{ type:"node", data:{ content, ... } }`。
 * 不写入 post_type / message_type，交由调用方统一指定。
 */
function toForwardNodePayload(rawNode: Record<string, unknown>): Record<string, unknown> {
  const data = asRecord(rawNode.data);
  const source = data && Array.isArray(data.content) ? data : rawNode;
  const sender = asRecord(source.sender);
  const message = Array.isArray(source.message)
    ? source.message
    : Array.isArray(source.content)
      ? source.content
      : [];
  const userId = toNullableId(source.user_id) ?? toNullableId(sender?.user_id);
  const nickname =
    toNullableString(sender?.card) ??
    toNullableString(sender?.nickname) ??
    toNullableString(source.nickname);

  return {
    message,
    time: source.time,
    user_id: userId ?? undefined,
    sender: sender ?? (nickname ? { nickname } : undefined),
  };
}

function explainSkippedHistoricalMessageReasons(
  event: NapcatGatewayNormalizedPostTypeEvent,
): string[] {
  const reasons: string[] = [];

  if (!HISTORICAL_GROUP_MESSAGE_POST_TYPES.has(event.postType)) {
    reasons.push("NOT_MESSAGE_POST_TYPE");
  }

  if (event.messageType !== "group") {
    reasons.push("NOT_GROUP_MESSAGE");
  }

  if (!event.groupId) {
    reasons.push("MISSING_GROUP_ID");
  }

  if (event.rawMessage === null) {
    reasons.push("EMPTY_OR_INVALID_MESSAGE_SEGMENTS");
  }

  if (!event.userId) {
    reasons.push("MISSING_USER_ID");
  }

  if (!event.nickname) {
    reasons.push("MISSING_NICKNAME");
  }

  return reasons;
}
