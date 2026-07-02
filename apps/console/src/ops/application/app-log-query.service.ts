import { type AppLogListQuery, type AppLogListResponse } from "@kagami/console-api/app-log";

export interface AppLogQueryService {
  queryList(query: AppLogListQuery): Promise<AppLogListResponse>;
}
