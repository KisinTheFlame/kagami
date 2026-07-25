import { z } from "zod";
import { BizError } from "@kagami/kernel/errors/biz-error";
import { NonEmptyStringSchema, NonNegativeIntSchema, parseOrThrow } from "./wire-schemas.js";
import type { NapcatGatewayTransport } from "./transport.js";
import type { NapcatGroupFileListing } from "../napcat-gateway.service.js";

const GroupFileListingResponseSchema = z.object({
  files: z
    .array(
      z
        .object({
          file_id: NonEmptyStringSchema,
          file_name: z.string(),
          // 不同 napcat 版本字段名不一（file_size / size），两者都收，映射时兜底。
          file_size: NonNegativeIntSchema.optional(),
          size: NonNegativeIntSchema.optional(),
          upload_time: NonNegativeIntSchema.optional(),
          uploader_name: z.string().optional(),
        })
        .passthrough(),
    )
    .optional()
    .default([]),
  folders: z
    .array(
      z
        .object({
          folder_id: NonEmptyStringSchema,
          folder_name: z.string(),
          total_file_count: NonNegativeIntSchema.optional(),
        })
        .passthrough(),
    )
    .optional()
    .default([]),
});
const GroupFileUrlResponseSchema = z.object({
  url: NonEmptyStringSchema,
});

type GroupFileClientOptions = {
  request: NapcatGatewayTransport["request"];
};

/**
 * 群文件操作（列目录 / 取下载 URL / 上传）。从网关 god-service 拆出的协作对象——
 * 这三个动作与消息收发、好友表、转发缓存互不相干，自成一块。
 */
export class NapcatGroupFileClient {
  private readonly request: NapcatGatewayTransport["request"];

  public constructor({ request }: GroupFileClientOptions) {
    this.request = request;
  }

  public async list({
    groupId,
    folderId,
    fileCount,
  }: {
    groupId: string;
    folderId?: string;
    fileCount?: number;
  }): Promise<NapcatGroupFileListing> {
    const normalizedGroupId = parseOrThrow(NonEmptyStringSchema, groupId, {
      message: "groupId 必须是非空字符串",
      reason: "INVALID_GROUP_ID",
    });

    // folderId 省略 → 根目录；带上 → 该文件夹。两个 action 返回结构相同。
    const action = folderId ? "get_group_files_by_folder" : "get_group_root_files";
    const params: Record<string, unknown> = { group_id: normalizedGroupId };
    if (fileCount !== undefined) {
      params.file_count = fileCount;
    }
    if (folderId !== undefined) {
      params.folder_id = folderId;
    }

    const data = await this.request(action, params);
    const listing = parseOrThrow(GroupFileListingResponseSchema, data ?? {}, {
      message: "NapCat 返回的群文件列表结构无效",
      reason: "INVALID_GROUP_FILE_LISTING_RESPONSE",
    });

    return {
      files: listing.files.map(file => ({
        fileId: file.file_id,
        fileName: file.file_name,
        size: file.file_size ?? file.size ?? 0,
        uploadTime: file.upload_time ?? null,
        uploaderName: file.uploader_name ?? "",
      })),
      folders: listing.folders.map(folder => ({
        folderId: folder.folder_id,
        folderName: folder.folder_name,
        fileCount: folder.total_file_count ?? 0,
      })),
    };
  }

  public async getUrl({
    groupId,
    fileId,
  }: {
    groupId: string;
    fileId: string;
  }): Promise<{ url: string }> {
    const invalidArgs = {
      message: "groupId / fileId 必须是非空字符串",
      reason: "INVALID_GROUP_FILE_ARGS",
    };
    const normalizedGroupId = parseOrThrow(NonEmptyStringSchema, groupId, invalidArgs);
    const normalizedFileId = parseOrThrow(NonEmptyStringSchema, fileId, invalidArgs);

    const data = await this.request("get_group_file_url", {
      group_id: normalizedGroupId,
      file_id: normalizedFileId,
    });
    const parsed = parseOrThrow(GroupFileUrlResponseSchema, data ?? {}, {
      message: "NapCat 返回的群文件 URL 结构无效",
      reason: "INVALID_GROUP_FILE_URL_RESPONSE",
    });
    return { url: parsed.url };
  }

  public async upload({
    groupId,
    fileRef,
    name,
    folderId,
  }: {
    groupId: string;
    fileRef: string;
    name: string;
    folderId?: string;
  }): Promise<void> {
    const invalidArgs = {
      message: "groupId / name 必须是非空字符串",
      reason: "INVALID_GROUP_FILE_ARGS",
    };
    const normalizedGroupId = parseOrThrow(NonEmptyStringSchema, groupId, invalidArgs);
    const normalizedName = parseOrThrow(NonEmptyStringSchema, name, invalidArgs);
    if (fileRef.length === 0) {
      throw new BizError({
        message: "fileRef 不能为空",
        meta: { reason: "INVALID_GROUP_FILE_ARGS" },
      });
    }

    // fileRef 走 base64:// 自包含形态；**不记录 fileRef**（base64 串会爆日志）。
    const params: Record<string, unknown> = {
      group_id: normalizedGroupId,
      file: fileRef,
      name: normalizedName,
    };
    if (folderId !== undefined) {
      params.folder_id = folderId;
    }
    // 返回 null；transport.request 已在 retcode!=0 时抛 BizError，失败自动冒泡。
    await this.request("upload_group_file", params);
  }
}
