import { type AppLogListQuery, type AppLogListResponse } from "@kagami/shared/schemas/app-log";

export interface AppLogQueryService {
  queryList(query: AppLogListQuery): Promise<AppLogListResponse>;
}
