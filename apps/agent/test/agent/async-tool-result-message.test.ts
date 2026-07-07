import { describe, expect, it } from "vitest";
import { createAsyncToolResultMessage } from "../../src/agent/runtime/context/context-message-factory.js";

describe("createAsyncToolResultMessage", () => {
  it("success：含 content，无 status", () => {
    const m = createAsyncToolResultMessage({
      taskId: "t1",
      toolName: "search_web",
      outcome: { status: "success", content: "摘要正文" },
    });
    expect(m).toEqual({
      role: "user",
      content: '<async_tool_result task_id="t1" tool="search_web">\n摘要正文\n</async_tool_result>',
    });
  });

  it("error：带 status=error 与错误信息", () => {
    const m = createAsyncToolResultMessage({
      taskId: "t2",
      toolName: "search_web",
      outcome: { status: "error", message: "boom" },
    });
    expect(m).toEqual({
      role: "user",
      content:
        '<async_tool_result task_id="t2" tool="search_web" status="error">\nboom\n</async_tool_result>',
    });
  });

  it("timeout：带 status=timeout 与超时文案", () => {
    const m = createAsyncToolResultMessage({
      taskId: "t3",
      toolName: "search_web",
      outcome: { status: "timeout" },
    });
    expect(m).toEqual({
      role: "user",
      content:
        '<async_tool_result task_id="t3" tool="search_web" status="timeout">\n任务超时未完成\n</async_tool_result>',
    });
  });

  it("success 带 images：拼成多模态消息（文本 part + 图片 part）", () => {
    const m = createAsyncToolResultMessage({
      taskId: "t4",
      toolName: "generate",
      outcome: {
        status: "success",
        content: '{"ok":true}',
        images: [{ content: "BASE64", mimeType: "image/png", filename: "atelier.png" }],
      },
    });
    expect(m).toEqual({
      role: "user",
      content: [
        {
          type: "text",
          text: '<async_tool_result task_id="t4" tool="generate">\n{"ok":true}\n</async_tool_result>',
        },
        { type: "image", content: "BASE64", mimeType: "image/png", filename: "atelier.png" },
      ],
    });
  });

  it("success images 为空数组：退化为纯文本", () => {
    const m = createAsyncToolResultMessage({
      taskId: "t5",
      toolName: "generate",
      outcome: { status: "success", content: "done", images: [] },
    });
    expect(m).toEqual({
      role: "user",
      content: '<async_tool_result task_id="t5" tool="generate">\ndone\n</async_tool_result>',
    });
  });
});
