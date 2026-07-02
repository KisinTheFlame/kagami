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
 * 内容缓冲条目。`countsAsUnread = false` 的是回声（小镜自己发的消息，见 pushEcho）：
 * 占缓冲位可被渲染，但不计未读——退化补推 / 红点持久化都只看真实未读。
 * `mentioned` 记录该条是否 @ 了小镜，供 reconcileUnreadWithBuffer 精确重算（sticky
 * 粘滞标记覆盖不了「溢出被挤掉的 @」，逐条记录才能在对账时不多不少）。
 */
type UnreadEntry = {
  readonly message: ConversationMessage;
  readonly countsAsUnread: boolean;
  readonly mentioned: boolean;
};

/**
 * 一个 QQ 会话（群或私聊）。QQ App 持有这些，取代旧状态树的 GroupChatState /
 * PrivateChatState（逻辑照搬）。持未读消息 + 元信息 + 是否进过。
 *
 * 消费语义（前台实时投递 / open 补看 / 未读计数三路共用，杜绝重复展示）：
 * - `consumeUnreadTail()`：全量消费——取缓冲尾、清空缓冲与计数、清 @ 粘滞标记。
 * - `takeUnreadSnapshot()` + `dropUnreadInstances()` / `dropUnreadIn()` +
 *   `reconcileUnreadWithBuffer()`：部分消费 + 对账——供 fetch 窗口纪律使用（消费动作
 *   只发生在 fetch 成功路径上）；部分剔除**不动** @ 粘滞标记（保守语义），对账时按
 *   缓冲逐条精确重算。
 * - 总纪律：游标推进不得跨 await 引用陈旧读数；剔除按对象引用不按位置（缓冲位移免疫）。
 */
export class Conversation {
  public readonly id: ConversationId;
  private readonly meta: GroupMeta | PrivateMeta;
  private readonly unreadLimit: number;
  /** 内容缓冲，封顶 unreadLimit（只为渲染最近几条）。含回声条目（不计未读）。 */
  private unread: UnreadEntry[] = [];
  /**
   * 未读条数：**不封顶**的真实计数，权威来源在 QQ App 这里。小镜不来看它就一直涨——
   * 通知里显示的就是这个，而不是某个 30s 窗口内的临时计数。消费点见类级「消费语义」
   * 注释：全量消费（consumeUnreadTail）清零；部分消费（dropUnread* / reconcile）等额
   * 扣减或按缓冲对账。
   */
  private unreadCount = 0;
  /**
   * 未读里是否有人 @ 过小镜：出现一次就粘住（缓冲封顶会挤掉早期消息，粘滞标记保住
   * 「曾被 @」的事实）。全量消费清零；部分剔除保守不动；首开会话 fetch 对账时按缓冲
   * 逐条精确重算。
   */
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

  /**
   * @ 事实是否只存在于缓冲之外（带 @ 的消息已被封顶挤出，粘滞标记还记得）。
   * 前台 drain 只展示缓冲内容，若不带出这个信号，被挤掉的「有人 @ 你」就从所有
   * 输出里消失了——后台通知路径的 draft 反而带得出来。
   */
  public hasMentionOutsideBuffer(): boolean {
    return this.unreadHasMention && !this.unread.some(entry => entry.mentioned);
  }

  public hasEntered(): boolean {
    return this.entered;
  }

  /**
   * 缓冲里最新的一条**真实未读**（跳过回声）：通知预览用——预览渲染的是「别人最新说了
   * 什么」，小镜自己的回声不算。缓冲空（如 restoreUnread 恢复的裸计数）时返回 null。
   */
  public getLatestUnread(): ConversationMessage | null {
    for (let i = this.unread.length - 1; i >= 0; i--) {
      const entry = this.unread[i];
      if (entry.countsAsUnread) {
        return entry.message;
      }
    }
    return null;
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
    this.unread.push({ message, countsAsUnread: true, mentioned });
    this.unread = takeLast(this.unread, this.unreadLimit);
    // 计数与 @ 标记独立于封顶缓冲：缓冲只留最近几条内容，计数据实累积。
    this.unreadCount += 1;
    this.unreadHasMention ||= mentioned;
  }

