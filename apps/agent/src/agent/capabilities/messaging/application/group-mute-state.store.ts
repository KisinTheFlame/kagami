/**
 * 群禁言状态（纯内存，无定时器，check 时惰性过期）。
 *
 * 两维**独立存取**：
 * - self：小镜自己被禁言，带到期毫秒时间戳（`Date.now() + duration*1000`，或事件 time 基准）。
 * - whole：全员禁言开关（无到期，靠 lift_ban 事件 / onStartup groupAllShut 同步翻回）。
 *
 * 组合语义（spec D8②）：同时为真时 `check` 优先报 `reason: "self"`（含到期时间，信息更多）；
 * lift(self) 不清 whole、lift(whole) 不清 self、惰性过期只清 self。这是「外部世界状态」——
 * 不参与 resetContext / 上下文压缩的任何状态重置（spec D3），唯一失效途径 = lift_ban 事件 /
 * self 惰性过期 / groupAllShut 同步。
 *
 * `now` 注入便于单测免真实时钟（spec Step0）。
 */
export type GroupMuteCheck =
  | { muted: false }
  | { muted: true; reason: "self"; untilEpochMs: number }
  | { muted: true; reason: "whole" };

export class GroupMuteStateStore {
  private readonly selfMuteUntilByGroup = new Map<string, number>();
  private readonly wholeMuteGroups = new Set<string>();
  private readonly now: () => number;

  public constructor({ now = () => Date.now() }: { now?: () => number } = {}) {
    this.now = now;
  }

  /** 小镜自己被禁言到 `untilEpochMs`（毫秒）。到期时间不在未来则等价于清除。 */
  public setSelfMute(groupId: string, untilEpochMs: number): void {
    if (untilEpochMs > this.now()) {
      this.selfMuteUntilByGroup.set(groupId, untilEpochMs);
    } else {
      this.selfMuteUntilByGroup.delete(groupId);
    }
  }

  /** 小镜自己被解禁。 */
  public clearSelfMute(groupId: string): void {
    this.selfMuteUntilByGroup.delete(groupId);
  }

  /** 全员禁言开 / 关。 */
  public setWholeGroupMute(groupId: string, on: boolean): void {
    if (on) {
      this.wholeMuteGroups.add(groupId);
    } else {
      this.wholeMuteGroups.delete(groupId);
    }
  }

  /**
   * 查该群当前是否禁着小镜的嘴。self 优先（信息更多，带到期时间）；self 已过期就惰性清除
   * 再看 whole。两者都无 → 未禁言。
   */
  public check(groupId: string): GroupMuteCheck {
    const selfUntil = this.selfMuteUntilByGroup.get(groupId);
    if (selfUntil !== undefined) {
      if (selfUntil > this.now()) {
        return { muted: true, reason: "self", untilEpochMs: selfUntil };
      }
      this.selfMuteUntilByGroup.delete(groupId);
    }
    if (this.wholeMuteGroups.has(groupId)) {
      return { muted: true, reason: "whole" };
    }
    return { muted: false };
  }
}
