/**
 * claude-code 图片 File API 缓存端口：图片内容 sha256 → 已上传的 Anthropic file_id。
 * 让同一张图只上传一次（跨轮次 / 跨进程重启 / 跨会话）。impl 在 apps/llm（Prisma），
 * 镜像 EmbeddingCacheDao 的 port/impl 拆分。
 */

export type ClaudeFileCacheRecord = {
  contentSha256: string;
  fileId: string;
  // mimeType / sizeBytes 仅作诊断，当前解析逻辑只消费 fileId，不参与任何判定。
  mimeType: string;
  sizeBytes: number;
  // 最近使用时间：命中时刷新（节流）。GC 判据 = lastUsedAt 早于 idle cutoff 即回收（#433），
  // 也用于删除前的 freshness 复查（选中后被并发 touch 顶新则跳过）。
  lastUsedAt: Date;
};

/** save 入参不含 lastUsedAt：插入时由 impl 置 now（新上传即最近使用）。 */
export type ClaudeFileCacheSaveInput = {
  contentSha256: string;
  fileId: string;
  mimeType: string;
  sizeBytes: number;
};

export interface ClaudeFileCacheDao {
  findByHash(contentSha256: string): Promise<ClaudeFileCacheRecord | null>;
  /** upsert：并发/重启下同一 sha256 重复写入必须幂等，不得抛主键冲突。 */
  save(input: ClaudeFileCacheSaveInput): Promise<void>;
  /**
   * 命中时刷新 last_used_at（节流：仅当距上次刷新超过节流窗才真写，否则 0 行影响）。
   * 调用方须 best-effort 包裹（失败不得拖垮图片解析 / LLM 主请求）。
   */
  touch(contentSha256: string): Promise<void>;
  /** GC：取 last_used_at 早于 cutoff 的行（按 last_used_at 升序，最多 limit 条）。 */
  findIdle(params: { cutoff: Date; limit: number }): Promise<ClaudeFileCacheRecord[]>;
  /**
   * GC：按 content sha256 无条件删除本地行。对已远端删除（含 404）的 hash 必须无条件删——
   * 远端文件已没，本地行若留就是指向死 file_id 的 stale 条目，会让后续 findByHash 命中用坏 id
   * 让请求失败。故此处刻意不加 last_used_at 二次条件（那会制造 stale 行）。返回删除行数。
   */
  deleteByContentHashes(contentSha256: readonly string[]): Promise<number>;
}