  /**
   * 回声：小镜自己发的消息。只入内容缓冲（前台实时投递时随增量一起可见，像看到自己的
   * 消息上屏），不计未读、不动 @——退化补推与红点持久化都不会把自己的回声做成通知。
   * 副作用：回声占缓冲位，olderUnread 差额提示可能略偏小，可接受。
   */
  public pushEcho(message: ConversationMessage): void {
    this.unread.push({ message, countsAsUnread: false, mentioned: false });
    this.unread = takeLast(this.unread, this.unreadLimit);
  }

  /** 进入会话：取未读尾、清空未读（含计数 + @ 标记）。没进过时调用方会另外拉历史。 */
  public consumeUnreadTail(): ConversationMessage[] {
    const consumed = takeLast(this.unread, this.unreadLimit).map(entry => entry.message);
    this.resetUnread();
    return consumed;
  }

  /**
   * 只读快照：当前缓冲的全部条目（含回声），不消费。fetch 窗口纪律的第一步——
   * 在发起 await 前记录，成功后用 `dropUnreadInstances(快照)` 按引用精确清掉这一段。
   */
  public takeUnreadSnapshot(): readonly ConversationMessage[] {
    return this.unread.map(entry => entry.message);
  }

  /**
   * 按消息**对象引用**剔除快照中的条目，并按其中真实未读的条数等额减计数。
   * 不动 @ 粘滞标记（部分消费的保守语义）。
   *
   * 为什么按引用不按位置：缓冲封顶，快照后的 await 窗口内新消息 push 会把头部挤掉
   * （缓冲位移），按「位置/数量」剔除会误伤 await 期间的新消息——内容永不展示、计数
   * 却被扣掉。按引用剔除对位移免疫：快照条目还在就剔、已被挤掉就跳过（其残留计数由
   * reconcileUnreadWithBuffer 对账）。
   */
  public dropUnreadInstances(messages: readonly ConversationMessage[]): void {
    const instances = new Set<ConversationMessage>(messages);
    const dropped: UnreadEntry[] = [];
    this.unread = this.unread.filter(entry => {
      if (instances.has(entry.message)) {
        dropped.push(entry);
        return false;
      }
      return true;
    });
    this.decrementUnreadCount(dropped);
  }

  /**
   * 按 messageId 剔除缓冲中已在别处展示过的消息（如 fetch 拉回的历史里已包含的），
   * 并按其中真实未读的条数等额减计数。`messageId === null` 的消息不参与匹配、保守
   * 保留（宁可极低概率重复一条，不丢）。不动 @ 粘滞标记。
   */
  public dropUnreadIn(messageIds: Set<number>): void {
    const dropped: UnreadEntry[] = [];
    this.unread = this.unread.filter(entry => {
      const { messageId } = entry.message;
      if (messageId !== null && messageIds.has(messageId)) {
        dropped.push(entry);
        return false;
      }
      return true;
    });
    this.decrementUnreadCount(dropped);
  }

  /**
   * 按缓冲对账：把计数与 @ 标记重算为缓冲内条目的真实值。首开会话 fetch 成功后调用——
   * 溢出缓冲被挤掉的旧未读（含 restoreUnread 恢复的无缓冲裸计数）已被拉回的历史覆盖，
   * 若不对账会残留幻影计数：列表假红点、敲门空转、每次 blur/切会话反复补推假通知。
   * @ 按缓冲逐条重算（粘滞标记可能来自已被覆盖的溢出消息，此刻以缓冲为准）。
   */
  public reconcileUnreadWithBuffer(): void {
    this.unreadCount = this.unread.filter(entry => entry.countsAsUnread).length;
    this.unreadHasMention = this.unread.some(entry => entry.mentioned);
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

  private decrementUnreadCount(dropped: readonly UnreadEntry[]): void {
    const counted = dropped.filter(entry => entry.countsAsUnread).length;
    this.unreadCount = Math.max(0, this.unreadCount - counted);
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
