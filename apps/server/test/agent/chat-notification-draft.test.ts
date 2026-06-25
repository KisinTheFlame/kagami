import { describe, expect, it } from "vitest";
import {
  ChatNotificationDraft,
  detectBotMentioned,
} from "../../src/agent/capabilities/messaging/chat-notification-draft.js";
import type { NapcatReceiveMessageSegment } from "../../src/napcat/service/napcat-gateway/shared.js";

describe("ChatNotificationDraft", () => {
  it("renders {name}：{latest} without a mention", () => {
    const draft = new ChatNotificationDraft("qq_group:1", "产品群", "在吗", false);
    expect(draft.sourceId).toBe("qq_group:1");
    expect(draft.render()).toBe("产品群：在吗");
  });

  it("renders the mention tag when mentioned", () => {
    const draft = new ChatNotificationDraft("qq_group:1", "产品群", "看下这个", true);
    expect(draft.render()).toBe("产品群：[有人@你] 看下这个");
  });

  it("truncates an over-long latest message", () => {
    const long = "一".repeat(50);
    const draft = new ChatNotificationDraft("qq_group:1", "群", long, false);
    expect(draft.render()).toBe(`群：${"一".repeat(40)}…`);
  });

  it("folds via merge(prev): latest text wins, mention is sticky within the window", () => {
    const older = new ChatNotificationDraft("qq_group:1", "群", "第一条", true); // 历史里 @ 过
    const newer = new ChatNotificationDraft("qq_group:1", "群", "第二条", false);
    const merged = newer.merge(older);
    expect(merged.render()).toBe("群：[有人@你] 第二条");
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
