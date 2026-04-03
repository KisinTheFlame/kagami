import type {
  NapcatFriendInfo,
  NapcatGroupMessageData,
  NapcatPrivateMessageData,
} from "../../../napcat/service/napcat-gateway.service.js";

export type NapcatGroupMessageEvent = {
  type: "napcat_group_message";
  data: NapcatGroupMessageData;
};

export type NapcatPrivateMessageEvent = {
  type: "napcat_private_message";
  data: NapcatPrivateMessageData;
};

export type NapcatFriendListUpdatedEvent = {
  type: "napcat_friend_list_updated";
  data: {
    friends: NapcatFriendInfo[];
  };
};

export type NewsArticleIngestedEvent = {
  type: "news_article_ingested";
  data: {
    sourceKey: "ithome";
    articleId: number;
    title: string;
  };
};

export type Event =
  | NapcatGroupMessageEvent
  | NapcatPrivateMessageEvent
  | NapcatFriendListUpdatedEvent
  | NewsArticleIngestedEvent;
