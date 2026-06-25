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

  it("accumulates unread up to the limit and exposes the latest", () => {
    const group = Conversation.group("1", 2);
    expect(group.getUnreadCount()).toBe(0);
    group.pushUnread(groupMsg("a"));
    group.pushUnread(groupMsg("b"));
    group.pushUnread(groupMsg("c")); // 超过上限 2，最旧的被丢
    expect(group.getUnreadCount()).toBe(2);
    expect(group.getLatestUnread()?.rawMessage).toBe("c");
  });

  it("consumeUnreadTail returns and clears unread", () => {
    const group = Conversation.group("1", 5);
    group.pushUnread(groupMsg("a"));
    group.pushUnread(groupMsg("b"));
    const tail = group.consumeUnreadTail();
    expect(tail.map(m => m.rawMessage)).toEqual(["a", "b"]);
    expect(group.getUnreadCount()).toBe(0);
  });

  it("tracks entered + accepts private messages as unread", () => {
    const priv = Conversation.privateChat("888", 5);
    expect(priv.hasEntered()).toBe(false);
    priv.markEntered();
    expect(priv.hasEntered()).toBe(true);
    priv.pushUnread(privateMsg("hi"));
    expect(priv.getLatestUnread()?.rawMessage).toBe("hi");
    priv.clearUnread();
    expect(priv.getUnreadCount()).toBe(0);
  });

  it("honors a zero unread limit (drops everything)", () => {
    const group = Conversation.group("1", 0);
    group.pushUnread(groupMsg("a"));
    expect(group.getUnreadCount()).toBe(0);
  });
});
