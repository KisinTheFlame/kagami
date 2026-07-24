/**
 * ObjectStore 的纯决策逻辑（无 I/O、无 DB、无 fs）：对外 key 的编解码、blob 分片、临时文件
 * 判定、refcount 归零决策。抽出来单独放，既让 object-store.ts 只剩 I/O 编排，也让这些
 * 「一旦错就引用计数泄漏 / 误删 blob / 返回错对象」的纯逻辑能被纯单测钉死（禁真实 fs/DB）。
 */

const KEY_PREFIX = "res-";
const SHARD_PREFIX_LENGTH = 2;
/** 临时写入文件名里的标记：sweepOrphans 见到一律当孤儿回收。 */
const TEMP_ARTIFACT_MARKER = ".tmp-";

/** 由 object id 拼出对外 key（`res-<id>`）。与 {@link parseObjectKey} 共享同一前缀，单一事实源。 */
export function formatObjectKey(id: number): string {
  return `${KEY_PREFIX}${id}`;
}

/** 解析对外 key：`res-<正整数>` → id；前缀不对 / 非正整数 / 越界 → null（视作无映射）。 */
export function parseObjectKey(key: string): number | null {
  if (!key.startsWith(KEY_PREFIX)) {
    return null;
  }
  const rest = key.slice(KEY_PREFIX.length);
  if (!/^[0-9]+$/.test(rest)) {
    return null;
  }
  const id = Number(rest);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return null;
  }
  return id;
}

/** blob 的分片目录名（sha256 前 2 位十六进制）；物理路径 = blobDir/<shard>/<sha256>。 */
export function blobShard(sha256: string): string {
  return sha256.slice(0, SHARD_PREFIX_LENGTH);
}

/** 是否是崩溃残留的临时写入文件（含 tmp/ 目录里的）——一律视作可回收孤儿。 */
export function isTempArtifactName(name: string): boolean {
  return name.includes(TEMP_ARTIFACT_MARKER);
}

/**
 * 解引用（删一个 object）后，这个 blob 是否应连行带物理文件一起删。refcount ≤ 1（即当前
 * 是最后一个引用）就删；否则只做 -1。仅在 blob 行确实存在时调用（缺失由调用方短路）。
 */
export function shouldDeleteBlobAfterUnref(refcount: number): boolean {
  return refcount <= 1;
}
