import { z } from "zod";
import { AppLogger } from "@kagami/kernel/logger/logger";
import {
  NonEmptyStringSchema,
  NonNegativeIntSchema,
  PositiveIntSchema,
  parseOrThrow,
} from "./wire-schemas.js";
import type { NapcatGatewayActionResponseData } from "./shared.js";
import type { NapcatGatewayTransport } from "./transport.js";
import type {
  NapcatForwardMessageNode,
  NapcatForwardMessagePage,
} from "../napcat-gateway.service.js";

const logger = new AppLogger({ source: "service.napcat-gateway.forward" });

const FORWARD_MESSAGE_CACHE_TTL_MS = 10 * 60 * 1000;
// 转发刚到达 / 内层是旧消息时，NapCat 对 get_msg / get_forward_msg 会瞬时返回空（内层尚未解析），
// 稍候即有（实测）。一次取空就重试几次带退避；仍空则不缓存，留给下次调用再试，避免把瞬时空固化成永久失败。
const FORWARD_FETCH_MAX_ATTEMPTS = 3;
const FORWARD_FETCH_RETRY_BACKOFF_MS = 400;

// get_forward_msg 返回结构对齐 node-napcat-ts（规范 TS 客户端）：节点只挂在 messages 下。
const ForwardMessageResponseSchema = z.object({
  messages: z.array(z.record(z.string(), z.unknown())).optional(),
});
// get_msg 主路径：容器消息的 forward 段自带内联 content（节点形态与 get_forward_msg 的 messages 一致），
// 比 get_forward_msg（resId→getMsgHistory 多一跳）更稳。这里只取 message 段数组，逐段挑出 forward。
const GetMsgResponseSchema = z.object({
  message: z.array(z.unknown()).optional(),
});
const ForwardSegmentWithContentSchema = z.object({
  type: z.literal("forward"),
  data: z
    .object({
      content: z.array(z.record(z.string(), z.unknown())).optional(),
    })
    .passthrough(),
});

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

type ForwardMessageReaderOptions = {
  request: NapcatGatewayTransport["request"];
  /** 原始节点 → 领域节点（含 vision 等重加工），由 group-message-processor 提供。 */
  normalizeForwardMessages: (
    rawNodes: Record<string, unknown>[],
  ) => Promise<NapcatForwardMessageNode[]>;
};

/**
 * 合并转发的读取器：从网关 god-service 拆出的协作对象，独占两级缓存。
 *
 * - 原始节点缓存（按 res_id）：翻页时不重复调 get_forward_msg / get_msg。
 * - 当页渲染结果缓存（按 res_id+offset+limit）：避免同一页来回翻时重复跑 vision。
 *
 * 两级都**只缓存非空结果**：空往往是 NapCat 的瞬时未解析，缓存空会把它固化成 TTL 内
 * （10 分钟）的永久失败，下次调用本可成功却被空缓存挡住。
 */
export class NapcatForwardMessageReader {
  private readonly request: NapcatGatewayTransport["request"];
  private readonly normalizeForwardMessages: (
    rawNodes: Record<string, unknown>[],
  ) => Promise<NapcatForwardMessageNode[]>;
  private readonly rawNodeCache = new Map<
    string,
    { nodes: Record<string, unknown>[]; expiresAt: number }
  >();
  private readonly pageCache = new Map<
    string,
    { nodes: NapcatForwardMessageNode[]; total: number; expiresAt: number }
  >();

  public constructor({ request, normalizeForwardMessages }: ForwardMessageReaderOptions) {
    this.request = request;
    this.normalizeForwardMessages = normalizeForwardMessages;
  }

  public async getPage({
    id,
    offset,
    limit,
  }: {
    id: string;
    offset: number;
    limit: number;
  }): Promise<NapcatForwardMessagePage> {
    const forwardId = parseOrThrow(NonEmptyStringSchema, id, {
      message: "合并转发 id 必须是非空字符串",
      reason: "INVALID_FORWARD_ID",
    });
    const pageOffset = parseOrThrow(NonNegativeIntSchema, offset, {
      message: "offset 必须是非负整数",
      reason: "INVALID_FORWARD_OFFSET",
    });
    const pageLimit = parseOrThrow(PositiveIntSchema, limit, {
      message: "limit 必须是正整数",
      reason: "INVALID_FORWARD_LIMIT",
    });

    const pageCacheKey = `${forwardId}:${pageOffset}:${pageLimit}`;
    const cachedPage = this.pageCache.get(pageCacheKey);
    if (cachedPage && cachedPage.expiresAt > Date.now()) {
      return { nodes: cachedPage.nodes, total: cachedPage.total, offset: pageOffset };
    }
    if (cachedPage) {
      this.pageCache.delete(pageCacheKey);
    }

    const rawNodes = await this.loadRawNodes(forwardId);
    const total = rawNodes.length;
    const pageRawNodes = rawNodes.slice(pageOffset, pageOffset + pageLimit);
    const nodes = await this.normalizeForwardMessages(pageRawNodes);

    if (total > 0) {
      this.pageCache.set(pageCacheKey, {
        nodes,
        total,
        expiresAt: Date.now() + FORWARD_MESSAGE_CACHE_TTL_MS,
      });
    }

    return { nodes, total, offset: pageOffset };
  }

