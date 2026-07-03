import { describe, expect, it } from "vitest";
import {
  formatMuteDuration,
  renderGroupNoticePlainText,
} from "../../../../src/agent/apps/qq/qq-message-render.js";
import type { GroupNoticeMessage } from "../../../../src/agent/capabilities/messaging/conversation.js";
import { initTestLoggerRuntime } from "../../../helpers/logger.js";

initTestLoggerRuntime();

function notice(overrides: Partial<GroupNoticeMessage>): GroupNoticeMessage {
  return {
    kind: "group_notice",
    noticeType: "ban",
    wholeGroup: false,
    selfTargeted: false,
    targetUserId: "10002",
    targetName: "李四",
    operatorUserId: "10001",
    operatorName: "张三",
    durationSeconds: 600,
    messageId: null,
    time: 1,
    ...overrides,
  };
}

describe("renderGroupNoticePlainText 六形态", () => {
  it("自己被禁言", () => {
    const text = renderGroupNoticePlainText(
      notice({ selfTargeted: true, targetUserId: "10001", targetName: null }),
    );
    expect(text).toBe("<qq_notice>你被 张三(10001) 禁言了 10 分钟</qq_notice>");
  });

  it("群友被禁言", () => {
    const text = renderGroupNoticePlainText(notice({ durationSeconds: 3600 }));
    expect(text).toBe("<qq_notice>李四(10002) 被 张三(10001) 禁言了 1 小时</qq_notice>");
  });

  it("全员禁言开", () => {
    const text = renderGroupNoticePlainText(
      notice({ wholeGroup: true, targetUserId: null, targetName: null }),
    );
    expect(text).toBe("<qq_notice>张三(10001) 开启了全员禁言</qq_notice>");
  });

  it("自己被解禁", () => {
    const text = renderGroupNoticePlainText(
      notice({
        noticeType: "lift_ban",
        selfTargeted: true,
        targetUserId: "10001",
        targetName: null,
      }),
    );
    expect(text).toBe("<qq_notice>张三(10001) 解除了你的禁言</qq_notice>");
  });

  it("群友被解禁", () => {
    const text = renderGroupNoticePlainText(notice({ noticeType: "lift_ban" }));
    expect(text).toBe("<qq_notice>张三(10001) 解除了 李四(10002) 的禁言</qq_notice>");
  });

  it("全员禁言关", () => {
    const text = renderGroupNoticePlainText(
      notice({ noticeType: "lift_ban", wholeGroup: true, targetUserId: null, targetName: null }),
    );
    expect(text).toBe("<qq_notice>张三(10001) 解除了全员禁言</qq_notice>");
  });

  it("bare=true 输出裸正文（无标签），供通知预览用", () => {
    const text = renderGroupNoticePlainText(
      notice({ selfTargeted: true, targetUserId: "10001", targetName: null }),
      { bare: true },
    );
    expect(text).toBe("你被 张三(10001) 禁言了 10 分钟");
  });

  it("名字查不到退化裸号；operator 缺失退化为「管理员」", () => {
    const text = renderGroupNoticePlainText(
      notice({ targetName: null, operatorName: null, operatorUserId: null }),
    );
    expect(text).toBe("<qq_notice>10002 被 管理员 禁言了 10 分钟</qq_notice>");
  });
});

describe("formatMuteDuration", () => {
  it("秒", () => {
    expect(formatMuteDuration(30)).toBe("30 秒");
    expect(formatMuteDuration(0)).toBe("0 秒");
  });
  it("分钟", () => {
    expect(formatMuteDuration(600)).toBe("10 分钟");
  });
  it("小时 + 分钟", () => {
    expect(formatMuteDuration(3600)).toBe("1 小时");
    expect(formatMuteDuration(5400)).toBe("1 小时 30 分钟");
  });
  it("天", () => {
    expect(formatMuteDuration(2592000)).toBe("30 天");
  });
});
