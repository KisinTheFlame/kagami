import { z } from "zod";
import {
  NapcatFriendInfoSchema,
  NapcatGroupMessageDataSchema,
  NapcatPrivateMessageDataSchema,
} from "./message.js";

/**
 * napcat → agent 的**入站事件** wire（SSE 载荷）—— 忠实镜像原 `NapcatAgentEvent` 判别联合
 * （issue #347 拆分）。事件是网关侧渲染好的「agent 视角事件」：图片已过 vision 带 resid、成员名
 * 已解析，agent 收到即用，不再回头做 napcat 专属处理。
 *
 * 4 类：群消息 / 私聊消息 / 好友列表更新 / 群禁言变更。经 outbox（{@link NapcatOutboxEventSchema}）
 * 单调 `seq` 有序落库后推 SSE；agent 按 `seq` 去重 + 断点续传。
 */

export const NapcatGroupMessageEventSchema = z.object({
  type: z.literal("napcat_group_message"),
  data: NapcatGroupMessageDataSchema,
});
export type NapcatGroupMessageEvent = z.infer<typeof NapcatGroupMessageEventSchema>;

export const NapcatPrivateMessageEventSchema = z.object({
  type: z.literal("napcat_private_message"),
  data: NapcatPrivateMessageDataSchema,
});
export type NapcatPrivateMessageEvent = z.infer<typeof NapcatPrivateMessageEventSchema>;

export const NapcatFriendListUpdatedEventSchema = z.object({
  type: z.literal("napcat_friend_list_updated"),
  data: z.object({
    friends: z.array(NapcatFriendInfoSchema),
  }),
});
export type NapcatFriendListUpdatedEvent = z.infer<typeof NapcatFriendListUpdatedEventSchema>;

/**
 * 群禁言 / 解禁事件（OneBot `notice_type: "group_ban"`）。全员禁言 / 解禁时 `targetUserId` 为 null
 * （NapCat user_id=0 归一化）。operator/target 显示名在网关侧解析，查不到为 null（渲染退化裸号）。
 */
export const NapcatGroupBanDataSchema = z.object({
  groupId: z.string(),
  subType: z.enum(["ban", "lift_ban"]),
  targetUserId: z.string().nullable(),
  targetName: z.string().nullable(),
  operatorUserId: z.string().nullable(),
  operatorName: z.string().nullable(),
  durationSeconds: z.number(),
  time: z.number().nullable(),
});
export type NapcatGroupBanData = z.infer<typeof NapcatGroupBanDataSchema>;

export const NapcatGroupBanEventSchema = z.object({
  type: z.literal("napcat_group_ban"),
  data: NapcatGroupBanDataSchema,
});
export type NapcatGroupBanEvent = z.infer<typeof NapcatGroupBanEventSchema>;

export const NapcatAgentEventSchema = z.discriminatedUnion("type", [
  NapcatGroupMessageEventSchema,
  NapcatPrivateMessageEventSchema,
  NapcatFriendListUpdatedEventSchema,
  NapcatGroupBanEventSchema,
]);
export type NapcatAgentEvent = z.infer<typeof NapcatAgentEventSchema>;

/**
 * outbox 里一条 agent-facing 事件：单调 `seq`（= SSE event id）+ 渲染好的事件。napcat 先事务
 * 落 outbox 拿 seq 再推 SSE 帧（`id: <seq>\ndata: <event JSON>\n\n`）；agent 重连带
 * `Last-Event-ID: <seq>` 回放 `seq >` 缺口，按 seq 去重。严格 at-least-once。
 */
export const NapcatOutboxEventSchema = z.object({
  seq: z.number().int().positive(),
  event: NapcatAgentEventSchema,
});
export type NapcatOutboxEvent = z.infer<typeof NapcatOutboxEventSchema>;

/** SSE 事件流路径（agent 拨出订阅；非 JsonRoute，是 `text/event-stream` 长流，见 #349/#350）。 */
export const NAPCAT_EVENTS_SSE_PATH = "/napcat/events";

/** SSE 断线检测约定：napcat 每 15s 发一个注释帧保活；agent 侧超过该阈值无任何帧即判死重连。 */
export const NAPCAT_SSE_HEARTBEAT_MS = 15_000;
