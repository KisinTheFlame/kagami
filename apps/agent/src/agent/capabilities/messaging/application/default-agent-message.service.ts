import { AppLogger } from "@kagami/kernel/logger/logger";
import type {
  NapcatChatTarget,
  NapcatGatewayService,
} from "../../../../napcat/application/napcat-gateway.service.js";
import type { AgentMessageService } from "./agent-message.service.js";
import type { GroupMuteStateStore } from "./group-mute-state.store.js";
import { MutedSendError } from "./muted-send-error.js";

const logger = new AppLogger({ source: "agent.messaging" });

/**
 * QQ 出站发送的单一咽喉点。禁言 guard 收口在这里（spec D6/D9）：send_message / send_resource
 * 两个工具、管理台 `/napcat/group/send` 直发都经此，无人再碰裸网关，因此拦截天然覆盖三条路径。
 *
 * 两段拦截：
 * 1. 发送前 `check(groupId)`：内存态明确禁言 → 直接抛 `MutedSendError`（不打 NapCat）。
 * 2. 发送失败兜底：内存态未知（如重启后丢失）而 NapCat 报错时，探一次 shut_up_timestamp——
 *    确在禁言 → 回填 self 态 + 抛 `MutedSendError`；否则原始错误照旧冒泡（probe 自身抛错也吞掉，
 *    返回原错误，spec D4）。
 */
export class DefaultAgentMessageService implements AgentMessageService {
  private readonly napcatGatewayService: NapcatGatewayService;
  private readonly muteStore: GroupMuteStateStore;
  private readonly botQQ: string;

  public constructor({
    napcatGatewayService,
    muteStore,
    botQQ,
  }: {
    napcatGatewayService: NapcatGatewayService;
    muteStore: GroupMuteStateStore;
    botQQ: string;
  }) {
    this.napcatGatewayService = napcatGatewayService;
    this.muteStore = muteStore;
    this.botQQ = botQQ;
  }

  public async sendGroupMessage(input: {
    groupId: string;
    message: string;
    replyToMessageId?: number;
  }): Promise<{ messageId: number }> {
    await this.verifyMutedOrThrow(input.groupId);
    try {
      return await this.napcatGatewayService.sendGroupMessage(input);
    } catch (error) {
      return await this.handleGroupSendFailure(input.groupId, error);
    }
  }

  public async sendPrivateMessage(input: {
    userId: string;
    message: string;
    replyToMessageId?: number;
  }): Promise<{ messageId: number }> {
    return await this.napcatGatewayService.sendPrivateMessage(input);
  }

  public async sendImage(input: {
    target: NapcatChatTarget;
    fileRef: string;
    replyToMessageId?: number;
  }): Promise<{ messageId: number }> {
    const groupId = input.target.chatType === "group" ? input.target.groupId : null;
    if (groupId) {
      await this.verifyMutedOrThrow(groupId);
    }
    try {
      return await this.napcatGatewayService.sendImage(input);
    } catch (error) {
      if (groupId) {
        return await this.handleGroupSendFailure(groupId, error);
      }
      throw error;
    }
  }

  /**
   * 内存态明确禁言时抛 MutedSendError。self（带到期时间）走惰性过期，直接拦。
   * whole（全员禁言，无 TTL）拦截前先查一次实时 groupAllShut 自愈：丢一条 lift_ban(whole)
   * 事件（WS 重连间隙、NapCat 不补发）会让本进程永久误判全员禁言、把小镜自己憋死。
   * 查到已解除就清态放行；仍在禁言（或 probe 失败，保守）才拦。self 常态不触发 probe。
   */
  private async verifyMutedOrThrow(groupId: string): Promise<void> {
    const result = this.muteStore.check(groupId);
    if (!result.muted) {
      return;
    }
    if (result.reason === "self") {
      throw new MutedSendError("self", result.untilEpochMs);
    }
    if (await this.isWholeGroupMuteStale(groupId)) {
      this.muteStore.setWholeGroupMute(groupId, false);
      return;
    }
    throw new MutedSendError("whole");
  }

  /**
   * 实时核验全员禁言态是否已陈旧（群实际已解除全员禁言）。groupAllShut=false → 陈旧 → true。
   * probe 失败时保守返回 false（不放行、照旧拦）——查不到就不冒险发进真禁言里。
   */
  private async isWholeGroupMuteStale(groupId: string): Promise<boolean> {
    try {
      const info = await this.napcatGatewayService.getGroupInfo({ groupId });
      return !info.groupAllShut;
    } catch (error) {
      logger.warn("Whole-group mute liveness probe failed; keeping block", {
        event: "agent.messaging.whole_mute_probe_failed",
        groupId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * 群消息发送失败兜底：check 已在发送前判为未禁言，失败可能是内存态未知（重启后丢失）。
   * 探一次 shut_up_timestamp——确在禁言就回填 self 态并抛 MutedSendError；否则原始错误照旧。
   * probe 自身抛错时吞掉（warn），返回原始发送错误（spec D4）。
   */
  private async handleGroupSendFailure(groupId: string, error: unknown): Promise<never> {
    let untilMs: number | null;
    try {
      untilMs = await this.napcatGatewayService.getGroupMemberShutUp({
        groupId,
        userId: this.botQQ,
      });
    } catch (probeError) {
      logger.warn("Mute probe after send failure itself failed; returning original send error", {
        event: "agent.messaging.mute_probe_failed",
        groupId,
        error: probeError instanceof Error ? probeError.message : String(probeError),
      });
      throw normalizeError(error);
    }

    if (untilMs !== null) {
      this.muteStore.setSelfMute(groupId, untilMs);
      throw new MutedSendError("self", untilMs);
    }
    throw normalizeError(error);
  }
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
