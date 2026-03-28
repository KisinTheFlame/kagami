import type { LoopRunDetailResponse, LoopRunListQuery, LoopRunListResponse } from "@kagami/shared";

export interface LoopRunQueryService {
  getDetail(id: string): Promise<LoopRunDetailResponse>;
  queryList(query: LoopRunListQuery): Promise<LoopRunListResponse>;
}
