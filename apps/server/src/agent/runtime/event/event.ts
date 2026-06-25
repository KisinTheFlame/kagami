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

export type IthomeArticleIngestedEvent = {
  type: "ithome_article_ingested";
  data: {
    articleId: number;
    title: string;
  };
};

/**
 * Pure wake event. Produced by internal mechanisms (wait tool timers,
 * stop requests, reset notifications) that need to unblock a consumer
 * waiting on the event queue but have no business-level content to convey.
 *
 * Session routing treats it as a no-op.
 */
export type WakeEvent = {
  type: "wake";
};

export type StoryRecallStoryPayload = {
  id: string;
  markdown: string;
  createdAt: Date;
};

/**
 * Story recall 后台任务异步完成后，把召回到的故事以事件形式塞回主 Agent 的事件队列。
 * Session 在路由时把 stories 装配成 <story_recall> user message 并追加到上下文，
 * 同时触发新一轮 round，让主 Agent 想起记忆后继续行动。召回结果为空时不会发出该事件。
 */
export type StoryRecallCompletedEvent = {
  type: "story_recall_completed";
  data: {
    stories: StoryRecallStoryPayload[];
  };
};

export type Event =
  | NapcatGroupMessageEvent
  | NapcatPrivateMessageEvent
  | NapcatFriendListUpdatedEvent
  | IthomeArticleIngestedEvent
  | StoryRecallCompletedEvent
  | WakeEvent;
