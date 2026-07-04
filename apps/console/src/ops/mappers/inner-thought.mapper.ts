import {
  type InnerThoughtItem,
  type InnerThoughtListResponse,
} from "@kagami/console-api/inner-thought";
import type { InnerThoughtSummary } from "@kagami/persistence/dao/inner-thought.dao";

type MapInnerThoughtListInput = {
  page: number;
  pageSize: number;
  total: number;
  items: InnerThoughtSummary[];
};

export function mapInnerThoughtList(input: MapInnerThoughtListInput): InnerThoughtListResponse {
  return {
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      total: input.total,
    },
    items: input.items.map(mapInnerThoughtItem),
  };
}

function mapInnerThoughtItem(item: InnerThoughtSummary): InnerThoughtItem {
  return {
    id: item.id,
    triggeredAt: item.triggeredAt.toISOString(),
    outcome: item.outcome,
    thought: item.thought,
    runtimeKey: item.runtimeKey,
    createdAt: item.createdAt.toISOString(),
  };
}
