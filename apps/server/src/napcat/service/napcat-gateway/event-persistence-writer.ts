import type { NapcatEventDao } from "../../dao/napcat-event.dao.js";
import type { NapcatQqMessageDao } from "../../dao/napcat-group-message.dao.js";
import { AppLogger } from "../../../logger/logger.js";
import type { NapcatPersistableQqMessage } from "../napcat-gateway.service.js";
import {
  BLOCKED_NAPCAT_EVENT_POST_TYPES,
  type NapcatGatewayNormalizedPostTypeEvent,
} from "./shared.js";

export interface NapcatGatewayPersistenceWriter {
  persistEvent(event: NapcatGatewayNormalizedPostTypeEvent): void;
  persistQqMessage(event: NapcatPersistableQqMessage, eventTime: Date | null): void;
}

type NapcatEventPersistenceWriterOptions = {
  napcatEventDao?: NapcatEventDao;
  napcatQqMessageDao?: NapcatQqMessageDao;
};

const logger = new AppLogger({ source: "service.napcat-gateway" });

export class NapcatEventPersistenceWriter implements NapcatGatewayPersistenceWriter {
  private readonly napcatEventDao: NapcatEventDao | null;
  private readonly napcatQqMessageDao: NapcatQqMessageDao | null;

  public constructor({ napcatEventDao, napcatQqMessageDao }: NapcatEventPersistenceWriterOptions) {
    this.napcatEventDao = napcatEventDao ?? null;
    this.napcatQqMessageDao = napcatQqMessageDao ?? null;
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

  public persistQqMessage(event: NapcatPersistableQqMessage, eventTime: Date | null): void {
    if (!this.napcatQqMessageDao) {
      return;
    }

    void this.napcatQqMessageDao
      .insert({
        messageType: event.messageType,
        subType: event.subType,
        groupId: event.groupId,
        userId: event.userId,
        nickname: event.nickname,
        messageId: event.messageId,
        message: event.messageSegments,
        eventTime,
        payload: event.payload,
      })
      .catch(error => {
        logger.errorWithCause("Failed to persist NapCat QQ message", error, {
          event: "napcat.gateway.qq_message_persist_failed",
          messageType: event.messageType,
          groupId: event.groupId,
          userId: event.userId,
          messageId: event.messageId,
        });
      });
  }
}
