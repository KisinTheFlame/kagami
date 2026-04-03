import { AppLogger } from "../../../logger/logger.js";
import type {
  NapcatGroupMessageData,
  NapcatGroupMessageEvent,
  NapcatPersistableGroupMessageEvent,
  NapcatPersistableQqMessage,
} from "../napcat-gateway.service.js";
import {
  GROUP_MEMBER_DISPLAY_NAME_CACHE_TTL_MS,
  extractDisplayNameFromGroupMemberInfo,
  extractSenderNickname,
  parseMessageSegments,
  renderSupportedMessageSegments,
  toEventTime,
  toNullableNumber,
  toNullablePositiveInt,
  toNullableString,
  toNullableId,
  withAtSegmentName,
  type NapcatGatewayNormalizedPostTypeEvent,
  type NapcatGatewayPostTypeEventPayload,
  type NapcatReceiveMessageSegment,
} from "./shared.js";
import { isNapcatReceiveImageSegment } from "../../schema/napcat-segment.js";
import type { NapcatImageMessageAnalyzer } from "./image-message-analyzer.js";

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
  private readonly groupMemberDisplayNameCache = new Map<
    string,
    GroupMemberDisplayNameCacheEntry
  >();

  public constructor({
    listenGroupIds,
    actionRequester,
    enqueueGroupMessageEvent,
    imageMessageAnalyzer,
  }: NapcatGroupMessageProcessorOptions) {
    this.listenGroupIds = new Set(listenGroupIds);
    this.actionRequester = actionRequester;
    this.enqueueGroupMessageEvent = enqueueGroupMessageEvent;
    this.imageMessageAnalyzer = imageMessageAnalyzer;
  }

  public async handle(eventPayload: NapcatGatewayPostTypeEventPayload): Promise<{
    normalizedEvent: NapcatGatewayNormalizedPostTypeEvent;
    qqMessage: NapcatPersistableQqMessage | null;
    groupMessageEvent: NapcatPersistableGroupMessageEvent | null;
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
  }> {
    const normalizedEvent = await this.normalize(eventPayload);
    this.logPrivateMessage(normalizedEvent);

    const qqMessage = this.toPersistableQqMessage(normalizedEvent);
    const groupMessageEvent = this.toPersistableGroupMessageEvent(normalizedEvent);

    return {
      normalizedEvent,
      qqMessage,
      groupMessageEvent,
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
    if (event.postType !== "message") {
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

    const hydratedSegments = await this.hydrateAtSegmentNames({
      groupId,
      messageSegments,
    });
    const renderedImageSegments = await this.renderImageSegments(hydratedSegments);
    const normalizedSegments = this.hydrateImageSegmentSummaries({
      messageSegments: hydratedSegments,
      renderedImageSegments,
    });
    const renderedMessage = renderSupportedMessageSegments(hydratedSegments, {
      renderImageSegment: segment => renderedImageSegments.get(segment) ?? "[图片]",
    });

    return {
      rawMessage: renderedMessage,
      messageSegments: normalizedSegments,
    };
  }

  private async renderImageSegments(
    messageSegments: NapcatReceiveMessageSegment[],
  ): Promise<Map<NapcatReceiveMessageSegment, string>> {
    const imageEntries = await Promise.all(
      messageSegments.map(async segment => {
        if (!isNapcatReceiveImageSegment(segment)) {
          return null;
        }

        const renderedText = await this.imageMessageAnalyzer.analyzeImageSegment(segment);
        return [segment, renderedText] as const;
      }),
    );

    return new Map(
      imageEntries.filter(
        (
          entry,
        ): entry is readonly [Extract<NapcatReceiveMessageSegment, { type: "image" }>, string] =>
          entry !== null,
      ),
    );
  }

  private hydrateImageSegmentSummaries({
    messageSegments,
    renderedImageSegments,
  }: {
    messageSegments: NapcatReceiveMessageSegment[];
    renderedImageSegments: Map<NapcatReceiveMessageSegment, string>;
  }): NapcatReceiveMessageSegment[] {
    return messageSegments.map(segment => {
      if (!isNapcatReceiveImageSegment(segment)) {
        return segment;
      }

      const renderedText = renderedImageSegments.get(segment);
      const description = extractImageDescription(renderedText);
      if (!description) {
        return segment;
      }

      return {
        ...segment,
        data: {
          ...segment.data,
          summary: description,
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

  private async resolveAtDisplayName({
    groupId,
    qq,
  }: {
    groupId: string | null;
    qq: string | "all";
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

function extractImageDescription(renderedText: string | undefined): string | null {
  if (!renderedText) {
    return null;
  }

  const matched = /^\[图片: (.+)\]$/u.exec(renderedText.trim());
  return matched?.[1]?.trim() || null;
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
