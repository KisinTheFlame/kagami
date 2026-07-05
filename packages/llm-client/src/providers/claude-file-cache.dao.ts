/**
 * claude-code 图片 File API 缓存端口：图片内容 sha256 → 已上传的 Anthropic file_id。
 * 让同一张图只上传一次（跨轮次 / 跨进程重启 / 跨会话）。impl 在 apps/llm（Prisma），
 * 镜像 EmbeddingCacheDao 的 port/impl 拆分。
 */

export type ClaudeFileCacheRecord = {
  contentSha256: string;
  fileId: string;
  // mimeType / sizeBytes 仅作诊断与将来的按大小 GC 之用，当前解析逻辑只消费 fileId，不参与任何判定。
  mimeType: string;
  sizeBytes: number;
};

export interface ClaudeFileCacheDao {
  findByHash(contentSha256: string): Promise<ClaudeFileCacheRecord | null>;
  /** upsert：并发/重启下同一 sha256 重复写入必须幂等，不得抛主键冲突。 */
  save(input: ClaudeFileCacheRecord): Promise<void>;
}
