import type {
  NapcatGetGroupInfoResult,
  NapcatGroupMessageData,
} from "../../../../napcat/service/napcat-gateway.service.js";

type GroupChatStateOptions = {
  groupId: string;
  unreadLimit: number;
};

export class GroupChatState {
  public readonly groupId: string;
  public groupInfo: NapcatGetGroupInfoResult | null = null;
  private readonly unreadLimit: number;
  private unreadMessages: NapcatGroupMessageData[] = [];
  private entered = false;

  public constructor({ groupId, unreadLimit }: GroupChatStateOptions) {
    this.groupId = groupId;
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

  public setGroupInfo(groupInfo: NapcatGetGroupInfoResult): void {
    this.groupInfo = groupInfo;
  }

  public getGroupName(): string | null {
    return this.groupInfo?.groupName?.trim() || null;
  }

  public pushUnreadMessage(message: NapcatGroupMessageData): void {
    this.unreadMessages.push(message);
    this.unreadMessages = takeLast(this.unreadMessages, this.unreadLimit);
  }

  public consumeUnreadTail(): NapcatGroupMessageData[] {
    const consumed = takeLast(this.unreadMessages, this.unreadLimit);
    this.unreadMessages = [];
    return consumed;
  }

  public clearUnreadMessages(): void {
    this.unreadMessages = [];
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
