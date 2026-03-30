import type { NapcatGroupMessageData } from "../../../napcat/service/napcat-gateway.service.js";

export type NapcatGroupMessageEvent = {
  type: "napcat_group_message";
  data: NapcatGroupMessageData;
};

export type NewsArticleIngestedEvent = {
  type: "news_article_ingested";
  data: {
    sourceKey: "ithome";
    articleId: number;
    title: string;
  };
};

export type Event = NapcatGroupMessageEvent | NewsArticleIngestedEvent;
