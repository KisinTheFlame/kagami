import { describe, expect, it } from "vitest";
import {
  createConversationSummaryMessage,
  createEnterZoneOutMessage,
  createExitZoneOutMessage,
  createIthomeArticleDetailMessage,
  createIthomeArticleListMessage,
  createMergedGroupMessagesMessage,
  createPortalSnapshotMessage,
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

  it("should wrap conversation summaries in the conversation_summary tag", () => {
    expect(createConversationSummaryMessage("  旧上下文摘要  ")).toEqual({
      role: "user",
      content: "<conversation_summary>\n旧上下文摘要\n</conversation_summary>",
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
        '- QQ 群 测试群（10001），未读 3 条，可通过 enter(kind="qq_group", id="10001") 进入',
        '- QQ 群 10002，尚未查看，可通过 enter(kind="qq_group", id="10002") 进去看看最近消息',
        '- IT之家（kind="ithome"），新文章 2 篇，可通过 enter(kind="ithome") 进入',
        '- 神游（kind="zone_out"），可通过 enter(kind="zone_out") 进入自由思考状态',
        "</system_reminder>",
      ].join("\n"),
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
        "如果想阅读全文，调用 open_ithome_article；如果想离开，调用 back_to_portal。",
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
        "看完后可以继续打开别的文章，或者调用 back_to_portal 离开资讯空间。",
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

  it("should render zone out transition messages", () => {
    expect(createEnterZoneOutMessage()).toEqual({
      role: "user",
      content: [
        "<system_instruction>",
        "你已进入神游状态。",
        '现在不能看群消息，也不能直接搜索或发群消息；如果要继续思考，请调用 invoke(tool="zone_out", thought="...")，如果想回到门户，调用 back_to_portal。',
        "</system_instruction>",
      ].join("\n"),
    });
    expect(createExitZoneOutMessage()).toEqual({
      role: "user",
      content: [
        "<system_instruction>",
        "你已结束神游，回到门户状态。",
        "如需进入某个目标，请调用 enter。",
        "</system_instruction>",
      ].join("\n"),
    });
  });

  it("should render the web search instruction message", () => {
    expect(createWebSearchInstructionMessage(" OpenAI 最近有什么新动态？ ")).toEqual({
      role: "user",
      content: [
        "<system_instruction>",
        "你正在继承主 agent 当前上下文，临时执行一次网页检索子任务。",
        "这次不是群聊发言决策，也不是直接回复群消息；本轮唯一目标是为主 agent 搜集信息，并给回一段可复用的中文摘要。",
        "你应该基于当前上下文理解这个问题在指什么，再决定搜索策略，而不是把问题孤立地当成一句无上下文文本。",
        "当前要检索的问题：OpenAI 最近有什么新动态？",
        "你可以按需把问题拆成多个关键词或子问题，并多次调用 search_web_raw。",
        "如果信息已经足够，调用 finalize_web_search 输出最终摘要；摘要必须基于检索结果，且在证据不足、结果冲突或时间不明确时明确保留不确定性。",
        "不要直接输出自由文本回答，不要复述思考过程，只通过工具调用推进本轮任务。",
        "</system_instruction>",
      ].join("\n"),
    });
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
