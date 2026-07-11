import { describe, expect, it } from "vitest";
import {
  createConversationSummaryMessage,
  createForegroundInputMessage,
  createNotificationMessage,
  createPortalReminderMessage,
  createRootContextSummaryReminderMessage,
  createWakeReminderMessage,
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
        "这份摘要不是状态面板，也不是任务汇报，而是同一个人中途离开后回来继续延续当下局面的高保真工作记忆。",
        "不要重点记录当前正处于哪个状态、眼前有哪些入口、刚进入了哪里。",
        "这些信息会随着后续状态切换和系统提醒重新出现，不属于累计摘要最该保留的内容。",
        "如果输入中已有 `<conversation_summary>`，把它视为累计记忆的基线，与后续新信息保守合并。",
        "旧摘要中仍成立的内容必须继续保留；只有某项内容已明确失效、被新事实覆盖，或已经结束且不再影响后续时，才可以删除或改写，并应保留仍有意义的结果与影响。",
        "请优先保留那些在上下文压缩后最容易丢失、但最影响后续自然延续的内容：",
        "跨轮仍成立的背景，当前仍在延续的线索，关键对象，小镜自己的感觉与倾向，已经做过的关键动作及结果，以及后续还可以继续展开的点。",
        "在原始上下文确有依据时，尽量保留具体对象与关系、决定及理由、因果链、推进到的位置、成功与失败的结果、承诺与约束、尚未确认的不确定性、能帮助续接的极短原话或线索，以及小镜真实表现出的感受与倾向。",
        "摘要长度应随有效信息量自适应。信息充足时通常写到约 4000 到 8000 个中文字符；复杂上下文可以更长，不要因为达到这个范围就截断重要信息。信息较少时可以自然缩短，不要为了凑字数重复或填充内容。",
        "摘要使用 Markdown 二级标题，按固定顺序组织为：`## 持续背景`、`## 仍在延续的线索`、`## 关键对象`、`## 小镜这边的感觉与倾向`、`## 已做动作与结果`、`## 还可以继续展开的点`。",
        "每节可以使用多个原子化条目；一个条目只承载一组紧密相关的信息，并写清对象、变化、原因或当前落点，便于以后准确合并和更新。",
        "`## 持续背景` 保留跨轮仍重要的事实、关系、承诺、约束、长期判断。",
        "`## 仍在延续的线索` 保留当前还没完的事情，可以是聊天话题、阅读线索、论坛讨论、游戏目标、判断链或其他活动；写清它最近推进到了哪。",
        "`## 关键对象` 按“为什么现在仍重要”来写，可以包括人、群、文章、帖子、事件、问题、目标或别的关键对象。",
        "`## 小镜这边的感觉与倾向` 写小镜更想接什么、不想接什么、对哪些方向更有兴趣、哪些方向更自然、哪些方向让人烦、尴尬或懒得接。",
        "`## 已做动作与结果` 记录有语义后果的动作与结果，包括成功、失败、尝试过但未奏效的路径及其原因；不要机械记录纯状态切换。",
        "`## 还可以继续展开的点` 保留所有仍然自然且有后续价值的点，可包含极短原话或极短线索摘录，不要为了追求简短而强行限制条目数量。",
        "忽略寒暄、纯重复内容、已经失效的瞬时界面信息、无后续价值的机械操作和明显无关细节。",
        "允许写得详细，但要按语义组织，不要逐消息复述成流水账。不得补写、猜测或推断原始上下文中没有依据的事实；不确定的内容必须明确标为不确定。",
        '不要直接输出自由文本回复，必须调用 `invoke(tool="finalize_summary", summary=...)` 提交摘要并结束本次子任务；`summary` 参数应是高保真、可供后续自然续接的中文字符串。',
        "本轮 switch / wait / help 等其他顶层工具均不可用，调用会被拒绝。",
        "</system_reminder>",
      ].join("\n"),
    });
  });

  it("should render portal reminder without listing apps (名单已常驻 system prompt)", () => {
    expect(createPortalReminderMessage()).toEqual({
      role: "user",
      content: [
        "<system_reminder>",
        "你现在在桌面（Portal），这是初始状态。离开桌面后无法返回。",
        "用 switch(id=...) 进入某个 App（有哪些 App 见系统说明里的 App 列表）。",
        "</system_reminder>",
      ].join("\n"),
    });
  });
});
