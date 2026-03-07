import type { NapcatGroupMessageListQuery, NapcatGroupMessageListResponse } from "@kagami/shared";

export interface NapcatGroupMessageQueryService {
  queryList(query: NapcatGroupMessageListQuery): Promise<NapcatGroupMessageListResponse>;
}
