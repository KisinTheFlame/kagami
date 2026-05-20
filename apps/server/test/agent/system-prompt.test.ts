import { describe, expect, it } from "vitest";
import { createStoryAgentSystemPrompt } from "../../src/agent/capabilities/story/task-agent/system-prompt.js";
import { createVisionSystemPrompt } from "../../src/agent/capabilities/vision/application/system-prompt.js";
import { createAgentSystemPrompt } from "../../src/agent/runtime/root-agent/system-prompt.js";

describe("createAgentSystemPrompt", () => {
  it("should describe qq message and system tags in the prompt", () => {
    const prompt = createAgentSystemPrompt({
      botQQ: "123456789",
      creatorName: "测试创造者",
      creatorQQ: "987654321",
    });

    expect(prompt).toContain("<input_format>");
    expect(prompt).toContain("<qq_message>");
    expect(prompt).toContain("<system_reminder>");
    expect(prompt).toContain("<system_instruction>");
    expect(prompt).toContain("<conversation_summary>");
    expect(prompt).toContain("可能按分段小标题组织");
    expect(prompt).toContain("优先关注其中的状态、待处理和不确定性");
    expect(prompt).toContain("123456789");
    expect(prompt).toContain("测试创造者");
    expect(prompt).toContain("987654321");
  });

  it("should not enumerate invoke subtools in the prompt", () => {
    // 这条不变量保住主 Agent 顶层 tools 数组的 KV cache 稳定性——加 / 删 / 改子工具
    // 不会让 system prompt 漂移。子工具说明走 invoke 错误返回回带。
    const prompt = createAgentSystemPrompt({
      botQQ: "123456789",
      creatorName: "测试创造者",
      creatorQQ: "987654321",
    });

    expect(prompt).not.toContain("<invoke_tools>");
    expect(prompt).not.toContain("send_message");
    expect(prompt).not.toContain("open_ithome_article");
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
