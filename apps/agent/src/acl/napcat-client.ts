import { createClient, type JsonClient } from "@kagami/rpc-client/client";
import { napcatApiContract } from "@kagami/napcat-api/contract";
import type {
  NapcatChatTarget,
  NapcatFriendInfo,
  NapcatForwardMessagePage,
  NapcatGetGroupInfoResponse,
  NapcatGroupFileListing,
  NapcatGroupMessageData,
  NapcatPersistableQqMessage,
  NapcatSendGroupMessageRequest,
  NapcatSendImageRequest,
  NapcatSendMessageResponse,
  NapcatSendPrivateMessageRequest,
} from "@kagami/napcat-api/message";

// napcat wire 类型的事实源是 @kagami/napcat-api/message；agent 侧消费方直接从那里导入
// （no-restricted-syntax 禁止 barrel/re-export）。

const NAPCAT_UNREACHABLE_MESSAGE = "NapCat 服务调用失败";
const DEFAULT_CLIENT_TIMEOUT_MS = 15_000;

/** 出站发送内部输入：wire request 之上 replyToMessageId 已是可选字段，这里直接复用。 */
export type NapcatSendGroupMessageInput = NapcatSendGroupMessageRequest;
export type NapcatSendPrivateMessageInput = NapcatSendPrivateMessageRequest;
export type NapcatSendImageInput = NapcatSendImageRequest;
export type NapcatChatTargetInput = NapcatChatTarget;

/**
 * agent 侧的 napcat 出站门面：把原 in-process 的 NapcatGatewayService 方法经 HTTP 打到独立的
 * kagami-napcat 进程（issue #347）。方法签名与旧 NapcatGatewayService（去掉 start/stop）一致，
 * 让 QqApp / messaging / 群文件工具近乎 drop-in——只把注入类型从 NapcatGatewayService 换成
 * NapcatClient。wire 信封的包/拆（{messages}、{shutUpUntilMs}、{friends}、{} 等）收在实现里。
 *
 * 入站事件不走这里——那是 SSE（NapcatEventSubscriber）。
 */
export interface NapcatClient {
  sendGroupMessage(input: NapcatSendGroupMessageInput): Promise<NapcatSendMessageResponse>;
  sendPrivateMessage(input: NapcatSendPrivateMessageInput): Promise<NapcatSendMessageResponse>;
  sendImage(input: NapcatSendImageInput): Promise<NapcatSendMessageResponse>;
  getFriendList(): Promise<NapcatFriendInfo[]>;
  getGroupInfo(input: { groupId: string }): Promise<NapcatGetGroupInfoResponse>;
  getRecentGroupMessages(input: {
    groupId: string;
    count: number;
  }): Promise<NapcatGroupMessageData[]>;
  getRecentPrivateMessages(input: {
    userId: string;
    count: number;
    messageSeq?: number;
  }): Promise<NapcatPersistableQqMessage[]>;
  getForwardMessages(input: {
    id: string;
    offset: number;
    limit: number;
  }): Promise<NapcatForwardMessagePage>;
  listGroupFiles(input: {
    groupId: string;
    folderId?: string;
    fileCount?: number;
  }): Promise<NapcatGroupFileListing>;
  getGroupFileUrl(input: { groupId: string; fileId: string }): Promise<{ url: string }>;
  /** 群成员禁言到期毫秒时间戳；未被禁言为 null。 */
  getGroupMemberShutUp(input: { groupId: string; userId: string }): Promise<number | null>;
  uploadGroupFile(input: {
    groupId: string;
    fileRef: string;
    name: string;
    folderId?: string;
  }): Promise<void>;
}

type FetchLike = typeof fetch;

export class HttpNapcatClient implements NapcatClient {
  private readonly api: JsonClient<typeof napcatApiContract>;

  public constructor({ baseUrl, fetch: fetchImpl }: { baseUrl: string; fetch?: FetchLike }) {
    this.api = createClient(napcatApiContract, {
      baseUrl,
      ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
      timeoutMs: DEFAULT_CLIENT_TIMEOUT_MS,
      unreachableMessage: NAPCAT_UNREACHABLE_MESSAGE,
    });
  }

  public sendGroupMessage(input: NapcatSendGroupMessageInput): Promise<NapcatSendMessageResponse> {
    return this.api.sendGroupMessage(input);
  }

  public sendPrivateMessage(
    input: NapcatSendPrivateMessageInput,
  ): Promise<NapcatSendMessageResponse> {
    return this.api.sendPrivateMessage(input);
  }

  public sendImage(input: NapcatSendImageInput): Promise<NapcatSendMessageResponse> {
    return this.api.sendImage(input);
  }

  public async getFriendList(): Promise<NapcatFriendInfo[]> {
    const { friends } = await this.api.getFriendList({});
    return friends;
  }

  public getGroupInfo(input: { groupId: string }): Promise<NapcatGetGroupInfoResponse> {
    return this.api.getGroupInfo(input);
  }

  public async getRecentGroupMessages(input: {
    groupId: string;
    count: number;
  }): Promise<NapcatGroupMessageData[]> {
    const { messages } = await this.api.getRecentGroupMessages(input);
    return messages;
  }

  public async getRecentPrivateMessages(input: {
    userId: string;
    count: number;
    messageSeq?: number;
  }): Promise<NapcatPersistableQqMessage[]> {
    const { messages } = await this.api.getRecentPrivateMessages(input);
    return messages;
  }

  public getForwardMessages(input: {
    id: string;
    offset: number;
    limit: number;
  }): Promise<NapcatForwardMessagePage> {
    return this.api.getForwardMessages(input);
  }

  public listGroupFiles(input: {
    groupId: string;
    folderId?: string;
    fileCount?: number;
  }): Promise<NapcatGroupFileListing> {
    return this.api.listGroupFiles(input);
  }

  public getGroupFileUrl(input: { groupId: string; fileId: string }): Promise<{ url: string }> {
    return this.api.getGroupFileUrl(input);
  }

  public async getGroupMemberShutUp(input: {
    groupId: string;
    userId: string;
  }): Promise<number | null> {
    const { shutUpUntilMs } = await this.api.getGroupMemberShutUp(input);
    return shutUpUntilMs;
  }

  public async uploadGroupFile(input: {
    groupId: string;
    fileRef: string;
    name: string;
    folderId?: string;
  }): Promise<void> {
    await this.api.uploadGroupFile(input);
  }
}
