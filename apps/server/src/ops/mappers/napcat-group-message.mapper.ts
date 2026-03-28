import type { NapcatGroupMessageItem, NapcatGroupMessageListResponse } from "@kagami/shared";
import type { NapcatGroupMessageItem as NapcatGroupMessageDaoItem } from "../../napcat/dao/napcat-group-message.dao.js";

type MapNapcatGroupMessageListInput = {
  page: number;
  pageSize: number;
  total: number;
  items: NapcatGroupMessageDaoItem[];
};

export function mapNapcatGroupMessageList(
  input: MapNapcatGroupMessageListInput,
): NapcatGroupMessageListResponse {
  return {
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      total: input.total,
    },
    items: input.items.map(mapNapcatGroupMessageItem),
  };
}

function mapNapcatGroupMessageItem(item: NapcatGroupMessageDaoItem): NapcatGroupMessageItem {
  return {
    id: item.id,
    groupId: item.groupId,
    userId: item.userId,
    nickname: item.nickname,
    messageId: item.messageId,
    message: item.message,
    eventTime: item.eventTime ? item.eventTime.toISOString() : null,
    payload: item.payload,
    createdAt: item.createdAt.toISOString(),
  };
}
