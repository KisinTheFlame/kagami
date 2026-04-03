import type { NapcatReceiveMessageSegment } from "./napcat-gateway/shared.js";
import {
  type NapcatSendPrivateMessageRequest,
  type NapcatSendPrivateMessageResponse,
  type NapcatSendGroupMessageRequest,
  type NapcatSendGroupMessageResponse,
} from "@kagami/shared/schemas/napcat-message";

export type NapcatSendGroupMessageInput = NapcatSendGroupMessageRequest;
export type NapcatSendGroupMessageResult = NapcatSendGroupMessageResponse;
export type NapcatSendPrivateMessageInput = NapcatSendPrivateMessageRequest;
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
}
