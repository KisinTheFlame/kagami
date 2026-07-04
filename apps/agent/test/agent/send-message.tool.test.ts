import { describe, expect, it, vi } from "vitest";
import { SendMessageTool } from "../../src/agent/capabilities/messaging/tools/send-message.tool.js";
import { PendingDraftStore } from "../../src/agent/capabilities/messaging/application/pending-draft.store.js";
import { MutedSendError } from "../../src/agent/capabilities/messaging/application/muted-send-error.js";
import type { NapcatChatTarget } from "@kagami/napcat-api/message";

/** chatTarget 现由 QqApp 经 getChatTarget 注入（不再走 tool 执行上下文），执行上下文置空即可。 */
const emptyContext = {} as Parameters<SendMessageTool["execute"]>[1];

function buildTool(options?: {
  score?: number;
  enabled?: boolean;
  blockThreshold?: number;
  pendingDraftStore?: PendingDraftStore;
  sendGroupMessage?: ReturnType<typeof vi.fn>;
  sendPrivateMessage?: ReturnType<typeof vi.fn>;
  getChatTarget?: () => NapcatChatTarget | undefined;
}) {
  const agentMessageService = {
    sendGroupMessage: options?.sendGroupMessage ?? vi.fn().mockResolvedValue({ messageId: 9527 }),
    sendPrivateMessage:
      options?.sendPrivateMessage ?? vi.fn().mockResolvedValue({ messageId: 9630 }),
    sendImage: vi.fn().mockResolvedValue({ messageId: 9777 }),
  };
  const aiToneScorer = { proba: vi.fn().mockReturnValue(options?.score ?? 0.1) };
  const pendingDraftStore = options?.pendingDraftStore ?? new PendingDraftStore();
  const tool = new SendMessageTool({
    agentMessageService,
    aiToneScorer: aiToneScorer as unknown as ConstructorParameters<
      typeof SendMessageTool
    >[0]["aiToneScorer"],
    pendingDraftStore,
    aiTone: {
      enabled: options?.enabled ?? true,
      blockThreshold: options?.blockThreshold ?? 0.8,
    },
    getChatTarget:
      options?.getChatTarget ?? (() => ({ chatType: "group", groupId: "987654" }) as const),
  });
  return { tool, agentMessageService, aiToneScorer, pendingDraftStore };
}

