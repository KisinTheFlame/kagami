import { describe, expect, it } from "vitest";
import {
  extractCodexImageFromSse,
  extractCodexUpstreamError,
  toCodexImageRequestBody,
} from "../src/image/providers/openai-codex-image-provider.js";

/** 把 (event, data) 组装成一段 codex responses SSE 文本（块间空行分隔），贴合真实流形态。 */
function sse(events: Array<{ event: string; data: unknown }>): string {
  return events.map(e => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}`).join("\n\n");
}

const doneEvent = {
  event: "response.output_item.done",
  data: {
    type: "response.output_item.done",
    item: {
      id: "ig_1",
      type: "image_generation_call",
      status: "generating",
      result: "RE9ORV9CQVNFNjQ=",
      revised_prompt: "一个红色的圆",
      output_format: "png",
      size: "1024x1024",
    },
  },
};

const partialEvent = {
  event: "response.image_generation_call.partial_image",
  data: {
    type: "response.image_generation_call.partial_image",
    partial_image_b64: "UEFSVElBTF9CQVNFNjQ=",
    partial_image_index: 0,
    output_format: "png",
    size: "1254x1254",
  },
};

describe("extractCodexImageFromSse", () => {
  it("从 output_item.done 取终图与元数据", () => {
    const payload = extractCodexImageFromSse(sse([partialEvent, doneEvent]));
    expect(payload).toEqual({
      b64: "RE9ORV9CQVNFNjQ=",
      revisedPrompt: "一个红色的圆",
      size: "1024x1024",
      outputFormat: "png",
    });
  });

  it("done 优先于 partial（default 下 partial 即终图，显式 partial_images 时是低清中间帧）", () => {
    const payload = extractCodexImageFromSse(sse([doneEvent, partialEvent]));
    expect(payload?.b64).toBe("RE9ORV9CQVNFNjQ=");
  });

  it("无 done 时退回 partial 兜底", () => {
    const payload = extractCodexImageFromSse(sse([partialEvent]));
    expect(payload?.b64).toBe("UEFSVElBTF9CQVNFNjQ=");
    expect(payload?.size).toBe("1254x1254");
  });

  it("无任何图片事件返回 null（如纯文本轮或空 completed）", () => {
    const text = sse([
      { event: "response.created", data: { type: "response.created" } },
      { event: "keepalive", data: {} },
      {
        event: "response.completed",
        data: { type: "response.completed", response: { output: [] } },
      },
    ]);
    expect(extractCodexImageFromSse(text)).toBeNull();
  });

  it("忽略无法解析的 data 块", () => {
    const text = `event: response.output_item.done\ndata: {not-json`;
    expect(extractCodexImageFromSse(text)).toBeNull();
  });
});

describe("toCodexImageRequestBody", () => {
  it("产出被后端 400 约束逼出来的 load-bearing 形状（防回归）", () => {
    const body = toCodexImageRequestBody({ prompt: "画只猫", model: "gpt-5.4" });

    // tool 内显式 image 后端模型；顶层 model 是 responses 路由模型。
    expect(body.model).toBe("gpt-5.4");
    expect(body.tools).toEqual([
      { type: "image_generation", model: "gpt-image-2", output_format: "png" },
    ]);
    // 强制出图只能走 allowed_tools 包装形式（直接 {type:image_generation} 会被后端 400）。
    expect(body.tool_choice).toEqual({
      type: "allowed_tools",
      mode: "required",
      tools: [{ type: "image_generation" }],
    });
    expect(body.stream).toBe(true);
    expect(body.store).toBe(false);
  });

  it("size/quality 有值才透传进 tool", () => {
    const body = toCodexImageRequestBody({
      prompt: "x",
      model: "gpt-5.4",
      size: "1024x1536",
      quality: "high",
    });
    expect(body.tools).toEqual([
      {
        type: "image_generation",
        model: "gpt-image-2",
        output_format: "png",
        size: "1024x1536",
        quality: "high",
      },
    ]);
  });
});

describe("extractCodexUpstreamError", () => {
  it("取到 response.completed 内嵌的 error.message", () => {
    const text = sse([
      {
        event: "response.completed",
        data: { type: "response.completed", response: { error: { message: "上游炸了" } } },
      },
    ]);
    expect(extractCodexUpstreamError(text)).toBe("上游炸了");
  });

  it("无 error 时返回 null", () => {
    const text = sse([
      {
        event: "response.completed",
        data: { type: "response.completed", response: { error: null, output: [] } },
      },
    ]);
    expect(extractCodexUpstreamError(text)).toBeNull();
  });
});
