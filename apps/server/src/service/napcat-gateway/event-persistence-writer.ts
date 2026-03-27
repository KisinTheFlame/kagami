import { formatGroupMessagePlainText } from "../../event/event.js";
import type { NapcatEventDao } from "../../dao/napcat-event.dao.js";
import type { NapcatGroupMessageChunkDao } from "../../dao/napcat-group-message-chunk.dao.js";
import type { NapcatGroupMessageDao } from "../../dao/napcat-group-message.dao.js";
import { AppLogger } from "../../logger/logger.js";
import type { GroupMessageChunkIndexer } from "../../rag/indexer.service.js";
import type { NapcatGroupMessageEvent } from "../napcat-gateway.service.js";
import {
  BLOCKED_NAPCAT_EVENT_POST_TYPES,
  type NapcatGatewayNormalizedPostTypeEvent,
} from "./shared.js";

export interface NapcatGatewayPersistenceWriter {
  persistEvent(event: NapcatGatewayNormalizedPostTypeEvent): void;
  persistGroupMessage(event: NapcatGroupMessageEvent, eventTime: Date | null): void;
}

type NapcatEventPersistenceWriterOptions = {
  napcatEventDao?: NapcatEventDao;
  napcatGroupMessageDao?: NapcatGroupMessageDao;
  napcatGroupMessageChunkDao?: NapcatGroupMessageChunkDao;
  groupMessageChunkIndexer?: GroupMessageChunkIndexer;
};

const logger = new AppLogger({ source: "service.napcat-gateway" });

export class NapcatEventPersistenceWriter implements NapcatGatewayPersistenceWriter {
  private readonly napcatEventDao: NapcatEventDao | null;
  private readonly napcatGroupMessageDao: NapcatGroupMessageDao | null;
  private readonly napcatGroupMessageChunkDao: NapcatGroupMessageChunkDao | null;
  private readonly groupMessageChunkIndexer: GroupMessageChunkIndexer | null;

  public constructor({
    napcatEventDao,
    napcatGroupMessageDao,
    napcatGroupMessageChunkDao,
    groupMessageChunkIndexer,
  }: NapcatEventPersistenceWriterOptions) {
    this.napcatEventDao = napcatEventDao ?? null;
    this.napcatGroupMessageDao = napcatGroupMessageDao ?? null;
    this.napcatGroupMessageChunkDao = napcatGroupMessageChunkDao ?? null;
    this.groupMessageChunkIndexer = groupMessageChunkIndexer ?? null;
  }

  public persistEvent(event: NapcatGatewayNormalizedPostTypeEvent): void {
    if (!this.napcatEventDao) {
      return;
    }

    if (BLOCKED_NAPCAT_EVENT_POST_TYPES.has(event.postType)) {
      return;
    }

    void this.napcatEventDao
      .insert({
        postType: event.postType,
        messageType: event.messageType,
        subType: event.subType,
        userId: event.userId,
        groupId: event.groupId,
        eventTime: event.eventTime,
        payload: event.payload,
      })
      .catch(error => {
        logger.errorWithCause("Failed to persist NapCat event", error, {
          event: "napcat.gateway.event_persist_failed",
          postType: event.postType,
          messageType: event.messageType,
          nickname: event.nickname,
        });
      });
  }

  public persistGroupMessage(event: NapcatGroupMessageEvent, eventTime: Date | null): void {
    if (!this.napcatGroupMessageDao) {
      return;
    }

    void this.napcatGroupMessageDao
      .insert({
        groupId: event.groupId,
        userId: event.userId,
        nickname: event.nickname,
        messageId: event.messageId,
        message: event.messageSegments,
        eventTime,
        payload: event.payload,
      })
      .then(async sourceMessageId => {
        if (!this.napcatGroupMessageChunkDao) {
          return;
        }

        const chunkId = await this.napcatGroupMessageChunkDao.insert({
          sourceMessageId,
          groupId: event.groupId,
          chunkIndex: 0,
          content: formatGroupMessagePlainText({
            nickname: event.nickname,
            userId: event.userId,
            rawMessage: event.rawMessage,
          }),
          status: "pending",
          embeddingModel: null,
          embeddingDim: null,
          errorMessage: null,
        });
        this.groupMessageChunkIndexer?.enqueue(chunkId);
      })
      .catch(error => {
        logger.errorWithCause("Failed to persist NapCat group message", error, {
          event: "napcat.gateway.group_message_persist_failed",
          groupId: event.groupId,
          userId: event.userId,
          messageId: event.messageId,
        });
      });
  }
}
