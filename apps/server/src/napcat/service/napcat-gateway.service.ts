import type { NapcatReceiveMessageSegment } from "./napcat-gateway/shared.js";
import {
  type NapcatSendGroupMessageRequest,
  type NapcatSendGroupMessageResponse,
} from "@kagami/shared/schemas/napcat-message";

export type NapcatSendGroupMessageInput = NapcatSendGroupMessageRequest;
export type NapcatSendGroupMessageResult = NapcatSendGroupMessageResponse;

export type NapcatGroupMessageData = {
  groupId: string;
  userId: string;
  nickname: string;
  rawMessage: string;
  messageSegments: NapcatReceiveMessageSegment[];
  messageId: number | null;
  time: number | null;
};

export type NapcatGroupMessageEvent = {
  type: "napcat_group_message";
  data: NapcatGroupMessageData;
};

export type NapcatPersistableGroupMessageEvent = NapcatGroupMessageData & {
  payload: Record<string, unknown>;
};

export interface NapcatGatewayService {
  start(): Promise<void>;
  stop(): Promise<void>;
  sendGroupMessage(input: NapcatSendGroupMessageInput): Promise<NapcatSendGroupMessageResult>;
  getRecentGroupMessages(input: {
    groupId: string;
    count: number;
  }): Promise<NapcatGroupMessageData[]>;
}
