import { z } from "zod";
import {
  createPaginatedResponseSchema,
  PaginationQuerySchema,
  parseOptionalStringInput,
} from "@kagami/http/wire";

// === kagami-oss 的控制台只读面 wire schema（对象浏览 + 存储统计） ===
//
// OSS 是数据 owner，自己出这份只读 JSON 契约给管理台（web 经 gateway `/oss-object` 前缀消费），
// Console 不代读 OSS 的私有 better-sqlite3 库。写操作（put/delete）仍只在二进制契约 ossApiContract
// 里、不进 gateway 分流表，浏览器永远够不到。

export const OssObjectListQuerySchema = PaginationQuerySchema.extend({
  // 可选按 mime 精确过滤（如 image/png）。
  mime: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
});

export type OssObjectListQuery = z.infer<typeof OssObjectListQuerySchema>;

export const OssObjectSummarySchema = z.object({
  /** 对外 key，形如 `res-<id>`。 */
  key: z.string().min(1),
  mime: z.string().min(1),
  /** 字节大小，取自去重后的 blob 行（权威）。 */
  size: z.number().int().nonnegative(),
  /** 内容哈希（内部去重键，此处仅作展示 / 排查用）。 */
  sha256: z.string().min(1),
  /** 多少个 object 共享此内容（refcount>1 即命中去重）。 */
  refcount: z.number().int().positive(),
  createdAt: z.string().datetime(),
});

export type OssObjectSummary = z.infer<typeof OssObjectSummarySchema>;

export const OssObjectListResponseSchema = createPaginatedResponseSchema(OssObjectSummarySchema);

export type OssObjectListResponse = z.infer<typeof OssObjectListResponseSchema>;

export const OssStatsResponseSchema = z.object({
  /** object 表行数（命名层，含去重后的重复引用）。 */
  objectCount: z.number().int().nonnegative(),
  /** blob 表行数（内容层，去重后的物理条目数）。 */
  blobCount: z.number().int().nonnegative(),
  /** SUM(blob.size)：去重后真实物理占用。 */
  physicalBytes: z.number().int().nonnegative(),
  /** SUM over objects 的 blob.size：不去重时的名义占用。 */
  logicalBytes: z.number().int().nonnegative(),
  /** logicalBytes - physicalBytes：内容寻址去重省下的字节。 */
  dedupSavedBytes: z.number().int().nonnegative(),
});

export type OssStatsResponse = z.infer<typeof OssStatsResponseSchema>;
