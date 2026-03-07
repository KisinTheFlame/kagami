import type { NapcatSendGroupMessageRequest, NapcatSendGroupMessageResponse } from "@kagami/shared";

export type NapcatSendGroupMessageInput = NapcatSendGroupMessageRequest;
export type NapcatSendGroupMessageResult = NapcatSendGroupMessageResponse;

export type NapcatGroupMessageEvent = {
  groupId: string;
  userId: string | null;
  rawMessage: string;
  messageId: number | null;
  time: number | null;
  payload: Record<string, unknown>;
};

export type NapcatGatewayErrorCode = "NOT_CONNECTED" | "REQUEST_TIMEOUT" | "UPSTREAM_ERROR";

export class NapcatGatewayError extends Error {
  public readonly code: NapcatGatewayErrorCode;

  public constructor({
    code,
    message,
    cause,
  }: {
    code: NapcatGatewayErrorCode;
    message: string;
    cause?: unknown;
  }) {
    super(message, cause ? { cause } : undefined);
    this.code = code;
    this.name = "NapcatGatewayError";
  }
}

export interface NapcatGatewayService {
  start(): Promise<void>;
  stop(): Promise<void>;
  sendGroupMessage(input: NapcatSendGroupMessageInput): Promise<NapcatSendGroupMessageResult>;
}
