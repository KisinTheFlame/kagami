import { z } from "zod";
import { AsyncTool, type AsyncTaskManager, type AsyncTaskRunResult } from "@kagami/agent-runtime";
import { AppLogger } from "@kagami/kernel/logger/logger";
import type { ImageClient } from "../../../../acl/image-client.js";
import type { OssClient } from "../../../../acl/oss-client.js";

const GENERATE_TOOL_NAME = "generate";

const logger = new AppLogger({ source: "agent.atelier.generate" });

const Schema = z.object({
  prompt: z.string().trim().min(1),
});

// as const + 具名 const（非内联字面量）：JsonSchema 类型不含 required，内联传参会触发 excess property
// 检查；抽成 const 后按结构子类型赋值、额外 required 被接受（同 pixel 各工具的 parameters 声明）。
const GENERATE_PARAMETERS = {
  type: "object",
  properties: {
    prompt: {
      type: "string",
      description: "想画什么的文字描述，越具体越好（画面内容、风格、氛围）。",
    },
  },
  required: ["prompt"],
} as const;

type Deps = {
  imageClient: ImageClient;
  /** 生成图叠加落 OSS 拿 resid（供之后 send_resource 发群）；缺省（OSS 关闭）时图仍进视野、只是没 resid。 */
  ossClient?: OssClient;
  asyncTaskManager: AsyncTaskManager;
};

/**
 * 生图（异步）：把 prompt 交给 kagami-llm 的生图端点（走 codex 订阅额度、后端 gpt-image-2），生成是
 * 多秒操作故做成异步工具——调用立刻回占位、主循环不阻塞，出图后经 `<async_tool_result>` 尾部追加。
 * 完成时**原图直接进你的视野**（多模态块），并叠加落 OSS 拿 resid（之后 switch(qq) 用 send_resource 发群）。
 *
 * 只收 prompt：codex 后端忽略 size/quality、固定 1254×1254，暴露尺寸旋钮是误导（见 #503）。
 * 镜像 pixel render 的「落 OSS + 图进视野 + OSS 关闭则降级无 resid」，区别只在这里走异步回流路径。
 */
export function createAtelierGenerateTool({
  imageClient,
  ossClient,
  asyncTaskManager,
}: Deps): AsyncTool<typeof Schema> {
  const tryPutToOss = async (bytes: Buffer, mimeType: string): Promise<string | undefined> => {
    if (!ossClient) {
      return undefined;
    }
    try {
      return await ossClient.putObject({ bytes, mimeType });
    } catch (error) {
      logger.warn("生成图落 OSS 失败，降级为仅入视野", {
        event: "agent.atelier.generate.oss_put_failed",
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  };

  return new AsyncTool({
    name: GENERATE_TOOL_NAME,
    description:
      "根据文字描述生成一张图、进你的视野，同时存档返回一个 resid。生成要花几秒，是异步的：先回一个占位，图好了会自己回到你眼前。",
    parameters: GENERATE_PARAMETERS,
    inputSchema: Schema,
    asyncTaskManager,
    prepareAsync: input => ({
      kind: "submit",
      run: async (): Promise<AsyncTaskRunResult> => {
        const result = await imageClient.generate({ prompt: input.prompt });
        const bytes = Buffer.from(result.imageBase64, "base64");
        const resid = await tryPutToOss(bytes, result.mimeType);
        const content = JSON.stringify({
          ok: true,
          ...(resid ? { resid } : {}),
          ...(result.revisedPrompt ? { revised_prompt: result.revisedPrompt } : {}),
          note: resid
            ? "图生成好了，已进入你的视野，也存了档（resid 见上，可用 send_resource 发出去）。"
            : "图生成好了，已进入你的视野（本次未落 OSS，无 resid）。",
        });
        return {
          content,
          images: [
            { content: result.imageBase64, mimeType: result.mimeType, filename: "atelier.png" },
          ],
        };
      },
    }),
  });
}
