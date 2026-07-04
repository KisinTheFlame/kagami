import {
  type InnerThoughtListQuery,
  type InnerThoughtListResponse,
} from "@kagami/console-api/inner-thought";
import type { InnerThoughtDao } from "@kagami/persistence/dao/inner-thought.dao";
import type { InnerThoughtQueryService } from "./inner-thought-query.service.js";
import { mapInnerThoughtList } from "../mappers/inner-thought.mapper.js";

type DefaultInnerThoughtQueryServiceDeps = {
  innerThoughtDao: InnerThoughtDao;
};

export class DefaultInnerThoughtQueryService implements InnerThoughtQueryService {
  private readonly innerThoughtDao: InnerThoughtDao;

  public constructor({ innerThoughtDao }: DefaultInnerThoughtQueryServiceDeps) {
    this.innerThoughtDao = innerThoughtDao;
  }

  public async queryList(query: InnerThoughtListQuery): Promise<InnerThoughtListResponse> {
    const [total, items] = await Promise.all([
      this.innerThoughtDao.countByQuery(query),
      this.innerThoughtDao.listPage(query),
    ]);

    return mapInnerThoughtList({
      page: query.page,
      pageSize: query.pageSize,
      total,
      items,
    });
  }
}
