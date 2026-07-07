import { describe, expect, it, vi } from "vitest";
import { AsyncTaskManager, type AsyncTaskCompletion } from "@kagami/agent-runtime";
import { createAtelierGenerateTool } from "../../../../src/agent/capabilities/atelier/tools/generate.tool.js";
import type { ImageClient } from "../../../../src/acl/image-client.js";
import type { OssClient } from "../../../../src/acl/oss-client.js";
import { initTestLoggerRuntime } from "../../../helpers/logger.js";

// generate 工具在 OSS put 失败降级路径会 logger.warn，需先初始化 logger runtime。
initTestLoggerRuntime();

const IMAGE_RESULT = {
  provider: "openai-codex",
  model: "gpt-image-2",
  mimeType: "image/png",
  imageBase64: "QkFTRTY0",
  revisedPrompt: "一只戴眼镜的橘猫",
  size: "1254x1254",
};

function stubImageClient(): ImageClient {
  return { generate: vi.fn().mockResolvedValue(IMAGE_RESULT) };
}

/** 驱动一次 generate：真 AsyncTaskManager 捕获 completion，execute 触发后台 run，await 完成。 */
async function runGenerate(deps: {
  imageClient: ImageClient;
  ossClient?: OssClient;
}): Promise<AsyncTaskCompletion> {
  let resolve!: (completion: AsyncTaskCompletion) => void;
  const completed = new Promise<AsyncTaskCompletion>(r => {
    resolve = r;
  });
  const asyncTaskManager = new AsyncTaskManager({
    maxTaskDurationMs: 60_000,
    onComplete: completion => resolve(completion),
  });
  const tool = createAtelierGenerateTool({ ...deps, asyncTaskManager });

  const placeholder = await tool.execute({ prompt: "画只猫" }, {});
  expect(placeholder.content).toContain("<async_task_submitted");

  return completed;
}

describe("createAtelierGenerateTool", () => {
  it("run：调 client 生图 → 落 OSS 拿 resid → 成功载荷带 resid+revised_prompt+images", async () => {
    const imageClient = stubImageClient();
    const putObject = vi.fn().mockResolvedValue("res-9");
    const ossClient = { putObject } as unknown as OssClient;

    const completion = await runGenerate({ imageClient, ossClient });

    expect(imageClient.generate).toHaveBeenCalledWith({ prompt: "画只猫" });
    // 落 OSS 的字节是 base64 解码后的原图。
    expect(putObject).toHaveBeenCalledWith({
      bytes: Buffer.from("QkFTRTY0", "base64"),
      mimeType: "image/png",
    });
    expect(completion.outcome.status).toBe("success");
    if (completion.outcome.status !== "success") {
      throw new Error("unreachable");
    }
    expect(JSON.parse(completion.outcome.content)).toMatchObject({
      ok: true,
      resid: "res-9",
      revised_prompt: "一只戴眼镜的橘猫",
    });
    expect(completion.outcome.images).toEqual([
      { content: "QkFTRTY0", mimeType: "image/png", filename: "atelier.png" },
    ]);
  });

  it("OSS 关闭：降级为仅带 images、content 无 resid", async () => {
    const imageClient = stubImageClient();

    const completion = await runGenerate({ imageClient });

    expect(completion.outcome.status).toBe("success");
    if (completion.outcome.status !== "success") {
      throw new Error("unreachable");
    }
    expect(JSON.parse(completion.outcome.content).resid).toBeUndefined();
    expect(completion.outcome.images).toHaveLength(1);
  });

  it("OSS put 失败：降级为无 resid，仍出图（不抛）", async () => {
    const imageClient = stubImageClient();
    const ossClient = {
      putObject: vi.fn().mockRejectedValue(new Error("oss down")),
    } as unknown as OssClient;

    const completion = await runGenerate({ imageClient, ossClient });

    expect(completion.outcome.status).toBe("success");
    if (completion.outcome.status !== "success") {
      throw new Error("unreachable");
    }
    expect(JSON.parse(completion.outcome.content).resid).toBeUndefined();
    expect(completion.outcome.images).toHaveLength(1);
  });

  it("生图失败：error outcome（run 抛错被 manager 兜住）", async () => {
    const imageClient = {
      generate: vi.fn().mockRejectedValue(new Error("codex 400")),
    } as unknown as ImageClient;

    const completion = await runGenerate({ imageClient });

    expect(completion.outcome.status).toBe("error");
    if (completion.outcome.status !== "error") {
      throw new Error("unreachable");
    }
    expect(completion.outcome.message).toContain("codex 400");
  });
});
