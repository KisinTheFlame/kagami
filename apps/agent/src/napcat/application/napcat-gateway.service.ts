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

/**
 * 出站发图：单一入口，按 target.chatType 内部分发 send_group_msg / send_private_msg。
 * `fileRef` 是 OneBot file 字段（send_resource 用 base64:// 形态，自包含、不依赖
 * napcat 能访问 OSS）。**不要记录 fileRef**——base64 串落库/日志会爆。
 */
export type NapcatSendImageInput = {
  target: NapcatChatTarget;
  fileRef: string;
  summary?: string;
  replyToMessageId?: number;
};
export type NapcatSendImageResult = { messageId: number };
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

/**
 * 群禁言 / 解禁事件（OneBot `notice_type: "group_ban"`）。全员禁言 / 解禁时 NapCat 的
 * `user_id` 为 0，这里归一化为 `targetUserId: null`（渲染层据此走「全员禁言」文案）。
 * operator/target 的显示名在网关侧复用成员名缓存解析，查不到为 null（渲染退化裸号）。
 */
export type NapcatGroupBanData = {
  groupId: string;
  subType: "ban" | "lift_ban";
  /** 被禁言人 QQ；全员禁言 / 解禁时为 null（NapCat user_id=0）。 */
  targetUserId: string | null;
  /** 被禁言人显示名（成员名缓存），查不到为 null，渲染层退化裸号。 */
  targetName: string | null;
  operatorUserId: string | null;
  operatorName: string | null;
  /** 禁言秒数；lift_ban 时为 0；payload 异常时降级为 0（见 spec D5）。 */
  durationSeconds: number;
  time: number | null;
};

export type NapcatGroupBanEvent = {
  type: "napcat_group_ban";
  data: NapcatGroupBanData;
};

export type NapcatAgentEvent =
  | NapcatGroupMessageEvent
  | NapcatPrivateMessageEvent
  | NapcatFriendListUpdatedEvent
  | NapcatGroupBanEvent;

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

/** 群文件系统里的一个文件。 */
export type NapcatGroupFileEntry = {
  fileId: string;
  fileName: string;
  size: number;
  uploadTime: number | null;
  uploaderName: string;
};

/** 群文件系统里的一个文件夹。 */
export type NapcatGroupFolderEntry = {
  folderId: string;
  folderName: string;
  fileCount: number;
};

/** 群文件某一层（根或某文件夹）的列表：子文件 + 子文件夹。 */
export type NapcatGroupFileListing = {
  files: NapcatGroupFileEntry[];
  folders: NapcatGroupFolderEntry[];
};

export interface NapcatGatewayService {
  start(): Promise<void>;
  stop(): Promise<void>;
  sendGroupMessage(input: NapcatSendGroupMessageInput): Promise<NapcatSendGroupMessageResult>;
  sendPrivateMessage(input: NapcatSendPrivateMessageInput): Promise<NapcatSendPrivateMessageResult>;
  sendImage(input: NapcatSendImageInput): Promise<NapcatSendImageResult>;
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
  /**
   * 列群文件某一层：folderId 省略取根目录（get_group_root_files），带上则取该文件夹
   * （get_group_files_by_folder）。fileCount 是向 napcat 请求的数量上限（默认由调用方给）。
   */
  listGroupFiles(input: {
    groupId: string;
    folderId?: string;
    fileCount?: number;
  }): Promise<NapcatGroupFileListing>;
  /** 拿一个群文件的下载 URL（get_group_file_url，返回腾讯 CDN 直链，agent 侧可直接拉取）。 */
  getGroupFileUrl(input: { groupId: string; fileId: string }): Promise<{ url: string }>;
  /**
   * 查某个群成员的禁言到期时间戳（get_group_member_info 的 shut_up_timestamp，epoch 秒）。
   * 返回该毫秒时间戳；未被禁言（0 / 过去时间 / 字段缺失 / 畸形响应）返回 null。发送失败
   * 兜底用（重启后内存禁言态丢失时，查一次判定小镜是否真被禁言）。调用方持 botQQ 传入。
   */
  getGroupMemberShutUp(input: { groupId: string; userId: string }): Promise<number | null>;
  /**
   * 上传一个文件到群（upload_group_file）。fileRef 走 napcat 通用 file resolver，用
   * `base64://` 形态自包含（不依赖 napcat 访问 agent 的 OSS）。**不要记录 fileRef**——base64 会爆日志。
   */
  uploadGroupFile(input: {
    groupId: string;
    fileRef: string;
    name: string;
    folderId?: string;
  }): Promise<void>;
}
