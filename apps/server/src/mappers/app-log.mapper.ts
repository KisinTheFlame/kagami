import type { AppLogItem, AppLogListResponse } from "@kagami/shared";
import type { AppLogItem as AppLogDaoItem } from "../dao/log.dao.js";

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
