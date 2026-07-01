import { describe, expect, it } from "vitest";
import {
  ChatNotificationDraft,
  detectBotMentioned,
} from "../../src/agent/capabilities/messaging/chat-notification-draft.js";
import type { NapcatReceiveMessageSegment } from "../../src/napcat/application/napcat-gateway/shared.js";

describe("ChatNotificationDraft", () => {
  it("belongs to the QQ group", () => {
    expect(new ChatNotificationDraft("qq_group:1", "产品群", false, 1).group).toBe("QQ");
  });

  it("falls back to 有新消息 for a single non-@ message (no body preview)", () => {
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

  it("merge(prev) takes the latest snapshot (count is authoritative, not accumulated)", () => {
    // 未读计数 / @ 标记的权威来源是 Conversation，新 draft 已带全量快照；过期 prev 被丢弃。
    const older = new ChatNotificationDraft("qq_group:1", "群", true, 1); // 旧快照：@ 过、count 1
    const newer = new ChatNotificationDraft("qq_group:1", "群", false, 5); // 新快照：count 5、未 @
    expect(newer.merge(older).render()).toBe("群: [5 条消息]");
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
