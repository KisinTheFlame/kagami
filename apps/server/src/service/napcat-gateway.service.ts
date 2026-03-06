export type NapcatSendPrivateTextInput = {
  userId: string;
  message: string;
};

export type NapcatSendPrivateTextResult = {
  messageId: number;
};

export type NapcatSendGroupTextInput = {
  groupId: string;
  message: string;
};

export type NapcatSendGroupTextResult = {
  messageId: number;
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
  sendPrivateText(input: NapcatSendPrivateTextInput): Promise<NapcatSendPrivateTextResult>;
  sendGroupText(input: NapcatSendGroupTextInput): Promise<NapcatSendGroupTextResult>;
}
