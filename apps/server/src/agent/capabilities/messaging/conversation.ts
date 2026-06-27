import type {
  NapcatChatTarget,
  NapcatFriendInfo,
  NapcatGetGroupInfoResult,
  NapcatGroupMessageData,
  NapcatPrivateMessageData,
} from "../../../napcat/application/napcat-gateway.service.js";
import {
  type ConversationId,
  createGroupConversationId,
  createPrivateConversationId,
} from "./conversation-id.js";

export type ConversationMessage = NapcatGroupMessageData | NapcatPrivateMessageData;

type GroupMeta = {
  readonly kind: "group";
  readonly groupId: string;
  groupInfo: NapcatGetGroupInfoResult | null;
};
type PrivateMeta = {
  readonly kind: "private";
  readonly userId: string;
  friendInfo: NapcatFriendInfo | null;
};

/**
 * 一个 QQ 会话（群或私聊）。QQ App 持有这些，取代旧状态树的 GroupChatState /
 * PrivateChatState（逻辑照搬）。持未读消息 + 元信息 + 是否进过。
 */
export class Conversation {
  public readonly id: ConversationId;
  private readonly meta: GroupMeta | PrivateMeta;
  private readonly unreadLimit: number;
  /** 未读消息内容缓冲，封顶 unreadLimit（只为渲染最近几条）。 */
  private unread: ConversationMessage[] = [];
  /**
   * 未读条数：**不封顶**的真实计数，权威来源在 QQ App 这里。只增不减，唯一清零点是
   * open_conversation（consumeUnreadTail / clearUnread）。小镜一直不来看，它就一直涨——
   * 通知里显示的就是这个，而不是某个 30s 窗口内的临时计数。
   */
  private unreadCount = 0;
  /** 未读里是否有人 @ 过小镜：出现一次就粘住，同样到 open_conversation 才清。 */
  private unreadHasMention = false;
  private entered = false;

  private constructor(id: ConversationId, meta: GroupMeta | PrivateMeta, unreadLimit: number) {
    this.id = id;
    this.meta = meta;
    this.unreadLimit = unreadLimit;
  }

  public static group(groupId: string, unreadLimit: number): Conversation {
    return new Conversation(
      createGroupConversationId(groupId),
      { kind: "group", groupId, groupInfo: null },
      unreadLimit,
    );
  }

  public static privateChat(userId: string, unreadLimit: number): Conversation {
    return new Conversation(
      createPrivateConversationId(userId),
      { kind: "private", userId, friendInfo: null },
      unreadLimit,
    );
  }

  public get kind(): "group" | "private" {
    return this.meta.kind;
  }

  public getChatTarget(): NapcatChatTarget {
    return this.meta.kind === "group"
      ? { chatType: "group", groupId: this.meta.groupId }
      : { chatType: "private", userId: this.meta.userId };
  }

  /** 完整展示名（会话列表 / onFocus 用），群带 "QQ 群 X (id)"。 */
  public getDisplayName(): string {
    if (this.meta.kind === "group") {
      const name = this.meta.groupInfo?.groupName?.trim();
      return name ? `QQ 群 ${name} (${this.meta.groupId})` : `QQ 群 ${this.meta.groupId}`;
    }
    const remark = this.meta.friendInfo?.remark?.trim();
    if (remark) {
      return remark;
    }
    const nickname = this.meta.friendInfo?.nickname?.trim();
    return nickname ? nickname : this.meta.userId;
  }

  /** 通知里用的紧凑短名（群名 / 好友名）。 */
  public getShortName(): string {
    if (this.meta.kind === "group") {
      return this.meta.groupInfo?.groupName?.trim() ?? `群 ${this.meta.groupId}`;
    }
    return this.getDisplayName();
  }

  /** 权威未读条数（不封顶，跨通知窗口持续累积，open 才清零）。 */
  public getUnreadCount(): number {
    return this.unreadCount;
  }

  /** 未读里是否有人 @ 过小镜（粘住，open 才清零）。 */
  public hasUnreadMention(): boolean {
    return this.unreadHasMention;
  }

  public hasEntered(): boolean {
    return this.entered;
  }

  public getLatestUnread(): ConversationMessage | null {
    return this.unread.at(-1) ?? null;
  }

  public setGroupInfo(groupInfo: NapcatGetGroupInfoResult): void {
    if (this.meta.kind === "group") {
      this.meta.groupInfo = groupInfo;
    }
  }

  public setFriendInfo(friendInfo: NapcatFriendInfo): void {
    if (this.meta.kind === "private") {
      this.meta.friendInfo = friendInfo;
    }
  }

  public pushUnread(message: ConversationMessage, mentioned: boolean): void {
    this.unread.push(message);
    this.unread = takeLast(this.unread, this.unreadLimit);
    // 计数与 @ 标记独立于封顶缓冲：缓冲只留最近几条内容，计数据实累积。
    this.unreadCount += 1;
    this.unreadHasMention ||= mentioned;
  }

  /** 进入会话：取未读尾、清空未读（含计数 + @ 标记）。没进过时调用方会另外拉历史。 */
  public consumeUnreadTail(): ConversationMessage[] {
    const consumed = takeLast(this.unread, this.unreadLimit);
    this.resetUnread();
    return consumed;
  }

  public clearUnread(): void {
    this.resetUnread();
  }

  /**
   * 从持久化存档恢复未读红点：只恢复计数 + @ 标记，**不**恢复消息内容缓冲——内容靠
   * open_conversation 时从 napcat 实时拉，避免存陈旧原文。
   */
  public restoreUnread(count: number, mentioned: boolean): void {
    this.unreadCount = Math.max(0, Math.trunc(count));
    this.unreadHasMention = mentioned;
  }

  private resetUnread(): void {
    this.unread = [];
    this.unreadCount = 0;
    this.unreadHasMention = false;
  }

  public markEntered(): void {
    this.entered = true;
  }
}

function takeLast<T>(items: T[], limit: number): T[] {
  if (limit <= 0) {
    return [];
  }
  return items.length <= limit ? [...items] : items.slice(items.length - limit);
}
