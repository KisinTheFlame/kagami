import {
  type LoopRunDetailResponse,
  type LoopRunListQuery,
  type LoopRunListResponse,
} from "@kagami/shared/schemas/loop-run";

export interface LoopRunQueryService {
  getDetail(id: string): Promise<LoopRunDetailResponse>;
  queryList(query: LoopRunListQuery): Promise<LoopRunListResponse>;
}
