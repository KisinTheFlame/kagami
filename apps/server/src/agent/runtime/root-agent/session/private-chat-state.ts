import type {
  NapcatFriendInfo,
  NapcatPrivateMessageData,
} from "../../../../napcat/service/napcat-gateway.service.js";

type PrivateChatStateOptions = {
  userId: string;
  unreadLimit: number;
};

export class PrivateChatState {
  public readonly userId: string;
  public friendInfo: NapcatFriendInfo | null = null;
  private readonly unreadLimit: number;
  private unreadMessages: NapcatPrivateMessageData[] = [];
  private entered = false;

  public constructor({ userId, unreadLimit }: PrivateChatStateOptions) {
    this.userId = userId;
    this.unreadLimit = unreadLimit;
  }

  public hasEntered(): boolean {
    return this.entered;
  }

  public markEntered(): void {
    this.entered = true;
  }

  public getUnreadCount(): number {
    return this.unreadMessages.length;
  }

  public getFriendInfo(): NapcatFriendInfo | null {
    return this.friendInfo ? structuredClone(this.friendInfo) : null;
  }

  public getUnreadMessages(): NapcatPrivateMessageData[] {
    return structuredClone(this.unreadMessages);
  }

  public setFriendInfo(friendInfo: NapcatFriendInfo): void {
    this.friendInfo = friendInfo;
  }

  public getDisplayName(): string {
    const remark = this.friendInfo?.remark?.trim();
    if (remark) {
      return remark;
    }

    const nickname = this.friendInfo?.nickname?.trim();
    if (nickname) {
      return nickname;
    }

    return this.userId;
  }

  public pushUnreadMessage(message: NapcatPrivateMessageData): void {
    this.unreadMessages.push(message);
    this.unreadMessages = takeLast(this.unreadMessages, this.unreadLimit);
  }

  public consumeUnreadTail(): NapcatPrivateMessageData[] {
    const consumed = takeLast(this.unreadMessages, this.unreadLimit);
    this.unreadMessages = [];
    return consumed;
  }

  public clearUnreadMessages(): void {
    this.unreadMessages = [];
  }

  public restoreSnapshot(input: {
    friendInfo: NapcatFriendInfo | null;
    unreadMessages: NapcatPrivateMessageData[];
    hasEntered: boolean;
  }): void {
    this.friendInfo = input.friendInfo ? structuredClone(input.friendInfo) : null;
    this.unreadMessages = takeLast(structuredClone(input.unreadMessages), this.unreadLimit);
    this.entered = input.hasEntered;
  }

  public reset(): void {
    this.friendInfo = null;
    this.unreadMessages = [];
    this.entered = false;
  }
}

function takeLast<T>(items: T[], limit: number): T[] {
  if (limit <= 0) {
    return [];
  }

  if (items.length <= limit) {
    return [...items];
  }

  return items.slice(items.length - limit);
}
