import { mkdirSync } from "node:fs";
import path from "node:path";
// hnswlib-node 是 CommonJS 原生模块（module.exports = addon），命名导入在 Node ESM 下无法
// 静态解析，必须用默认导入拿到整个 exports 对象再解构。
import hnswlibNode from "hnswlib-node";

const { HierarchicalNSW } = hnswlibNode;
type HierarchicalNSW = InstanceType<typeof HierarchicalNSW>;

const SPACE_NAME = "cosine" as const;
const INITIAL_CAPACITY = 1024;
const HNSW_M = 16;
const HNSW_EF_CONSTRUCTION = 200;
const HNSW_RANDOM_SEED = 100;
const HNSW_QUERY_EF = 64;

export type VectorSearchHit = {
  label: number;
  score: number;
};

export type VectorIndexPoint = {
  label: number;
  vector: number[];
};

/**
 * Story 向量记忆的进程内 HNSW 索引（替代 pgvector）。
 *
 * 设计：SQLite 是唯一事实来源（每条 `story_memory_document` 行内存归一化向量的 JSON），
 * HNSW 仅是派生的内存索引。启动时由 {@link rebuildFrom} 从 SQLite 全量重建，因此索引文件
 * 缺失 / 损坏都不会造成数据丢失，也不存在「索引文件 ↔ DB 行」漂移问题。索引文件落在
 * `data/vector/` 下，作为当前向量集合的派生快照（满足持久化数据分门别类安放）。
 *
 * cosine 空间下 `searchKnn` 返回的 distance = 1 - 余弦相似度，故 `score = 1 - distance`，
 * 与原 pgvector `1 - (embedding <=> q)` 语义一致。label 直接用 `story_memory_document.id`。
 */
export class HnswVectorIndex {
  private readonly dimensions: number;
  private readonly indexFilePath: string;
  private index: HierarchicalNSW;

  public constructor({ dimensions, indexFilePath }: { dimensions: number; indexFilePath: string }) {
    this.dimensions = dimensions;
    this.indexFilePath = indexFilePath;
    this.index = this.createEmptyIndex(INITIAL_CAPACITY);
  }

  /** 从 SQLite 的全部向量行重建索引并落盘。启动补水时调用。 */
  public rebuildFrom(points: VectorIndexPoint[]): void {
    const capacity = Math.max(INITIAL_CAPACITY, points.length * 2);
    this.index = this.createEmptyIndex(capacity);
    for (const point of points) {
      if (point.vector.length === this.dimensions) {
        this.index.addPoint(point.vector, point.label, true);
      }
    }
    this.flush();
  }

  /** 写入 / 更新一个向量（label 已存在时会被新点覆盖）。 */
  public add(label: number, vector: number[]): void {
    if (vector.length !== this.dimensions) {
      return;
    }
    this.ensureCapacityForOneMore();
    this.index.addPoint(vector, label, true);
  }

  /** 软删除一个向量（从检索结果中排除）。label 不存在时忽略。 */
  public remove(label: number): void {
    try {
      this.index.markDelete(label);
    } catch {
      // label 不在索引中（例如该 story 此前没有向量），忽略即可。
    }
  }

  /** 余弦近邻检索，返回 `{ label, score }`，score 为余弦相似度。 */
  public search(vector: number[], topK: number): VectorSearchHit[] {
    if (vector.length !== this.dimensions) {
      return [];
    }
    const count = this.index.getCurrentCount();
    if (count === 0) {
      return [];
    }
    const k = Math.min(Math.max(1, topK), count);
    try {
      const result = this.index.searchKnn(vector, k);
      return result.neighbors.map((label, i) => ({
        label,
        score: 1 - result.distances[i],
      }));
    } catch {
      // 当软删除元素过多导致可检索数量不足时，searchKnn 可能抛错；退化为空结果。
      return [];
    }
  }

  /** 把当前索引快照写到磁盘。批量写完后由调用方触发一次即可。 */
  public flush(): void {
    mkdirSync(path.dirname(this.indexFilePath), { recursive: true });
    this.index.writeIndexSync(this.indexFilePath);
  }

  private ensureCapacityForOneMore(): void {
    if (this.index.getCurrentCount() >= this.index.getMaxElements()) {
      this.index.resizeIndex(this.index.getMaxElements() * 2);
    }
  }

  private createEmptyIndex(capacity: number): HierarchicalNSW {
    const index = new HierarchicalNSW(SPACE_NAME, this.dimensions);
    index.initIndex(capacity, HNSW_M, HNSW_EF_CONSTRUCTION, HNSW_RANDOM_SEED, true);
    index.setEf(HNSW_QUERY_EF);
    return index;
  }
}
