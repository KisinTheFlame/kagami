export type BizErrorMeta = Record<string, unknown>;

type BizErrorOptions = {
  message: string;
  meta?: BizErrorMeta;
  cause?: unknown;
  statusCode?: number;
};

export class BizError extends Error {
  public readonly meta?: BizErrorMeta;
  public override readonly cause?: unknown;
  public readonly statusCode: number;

  public constructor({ message, meta, cause, statusCode = 500 }: BizErrorOptions) {
    super(message);
    this.name = "BizError";
    this.meta = meta;
    this.cause = cause;
    this.statusCode = statusCode;
  }
}
