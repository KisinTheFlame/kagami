import { describe, expect, it, vi } from "vitest";
import { DefaultAgentMessageService } from "../../src/agent/capabilities/messaging/application/default-agent-message.service.js";
import { GroupMuteStateStore } from "../../src/agent/capabilities/messaging/application/group-mute-state.store.js";
import { MutedSendError } from "../../src/agent/capabilities/messaging/application/muted-send-error.js";
import type { NapcatGatewayService } from "../../src/napcat/application/napcat-gateway.service.js";
import { initTestLoggerRuntime } from "../helpers/logger.js";

initTestLoggerRuntime();

function build(options?: {
  sendGroupMessage?: ReturnType<typeof vi.fn>;
  getGroupMemberShutUp?: ReturnType<typeof vi.fn>;
  getGroupInfo?: ReturnType<typeof vi.fn>;
  now?: () => number;
}) {
  const gateway = {
    sendGroupMessage: options?.sendGroupMessage ?? vi.fn().mockResolvedValue({ messageId: 1 }),
    sendPrivateMessage: vi.fn().mockResolvedValue({ messageId: 2 }),
    sendImage: vi.fn().mockResolvedValue({ messageId: 3 }),
    getGroupMemberShutUp: options?.getGroupMemberShutUp ?? vi.fn().mockResolvedValue(null),
    // 默认 groupAllShut=true：whole 拦截 probe 到「仍在全员禁言」，维持拦截语义。
    getGroupInfo:
      options?.getGroupInfo ?? vi.fn().mockResolvedValue({ groupId: "g1", groupAllShut: true }),
  } as unknown as NapcatGatewayService & {
    sendGroupMessage: ReturnType<typeof vi.fn>;
    getGroupMemberShutUp: ReturnType<typeof vi.fn>;
    getGroupInfo: ReturnType<typeof vi.fn>;
    sendImage: ReturnType<typeof vi.fn>;
  };
  const muteStore = new GroupMuteStateStore({ now: options?.now ?? (() => 1_000_000) });
  const service = new DefaultAgentMessageService({
    napcatGatewayService: gateway,
    muteStore,
    botQQ: "10001",
  });
  return { service, gateway, muteStore };
}

describe("DefaultAgentMessageService 禁言 guard", () => {
  it("内存态 self 禁言：前置拦截，抛 MutedSendError，不打网关", async () => {
    const { service, gateway, muteStore } = build();
    muteStore.setSelfMute("g1", 2_000_000);
    await expect(service.sendGroupMessage({ groupId: "g1", message: "hi" })).rejects.toMatchObject({
      name: "MutedSendError",
      reason: "self",
      untilEpochMs: 2_000_000,
    });
    expect(gateway.sendGroupMessage).not.toHaveBeenCalled();
  });

  it("内存态全员禁言 + 实时仍在禁言：前置拦截 reason=whole", async () => {
    const { service, muteStore } = build();
    muteStore.setWholeGroupMute("g1", true);
    await expect(service.sendGroupMessage({ groupId: "g1", message: "hi" })).rejects.toMatchObject({
      reason: "whole",
    });
  });

  it("全员禁言态陈旧（实时 groupAllShut=false）：自愈清态并放行发送", async () => {
    const getGroupInfo = vi.fn().mockResolvedValue({ groupId: "g1", groupAllShut: false });
    const { service, gateway, muteStore } = build({ getGroupInfo });
    muteStore.setWholeGroupMute("g1", true); // 丢了 lift_ban(whole) 的陈旧态
    await expect(service.sendGroupMessage({ groupId: "g1", message: "hi" })).resolves.toEqual({
      messageId: 1,
    });
    expect(getGroupInfo).toHaveBeenCalledWith({ groupId: "g1" });
    expect(gateway.sendGroupMessage).toHaveBeenCalled();
    // 态已清：后续 check 不再误判。
    expect(muteStore.check("g1")).toEqual({ muted: false });
  });

  it("全员禁言态 + liveness probe 失败：保守维持拦截", async () => {
    const getGroupInfo = vi.fn().mockRejectedValue(new Error("group info down"));
    const { service, muteStore } = build({ getGroupInfo });
    muteStore.setWholeGroupMute("g1", true);
    await expect(service.sendGroupMessage({ groupId: "g1", message: "hi" })).rejects.toMatchObject({
      reason: "whole",
    });
  });

  it("未禁言：正常发送", async () => {
    const { service } = build();
    await expect(service.sendGroupMessage({ groupId: "g1", message: "hi" })).resolves.toEqual({
      messageId: 1,
    });
  });

  it("发送失败 + 兜底探到禁言：回填 self 态并抛 MutedSendError，后续前置拦截", async () => {
    const sendGroupMessage = vi.fn().mockRejectedValue(new Error("napcat boom"));
    const getGroupMemberShutUp = vi.fn().mockResolvedValue(3_000_000);
    const { service, muteStore } = build({ sendGroupMessage, getGroupMemberShutUp });
    await expect(service.sendGroupMessage({ groupId: "g1", message: "hi" })).rejects.toBeInstanceOf(
      MutedSendError,
    );
    expect(getGroupMemberShutUp).toHaveBeenCalledWith({ groupId: "g1", userId: "10001" });
    // 状态已回填：再发直接前置拦，不再打网关。
    expect(muteStore.check("g1")).toMatchObject({ muted: true, reason: "self" });
    sendGroupMessage.mockClear();
    await expect(
      service.sendGroupMessage({ groupId: "g1", message: "again" }),
    ).rejects.toBeInstanceOf(MutedSendError);
    expect(sendGroupMessage).not.toHaveBeenCalled();
  });

  it("发送失败 + 探测未禁言：原始错误透传", async () => {
    const sendGroupMessage = vi.fn().mockRejectedValue(new Error("napcat boom"));
    const getGroupMemberShutUp = vi.fn().mockResolvedValue(null);
    const { service } = build({ sendGroupMessage, getGroupMemberShutUp });
    await expect(service.sendGroupMessage({ groupId: "g1", message: "hi" })).rejects.toThrow(
      "napcat boom",
    );
  });

  it("发送失败 + 探测自身抛错：吞掉探测错误，返回原始发送错误", async () => {
    const sendGroupMessage = vi.fn().mockRejectedValue(new Error("napcat boom"));
    const getGroupMemberShutUp = vi.fn().mockRejectedValue(new Error("probe boom"));
    const { service } = build({ sendGroupMessage, getGroupMemberShutUp });
    await expect(service.sendGroupMessage({ groupId: "g1", message: "hi" })).rejects.toThrow(
      "napcat boom",
    );
  });

  it("sendImage 群目标同样前置拦截；私聊目标不拦", async () => {
    const { service, gateway, muteStore } = build();
    muteStore.setSelfMute("g1", 2_000_000);
    await expect(
      service.sendImage({ target: { chatType: "group", groupId: "g1" }, fileRef: "base64://x" }),
    ).rejects.toBeInstanceOf(MutedSendError);
    // 私聊不受禁言影响。
    await expect(
      service.sendImage({ target: { chatType: "private", userId: "888" }, fileRef: "base64://x" }),
    ).resolves.toEqual({ messageId: 3 });
    expect(gateway.sendImage).toHaveBeenCalledTimes(1);
  });
});
