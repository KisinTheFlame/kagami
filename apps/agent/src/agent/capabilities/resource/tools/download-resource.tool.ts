import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";
import { BizError } from "@kagami/kernel/errors/biz-error";
import type { ResourceFileService } from "../application/resource-file.service.js";

const DOWNLOAD_RESOURCE_TOOL_NAME = "download_resource";

const DownloadResourceArgumentsSchema = z.object({
  resid: z.string().trim().min(1),
  filename: z.string().trim().min(1),
  dir: z.string().trim().optional(),
});

/**
 * 把一个 OSS 资源（res-N）落地成本地文件，交给 terminal 等能力处理。文件名由你给出，
 * 落进资源根目录（默认 ~/kagami，与 terminal 工作目录重合，落好后能直接 ls 到）。
 *
 * **全局工具**：和 read_resource / upload_resource 同级。结果只回尾部，KV 友好。
 */
export class DownloadResourceTool extends ZodToolComponent<typeof DownloadResourceArgumentsSchema> {
  public readonly name = DOWNLOAD_RESOURCE_TOOL_NAME;
  public readonly description =
    "把一个 OSS 资源（resid，形如 res-N）下载成本地文件，落进资源根目录（默认 ~/kagami，" +
    "与 terminal 工作目录重合）。filename 由你指定；dir 可选（根目录下的相对子目录）。" +
    "目标已存在会报错（不覆盖），换个名字再来。落好后可在 terminal 里直接操作该文件。";
  public readonly parameters = {
    type: "object",
    properties: {
      resid: {
        type: "string",
        description: "要下载的资源 id，形如 res-N（含 res- 前缀）。",
      },
      filename: {
        type: "string",
        description: "落地文件名（由你决定，不沿用资源自身的内容寻址名），如 report.pdf。",
      },
      dir: {
        type: "string",
        description:
          "可选，资源根目录下的相对子目录（如 docs）；不填则落在根目录。不得逃出根目录。",
      },
    },
    required: ["resid", "filename"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = DownloadResourceArgumentsSchema;
  private readonly resourceFileService: ResourceFileService;

  public constructor({ resourceFileService }: { resourceFileService: ResourceFileService }) {
    super();
    this.resourceFileService = resourceFileService;
  }

  protected async executeTyped(
    input: z.infer<typeof DownloadResourceArgumentsSchema>,
  ): Promise<ToolExecutionResult> {
    try {
      const result = await this.resourceFileService.downloadToFile({
        resId: input.resid,
        dir: input.dir,
        filename: input.filename,
      });
      return {
        content: JSON.stringify({
          ok: true,
          path: result.absolutePath,
          note: "资源已落地为本地文件，可在 terminal 里操作它。",
        }),
      };
    } catch (error) {
      // 顶层工具失败不享受 invoke 的 schema 追加提示，错误文案要自包含。
      const reason =
        error instanceof BizError ? (error.meta?.reason ?? "DOWNLOAD_FAILED") : "DOWNLOAD_FAILED";
      return {
        content: JSON.stringify({
          ok: false,
          error: reason,
          note: error instanceof Error ? error.message : String(error),
        }),
      };
    }
  }
}
