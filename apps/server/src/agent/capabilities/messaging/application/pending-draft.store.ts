import type { NapcatChatTarget } from "../../../../napcat/service/napcat-gateway.service.js";

/** 一条因 AI 味过高被拦下、等待用户二次确认的发言草稿。 */
export interface PendingDraft {
  /** 被拦时所在会话的快照；confirm_last 补发时按此目标原样发送。 */
  readonly chatTarget: NapcatChatTarget;
  /** 被拦下的原始文本。 */
  readonly message: string;
  /** 被拦时算出的 AI 味分数；confirm_last 补发时回带此原始分（不重新打分）。 */
  readonly score: number;
  /** 被拦时的回复目标 message_id（若这条是引用回复）；confirm_last 补发时原样带上。 */
  readonly replyToMessageId?: number;
}

/**
 * 全局单一草稿持有者。
 *
 * 全局只记最近一次被拦的草稿：连续被拦时新草稿覆盖旧草稿；任意一次成功发送即清空。
 * 纯运行时态，不进 snapshot——server 重启即丢，重启后 confirm_last 会得到「无草稿」反馈。
 */
export class PendingDraftStore {
  private draft: PendingDraft | null = null;

  public set(draft: PendingDraft): void {
    this.draft = draft;
  }

  public peek(): PendingDraft | null {
    return this.draft;
  }

  public clear(): void {
    this.draft = null;
  }
}
