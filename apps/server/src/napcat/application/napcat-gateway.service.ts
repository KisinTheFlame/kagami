import type { NapcatReceiveMessageSegment } from "./napcat-gateway/shared.js";
import {
  type NapcatSendPrivateMessageRequest,
  type NapcatSendPrivateMessageResponse,
  type NapcatSendGroupMessageRequest,
  type NapcatSendGroupMessageResponse,
} from "@kagami/shared/schemas/napcat-message";

/**
 * 出站消息的内部输入：在 HTTP wire schema 之上加一个**仅内部使用**的可选 `replyToMessageId`。
 * 带上它时，发送链路会前置一个 reply 段，让这条消息成为对目标消息的引用回复。HTTP 请求
 * schema（/napcat/group/send）保持纯净，不暴露该字段。
 */
export type NapcatSendGroupMessageInput = NapcatSendGroupMessageRequest & {
  replyToMessageId?: number;
};
export type NapcatSendGroupMessageResult = NapcatSendGroupMessageResponse;
export type NapcatSendPrivateMessageInput = NapcatSendPrivateMessageRequest & {
  replyToMessageId?: number;
};
export type NapcatSendPrivateMessageResult = NapcatSendPrivateMessageResponse;
export type NapcatGetGroupInfoInput = {
  groupId: string;
};
export type NapcatFriendInfo = {
  userId: string;
  nickname: string;
  remark: string | null;
};
export type NapcatGetGroupInfoResult = {
  groupId: string;
  groupName: string;
  memberCount: number;
  maxMemberCount: number;
  groupRemark: string;
  groupAllShut: boolean;
};

export type NapcatGroupMessageData = {
  groupId: string;
  userId: string;
  nickname: string;
  rawMessage: string;
  messageSegments: NapcatReceiveMessageSegment[];
  messageId: number | null;
  time: number | null;
};

export type NapcatGroupMessageEvent = {
  type: "napcat_group_message";
  data: NapcatGroupMessageData;
};

export type NapcatPrivateMessageData = {
  userId: string;
  nickname: string;
  remark: string | null;
  rawMessage: string;
  messageSegments: NapcatReceiveMessageSegment[];
  messageId: number | null;
  time: number | null;
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

export type NapcatAgentEvent =
  | NapcatGroupMessageEvent
  | NapcatPrivateMessageEvent
  | NapcatFriendListUpdatedEvent;

export type NapcatChatTarget =
  | {
      chatType: "group";
      groupId: string;
    }
  | {
      chatType: "private";
      userId: string;
    };

export type NapcatPersistableGroupMessageEvent = NapcatGroupMessageData & {
  payload: Record<string, unknown>;
};

export type NapcatPersistableQqMessage = {
  messageType: "group" | "private";
  subType: string;
  groupId: string | null;
  userId: string | null;
  nickname: string | null;
  rawMessage: string;
  messageSegments: NapcatReceiveMessageSegment[];
  messageId: number | null;
  time: number | null;
  payload: Record<string, unknown>;
};

/** 合并转发里的一条消息（已渲染、图片已经过 vision 描述）。 */
export type NapcatForwardMessageNode = {
  senderName: string;
  senderUserId: string | null;
  rawMessage: string;
  time: number | null;
};

/** view_forward 的一页结果：当页节点 + 转发内总条数（用于分页提示）。 */
export type NapcatForwardMessagePage = {
  nodes: NapcatForwardMessageNode[];
  total: number;
  offset: number;
};

export interface NapcatGatewayService {
  start(): Promise<void>;
  stop(): Promise<void>;
  sendGroupMessage(input: NapcatSendGroupMessageInput): Promise<NapcatSendGroupMessageResult>;
  sendPrivateMessage(input: NapcatSendPrivateMessageInput): Promise<NapcatSendPrivateMessageResult>;
  getFriendList?(): Promise<NapcatFriendInfo[]>;
  getGroupInfo(input: NapcatGetGroupInfoInput): Promise<NapcatGetGroupInfoResult>;
  getRecentGroupMessages(input: {
    groupId: string;
    count: number;
  }): Promise<NapcatGroupMessageData[]>;
  getRecentPrivateMessages(input: {
    userId: string;
    count: number;
    messageSeq?: number;
  }): Promise<NapcatPersistableQqMessage[]>;
  /**
   * 按 res_id 拉取一条合并转发消息的内容（OneBot get_forward_msg），按 offset/limit 分页。
   * 当页内的图片会经过 vision 描述;嵌套的合并转发只渲染成 [forward_id: ...] 占位,不递归展开。
   */
  getForwardMessages(input: {
    id: string;
    offset: number;
    limit: number;
  }): Promise<NapcatForwardMessagePage>;
}
