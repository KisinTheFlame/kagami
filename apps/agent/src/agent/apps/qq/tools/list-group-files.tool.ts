import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";
import type { NapcatChatTarget } from "@kagami/napcat-api/message";
import type { NapcatClient } from "../../../../acl/napcat-client.js";
import { errorNote, errorReason, resolveGroupChatId } from "./group-file-support.js";

/** 向 napcat 请求的群文件数量上限。napcat 无 total/has_more 字段，只能按 returned vs requested 推断截断。 */
const LIST_FILE_COUNT = 100;

const ListGroupFilesArgumentsSchema = z.object({
  folder_id: z.string().trim().optional(),
});

/**
 * 列当前群的文件与文件夹。只在当前打开的会话是群时可用（私聊 / 未开会话报错）。folder_id
 * 省略看根目录，带上看该文件夹。结果只回尾部，不进稳定前缀。
 */
export class ListGroupFilesTool extends ZodToolComponent<typeof ListGroupFilesArgumentsSchema> {
  public readonly name = "list_group_files";
  public readonly description =
    "列出当前群的文件和文件夹（根目录，或用 folder_id 进某个文件夹）。只在你正打开一个群会话时可用。" +
    "返回每个文件的 file_id / 文件名 / 大小；file_id 用于 download_group_file 下载。";
  public readonly parameters = {
    type: "object",
    properties: {
      folder_id: {
        type: "string",
        description: "可选，要进入的文件夹 id（取自本工具返回的 folders）；不填看根目录。",
      },
    },
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = ListGroupFilesArgumentsSchema;
  private readonly getChatTarget: () => NapcatChatTarget | undefined;
  private readonly napcatGateway: NapcatClient;

  public constructor({
    getChatTarget,
    napcatGateway,
  }: {
    getChatTarget: () => NapcatChatTarget | undefined;
    napcatGateway: NapcatClient;
  }) {
    super();
    this.getChatTarget = getChatTarget;
    this.napcatGateway = napcatGateway;
  }

  protected async executeTyped(
    input: z.infer<typeof ListGroupFilesArgumentsSchema>,
  ): Promise<ToolExecutionResult> {
    const group = resolveGroupChatId(this.getChatTarget());
    if (!group.ok) {
      return {
        content: JSON.stringify({
          ok: false,
          error: group.error,
          note: "群文件是群能力。先 open_conversation 打开一个群会话再用。",
        }),
      };
    }

    try {
      const listing = await this.napcatGateway.listGroupFiles({
        groupId: group.groupId,
        folderId: input.folder_id,
        fileCount: LIST_FILE_COUNT,
      });
      // napcat 不返回总数，只能按「返回条数达到请求上限」推断可能被截断。
      const maybeTruncated = listing.files.length >= LIST_FILE_COUNT;
      return {
        content: JSON.stringify({
          ok: true,
          files: listing.files.map(file => ({
            file_id: file.fileId,
            name: file.fileName,
            size: file.size,
            uploader: file.uploaderName,
          })),
          folders: listing.folders.map(folder => ({
            folder_id: folder.folderId,
            name: folder.folderName,
            file_count: folder.fileCount,
          })),
          ...(maybeTruncated
            ? {
                note: `列表可能被上限截断（返回达 ${LIST_FILE_COUNT} 条）。用 folder_id 进子文件夹细分查看。`,
              }
            : {}),
        }),
      };
    } catch (error) {
      return {
        content: JSON.stringify({
          ok: false,
          error: errorReason(error, "NAPCAT_REQUEST_FAILED"),
          note: errorNote(error),
        }),
      };
    }
  }
}
