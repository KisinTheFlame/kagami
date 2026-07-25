import { z } from "zod";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { NonEmptyStringSchema, PositiveIntSchema, parseOrThrow } from "./wire-schemas.js";
import type { NapcatGatewayTransport } from "./transport.js";
import type { NapcatAgentEvent, NapcatFriendInfo } from "../napcat-gateway.service.js";

const logger = new AppLogger({ source: "service.napcat-gateway.friend-list" });

const FRIEND_LIST_REFRESH_INTERVAL_MS = 10_000;

const FriendListResponseSchema = z.array(
  z.object({
    user_id: z.union([NonEmptyStringSchema, PositiveIntSchema]).transform(value => String(value)),
    nickname: z.string().default(""),
    remark: z
      .string()
      .nullable()
      .optional()
      .transform(value => {
        const normalized = value?.trim() ?? "";
        return normalized.length > 0 ? normalized : null;
      }),
  }),
);

type FriendListManagerOptions = {
  request: NapcatGatewayTransport["request"];
  /** 好友表变更时对外广播 `napcat_friend_list_updated`。由网关注入（复用其失败吞掉+记日志语义）。 */
  publishAgentEvent: (event: NapcatAgentEvent) => void;
};

/**
 * 好友表的缓存 / 定时刷新 / 变更广播。从网关 god-service 拆出的协作对象：网关只管
 * 「什么时候要好友信息」，缓存新鲜度、单飞刷新、变更判定都收在这里。
 *
 * 刷新走单飞锁（`refreshPromise`）：并发 miss 合并成一次 get_friend_list，规避
 * 「读-改-写好友表」的覆盖竞态。刷新失败只记日志不抛——好友表是旁路信息，
 * 拉取失败不该把一条正在处理的消息打成 failed。
 */
export class NapcatFriendListManager {
  private readonly request: NapcatGatewayTransport["request"];
  private readonly publishAgentEvent: (event: NapcatAgentEvent) => void;
  private friendInfoByUserId: Map<string, NapcatFriendInfo> | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private refreshPromise: Promise<void> | null = null;

  public constructor({ request, publishAgentEvent }: FriendListManagerOptions) {
    this.request = request;
    this.publishAgentEvent = publishAgentEvent;
  }

  public startRefreshTimer(): void {
    if (this.refreshTimer) {
      return;
    }

    this.refreshTimer = setInterval(() => {
      void this.refresh({ force: true, reason: "interval" });
    }, FRIEND_LIST_REFRESH_INTERVAL_MS);
  }

  public stopRefreshTimer(): void {
    if (!this.refreshTimer) {
      return;
    }

    clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  /** 当前好友表快照（逐条浅拷贝，调用方改不到内部缓存）。 */
  public async list(): Promise<NapcatFriendInfo[]> {
    return [...(await this.load()).values()].map(friend => ({ ...friend }));
  }

  /**
   * 按 userId 查好友。缓存 miss 时强制刷新一次再判定——缓存可能已过期（含冷启动窗口内
   * 刚加为好友的用户，其首条私聊此前会被误当非好友静默永久丢弃）。刷新失败在 refresh
   * 内部被吞（记日志），此处退化为干净地按非好友处理。
   */
  public async findByUserId(userId: string): Promise<NapcatFriendInfo | null> {
    const cachedFriend = (await this.load()).get(userId);
    if (cachedFriend) {
      return cachedFriend;
    }

    await this.refresh({ force: true, reason: "friend_lookup_miss" });
    return this.friendInfoByUserId?.get(userId) ?? null;
  }

  private async load(input?: { refresh?: boolean }): Promise<Map<string, NapcatFriendInfo>> {
    if (!input?.refresh && this.friendInfoByUserId) {
      return this.friendInfoByUserId;
    }

    const data = await this.request("get_friend_list", {});
    const friendList = parseOrThrow(FriendListResponseSchema, data ?? [], {
      message: "NapCat 返回的好友列表结构无效",
      reason: "INVALID_FRIEND_LIST_RESPONSE",
    });

    const normalizedFriendList = normalizeFriendList(
      friendList.map(friend => ({
        userId: friend.user_id,
        nickname: friend.nickname.trim(),
        remark: friend.remark,
      })),
    );
    const previousFriendInfoByUserId = this.friendInfoByUserId;
    this.friendInfoByUserId = new Map(normalizedFriendList.map(friend => [friend.userId, friend]));

    if (hasFriendListChanged(previousFriendInfoByUserId, this.friendInfoByUserId)) {
      this.publishAgentEvent({
        type: "napcat_friend_list_updated",
        data: {
          friends: normalizedFriendList.map(friend => ({ ...friend })),
        },
      });
    }

    return this.friendInfoByUserId;
  }

  private async refresh(input?: {
    force?: boolean;
    reason?: "interval" | "friend_lookup_miss";
  }): Promise<void> {
    if (this.refreshPromise) {
      return await this.refreshPromise;
    }

    const refreshPromise = this.load({ refresh: input?.force ?? false })
      .then(() => undefined)
      .catch(error => {
        logger.warn("Failed to refresh NapCat friend list", {
          event: "napcat.gateway.friend_list_refresh_failed",
          reason: input?.reason ?? "interval",
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        if (this.refreshPromise === refreshPromise) {
          this.refreshPromise = null;
        }
      });

    this.refreshPromise = refreshPromise;
    await refreshPromise;
  }
}

function normalizeFriendList(friendList: NapcatFriendInfo[]): NapcatFriendInfo[] {
  return [...friendList]
    .map(friend => ({
      userId: friend.userId,
      nickname: friend.nickname.trim(),
      remark: normalizeRemark(friend.remark),
    }))
    .sort((left, right) => left.userId.localeCompare(right.userId));
}

function hasFriendListChanged(
  previous: Map<string, NapcatFriendInfo> | null,
  current: Map<string, NapcatFriendInfo>,
): boolean {
  if (!previous) {
    return true;
  }

  if (previous.size !== current.size) {
    return true;
  }

  for (const [userId, currentFriend] of current.entries()) {
    const previousFriend = previous.get(userId);
    if (!previousFriend) {
      return true;
    }

    if (
      previousFriend.nickname !== currentFriend.nickname ||
      normalizeRemark(previousFriend.remark) !== normalizeRemark(currentFriend.remark)
    ) {
      return true;
    }
  }

  return false;
}

function normalizeRemark(remark: string | null): string | null {
  const normalized = remark?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}
