import type { AppLogListQuery, AppLogListResponse } from "@kagami/shared";

export interface AppLogQueryService {
  queryList(query: AppLogListQuery): Promise<AppLogListResponse>;
}
