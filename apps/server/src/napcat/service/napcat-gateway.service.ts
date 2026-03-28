import type { NapcatReceiveMessageSegment } from "./napcat-gateway/shared.js";
import {
  type NapcatSendGroupMessageRequest,
  type NapcatSendGroupMessageResponse,
} from "@kagami/shared/schemas/napcat-message";

export type NapcatSendGroupMessageInput = NapcatSendGroupMessageRequest;
export type NapcatSendGroupMessageResult = NapcatSendGroupMessageResponse;

type NapcatBaseGroupMessageEvent = {
  groupId: string;
  userId: string;
  nickname: string;
  rawMessage: string;
  messageSegments: NapcatReceiveMessageSegment[];
  messageId: number | null;
  time: number | null;
};

export type NapcatGroupMessageEvent = NapcatBaseGroupMessageEvent & {
  type: "napcat_group_message";
};

export type NapcatPersistableGroupMessageEvent = NapcatBaseGroupMessageEvent & {
  payload: Record<string, unknown>;
};

export interface NapcatGatewayService {
  start(): Promise<void>;
  stop(): Promise<void>;
  sendGroupMessage(input: NapcatSendGroupMessageInput): Promise<NapcatSendGroupMessageResult>;
}
