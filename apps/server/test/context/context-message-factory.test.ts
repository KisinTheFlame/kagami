import { describe, expect, it } from "vitest";
import {
  createConversationSummaryMessage,
  createIthomeArticleDetailMessage,
  createIthomeArticleListMessage,
  createMergedGroupMessagesMessage,
  createNotificationMessage,
  createPortalSnapshotMessage,
  createRootContextSummaryReminderMessage,
  createStateSystemReminderMessage,
  createStoryContextSummaryReminderMessage,
  createWakeReminderMessage,
  createWebSearchInstructionMessage,
  renderGroupMessagePlainText,
} from "../../src/agent/runtime/context/context-message-factory.js";

describe("context-message-factory", () => {
  it("should render the wake reminder with beijing time", () => {
    expect(createWakeReminderMessage(new Date("2026-03-09T10:21:00.000Z"))).toEqual({
      role: "user",
      content: "<system_reminder>当前时间为北京时间 2026 年 3 月 9 日 18:21</system_reminder>",
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

  it("should render root and story context summary reminders", () => {
    expect(createRootContextSummaryReminderMessage()).toEqual({
      role: "user",
      content: [
        "<system_reminder>",
        "你现在不是在继续执行动作，而是在为当前 root agent 整理“稍后继续接上”的累计上下文摘要。",
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
        "不要直接输出自由文本回复，必须调用 `summary` 工具；`summary` 参数应是简洁但信息完整的中文字符串。",
        "</system_reminder>",
      ].join("\n"),
    });

    expect(createStoryContextSummaryReminderMessage()).toEqual({
      role: "user",
      content: [
        "<system_reminder>",
        "你现在不是在创建新回复，而是在为当前 story runtime 整理“稍后继续工作用”的累计上下文摘要。",
        "请基于你刚刚继承到的完整上下文（包括当前 system prompt 与已有消息）提炼真正会影响后续叙事归并和批处理完成的信息。",
        "摘要使用 Markdown 二级标题，按固定顺序组织为：`## 当前处理范围`、`## 已确认叙事`、`## 新增线索与判断`、`## 待完成事项`。",
        "`## 当前处理范围` 写当前批次或当前压缩范围正在处理什么主题、消息簇或叙事簇。",
        "`## 已确认叙事` 写已识别出的 story、归属关系、稳定判断；如果没有可留空但标题保留。",
        "`## 新增线索与判断` 写本轮新增消息带来的 merge / split / rewrite / create 判断，以及关键工具结果。",
        "`## 待完成事项` 写尚未完成的 create/rewrite/finish，以及仍有歧义的归并点。",
        "忽略寒暄、重复内容、无关细节和冗余措辞。",
        "不要直接输出自由文本回复，必须调用 `summary` 工具；`summary` 参数应是简洁但信息完整的中文字符串。",
        "</system_reminder>",
      ].join("\n"),
    });
  });

  it("should render portal snapshot for unread and unseen groups", () => {
    expect(
      createPortalSnapshotMessage(
        [
          {
            groupId: "10001",
            groupName: "测试群",
            unreadCount: 3,
            hasEntered: true,
          },
          {
            groupId: "10002",
            unreadCount: 0,
            hasEntered: false,
          },
        ],
        [
          {
            kind: "ithome",
            label: "IT之家",
            unreadCount: 2,
            hasEntered: true,
          },
        ],
      ),
    ).toEqual({
      role: "user",
      content: [
        "<system_reminder>",
        "你当前处于门户状态。",
        "这里会显示可进入的目标；如果你想进入某个目标，调用 enter。",
        "可进入目标：",
        '- QQ 群 测试群 (10001)，未读 3 条，可通过 enter(kind="qq_group", id="10001") 进入',
        '- QQ 群 10002，尚未查看，可通过 enter(kind="qq_group", id="10002") 进去看看最近消息',
        '- IT之家(kind="ithome")，新文章 2 篇，可通过 enter(kind="ithome") 进入',
        "</system_reminder>",
      ].join("\n"),
    });
  });

  it("should render state reminder without invoke tools section", () => {
    expect(
      createStateSystemReminderMessage({
        displayName: "QQ 群 程序喵AI竞技场 (253631878)",
      }),
    ).toEqual({
      role: "user",
      content: [
        "<system_reminder>",
        "你进入了 QQ 群 程序喵AI竞技场 (253631878) 节点",
        "</system_reminder>",
      ].join("\n"),
    });
  });

  it("should render apps section when apps are provided", () => {
    expect(
      createStateSystemReminderMessage({
        displayName: "门户",
        children: [
          {
            id: "qq_group:123",
            displayName: "QQ 群 测试群",
            description: "聊天",
          },
        ],
        apps: [{ id: "calc", displayName: "计算器" }],
      }),
    ).toEqual({
      role: "user",
      content: [
        "<system_reminder>",
        "你进入了 门户 节点，有以下子节点可进入：",
        "- QQ 群 测试群 (qq_group:123): 聊天",
        "也可以进入以下 App：",
        "- calc：计算器",
        "</system_reminder>",
      ].join("\n"),
    });
  });

  it("should omit apps section when apps array is empty", () => {
    expect(
      createStateSystemReminderMessage({
        displayName: "门户",
        apps: [],
      }),
    ).toEqual({
      role: "user",
      content: ["<system_reminder>", "你进入了 门户 节点", "</system_reminder>"].join("\n"),
    });
  });

  it("should render ithome article list and detail messages", () => {
    expect(
      createIthomeArticleListMessage({
        displayName: "IT之家",
        mode: "new",
        hiddenNewCount: 3,
        articles: [
          {
            id: 11,
            title: "测试文章",
            url: "https://www.ithome.com/test",
            publishedAt: new Date("2026-03-30T04:21:03.000Z"),
            rssSummary: "这是摘要",
          },
        ],
      }),
    ).toEqual({
      role: "user",
      content: [
        "<system_instruction>",
        "你已进入 IT之家 资讯空间。",
        "以下是游标之后最新的一批新文章。",
        "本轮只展示最新几篇；更早的 3 篇新文章已随本次进入一起略过。",
        '如果想阅读全文，调用 invoke(tool="open_ithome_article", articleId=...)；如果想离开，调用 back。',
        "</system_instruction>",
        "<ithome_article_list>",
        "[11] 测试文章",
        "发布时间：2026/3/30 12:21",
        "链接：https://www.ithome.com/test",
        "摘要：这是摘要",
        "",
        "</ithome_article_list>",
      ].join("\n"),
    });

    expect(
      createIthomeArticleDetailMessage({
        title: "测试文章",
        url: "https://www.ithome.com/test",
        publishedAt: new Date("2026-03-30T04:21:03.000Z"),
        content: "正文内容",
        contentSource: "rss_summary",
        truncated: true,
        maxChars: 8000,
      }),
    ).toEqual({
      role: "user",
      content: [
        "<system_instruction>",
        "以下是当前打开的 IT 之家文章。",
        "正文暂不可用，以下内容来自 RSS 摘要整理。",
        "正文过长，以下仅保留前 8000 字。",
        "看完后可以继续打开别的文章，或者调用 back 离开资讯空间。",
        "</system_instruction>",
        "<ithome_article>",
        "标题：测试文章",
        "发布时间：2026/3/30 12:21",
        "链接：https://www.ithome.com/test",
        "",
        "正文：",
        "正文内容",
        "</ithome_article>",
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

  it("should render qq messages from structured message bodies", () => {
    expect(
      renderGroupMessagePlainText({
        nickname: "测试昵称",
        userId: "654321",
        rawMessage: "raw fallback",
        messageSegments: [
          {
            type: "text",
            data: {
              text: "hello structured",
            },
          },
        ],
      }),
    ).toBe("<qq_message>\n测试昵称 (654321):\nhello structured\n</qq_message>");
  });

  it("should keep qq message wrapper when rendered body is empty", () => {
    expect(
      renderGroupMessagePlainText({
        nickname: "测试昵称",
        userId: "654321",
        rawMessage: "",
        messageSegments: [],
      }),
    ).toBe("<qq_message>\n测试昵称 (654321):\n\n</qq_message>");
  });

  it("should merge multiple qq messages into one user message", () => {
    expect(
      createMergedGroupMessagesMessage([
        {
          groupId: "group-1",
          userId: "654321",
          nickname: "测试昵称",
          rawMessage: "first",
          messageSegments: [
            {
              type: "text",
              data: {
                text: "first",
              },
            },
          ],
          messageId: 1001,
          time: 1710000000,
        },
        {
          groupId: "group-1",
          userId: "123456",
          nickname: "另一个群友",
          rawMessage: "second",
          messageSegments: [
            {
              type: "text",
              data: {
                text: "second",
              },
            },
          ],
          messageId: 1002,
          time: 1710000001,
        },
      ]),
    ).toEqual({
      role: "user",
      content: [
        "<qq_message>",
        "测试昵称 (654321):",
        "first",
        "</qq_message>",
        "",
        "<qq_message>",
        "另一个群友 (123456):",
        "second",
        "</qq_message>",
      ].join("\n"),
    });
  });
});
