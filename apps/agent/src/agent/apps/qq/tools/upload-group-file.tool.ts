import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";
import type { OssClient } from "../../../../oss/oss-client.js";
import type {
  NapcatChatTarget,
  NapcatGatewayService,
} from "../../../../napcat/application/napcat-gateway.service.js";
import { errorNote, errorReason, resolveGroupChatId } from "./group-file-support.js";

const UploadGroupFileArgumentsSchema = z.object({
  resid: z.string().trim().min(1),
  name: z.string().trim().min(1),
  folder_id: z.string().trim().optional(),
});

/**
 * 把一个 OSS 资源（res-N）作为文件上传到当前群（OSS → QQ）。字节以 `base64://` 自包含形态
 * 发出，napcat 不需要访问 agent 的 OSS。只在当前打开的会话是群时可用。
 */
export class UploadGroupFileTool extends ZodToolComponent<typeof UploadGroupFileArgumentsSchema> {
  public readonly name = "upload_group_file";
  public readonly description =
    "把一个 OSS 资源（resid，形如 res-N）作为文件上传到当前群。name 是群里显示的文件名。" +
    "resid 可来自 download_group_file、upload_resource、或截图返回。只在你正打开一个群会话时可用。";
  public readonly parameters = {
    type: "object",
    properties: {
      resid: {
        type: "string",
        description: "要上传的资源 id，形如 res-N（含 res- 前缀）。",
      },
      name: {
        type: "string",
        description: "文件在群里显示的名字，如 report.pdf。",
      },
      folder_id: {
        type: "string",
        description: "可选，上传到的目标文件夹 id（取自 list_group_files）；不填传到根目录。",
      },
    },
    required: ["resid", "name"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = UploadGroupFileArgumentsSchema;
  private readonly getChatTarget: () => NapcatChatTarget | undefined;
  private readonly napcatGateway: NapcatGatewayService;
  private readonly ossClient: OssClient | null;
  private readonly fileMaxBytes: number;

  public constructor({
    getChatTarget,
    napcatGateway,
    ossClient,
    fileMaxBytes,
  }: {
    getChatTarget: () => NapcatChatTarget | undefined;
    napcatGateway: NapcatGatewayService;
    ossClient?: OssClient;
    fileMaxBytes: number;
  }) {
    super();
    this.getChatTarget = getChatTarget;
    this.napcatGateway = napcatGateway;
    this.ossClient = ossClient ?? null;
    this.fileMaxBytes = fileMaxBytes;
  }

  protected async executeTyped(
    input: z.infer<typeof UploadGroupFileArgumentsSchema>,
  ): Promise<ToolExecutionResult> {
    const group = resolveGroupChatId(this.getChatTarget());
    if (!group.ok) {
      return this.fail(group.error, "群文件是群能力。先 open_conversation 打开一个群会话再用。");
    }
    if (!this.ossClient) {
      return this.fail("RESOURCE_OSS_DISABLED", "OSS 未启用，无法读取要上传的资源。");
    }

    let bytes: Buffer;
    try {
      // 按文件 cap（非 4 MiB 上下文 cap）取字节：群文件可能远大于图片。
      const object = await this.ossClient.getObject(input.resid, { maxBytes: this.fileMaxBytes });
      bytes = object.bytes;
    } catch (error) {
      return this.fail(errorReason(error, "RESOURCE_NOT_FOUND"), errorNote(error));
    }

    // base64:// 自包含形态：napcat 通用 file resolver 直接吃，不依赖 napcat 访问 OSS。
    const fileRef = `base64://${bytes.toString("base64")}`;
    try {
      await this.napcatGateway.uploadGroupFile({
        groupId: group.groupId,
        fileRef,
        name: input.name,
        folderId: input.folder_id,
      });
    } catch (error) {
      return this.fail(errorReason(error, "NAPCAT_REQUEST_FAILED"), errorNote(error));
    }

    return {
      content: JSON.stringify({
        ok: true,
        resid: input.resid,
        name: input.name,
        note: "文件已上传到群。",
      }),
    };
  }

  private fail(error: string, note: string): ToolExecutionResult {
    return { content: JSON.stringify({ ok: false, error, note }) };
  }
}
