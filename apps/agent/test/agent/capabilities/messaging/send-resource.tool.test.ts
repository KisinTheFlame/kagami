import { describe, expect, it, vi } from "vitest";
import { BizError } from "@kagami/kernel/errors/biz-error";
import { MutedSendError } from "../../../../src/agent/capabilities/messaging/application/muted-send-error.js";
import { SendResourceTool } from "../../../../src/agent/capabilities/messaging/tools/send-resource.tool.js";
import type { ResourceService } from "../../../../src/agent/capabilities/resource/application/resource.service.js";
import type { AgentMessageService } from "../../../../src/agent/capabilities/messaging/application/agent-message.service.js";
import type { NapcatChatTarget } from "@kagami/napcat-api/message";

const GROUP_TARGET: NapcatChatTarget = { chatType: "group", groupId: "123" };

function build(opts: {
  resolve: ResourceService["resolve"];
  // 发送目标来自持有该工具的 QqApp 当前会话（实时回调）；undefined = 没有打开的会话。
  chatTarget?: NapcatChatTarget;
  sendImage?: AgentMessageService["sendImage"];
}) {
  const sendImage = opts.sendImage ?? vi.fn().mockResolvedValue({ messageId: 555 });
  const tool = new SendResourceTool({
    resourceService: { resolve: opts.resolve } as unknown as ResourceService,
    agentMessageService: { sendImage } as unknown as AgentMessageService,
    getChatTarget: () => opts.chatTarget,
  });
  return { tool, sendImage };
}

describe("SendResourceTool", () => {
  it("errors when there is no open conversation", async () => {
    const { tool, sendImage } = build({ resolve: vi.fn() });
    const result = await tool.execute({ resid: "res-1" }, {});
    const parsed = JSON.parse(result.content);
    expect(parsed.error).toBe("CHAT_CONTEXT_UNAVAILABLE");
    // 文案由子工具自带（字段名为 message，非旧的 note），InvokeTool 不再替它合成。
    expect(parsed.message).toBe("当前没有打开的会话，先用 open_conversation 打开一个会话再发。");
    expect(sendImage).not.toHaveBeenCalled();
  });

  it("refuses non-image resources", async () => {
    const { tool, sendImage } = build({
      chatTarget: GROUP_TARGET,
      resolve: vi.fn().mockResolvedValue({
        resId: "res-2",
        bytes: Buffer.from("%PDF"),
        mimeType: "application/pdf",
        size: 4,
        isImage: false,
      }),
    });
    const result = await tool.execute({ resid: "res-2" }, {});
    expect(JSON.parse(result.content)).toMatchObject({
      error: "NON_IMAGE_RESOURCE",
      mime: "application/pdf",
    });
    expect(sendImage).not.toHaveBeenCalled();
  });

  it("surfaces OSS errors without sending", async () => {
    const { tool, sendImage } = build({
      chatTarget: GROUP_TARGET,
      resolve: vi.fn().mockRejectedValue(
        new BizError({
          message: "OSS 对象不存在：res-404",
          meta: { reason: "OSS_OBJECT_NOT_FOUND" },
        }),
      ),
    });
    const result = await tool.execute({ resid: "res-404" }, {});
    expect(JSON.parse(result.content).error).toBe("OSS_OBJECT_NOT_FOUND");
    expect(sendImage).not.toHaveBeenCalled();
  });

  it("sends an image as base64://, mapping reply_to→reply", async () => {
    const { tool, sendImage } = build({
      chatTarget: GROUP_TARGET,
      resolve: vi.fn().mockResolvedValue({
        resId: "res-7",
        bytes: Buffer.from("imgbytes"),
        mimeType: "image/jpeg",
        size: 8,
        isImage: true,
      }),
    });
    const result = await tool.execute({ resid: "res-7", reply_to: 42 }, {});

    expect(sendImage).toHaveBeenCalledWith({
      target: GROUP_TARGET,
      fileRef: `base64://${Buffer.from("imgbytes").toString("base64")}`,
      replyToMessageId: 42,
    });
    expect(JSON.parse(result.content)).toMatchObject({ ok: true, resid: "res-7", messageId: 555 });
  });

  // 回归：发送目标必须取自实时 getChatTarget()（持有工具的 QqApp 当前会话），
  // 绝不读 ToolContext —— 主 Agent 每轮的 toolContext 不再携带 chatTarget（QQ 私有概念，
  // 不经 session），早期写法读 context.chatTarget 会恒为 undefined、send_resource 永远报
  // "没有打开的会话"。这里特意往 context 塞一个会误导的 chatTarget，断言工具忽略它、用回调值。
  it("reads the live chat target from the callback, ignoring any ToolContext.chatTarget", async () => {
    const MISLEADING_CONTEXT_TARGET: NapcatChatTarget = { chatType: "private", userId: "999" };
    const { tool, sendImage } = build({
      chatTarget: GROUP_TARGET,
      resolve: vi.fn().mockResolvedValue({
        resId: "res-9",
        bytes: Buffer.from("img"),
        mimeType: "image/png",
        size: 3,
        isImage: true,
      }),
    });

    const result = await tool.execute({ resid: "res-9" }, {
      chatTarget: MISLEADING_CONTEXT_TARGET,
    } as never);

    expect(JSON.parse(result.content)).toMatchObject({ ok: true, resid: "res-9" });
    expect(sendImage).toHaveBeenCalledTimes(1);
    expect(sendImage).toHaveBeenCalledWith(expect.objectContaining({ target: GROUP_TARGET }));
  });

  it("发图遇 MutedSendError：翻译成 error=MUTED（带 resid + 友好 note）", async () => {
    const { tool } = build({
      chatTarget: GROUP_TARGET,
      resolve: vi.fn().mockResolvedValue({
        resId: "res-1",
        bytes: Buffer.from("img"),
        mimeType: "image/png",
        size: 3,
        isImage: true,
      }),
      sendImage: vi.fn().mockRejectedValue(new MutedSendError("whole")),
    });
    const result = await tool.execute({ resid: "res-1" }, {});
    const parsed = JSON.parse(result.content);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("MUTED");
    expect(parsed.resid).toBe("res-1");
    expect(parsed.note).toContain("全员禁言");
  });
});
