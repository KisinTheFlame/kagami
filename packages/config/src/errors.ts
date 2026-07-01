export type ConfigErrorMeta = Record<string, unknown>;

type ConfigErrorOptions = {
  message: string;
  meta?: ConfigErrorMeta;
  cause?: unknown;
  statusCode?: number;
};

/**
 * 配置装载/合并阶段的错误类型。字段形状与 `@kagami/kernel` 的 `BizError`
 * 同构（`message` / `meta` / `cause` / `statusCode`），以便沿用现有按 `meta.reason`
 * 的诊断，同时让 `@kagami/config` 保持零 `@kagami/*` 依赖的叶子包（不反向依赖 kernel）。
 */
export class ConfigError extends Error {
  public readonly meta?: ConfigErrorMeta;
  public override readonly cause?: unknown;
  public readonly statusCode: number;

  public constructor({ message, meta, cause, statusCode = 500 }: ConfigErrorOptions) {
    super(message);
    this.name = "ConfigError";
    this.meta = meta;
    this.cause = cause;
    this.statusCode = statusCode;
  }
}
