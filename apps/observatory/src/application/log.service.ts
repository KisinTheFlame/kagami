import type {
  IngestLogsRequest,
  IngestLogsResponse,
  QueryLogsRequest,
  QueryLogsResponse,
} from "@kagami/observatory-api/log";
import type { AppLogItem, LogDao } from "@kagami/kernel/logger/dao/log.dao";

type LogServiceDeps = {
  logDao: LogDao;
};

/**
 * 日志摄取与查询（issue #608）。
 *
 * observatory 对日志的语义和它对告警的语义一样克制：**不认识任何调用方的领域**。它只负责
 * 「收下、落库、按条件查回来」，不解析 metadata、不因 level 触发任何动作。
 *（error/fatal 自动转告警是另一件事，明确不在本 issue 内。）
 *
 * 服务方法**永不外抛业务异常**：摄取失败让它冒到 Fastify 的默认错误处理器回 500——上报方是
 * fire-and-forget 的 sink，拿到 500 也只会记一行 stderr 然后丢批，不会重试、不会堆积。
 */
export class LogService {
  private readonly logDao: LogDao;

  public constructor({ logDao }: LogServiceDeps) {
    this.logDao = logDao;
  }

  public async ingest(request: IngestLogsRequest): Promise<IngestLogsResponse> {
    await this.logDao.insertBatch(
      request.items.map(item => ({
        service: request.service,
        traceId: item.traceId,
        level: item.level,
        message: item.message,
        metadata: item.metadata,
        createdAt: new Date(item.createdAt),
      })),
    );

    return { accepted: request.items.length };
  }

  public async query(request: QueryLogsRequest): Promise<QueryLogsResponse> {
    const { page, pageSize, ...filters } = request;
    const [total, items] = await Promise.all([
      this.logDao.countByQuery(filters),
      this.logDao.listByQueryPage({ ...filters, page, pageSize }),
    ]);

    return { total, items: items.map(toWireItem) };
  }
}

/** DB Date → ISO 序列化在数据属主侧完成，console 拿到的就是 wire 形状、做纯转发聚合。 */
function toWireItem(item: AppLogItem): QueryLogsResponse["items"][number] {
  return {
    id: item.id,
    service: item.service,
    traceId: item.traceId,
    level: item.level,
    message: item.message,
    metadata: item.metadata,
    createdAt: item.createdAt.toISOString(),
  };
}
