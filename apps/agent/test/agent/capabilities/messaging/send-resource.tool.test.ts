import { describe, expect, it, vi } from "vitest";
import { BizError } from "@kagami/server-core/common/errors/biz-error";
import { SendResourceTool } from "../../../../src/agent/capabilities/messaging/tools/send-resource.tool.js";
import type { ResourceService } from "../../../../src/agent/capabilities/resource/application/resource.service.js";
import type { AgentMessageService } from "../../../../src/agent/capabilities/messaging/application/agent-message.service.js";
import type { NapcatChatTarget } from "../../../../src/napcat/application/napcat-gateway.service.js";

const GROUP_TARGET: NapcatChatTarget = { chatType: "group", groupId: "123" };

function build(opts: {
  resolve: ResourceService["resolve"];
  sendImage?: AgentMessageService["sendImage"];
}) {
  const sendImage = opts.sendImage ?? vi.fn().mockResolvedValue({ messageId: 555 });
  const tool = new SendResourceTool({
    resourceService: { resolve: opts.resolve } as unknown as ResourceService,
    agentMessageService: { sendImage } as unknown as AgentMessageService,
  });
  return { tool, sendImage };
}

describe("SendResourceTool", () => {
  it("errors when there is no open conversation", async () => {
    const { tool, sendImage } = build({ resolve: vi.fn() });
    const result = await tool.execute({ resid: "res-1" }, {});
    expect(JSON.parse(result.content).error).toBe("CHAT_CONTEXT_UNAVAILABLE");
    expect(sendImage).not.toHaveBeenCalled();
  });

  it("refuses non-image resources", async () => {
    const { tool, sendImage } = build({
      resolve: vi.fn().mockResolvedValue({
        resId: "res-2",
        bytes: Buffer.from("%PDF"),
        mimeType: "application/pdf",
        size: 4,
        isImage: false,
      }),
    });
    const result = await tool.execute({ resid: "res-2" }, { chatTarget: GROUP_TARGET } as never);
    expect(JSON.parse(result.content)).toMatchObject({
      error: "NON_IMAGE_RESOURCE",
      mime: "application/pdf",
    });
    expect(sendImage).not.toHaveBeenCalled();
  });

  it("surfaces OSS errors without sending", async () => {
    const { tool, sendImage } = build({
      resolve: vi.fn().mockRejectedValue(
        new BizError({
          message: "OSS 对象不存在：res-404",
          meta: { reason: "OSS_OBJECT_NOT_FOUND" },
        }),
      ),
    });
    const result = await tool.execute({ resid: "res-404" }, { chatTarget: GROUP_TARGET } as never);
    expect(JSON.parse(result.content).error).toBe("OSS_OBJECT_NOT_FOUND");
    expect(sendImage).not.toHaveBeenCalled();
  });

  it("sends an image as base64://, mapping caption→summary and reply_to→reply", async () => {
    const { tool, sendImage } = build({
      resolve: vi.fn().mockResolvedValue({
        resId: "res-7",
        bytes: Buffer.from("imgbytes"),
        mimeType: "image/jpeg",
        size: 8,
        isImage: true,
      }),
    });
    const result = await tool.execute({ resid: "res-7", caption: "看这个", reply_to: 42 }, {
      chatTarget: GROUP_TARGET,
    } as never);

    expect(sendImage).toHaveBeenCalledWith({
      target: GROUP_TARGET,
      fileRef: `base64://${Buffer.from("imgbytes").toString("base64")}`,
      summary: "看这个",
      replyToMessageId: 42,
    });
    expect(JSON.parse(result.content)).toMatchObject({ ok: true, resid: "res-7", messageId: 555 });
  });
});
