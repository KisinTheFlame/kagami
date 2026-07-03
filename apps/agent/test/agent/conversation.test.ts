import { describe, expect, it } from "vitest";
import {
  Conversation,
  type ConversationMessage,
  isGroupNotice,
} from "../../src/agent/capabilities/messaging/conversation.js";
import type {
  NapcatGroupMessageData,
  NapcatPrivateMessageData,
} from "../../src/napcat/application/napcat-gateway.service.js";

/** 会话流消息取正文（notice 变体无 rawMessage）。本文件用例只压入内容消息，恒有正文。 */
function rawOf(message: ConversationMessage | null): string | undefined {
  return message && !isGroupNotice(message) ? message.rawMessage : undefined;
}

function groupMsg(text: string, messageId: number | null = 1): NapcatGroupMessageData {
  return {
    groupId: "1",
    userId: "u",
    nickname: "群友",
    rawMessage: text,
    messageSegments: [{ type: "text", data: { text } }],
    messageId,
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
    expect(rawOf(group.getLatestUnread())).toBe("c");
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
    group.consumeUnreadTail();
    expect(group.hasUnreadMention()).toBe(false);
  });

  it("consumeUnreadTail returns and clears unread", () => {
    const group = Conversation.group("1", 5);
    group.pushUnread(groupMsg("a"), false);
    group.pushUnread(groupMsg("b"), false);
    const tail = group.consumeUnreadTail();
    expect(tail.map(rawOf)).toEqual(["a", "b"]);
    expect(group.getUnreadCount()).toBe(0);
  });

  it("tracks entered + accepts private messages as unread", () => {
    const priv = Conversation.privateChat("888", 5);
    expect(priv.hasEntered()).toBe(false);
    priv.markEntered();
    expect(priv.hasEntered()).toBe(true);
    priv.pushUnread(privateMsg("hi"), false);
    expect(rawOf(priv.getLatestUnread())).toBe("hi");
    priv.consumeUnreadTail();
    expect(priv.getUnreadCount()).toBe(0);
  });

  it("with a zero unread limit buffers nothing but still counts", () => {
    const group = Conversation.group("1", 0);
    group.pushUnread(groupMsg("a"), false);
    expect(group.getLatestUnread()).toBeNull();
    expect(group.getUnreadCount()).toBe(1);
  });

  describe("消费纪律（前台实时投递 / fetch 窗口，issue #251）", () => {
    it("takeUnreadSnapshot 只读不消费", () => {
      const group = Conversation.group("1", 5);
      group.pushUnread(groupMsg("a", 1), false);
      group.pushUnread(groupMsg("b", 2), false);
      const snapshot = group.takeUnreadSnapshot();
      expect(snapshot.map(rawOf)).toEqual(["a", "b"]);
      expect(group.getUnreadCount()).toBe(2);
      expect(group.takeUnreadSnapshot()).toHaveLength(2);
    });

    it("dropUnreadInstances 按对象引用剔除并等额减计数", () => {
      const group = Conversation.group("1", 5);
      group.pushUnread(groupMsg("a", 1), false);
      group.pushUnread(groupMsg("b", 2), false);
      group.pushUnread(groupMsg("c", 3), false);
      const snapshot = group.takeUnreadSnapshot();
      group.dropUnreadInstances(snapshot.slice(0, 2));
      expect(group.getUnreadCount()).toBe(1);
      expect(group.takeUnreadSnapshot().map(rawOf)).toEqual(["c"]);
    });

    it("dropUnreadInstances 边界：空数组无副作用，已被挤掉的快照条目安全跳过", () => {
      const group = Conversation.group("1", 2); // 缓冲上限 2
      group.pushUnread(groupMsg("a", 1), false);
      group.pushUnread(groupMsg("b", 2), false);
      const snapshot = group.takeUnreadSnapshot(); // [a, b]
      group.dropUnreadInstances([]);
      expect(group.getUnreadCount()).toBe(2);
      // 缓冲位移：新消息把 a 挤出缓冲。
      group.pushUnread(groupMsg("c", 3), false);
      group.dropUnreadInstances(snapshot); // a 已不在缓冲，只剔 b——c 不受误伤
      expect(group.takeUnreadSnapshot().map(rawOf)).toEqual(["c"]);
      expect(group.getUnreadCount()).toBe(2); // a 的残留计数留给 reconcile 对账
      group.reconcileUnreadWithBuffer();
      expect(group.getUnreadCount()).toBe(1);
    });

    it("reconcileUnreadWithBuffer 消除幻影计数并按缓冲精确重算 @", () => {
      const group = Conversation.group("1", 5);
      // 模拟 restoreUnread 恢复的无缓冲裸计数（重启后红点）。
      group.restoreUnread(7, true);
      expect(group.getUnreadCount()).toBe(7);
      group.reconcileUnreadWithBuffer(); // 缓冲为空：裸计数与 @ 全部对账清零
      expect(group.getUnreadCount()).toBe(0);
      expect(group.hasUnreadMention()).toBe(false);
      // 缓冲里有带 @ 的真实未读时，对账保留精确值。
      group.pushUnread(groupMsg("x", 31), true);
      group.pushEcho(groupMsg("echo", 32));
      group.reconcileUnreadWithBuffer();
      expect(group.getUnreadCount()).toBe(1);
      expect(group.hasUnreadMention()).toBe(true);
    });

    it("dropUnreadIn 按 messageId 剔除；null id 保守保留", () => {
      const group = Conversation.group("1", 5);
      group.pushUnread(groupMsg("a", 11), false);
      group.pushUnread(groupMsg("b", null), false); // 无 id：不参与匹配，宁重勿丢
      group.pushUnread(groupMsg("c", 13), false);
      group.dropUnreadIn(new Set([11, 13, 999]));
      expect(group.getUnreadCount()).toBe(1);
      expect(group.takeUnreadSnapshot().map(rawOf)).toEqual(["b"]);
    });

    it("部分剔除不动 @ 粘滞标记（保守），全量消费才清零", () => {
      const group = Conversation.group("1", 5);
      group.pushUnread(groupMsg("a", 1), true); // 有人 @
      group.pushUnread(groupMsg("b", 2), false);
      group.dropUnreadIn(new Set([1])); // 把带 @ 的那条剔掉
      expect(group.hasUnreadMention()).toBe(true); // sticky：宁多提醒不漏提醒
      group.dropUnreadInstances(group.takeUnreadSnapshot().slice(0, 1));
      expect(group.hasUnreadMention()).toBe(true);
      group.consumeUnreadTail();
      expect(group.hasUnreadMention()).toBe(false);
    });

    it("pushEcho 入缓冲但不计未读、不动 @、不当最新未读", () => {
      const group = Conversation.group("1", 5);
      group.pushEcho(groupMsg("我自己说的", 21));
      expect(group.getUnreadCount()).toBe(0);
      expect(group.hasUnreadMention()).toBe(false);
      // 回声不是「别人最新说的」：通知预览不能把小镜自己的发言当最新消息。
      expect(group.getLatestUnread()).toBeNull();
      // 回声随全量消费一起被带出展示。
      group.pushUnread(groupMsg("别人说的", 22), false);
      expect(rawOf(group.getLatestUnread())).toBe("别人说的");
      const tail = group.consumeUnreadTail();
      expect(tail.map(rawOf)).toEqual(["我自己说的", "别人说的"]);
    });

    it("剔除含回声的区段时计数只按真实未读扣减", () => {
      const group = Conversation.group("1", 5);
      group.pushUnread(groupMsg("a", 1), false);
      group.pushEcho(groupMsg("echo", 2));
      group.pushUnread(groupMsg("b", 3), false);
      expect(group.getUnreadCount()).toBe(2);
      group.dropUnreadInstances(group.takeUnreadSnapshot().slice(0, 2)); // 剔掉 a + echo：真实未读只少 1
      expect(group.getUnreadCount()).toBe(1);
      expect(group.takeUnreadSnapshot().map(rawOf)).toEqual(["b"]);
    });
  });
});