  private async loadRawNodes(forwardId: string): Promise<Record<string, unknown>[]> {
    const cached = this.rawNodeCache.get(forwardId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.nodes;
    }
    if (cached) {
      this.rawNodeCache.delete(forwardId);
    }

    const nodes = await this.fetchRawNodesWithRetry(forwardId);
    if (nodes.length > 0) {
      this.rawNodeCache.set(forwardId, {
        nodes,
        expiresAt: Date.now() + FORWARD_MESSAGE_CACHE_TTL_MS,
      });
    }
    return nodes;
  }

  /** 取一条合并转发的原始节点，空就重试带退避（NapCat 对刚到达 / 内层旧消息会瞬时返回空，稍候即有）。 */
  private async fetchRawNodesWithRetry(forwardId: string): Promise<Record<string, unknown>[]> {
    for (let attempt = 1; attempt <= FORWARD_FETCH_MAX_ATTEMPTS; attempt += 1) {
      const nodes = await this.requestRawNodes(forwardId);
      if (nodes.length > 0) {
        return nodes;
      }
      if (attempt < FORWARD_FETCH_MAX_ATTEMPTS) {
        logger.info("Forward fetch returned empty, retrying", {
          event: "napcat.gateway.forward_fetch_empty_retry",
          forwardId,
          attempt,
        });
        await delay(FORWARD_FETCH_RETRY_BACKOFF_MS * attempt);
      }
    }
    logger.warn("Forward fetch still empty after retries", {
      event: "napcat.gateway.forward_fetch_empty",
      forwardId,
      attempts: FORWARD_FETCH_MAX_ATTEMPTS,
    });
    return [];
  }

  /**
   * 单次拉取转发节点：主路径走 get_msg（容器消息的 forward 段自带内联 content，更稳），
   * 拿不到再兜底 get_forward_msg（resId→getMsgHistory，会瞬时返回空的那条）。
   */
  private async requestRawNodes(forwardId: string): Promise<Record<string, unknown>[]> {
    const viaGetMsg = await this.loadNodesViaGetMsg(forwardId);
    if (viaGetMsg.length > 0) {
      return viaGetMsg;
    }
    return await this.loadNodesViaGetForwardMsg(forwardId);
  }

  /** 主路径：get_msg(forwardId) 拿容器消息，挑出 forward 段的内联 content 作为节点。失败/无内容返回空。 */
  private async loadNodesViaGetMsg(forwardId: string): Promise<Record<string, unknown>[]> {
    let data: NapcatGatewayActionResponseData;
    try {
      data = await this.request("get_msg", { message_id: forwardId });
    } catch (error) {
      // get_msg 失败不致命，交给 get_forward_msg 兜底。
      logger.info("get_msg path for forward failed, will fall back", {
        event: "napcat.gateway.forward_get_msg_failed",
        forwardId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }

    const parsed = GetMsgResponseSchema.safeParse(data ?? {});
    if (!parsed.success) {
      return [];
    }
    for (const segment of parsed.data.message ?? []) {
      const forwardSegment = ForwardSegmentWithContentSchema.safeParse(segment);
      if (forwardSegment.success && forwardSegment.data.data.content) {
        return forwardSegment.data.data.content;
      }
    }
    return [];
  }

  /** 兜底路径：get_forward_msg（入参对齐 node-napcat-ts，只传 message_id）。 */
  private async loadNodesViaGetForwardMsg(forwardId: string): Promise<Record<string, unknown>[]> {
    const data = await this.request("get_forward_msg", {
      message_id: forwardId,
    });

    const response = parseOrThrow(ForwardMessageResponseSchema, data ?? {}, {
      message: "NapCat 返回的合并转发结构无效",
      reason: "INVALID_FORWARD_MESSAGE_RESPONSE",
    });

    return response.messages ?? [];
  }
}
