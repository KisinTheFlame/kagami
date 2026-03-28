import type { LoopRunDetailResponse, LoopRunListQuery, LoopRunListResponse } from "@kagami/shared";
import type { LoopRunDao } from "../../agent/dao/loop-run.dao.js";
import { BizError } from "../../common/errors/biz-error.js";
import { mapLoopRunDetail, mapLoopRunList } from "../mappers/loop-run.mapper.js";
import type { LoopRunQueryService } from "./loop-run-query.service.js";

type DefaultLoopRunQueryServiceDeps = {
  loopRunDao: LoopRunDao;
};

export class DefaultLoopRunQueryService implements LoopRunQueryService {
  private readonly loopRunDao: LoopRunDao;

  public constructor({ loopRunDao }: DefaultLoopRunQueryServiceDeps) {
    this.loopRunDao = loopRunDao;
  }

  public async getDetail(id: string): Promise<LoopRunDetailResponse> {
    const item = await this.loopRunDao.findById(id);
    if (!item) {
      throw new BizError({
        message: "未找到对应的 Loop 记录",
        statusCode: 404,
      });
    }

    return mapLoopRunDetail(item);
  }

  public async queryList(query: LoopRunListQuery): Promise<LoopRunListResponse> {
    const filters = {
      status: query.status,
      groupId: query.groupId,
    };
    const [total, items] = await Promise.all([
      this.loopRunDao.countByQuery(filters),
      this.loopRunDao.listPage(query),
    ]);

    return mapLoopRunList({
      page: query.page,
      pageSize: query.pageSize,
      total,
      items,
    });
  }
}
