import { describe, expect, it } from "vitest";
import { Conversation } from "../../src/agent/capabilities/messaging/conversation.js";
import type {
  NapcatGroupMessageData,
  NapcatPrivateMessageData,
} from "../../src/napcat/service/napcat-gateway.service.js";

function groupMsg(text: string): NapcatGroupMessageData {
  return {
    groupId: "1",
    userId: "u",
    nickname: "群友",
    rawMessage: text,
    messageSegments: [{ type: "text", data: { text } }],
    messageId: 1,
    time: 1,
  };
}

function privateMsg(text: string): NapcatPrivateMessageData {
  return {
    userId: "888",
    nickname: "老王",
    remark: null,
    rawMessage: text,
    messageSegments: [{ type: "text", data: { text } }],
    messageId: 1,
    time: 1,
  };
}

describe("Conversation", () => {
  it("builds group / private ids and chat targets", () => {
    const group = Conversation.group("1", 5);
    const priv = Conversation.privateChat("888", 5);
    expect(group.id).toBe("qq_group:1");
    expect(priv.id).toBe("qq_private:888");
    expect(group.kind).toBe("group");
    expect(group.getChatTarget()).toEqual({ chatType: "group", groupId: "1" });
    expect(priv.getChatTarget()).toEqual({ chatType: "private", userId: "888" });
  });

  it("renders group display name from groupInfo, falls back to groupId", () => {
    const group = Conversation.group("1", 5);
    expect(group.getDisplayName()).toBe("QQ 群 1");
    expect(group.getShortName()).toBe("群 1");
    group.setGroupInfo({
      groupId: "1",
      groupName: "产品群",
      memberCount: 1,
      maxMemberCount: 2,
      groupRemark: "",
      groupAllShut: false,
    });
    expect(group.getDisplayName()).toBe("QQ 群 产品群 (1)");
    expect(group.getShortName()).toBe("产品群");
  });

  it("private display name prefers remark, then nickname, then userId", () => {
    const a = Conversation.privateChat("888", 5);
    expect(a.getDisplayName()).toBe("888"); // 无 friendInfo 时退化为 userId
    a.setFriendInfo({ userId: "888", nickname: "老王", remark: null });
    expect(a.getDisplayName()).toBe("老王");
    a.setFriendInfo({ userId: "888", nickname: "老王", remark: "王哥" });
    expect(a.getDisplayName()).toBe("王哥");
  });

  it("counts unread uncapped but caps the buffered content", () => {
    const group = Conversation.group("1", 2);
    expect(group.getUnreadCount()).toBe(0);
    group.pushUnread(groupMsg("a"), false);
    group.pushUnread(groupMsg("b"), false);
    group.pushUnread(groupMsg("c"), false); // 内容缓冲超上限 2，最旧的被丢，但计数不封顶
    expect(group.getUnreadCount()).toBe(3);
    expect(group.getLatestUnread()?.rawMessage).toBe("c");
  });

  it("keeps counting unread across many messages, resetting only on consume", () => {
    const group = Conversation.group("1", 5);
    for (let i = 0; i < 12; i += 1) {
      group.pushUnread(groupMsg(String(i)), false);
    }
    // 远超缓冲上限 5，仍据实累积——对应通知里"未读越积越多，30s 窗口不重新计数"。
    expect(group.getUnreadCount()).toBe(12);
    group.consumeUnreadTail();
    expect(group.getUnreadCount()).toBe(0);
  });

  it("sticks the unread mention flag until consume / clear", () => {
    const group = Conversation.group("1", 5);
    expect(group.hasUnreadMention()).toBe(false);
    group.pushUnread(groupMsg("a"), false);
    expect(group.hasUnreadMention()).toBe(false);
    group.pushUnread(groupMsg("b"), true); // 有人 @
    group.pushUnread(groupMsg("c"), false); // 后续没 @ 也粘住
    expect(group.hasUnreadMention()).toBe(true);
    group.clearUnread();
    expect(group.hasUnreadMention()).toBe(false);
  });

  it("consumeUnreadTail returns and clears unread", () => {
    const group = Conversation.group("1", 5);
    group.pushUnread(groupMsg("a"), false);
    group.pushUnread(groupMsg("b"), false);
    const tail = group.consumeUnreadTail();
    expect(tail.map(m => m.rawMessage)).toEqual(["a", "b"]);
    expect(group.getUnreadCount()).toBe(0);
  });

  it("tracks entered + accepts private messages as unread", () => {
    const priv = Conversation.privateChat("888", 5);
    expect(priv.hasEntered()).toBe(false);
    priv.markEntered();
    expect(priv.hasEntered()).toBe(true);
    priv.pushUnread(privateMsg("hi"), false);
    expect(priv.getLatestUnread()?.rawMessage).toBe("hi");
    priv.clearUnread();
    expect(priv.getUnreadCount()).toBe(0);
  });

  it("with a zero unread limit buffers nothing but still counts", () => {
    const group = Conversation.group("1", 0);
    group.pushUnread(groupMsg("a"), false);
    expect(group.getLatestUnread()).toBeNull();
    expect(group.getUnreadCount()).toBe(1);
  });
});
