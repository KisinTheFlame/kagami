import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";
import { BizError } from "@kagami/kernel/errors/biz-error";
import type { ResourceFileService } from "../application/resource-file.service.js";

export const UPLOAD_RESOURCE_TOOL_NAME = "upload_resource";

const UploadResourceArgumentsSchema = z.object({
  path: z.string().trim().min(1),
});

/**
 * 把资源根目录（默认 ~/kagami）里的一个本地文件存进 OSS，得到一个 res-N，之后可被其他
 * 能力引用（如发到群、read_resource 调回）。是 download_resource 的反向操作。
 *
 * **全局工具**：和 read_resource / download_resource 同级。结果只回尾部，KV 友好。
 */
export class UploadResourceTool extends ZodToolComponent<typeof UploadResourceArgumentsSchema> {
  public readonly name = UPLOAD_RESOURCE_TOOL_NAME;
  public readonly description =
    "把资源根目录（默认 ~/kagami，与 terminal 工作目录重合）里的一个本地文件存进 OSS，" +
    "拿到一个 res-N，之后能被其他能力引用（发到群、read_resource 调回等）。" +
    "path 是根目录下的相对路径（不得逃出根目录）。";
  public readonly parameters = {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "要上传的本地文件路径，资源根目录下的相对路径（如 report.pdf 或 docs/a.zip）。",
      },
    },
    required: ["path"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = UploadResourceArgumentsSchema;
  private readonly resourceFileService: ResourceFileService;

  public constructor({ resourceFileService }: { resourceFileService: ResourceFileService }) {
    super();
    this.resourceFileService = resourceFileService;
  }

  protected async executeTyped(
    input: z.infer<typeof UploadResourceArgumentsSchema>,
  ): Promise<ToolExecutionResult> {
    try {
      const result = await this.resourceFileService.uploadFromFile({ path: input.path });
      return {
        content: JSON.stringify({
          ok: true,
          resid: result.resId,
          mime: result.mimeType,
          size: result.size,
          note: "本地文件已存进 OSS，可用这个 resid 引用它。",
        }),
      };
    } catch (error) {
      const reason =
        error instanceof BizError ? (error.meta?.reason ?? "UPLOAD_FAILED") : "UPLOAD_FAILED";
      return {
        content: JSON.stringify({
          ok: false,
          path: input.path,
          error: reason,
          note: error instanceof Error ? error.message : String(error),
        }),
      };
    }
  }
}
