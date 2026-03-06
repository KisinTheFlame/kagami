import type { NapcatEventItem, NapcatEventListResponse } from "@kagami/shared";
import type { NapcatEventItem as NapcatEventDaoItem } from "../dao/napcat-event.dao.js";

type MapNapcatEventListInput = {
  page: number;
  pageSize: number;
  total: number;
  items: NapcatEventDaoItem[];
};

export function mapNapcatEventList(input: MapNapcatEventListInput): NapcatEventListResponse {
  return {
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      total: input.total,
    },
    items: input.items.map(mapNapcatEventItem),
  };
}

function mapNapcatEventItem(item: NapcatEventDaoItem): NapcatEventItem {
  return {
    id: item.id,
    postType: item.postType,
    messageType: item.messageType,
    subType: item.subType,
    userId: item.userId,
    groupId: item.groupId,
    rawMessage: item.rawMessage,
    eventTime: item.eventTime ? item.eventTime.toISOString() : null,
    payload: item.payload,
    createdAt: item.createdAt.toISOString(),
  };
}
