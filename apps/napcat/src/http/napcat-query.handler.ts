import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/register";
import { napcatApiContract } from "@kagami/napcat-api/contract";
import type { NapcatEventWireItem, NapcatQqMessageWireItem } from "@kagami/napcat-api/query";
import type { NapcatEventDao, NapcatEventItem } from "../infra/napcat-event.dao.js";
import type { NapcatQqMessageDao, NapcatQqMessageItem } from "../infra/napcat-group-message.dao.js";

type NapcatQueryHandlerDeps = {
  napcatEventDao: NapcatEventDao;
  napcatQqMessageDao: NapcatQqMessageDao;
};

/**
 * console 只读查询端点（epic #539 子 issue 2）：napcat 独占库后，console 不再直读
 * napcat_event / napcat_qq_message，改经这两条契约路由查询。DB Date → ISO 字符串的
 * 序列化在此完成，console 侧拿到的就是 wire 形状、做纯转发聚合。
 */
export class NapcatQueryHandler {
  private readonly napcatEventDao: NapcatEventDao;
  private readonly napcatQqMessageDao: NapcatQqMessageDao;

  public constructor({ napcatEventDao, napcatQqMessageDao }: NapcatQueryHandlerDeps) {
    this.napcatEventDao = napcatEventDao;
    this.napcatQqMessageDao = napcatQqMessageDao;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, napcatApiContract.queryNapcatEvents, async ({ input }) => {
      const { page, pageSize, ...filters } = input;
      const [total, items] = await Promise.all([
        this.napcatEventDao.countByQuery(filters),
        this.napcatEventDao.listByQueryPage({ ...filters, page, pageSize }),
      ]);
      return { total, items: items.map(mapEventItem) };
    });

    registerJsonRoute(app, napcatApiContract.queryNapcatQqMessages, async ({ input }) => {
      const { page, pageSize, ...filters } = input;
      const [total, items] = await Promise.all([
        this.napcatQqMessageDao.countByQuery(filters),
        this.napcatQqMessageDao.listByQueryPage({ ...filters, page, pageSize }),
      ]);
      return { total, items: items.map(mapQqMessageItem) };
    });
  }
}

function mapEventItem(item: NapcatEventItem): NapcatEventWireItem {
  return {
    id: item.id,
    postType: item.postType,
    messageType: item.messageType,
    subType: item.subType,
    userId: item.userId,
    groupId: item.groupId,
    eventTime: item.eventTime ? item.eventTime.toISOString() : null,
    payload: item.payload,
    createdAt: item.createdAt.toISOString(),
  };
}

function mapQqMessageItem(item: NapcatQqMessageItem): NapcatQqMessageWireItem {
  return {
    id: item.id,
    messageType: item.messageType,
    subType: item.subType,
    groupId: item.groupId,
    userId: item.userId,
    nickname: item.nickname,
    messageId: item.messageId,
    message: item.message,
    eventTime: item.eventTime ? item.eventTime.toISOString() : null,
    payload: item.payload,
    createdAt: item.createdAt.toISOString(),
  };
}
