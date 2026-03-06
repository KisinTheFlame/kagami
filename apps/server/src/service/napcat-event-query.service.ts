import type { NapcatEventListQuery, NapcatEventListResponse } from "@kagami/shared";

export interface NapcatEventQueryService {
  queryList(query: NapcatEventListQuery): Promise<NapcatEventListResponse>;
}
