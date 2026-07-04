import { describe, expect, it } from "vitest";
import {
  buildChatNotificationPreview,
  buildNoticePreview,
  ChatNotificationDraft,
  detectBotMentioned,
} from "../../src/agent/capabilities/messaging/chat-notification-draft.js";
import type { NapcatGroupMessageData } from "@kagami/napcat-api/message";
import type { NapcatReceiveMessageSegment } from "@kagami/napcat-api/segment";

function groupMessage(text: string, nickname = "群友"): NapcatGroupMessageData {
  return {
    groupId: "1",
    userId: "654321",
    nickname,
    rawMessage: text,
    messageSegments: [{ type: "text", data: { text } } as NapcatReceiveMessageSegment],
    messageId: 1,
    time: 1,
  };
}

describe("ChatNotificationDraft", () => {
  it("belongs to the QQ group", () => {
    expect(new ChatNotificationDraft("qq_group:1", "产品群", false, 1).group).toBe("QQ");
  });

  it("falls back to 有新消息 without tags and without preview", () => {
    expect(new ChatNotificationDraft("qq_group:1", "产品群", false, 1).render()).toBe(
      "产品群: 有新消息",
    );
  });

  it("shows only the mention tag for a single @ message", () => {
    expect(new ChatNotificationDraft("qq_group:1", "产品群", true, 1).render()).toBe(
      "产品群: [有人 @ 你]",
    );
  });

  it("shows the count tag when >1, capping at 99+", () => {
    expect(new ChatNotificationDraft("qq_group:1", "群", false, 2).render()).toBe("群: [2 条消息]");
    expect(new ChatNotificationDraft("qq_group:1", "群", false, 150).render()).toBe(
      "群: [99+ 条消息]",
    );
  });

  it("orders count tag before mention tag", () => {
    expect(new ChatNotificationDraft("qq_group:1", "程序喵", true, 150).render()).toBe(
      "程序喵: [99+ 条消息][有人 @ 你]",
    );
  });

  it("renders the latest-message preview with sender for group chats", () => {
    const draft = new ChatNotificationDraft("qq_group:1", "产品群", false, 3, {
      senderName: "群友",
      text: "今晚开黑吗",
    });
    expect(draft.render()).toBe("产品群: [3 条消息] 群友: 今晚开黑吗");
  });

  it("renders the preview without sender for private chats", () => {
    const draft = new ChatNotificationDraft("qq_private:654321", "老王", false, 1, {
      senderName: null,
      text: "在吗",
    });
    expect(draft.render()).toBe("老王: 在吗");
  });

  it("keeps tags and preview together, tags first", () => {
    const draft = new ChatNotificationDraft("qq_group:1", "产品群", true, 5, {
      senderName: "群友",
      text: "小镜快来",
    });
    expect(draft.render()).toBe("产品群: [5 条消息][有人 @ 你] 群友: 小镜快来");
  });

  it("merge(prev) takes the latest snapshot (count is authoritative, not accumulated)", () => {
    // 未读计数 / @ 标记 / 预览的权威来源是 Conversation，新 draft 已带全量快照；过期 prev 被丢弃。
    const older = new ChatNotificationDraft("qq_group:1", "群", true, 1); // 旧快照：@ 过、count 1
    const newer = new ChatNotificationDraft("qq_group:1", "群", false, 5); // 新快照：count 5、未 @
    expect(newer.merge(older).render()).toBe("群: [5 条消息]");
  });
});

describe("buildChatNotificationPreview", () => {
  it("uses the sender nickname for group messages and none for private ones", () => {
    expect(buildChatNotificationPreview(groupMessage("在吗"), "group")).toEqual({
      senderName: "群友",
      text: "在吗",
    });
    expect(buildChatNotificationPreview(groupMessage("在吗"), "private")).toEqual({
      senderName: null,
      text: "在吗",
    });
  });

  it("falls back to userId when the group nickname is blank", () => {
    expect(buildChatNotificationPreview(groupMessage("在吗", "  "), "group")).toEqual({
      senderName: "654321",
      text: "在吗",
    });
  });

  it("collapses whitespace and truncates long bodies", () => {
    const preview = buildChatNotificationPreview(groupMessage("第一行\n  第二行"), "group");
    expect(preview?.text).toBe("第一行 第二行");

    const long = buildChatNotificationPreview(groupMessage("啊".repeat(60)), "group");
    expect(long?.text).toBe("啊".repeat(50) + "…");
  });

  // napcat 拆分后（issue #347），非文本段的占位/描述由 napcat 渲进 rawMessage（含 vision）；
  // agent 侧预览直接用 rawMessage。这里验证 rawMessage 里的图片占位透传。
  it("passes through napcat-rendered placeholders from rawMessage", () => {
    const message: NapcatGroupMessageData = {
      ...groupMessage("[图片: 一只橘猫, resid: res-5]"),
    };
    expect(buildChatNotificationPreview(message, "group")?.text).toBe(
      "[图片: 一只橘猫, resid: res-5]",
    );
  });

  it("returns null when the body renders empty", () => {
    const message: NapcatGroupMessageData = { ...groupMessage("   "), messageSegments: [] };
    expect(buildChatNotificationPreview(message, "group")).toBeNull();
  });
});

describe("buildNoticePreview", () => {
  it("notice 预览无 senderName，正文折叠为单行", () => {
    expect(buildNoticePreview("你被 张三(10001) 禁言了 10 分钟")).toEqual({
      senderName: null,
      text: "你被 张三(10001) 禁言了 10 分钟",
    });
  });

  it("超长正文按 50 码点截断", () => {
    const preview = buildNoticePreview("啊".repeat(80));
    expect(preview?.senderName).toBeNull();
    expect(preview?.text).toBe("啊".repeat(50) + "…");
  });

  it("空正文返回 null", () => {
    expect(buildNoticePreview("   ")).toBeNull();
  });
});

describe("detectBotMentioned", () => {
  const atSeg = (qq: string): NapcatReceiveMessageSegment =>
    ({ type: "at", data: { qq } }) as NapcatReceiveMessageSegment;
  const textSeg = (text: string): NapcatReceiveMessageSegment =>
    ({ type: "text", data: { text } }) as NapcatReceiveMessageSegment;

  it("is true when an at-segment targets the bot", () => {
    expect(detectBotMentioned([textSeg("hi"), atSeg("10001")], "10001")).toBe(true);
  });

  it("is false when no at-segment targets the bot", () => {
    expect(detectBotMentioned([textSeg("hi"), atSeg("99999")], "10001")).toBe(false);
    expect(detectBotMentioned([textSeg("hi")], "10001")).toBe(false);
  });
});
