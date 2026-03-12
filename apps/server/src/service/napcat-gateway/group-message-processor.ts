import { AppLogger } from "../../logger/logger.js";
import type { AgentEventQueue } from "../../agent/event.queue.js";
import type { NapcatGroupMessageEvent } from "../napcat-gateway.service.js";
import {
  GROUP_MEMBER_DISPLAY_NAME_CACHE_TTL_MS,
  canRenderTextOrAtSegment,
  extractDisplayNameFromGroupMemberInfo,
  extractSenderNickname,
  formatAtSegment,
  isTextOrAtSegment,
  parseMessageSegments,
  replaceAtSegmentsInRawMessage,
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

type GroupMemberDisplayNameCacheEntry = {
  displayName: string;
  expiresAt: number;
};

type NapcatActionRequester = {
  request(action: string, params: Record<string, unknown>): Promise<Record<string, unknown> | null>;
};

type NapcatGroupMessageProcessorOptions = {
  listenGroupId: string;
  actionRequester: NapcatActionRequester;
  eventQueue: AgentEventQueue;
};

const logger = new AppLogger({ source: "service.napcat-gateway" });

export class NapcatGroupMessageProcessor {
  private readonly listenGroupId: string;
  private readonly actionRequester: NapcatActionRequester;
  private readonly eventQueue: AgentEventQueue;
  private readonly groupMemberDisplayNameCache = new Map<
    string,
    GroupMemberDisplayNameCacheEntry
  >();

  public constructor({
    listenGroupId,
    actionRequester,
    eventQueue,
  }: NapcatGroupMessageProcessorOptions) {
    this.listenGroupId = listenGroupId;
    this.actionRequester = actionRequester;
    this.eventQueue = eventQueue;
  }

  public async handle(eventPayload: NapcatGatewayPostTypeEventPayload): Promise<{
    normalizedEvent: NapcatGatewayNormalizedPostTypeEvent;
    groupMessageEvent: NapcatGroupMessageEvent | null;
  }> {
    const normalizedEvent = await this.normalize(eventPayload);
    this.logPrivateMessage(normalizedEvent);

    const groupMessageEvent = this.toGroupMessageEvent(normalizedEvent);
    if (groupMessageEvent) {
      this.publishGroupMessage(groupMessageEvent);
    }

    return {
      normalizedEvent,
      groupMessageEvent,
    };
  }

  private async normalize(
    eventPayload: NapcatGatewayPostTypeEventPayload,
  ): Promise<NapcatGatewayNormalizedPostTypeEvent> {
    const userId = toNullableId(eventPayload.user_id);
    const selfId = toNullableId(eventPayload.self_id);
    const groupId = toNullableId(eventPayload.group_id);
    const payload = eventPayload as unknown as Record<string, unknown>;
    const rawMessage = await this.extractFormattedRawMessage({ payload, groupId });

    return {
      postType: eventPayload.post_type,
      messageType: toNullableString(eventPayload.message_type),
      subType: toNullableString(eventPayload.sub_type),
      userId,
      selfId,
      groupId,
      nickname: extractSenderNickname(payload),
      rawMessage,
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

  private toGroupMessageEvent(
    event: NapcatGatewayNormalizedPostTypeEvent,
  ): NapcatGroupMessageEvent | null {
    if (event.postType !== "message" || event.messageType !== "group") {
      return null;
    }

    if (!event.groupId || event.groupId !== this.listenGroupId) {
      return null;
    }

    if (!event.rawMessage) {
      return null;
    }

    if (!event.userId || !event.nickname) {
      return null;
    }

    if (event.selfId !== null && event.selfId === event.userId) {
      return null;
    }

    return {
      groupId: event.groupId,
      userId: event.userId,
      nickname: event.nickname,
      rawMessage: event.rawMessage,
      messageId: event.messageId,
      time: event.time,
      payload: event.payload,
    };
  }

  private publishGroupMessage(event: NapcatGroupMessageEvent): void {
    try {
      const result = this.eventQueue.enqueue({
        type: "napcat_group_message",
        groupId: event.groupId,
        userId: event.userId,
        nickname: event.nickname,
        rawMessage: event.rawMessage,
        messageId: event.messageId,
        time: event.time,
      });
      void Promise.resolve(result).catch(error => {
        logger.errorWithCause("Failed to publish group message event", error, {
          event: "napcat.gateway.group_message_publish_failed",
          groupId: event.groupId,
          userId: event.userId,
          messageId: event.messageId,
        });
      });
    } catch (error) {
      logger.errorWithCause("Failed to publish group message event", error, {
        event: "napcat.gateway.group_message_publish_failed",
        groupId: event.groupId,
        userId: event.userId,
        messageId: event.messageId,
      });
    }
  }

  private async extractFormattedRawMessage({
    payload,
    groupId,
  }: {
    payload: Record<string, unknown>;
    groupId: string | null;
  }): Promise<string | null> {
    const rawMessage = toNullableString(payload.raw_message);
    const messageSegments = parseMessageSegments(payload.message);

    if (!messageSegments || messageSegments.length === 0) {
      return rawMessage;
    }

    const hydratedSegments = await this.hydrateAtSegmentNames({
      groupId,
      messageSegments,
    });

    if (
      hydratedSegments.every(isTextOrAtSegment) &&
      hydratedSegments.every(canRenderTextOrAtSegment)
    ) {
      return hydratedSegments
        .map(segment => {
          if (segment.type === "text") {
            return segment.data.text;
          }

          return formatAtSegment(segment) ?? "";
        })
        .join("");
    }

    if (!rawMessage) {
      return null;
    }

    return replaceAtSegmentsInRawMessage(rawMessage, hydratedSegments);
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
}