describe("send_message tool", () => {
  it("低 AI 味发言正常发送，响应回带 aiToneScore", async () => {
    const { tool, agentMessageService } = buildTool({ score: 0.1 });

    const result = await tool.execute({ message: "  hello group  " }, emptyContext);

    expect(tool.name).toBe("send_message");
    expect(agentMessageService.sendGroupMessage).toHaveBeenCalledWith({
      groupId: "987654",
      message: "hello group",
    });
    expect(JSON.parse(result.content)).toEqual({
      ok: true,
      chatType: "group",
      groupId: "987654",
      messageId: 9527,
      aiToneScore: 0.1,
    });
  });

  it("带 reply_to 时把回复目标透传给发送服务", async () => {
    const { tool, agentMessageService } = buildTool({ score: 0.1 });

    await tool.execute({ message: "收到", reply_to: 9988 }, emptyContext);

    expect(agentMessageService.sendGroupMessage).toHaveBeenCalledWith({
      groupId: "987654",
      message: "收到",
      replyToMessageId: 9988,
    });
  });

  it("被拦的引用回复经 confirm_last 补发时保留回复目标", async () => {
    const { tool, agentMessageService } = buildTool({ score: 0.9 });

    await tool.execute({ message: "这不是结束，而是开始", reply_to: 9988 }, emptyContext);
    expect(agentMessageService.sendGroupMessage).not.toHaveBeenCalled();

    await tool.execute({ confirm_last: true }, emptyContext);

    expect(agentMessageService.sendGroupMessage).toHaveBeenCalledWith({
      groupId: "987654",
      message: "这不是结束，而是开始",
      replyToMessageId: 9988,
    });
  });

  it("私聊发言正常发送", async () => {
    const { tool, agentMessageService } = buildTool({
      score: 0.2,
      getChatTarget: () => ({ chatType: "private", userId: "123456" }),
    });

    const result = await tool.execute({ message: "  hello friend  " }, emptyContext);

    expect(agentMessageService.sendPrivateMessage).toHaveBeenCalledWith({
      userId: "123456",
      message: "hello friend",
    });
    expect(JSON.parse(result.content)).toMatchObject({
      ok: true,
      chatType: "private",
      userId: "123456",
      messageId: 9630,
      aiToneScore: 0.2,
    });
  });

  it("message 为空返回参数错误", async () => {
    const { tool, agentMessageService } = buildTool();

    const result = await tool.execute({ message: "   " }, emptyContext);

    expect(agentMessageService.sendGroupMessage).not.toHaveBeenCalled();
    expect(JSON.parse(result.content)).toMatchObject({ ok: false, error: "INVALID_ARGUMENTS" });
  });

  it("缺少会话上下文返回 CHAT_CONTEXT_UNAVAILABLE", async () => {
    const { tool, agentMessageService } = buildTool({ getChatTarget: () => undefined });

    const result = await tool.execute({ message: "hello" }, emptyContext);

    expect(agentMessageService.sendGroupMessage).not.toHaveBeenCalled();
    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "CHAT_CONTEXT_UNAVAILABLE",
    });
  });

  it("AI 味超阈值则拦截不发，并存草稿", async () => {
    const { tool, agentMessageService, pendingDraftStore } = buildTool({ score: 0.9 });

    const result = await tool.execute({ message: "这不是结束，而是开始" }, emptyContext);

    expect(agentMessageService.sendGroupMessage).not.toHaveBeenCalled();
    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      blocked: true,
      aiToneScore: 0.9,
      threshold: 0.8,
    });
    expect(pendingDraftStore.peek()).toMatchObject({
      message: "这不是结束，而是开始",
      score: 0.9,
    });
  });

  it("confirm_last 补发上一条被拦草稿并清空草稿", async () => {
    const { tool, agentMessageService, pendingDraftStore } = buildTool({ score: 0.9 });

    await tool.execute({ message: "这不是结束，而是开始" }, emptyContext);
    const result = await tool.execute({ confirm_last: true }, emptyContext);

    expect(agentMessageService.sendGroupMessage).toHaveBeenCalledWith({
      groupId: "987654",
      message: "这不是结束，而是开始",
    });
    expect(JSON.parse(result.content)).toMatchObject({
      ok: true,
      confirmedResend: true,
      aiToneScore: 0.9,
    });
    expect(pendingDraftStore.peek()).toBeNull();
  });

  it("confirm_last 同时带 message 会忽略本次 message 并提示", async () => {
    const { tool, agentMessageService } = buildTool({ score: 0.9 });

    await tool.execute({ message: "这不是结束，而是开始" }, emptyContext);
    const result = await tool.execute({ confirm_last: true, message: "另一句话" }, emptyContext);

    expect(agentMessageService.sendGroupMessage).toHaveBeenLastCalledWith({
      groupId: "987654",
      message: "这不是结束，而是开始",
    });
    expect(JSON.parse(result.content)).toMatchObject({ ok: true, confirmedResend: true });
    expect(JSON.parse(result.content).note).toContain("已忽略本次 message");
  });

  it("没有待确认草稿时 confirm_last 返回 NO_PENDING_DRAFT", async () => {
    const { tool, agentMessageService } = buildTool();

    const result = await tool.execute({ confirm_last: true }, emptyContext);

    expect(agentMessageService.sendGroupMessage).not.toHaveBeenCalled();
    expect(JSON.parse(result.content)).toMatchObject({ ok: false, error: "NO_PENDING_DRAFT" });
  });

  it("补发失败保留草稿", async () => {
    const sendGroupMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue({ messageId: 1 });
    const { tool, pendingDraftStore } = buildTool({ score: 0.9, sendGroupMessage });

    await tool.execute({ message: "这不是结束，而是开始" }, emptyContext);
    const result = await tool.execute({ confirm_last: true }, emptyContext);

    expect(JSON.parse(result.content)).toMatchObject({ ok: false, error: "RESEND_FAILED" });
    expect(pendingDraftStore.peek()).not.toBeNull();
  });

  it("成功发送会清空之前的待确认草稿", async () => {
    const store = new PendingDraftStore();
    store.set({ chatTarget: { chatType: "group", groupId: "1" }, message: "旧草稿", score: 0.9 });
    const { tool } = buildTool({ score: 0.1, pendingDraftStore: store });

    await tool.execute({ message: "正常发言" }, emptyContext);

    expect(store.peek()).toBeNull();
  });

  it("enabled=false 时完全退化：不打分、不拦、响应不含 aiToneScore", async () => {
    const { tool, agentMessageService, aiToneScorer } = buildTool({
      score: 0.99,
      enabled: false,
    });

    const result = await tool.execute({ message: "这不是结束，而是开始" }, emptyContext);

    expect(aiToneScorer.proba).not.toHaveBeenCalled();
    expect(agentMessageService.sendGroupMessage).toHaveBeenCalled();
    const parsed = JSON.parse(result.content);
    expect(parsed.ok).toBe(true);
    expect(parsed.aiToneScore).toBeUndefined();
  });

  describe("禁言拦截（service 抛 MutedSendError）", () => {
    it("正常发送路径遇 MUTED：翻译成 error=MUTED + 友好 note", async () => {
      const until = new Date(2026, 6, 3, 15, 30).getTime();
      const sendGroupMessage = vi.fn().mockRejectedValue(new MutedSendError("self", until));
      const { tool } = buildTool({ score: 0.1, sendGroupMessage });

      const result = await tool.execute({ message: "在吗" }, emptyContext);

      const parsed = JSON.parse(result.content);
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toBe("MUTED");
      expect(parsed.note).toContain("正被禁言");
      expect(parsed.note).toContain("才能说话");
    });

    it("confirm_last 遇 MUTED：保留草稿并返回 MUTED（非 RESEND_FAILED）", async () => {
      const sendGroupMessage = vi.fn().mockRejectedValue(new MutedSendError("whole"));
      const { tool, pendingDraftStore } = buildTool({ score: 0.9, sendGroupMessage });

      await tool.execute({ message: "这不是结束，而是开始" }, emptyContext); // 被 AI 味拦，存草稿
      const result = await tool.execute({ confirm_last: true }, emptyContext);

      const parsed = JSON.parse(result.content);
      expect(parsed.error).toBe("MUTED");
      expect(parsed.note).toContain("全员禁言");
      // 草稿保留：解禁后还能 confirm_last 补发。
      expect(pendingDraftStore.peek()).not.toBeNull();
    });
  });
});
