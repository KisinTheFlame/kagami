export type BizErrorMeta = Record<string, unknown>;

type BizErrorOptions = {
  message: string;
  meta?: BizErrorMeta;
  cause?: unknown;
};

export class BizError extends Error {
  public readonly meta?: BizErrorMeta;
  public override readonly cause?: unknown;

  public constructor({ message, meta, cause }: BizErrorOptions) {
    super(message);
    this.name = "BizError";
    this.meta = meta;
    this.cause = cause;
  }
}
