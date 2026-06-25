import type {
  NapcatChatTarget,
  NapcatFriendInfo,
  NapcatGetGroupInfoResult,
  NapcatGroupMessageData,
  NapcatPrivateMessageData,
} from "../../../napcat/service/napcat-gateway.service.js";
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
  private unread: ConversationMessage[] = [];
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

  public getUnreadCount(): number {
    return this.unread.length;
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

  public pushUnread(message: ConversationMessage): void {
    this.unread.push(message);
    this.unread = takeLast(this.unread, this.unreadLimit);
  }

  /** 进入会话：取未读尾、清空。没进过时调用方会另外拉历史。 */
  public consumeUnreadTail(): ConversationMessage[] {
    const consumed = takeLast(this.unread, this.unreadLimit);
    this.unread = [];
    return consumed;
  }

  public clearUnread(): void {
    this.unread = [];
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
