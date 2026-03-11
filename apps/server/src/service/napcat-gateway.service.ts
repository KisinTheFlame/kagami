import type { NapcatSendGroupMessageRequest, NapcatSendGroupMessageResponse } from "@kagami/shared";

export type NapcatSendGroupMessageInput = NapcatSendGroupMessageRequest;
export type NapcatSendGroupMessageResult = NapcatSendGroupMessageResponse;

export type NapcatGroupMessageEvent = {
  groupId: string;
  userId: string;
  nickname: string;
  rawMessage: string;
  messageId: number | null;
  time: number | null;
  payload: Record<string, unknown>;
};

export interface NapcatGatewayService {
  start(): Promise<void>;
  stop(): Promise<void>;
  sendGroupMessage(input: NapcatSendGroupMessageInput): Promise<NapcatSendGroupMessageResult>;
}
