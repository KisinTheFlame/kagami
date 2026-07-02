import { describe, expect, it } from "vitest";
import {
  createConversationSummaryMessage,
  createForegroundInputMessage,
  createNotificationMessage,
  createPortalReminderMessage,
  createRootContextSummaryReminderMessage,
  createWakeReminderMessage,
  createWebSearchInstructionMessage,
} from "../../src/agent/runtime/context/context-message-factory.js";

describe("context-message-factory", () => {
  it("should render the wake reminder with beijing time", () => {
    expect(createWakeReminderMessage(new Date("2026-03-09T10:21:00.000Z"))).toEqual({
      role: "user",
      content:
        "<system_reminder>当前时间为北京时间 2026 年 3 月 9 日 星期一 18:21</system_reminder>",
    });
  });

  it("should wrap notification lines in the notification tag, one line per source", () => {
    expect(
      createNotificationMessage(["IT之家：2篇新文，最新《某标题》", "产品群：[有人@你] 在吗"]),
    ).toEqual({
      role: "user",
      content:
        "<notification>\nIT之家：2篇新文，最新《某标题》\n产品群：[有人@你] 在吗\n</notification>",
    });
  });

  it("should pass foreground input text through as-is (App 已自带伪标签，不套第二层)", () => {
    expect(
      createForegroundInputMessage(
        '<qq_conversation_new_messages name="产品群">\n群友 (1): 在吗\n</qq_conversation_new_messages>',
      ),
    ).toEqual({
      role: "user",
      content:
        '<qq_conversation_new_messages name="产品群">\n群友 (1): 在吗\n</qq_conversation_new_messages>',
    });
  });

  it("should wrap conversation summaries in the conversation_summary tag", () => {
    expect(
      createConversationSummaryMessage(
        "  ## 当前状态\n群里正在讨论权限\n## 待处理\n等下一轮接话  ",
      ),
    ).toEqual({
      role: "user",
      content:
        "<conversation_summary>\n## 当前状态\n群里正在讨论权限\n## 待处理\n等下一轮接话\n</conversation_summary>",
    });
  });

  it("should render the root context summary reminder", () => {
    expect(createRootContextSummaryReminderMessage()).toEqual({
      role: "user",
      content: [
        "<system_reminder>",
        "你现在不是在继续执行动作，而是在为当前 root agent 整理「稍后继续接上」的累计上下文摘要。",
        "这份摘要不是状态面板，也不是任务汇报，而是同一个人中途离开后回来继续延续当下局面的工作记忆。",
        "不要重点记录当前正处于哪个状态、眼前有哪些入口、刚进入了哪里。",
        "这些信息会随着后续状态切换和系统提醒重新出现，不属于累计摘要最该保留的内容。",
        "请优先保留那些在上下文压缩后最容易丢失、但最影响后续自然延续的内容：",
        "跨轮仍成立的背景，当前仍在延续的线索，关键对象，小镜自己的感觉与倾向，已经做过的关键动作及结果，以及后续还可以继续展开的点。",
        "摘要使用 Markdown 二级标题，按固定顺序组织为：`## 持续背景`、`## 仍在延续的线索`、`## 关键对象`、`## 小镜这边的感觉与倾向`、`## 已做动作与结果`、`## 还可以继续展开的点`。",
        "`## 持续背景` 保留跨轮仍重要的事实、关系、承诺、约束、长期判断。",
        "`## 仍在延续的线索` 保留当前还没完的事情，可以是聊天话题、阅读线索、论坛讨论、游戏目标、判断链或其他活动；写清它最近推进到了哪。",
        "`## 关键对象` 按“为什么现在仍重要”来写，可以包括人、群、文章、帖子、事件、问题、目标或别的关键对象。",
        "`## 小镜这边的感觉与倾向` 写小镜更想接什么、不想接什么、对哪些方向更有兴趣、哪些方向更自然、哪些方向让人烦、尴尬或懒得接。",
        "`## 已做动作与结果` 只记录有语义后果的动作与结果，例如已经搜索、已经阅读、已经说过什么、已经获得了什么信息；不要机械记录纯状态切换。",
        "`## 还可以继续展开的点` 保留 1 到 3 个最自然能继续的点，可包含极短原话或极短线索摘录。",
        "忽略寒暄、纯重复内容、已经失效的瞬时界面信息和明显无关细节。",
        "不要写成冷冰冰的流程单，也不要写成长篇流水账。",
        '不要直接输出自由文本回复，必须调用 `invoke(tool="finalize_summary", summary=...)` 提交摘要并结束本次子任务；`summary` 参数应是简洁但信息完整的中文字符串。',
        "本轮 switch / list_apps / wait / search_web / help 等其他顶层工具均不可用，调用会被拒绝。",
        "</system_reminder>",
      ].join("\n"),
    });
  });

  it("should render portal reminder listing switchable apps", () => {
    expect(
      createPortalReminderMessage({
        apps: [
          { id: "qq", displayName: "QQ" },
          { id: "calc", displayName: "计算器" },
        ],
      }),
    ).toEqual({
      role: "user",
      content: [
        "<system_reminder>",
        "你现在在桌面（Portal），这是初始状态。离开桌面后无法返回。",
        "用 switch(id=...) 进入下面某个 App；之后想知道有哪些 App 用 list_apps：",
        "- qq：QQ",
        "- calc：计算器",
        "</system_reminder>",
      ].join("\n"),
    });
  });

  it("should render portal reminder when no apps are available", () => {
    expect(createPortalReminderMessage({ apps: [] })).toEqual({
      role: "user",
      content: [
        "<system_reminder>",
        "你现在在桌面（Portal），这是初始状态。离开桌面后无法返回。",
        "当前没有可进入的 App。",
        "</system_reminder>",
      ].join("\n"),
    });
  });

  it("should render the web search instruction message", () => {
    const message = createWebSearchInstructionMessage(" OpenAI 最近有什么新动态？ ");
    expect(message.role).toBe("user");
    expect(typeof message.content).toBe("string");
    const content = message.content as string;
    expect(content).toContain("<system_instruction>");
    expect(content).toContain("当前要检索的问题：OpenAI 最近有什么新动态？");
    // 本轮使用 invoke 调用子工具，不再用顶层 search_web_raw / finalize_web_search。
    expect(content).toContain('invoke(tool="search_web_raw"');
    expect(content).toContain('invoke(tool="finalize_web_search"');
    expect(content).toContain("</system_instruction>");
  });
});
