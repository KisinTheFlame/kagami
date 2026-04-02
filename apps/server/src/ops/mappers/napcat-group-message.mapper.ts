import {
  type NapcatQqMessageItem,
  type NapcatQqMessageListResponse,
} from "@kagami/shared/schemas/napcat-group-message";
import type { NapcatQqMessageItem as NapcatQqMessageDaoItem } from "../../napcat/dao/napcat-group-message.dao.js";

type MapNapcatQqMessageListInput = {
  page: number;
  pageSize: number;
  total: number;
  items: NapcatQqMessageDaoItem[];
};

export function mapNapcatQqMessageList(
  input: MapNapcatQqMessageListInput,
): NapcatQqMessageListResponse {
  return {
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      total: input.total,
    },
    items: input.items.map(mapNapcatQqMessageItem),
  };
}

function mapNapcatQqMessageItem(item: NapcatQqMessageDaoItem): NapcatQqMessageItem {
  return {
    id: item.id,
    messageType: item.messageType,
    subType: item.subType,
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
