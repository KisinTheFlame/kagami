import { z } from "zod";
import { BizError } from "@kagami/kernel/errors/biz-error";
import type { NapcatGatewayActionResponseData } from "./shared.js";

/**
 * NapCat 网关的入参 / 响应校验基元。网关各处对「校验不过就抛带 reason 的 BizError」这件事
 * 有十余处逐字重复，收敛到 {@link parseOrThrow} 一处；schema 原语也在此单一定义，避免各
 * 协作对象各自复制一份 `z.string().min(1)`。
 */

const MessageIdSchema = z.number().int().positive();
export const PositiveIntSchema = z.number().int().positive();
export const NonNegativeIntSchema = z.number().int().nonnegative();
export const NonEmptyStringSchema = z.string().min(1);

/**
 * 按 schema 校验，不过就抛 BizError（带 reason，供上层分类）。取代
 * `const r = S.safeParse(v); if (!r.success) throw new BizError(...)` 的三行样板。
 */
export function parseOrThrow<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  value: unknown,
  failure: { message: string; reason: string },
): z.infer<TSchema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BizError({
      message: failure.message,
      meta: { reason: failure.reason },
    });
  }

  return result.data as z.infer<TSchema>;
}

/**
 * 从发送类 action 的响应里取 message_id。数组形态的响应（NapCat 某些 action 返回数组）
 * 视作缺失。三个发送入口（群 / 私聊 / 图片）共用同一套缺失语义。
 */
export function extractMessageId(data: NapcatGatewayActionResponseData): number {
  const messageIdSource = Array.isArray(data) ? undefined : data?.message_id;
  return parseOrThrow(MessageIdSchema, messageIdSource, {
    message: "NapCat 返回结果缺少 message_id",
    reason: "MISSING_MESSAGE_ID",
  });
}
