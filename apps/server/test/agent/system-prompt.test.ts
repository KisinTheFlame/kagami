import { describe, expect, it } from "vitest";
import { createStoryAgentSystemPrompt } from "../../src/agent/capabilities/story/task-agent/system-prompt.js";
import { createVisionSystemPrompt } from "../../src/agent/capabilities/vision/application/system-prompt.js";
import { createWebSearchSystemPrompt } from "../../src/agent/capabilities/web-search/task-agent/system-prompt.js";
import { createAgentSystemPrompt } from "../../src/agent/runtime/root-agent/system-prompt.js";

describe("createAgentSystemPrompt", () => {
  it("should describe qq message and system tags in the prompt", () => {
    const prompt = createAgentSystemPrompt({
      botQQ: "123456789",
      creatorName: "测试创造者",
      creatorQQ: "987654321",
      invokeToolDefinitions: [
        {
          name: "send_message",
          description: "向当前监听的 QQ 群发送一条文本消息。",
          parameters: {
            type: "object",
            properties: {
              message: {
                type: "string",
                description: "要发送到群里的文本内容。",
              },
            },
          },
        },
        {
          name: "open_ithome_article",
          description: "在 IT 之家资讯空间里打开一篇文章的全文视图，只能在 ithome 状态下调用。",
          parameters: {
            type: "object",
            properties: {
              articleId: {
                type: "number",
                description: "要打开的文章 ID，来自当前 IT 之家文章列表。",
              },
            },
          },
        },
        {
          name: "zone_out",
          description: "在神游状态里记录一段当下的思路，不产生外部副作用。",
          parameters: {
            type: "object",
            properties: {
              thought: {
                type: "string",
                description: "这次神游里想的内容。",
              },
            },
          },
        },
      ],
    });

    expect(prompt).toContain("<input_format>");
    expect(prompt).toContain("<qq_message>");
    expect(prompt).toContain("<system_reminder>");
    expect(prompt).toContain("<system_instruction>");
    expect(prompt).toContain("<conversation_summary>");
    expect(prompt).toContain("<invoke_tools>");
    expect(prompt).toContain("`send_message`");
    expect(prompt).toContain("适用状态：`qq_group:*`");
    expect(prompt).toContain("可能按分段小标题组织");
    expect(prompt).toContain("优先关注其中的状态、待处理和不确定性");
    expect(prompt).toContain("123456789");
    expect(prompt).toContain("测试创造者");
    expect(prompt).toContain("987654321");
  });

  it("should render the web search system prompt from static template", () => {
    expect(createWebSearchSystemPrompt()).toBe(
      [
        "你是一个专门负责网页检索的搜索子 Agent。",
        "",
        "你的唯一目标，是把主 Agent 提交的一个问题，通过必要的多次搜索整理成一段可靠的中文摘要。",
        "",
        "工作规则：",
        "- 先理解原始问题，再决定是否要拆成多个关键词或子问题。",
        "- 可以执行多次 `search_web_raw`，但只在确有必要时才继续搜索。",
        "- 如果问题涉及最新动态、时间敏感信息或事实冲突，要主动缩小查询范围，必要时补做搜索。",
        "- 只能基于搜索结果中的信息总结，不能补写未被结果支持的事实。",
        "- 如果证据不足、来源说法冲突、日期不明确，摘要里必须明确说明不确定性。",
        "- 摘要尽量简洁，通常 2 到 4 句，直接回答问题本身，不要写成搜索过程汇报。",
        "- 当信息已足够时，必须调用 `finalize_web_search` 输出最终摘要。",
        "- 不要在未完成总结时调用 `finalize_web_search`。",
      ].join("\n"),
    );
  });

  it("should render the story agent prompt with fixed markdown rules", () => {
    expect(createStoryAgentSystemPrompt()).toContain("story 的 canonical Markdown 结构固定为");
    expect(createStoryAgentSystemPrompt()).toContain("`- 影响：...`");
    expect(createStoryAgentSystemPrompt()).toContain(
      "`时间`、`起因`、`经过`、`结果`、`影响` 必须非空。",
    );
    expect(createStoryAgentSystemPrompt()).toContain("如果工具返回格式错误");
    expect(createStoryAgentSystemPrompt()).toContain(
      "`<conversation_summary>` 表示较早上下文的压缩工作记忆",
    );
  });

  it("should render the vision prompt from static template", () => {
    expect(createVisionSystemPrompt()).toBe(
      [
        "请把这张图片转成适合聊天上下文的一小段中文文本。",
        "只输出最终描述，不要标题、不要分点、不要 Markdown、不要补充说明、不要提出后续建议。",
        "优先保留最影响理解上下文的信息：主体、动作、场景、可见文字、数字、时间、地点、关键界面信息。",
        "如果是截图或界面，提炼最关键的页面内容，不要把每个按钮和布局都详细列出来。",
        "控制在 1 段内，尽量简洁；通常 1 到 3 句即可。",
        "不要编造未出现的内容，不确定时省略或用简短措辞说明。",
      ].join("\n"),
    );
  });

  it("should render the story prompt with markdown requirements", () => {
    const prompt = createStoryAgentSystemPrompt();

    expect(prompt).toContain("`- 影响：...`");
    expect(prompt).toContain("`结果：...`");
    expect(prompt).toContain("`时间`、`起因`、`经过`、`结果`、`影响` 必须非空。");
    expect(prompt).toContain("如果工具返回格式错误，必须根据错误提示修改 Markdown 后重新提交");
  });
});
