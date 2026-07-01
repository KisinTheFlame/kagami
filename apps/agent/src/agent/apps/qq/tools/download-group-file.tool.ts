import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";
import { detectMime } from "../../../../oss/detect-mime.js";
import type { OssClient } from "../../../../oss/oss-client.js";
import type {
  NapcatChatTarget,
  NapcatGatewayService,
} from "../../../../napcat/application/napcat-gateway.service.js";
import {
  downloadBytesWithCap,
  errorNote,
  errorReason,
  resolveGroupChatId,
  type FetchLike,
} from "./group-file-support.js";

const DownloadGroupFileArgumentsSchema = z.object({
  file_id: z.string().trim().min(1),
});

/**
 * 把一个群文件下载进 OSS，拿到一个 res-N（QQ → OSS）。之后可用 read_resource 调回视野、
 * 或 download_resource 落地成本地文件。只在当前打开的会话是群时可用。
 */
export class DownloadGroupFileTool extends ZodToolComponent<
  typeof DownloadGroupFileArgumentsSchema
> {
  public readonly name = "download_group_file";
  public readonly description =
    "把当前群里的一个文件下载进 OSS，拿到一个 res-N（之后可 read_resource 看、或 download_resource 落地成本地文件）。" +
    "file_id 取自 list_group_files。只在你正打开一个群会话时可用。";
  public readonly parameters = {
    type: "object",
    properties: {
      file_id: {
        type: "string",
        description: "要下载的群文件 id，取自 list_group_files 返回的 file_id。",
      },
    },
    required: ["file_id"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = DownloadGroupFileArgumentsSchema;
  private readonly getChatTarget: () => NapcatChatTarget | undefined;
  private readonly napcatGateway: NapcatGatewayService;
  private readonly ossClient: OssClient | null;
  private readonly fileMaxBytes: number;
  private readonly fetchImpl: FetchLike;

  public constructor({
    getChatTarget,
    napcatGateway,
    ossClient,
    fileMaxBytes,
    fetch: fetchImpl,
  }: {
    getChatTarget: () => NapcatChatTarget | undefined;
    napcatGateway: NapcatGatewayService;
    ossClient?: OssClient;
    fileMaxBytes: number;
    fetch?: FetchLike;
  }) {
    super();
    this.getChatTarget = getChatTarget;
    this.napcatGateway = napcatGateway;
    this.ossClient = ossClient ?? null;
    this.fileMaxBytes = fileMaxBytes;
    this.fetchImpl = fetchImpl ?? fetch;
  }

  protected async executeTyped(
    input: z.infer<typeof DownloadGroupFileArgumentsSchema>,
  ): Promise<ToolExecutionResult> {
    const group = resolveGroupChatId(this.getChatTarget());
    if (!group.ok) {
      return this.fail(group.error, "群文件是群能力。先 open_conversation 打开一个群会话再用。");
    }
    if (!this.ossClient) {
      return this.fail("RESOURCE_OSS_DISABLED", "OSS 未启用，无法把群文件存进资源库。");
    }

    let url: string;
    try {
      ({ url } = await this.napcatGateway.getGroupFileUrl({
        groupId: group.groupId,
        fileId: input.file_id,
      }));
    } catch (error) {
      return this.fail(errorReason(error, "NAPCAT_REQUEST_FAILED"), errorNote(error));
    }

    const downloaded = await downloadBytesWithCap({
      url,
      maxBytes: this.fileMaxBytes,
      fetchImpl: this.fetchImpl,
    });
    if (!downloaded.ok) {
      return this.fail(downloaded.reason, "群文件下载失败或超出大小上限。");
    }

    // 群文件多为非图（pdf/zip/docx）：detectMime 只认图片 magic，认不出回落 application/octet-stream
    // （OSS 认可的合法类型）。真实类型由后续 download_resource 时你给的文件名承载。
    const mimeType = detectMime(downloaded.bytes);
    let resid: string;
    try {
      resid = await this.ossClient.putObject({ bytes: downloaded.bytes, mimeType });
    } catch (error) {
      return this.fail(errorReason(error, "OSS_PUT_FAILED"), errorNote(error));
    }

    return {
      content: JSON.stringify({
        ok: true,
        resid,
        mime: mimeType,
        size: downloaded.bytes.byteLength,
        note: "群文件已存进 OSS。可用 read_resource 看它，或 download_resource 落地成本地文件。",
      }),
    };
  }

  private fail(error: string, note: string): ToolExecutionResult {
    return { content: JSON.stringify({ ok: false, error, note }) };
  }
}
