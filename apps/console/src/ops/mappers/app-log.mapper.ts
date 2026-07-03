import { type AppLogItem, type AppLogListResponse } from "@kagami/console-api/app-log";
import type { AppLogItem as AppLogDaoItem } from "@kagami/kernel/logger/dao/log.dao";

type MapAppLogListInput = {
  page: number;
  pageSize: number;
  total: number;
  items: AppLogDaoItem[];
};

export function mapAppLogList(input: MapAppLogListInput): AppLogListResponse {
  return {
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      total: input.total,
    },
    items: input.items.map(mapAppLogItem),
  };
}

function mapAppLogItem(item: AppLogDaoItem): AppLogItem {
  return {
    id: item.id,
    traceId: item.traceId,
    level: item.level,
    message: item.message,
    metadata: item.metadata,
    createdAt: item.createdAt.toISOString(),
  };
}
