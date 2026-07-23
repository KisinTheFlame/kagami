import type { NapcatClient } from "../../../acl/napcat-client.js";
import type { AgentMessageService } from "../../capabilities/messaging/application/agent-message.service.js";
import { DefaultAgentMessageService } from "../../capabilities/messaging/application/default-agent-message.service.js";
import { GroupMuteStateStore } from "../../capabilities/messaging/application/group-mute-state.store.js";
import { PendingDraftStore } from "../../capabilities/messaging/application/pending-draft.store.js";
import { AiToneScorer } from "../../capabilities/messaging/infra/ai-tone-scorer.js";
import { SendMessageTool } from "../../capabilities/messaging/tools/send-message.tool.js";
import { SendResourceTool } from "../../capabilities/messaging/tools/send-resource.tool.js";
import type { ResourceService } from "../../capabilities/resource/application/resource.service.js";
import type { NotificationCenter } from "../../runtime/root-agent/notification/notification-center.js";
import type { OssClient } from "../../../acl/oss-client.js";
import { ListGroupFilesTool } from "./tools/list-group-files.tool.js";
import { DownloadGroupFileTool } from "./tools/download-group-file.tool.js";
import { UploadGroupFileTool } from "./tools/upload-group-file.tool.js";
import { QqApp } from "./qq.app.js";

type BuildQqAppInput = {
  /** 出站门面：打到独立的 kagami-napcat 进程（issue #347）。入站走 NapcatEventSubscriber（server-runtime）。 */
  napcatClient: NapcatClient;
  notificationCenter: NotificationCenter;
  /** 前台输入敲门端口（组合根组装的闭包：knock 计数 + enqueue foreground_input）。 */
  notifyForegroundInput: () => void;
  botQQ: string;
  creatorName: string;
  creatorQQ: string;
  blockedGroupIds: string[];
  recentMessageLimit: number;
  aiTone: { enabled: boolean; blockThreshold: number };
  /** 资源读取（send_resource 按 resid 取图字节）。OSS 关闭时调用层报错。 */
  resourceService: ResourceService;
  /** 群文件下载/上传要的 OSS client（putObject / 按大 cap getObject）。OSS 关闭则群文件降级报错。 */
  ossClient?: OssClient;
  /** 群文件下载/上传的字节上限（server.agent.resource.fileMaxBytes，独立于 4 MiB 上下文 cap）。 */
  fileMaxBytes: number;
};

export type QqAppBundle = {
  qqApp: QqApp;
  /** QQ 出站发送端口：send_message 工具与管理台直发 HTTP 都收口到这里（内部经 napcatClient 打 napcat）。 */
  outboundService: AgentMessageService;
};

/**
 * 装配 QQ App 这条竖切。napcat 拆成独立进程后（issue #347），网关不再由本 App 构造 / 持有：
 * 出站经注入的 `napcatClient`（HttpNapcatClient）打到 kagami-napcat；入站由 server-runtime 的
 * NapcatEventSubscriber 订阅 SSE 后喂 `qqApp.handleNapcatEvent`。本工厂只装配 App + 工具 + 出站门面。
 *
 * send_message 的发送目标 = QqApp 当前打开的会话：QqApp 与工具互为引用（工具问 App 当前会话，
 * App 持有工具），用一个局部 forward-ref 就地解环。
 */
export function buildQqApp({
  napcatClient,
  notificationCenter,
  notifyForegroundInput,
  botQQ,
  creatorName,
  creatorQQ,
  blockedGroupIds,
  recentMessageLimit,
  aiTone,
  resourceService,
  ossClient,
  fileMaxBytes,
}: BuildQqAppInput): QqAppBundle {
  // 禁言状态：QqApp（禁言事件写）与 outboundService（发送前读 + 兜底回填）共享同一实例。
  const muteStore = new GroupMuteStateStore();
  const outboundService = new DefaultAgentMessageService({
    napcatGatewayService: napcatClient,
    muteStore,
    botQQ,
  });
  const qqAppRef: { current: QqApp | undefined } = { current: undefined };
  const sendMessageTool = new SendMessageTool({
    agentMessageService: outboundService,
    aiToneScorer: new AiToneScorer(),
    pendingDraftStore: new PendingDraftStore(),
    aiTone,
    getChatTarget: () => qqAppRef.current?.getCurrentChatTarget(),
  });
  const sendResourceTool = new SendResourceTool({
    resourceService,
    agentMessageService: outboundService,
    getChatTarget: () => qqAppRef.current?.getCurrentChatTarget(),
  });
  // 群文件三件套：直接持 napcatClient + OSS + fileMaxBytes，getChatTarget 走同一个 forward-ref。
  const getChatTarget = () => qqAppRef.current?.getCurrentChatTarget();
  const listGroupFilesTool = new ListGroupFilesTool({ getChatTarget, napcatGateway: napcatClient });
  const downloadGroupFileTool = new DownloadGroupFileTool({
    getChatTarget,
    napcatGateway: napcatClient,
    ossClient,
    fileMaxBytes,
  });
  const uploadGroupFileTool = new UploadGroupFileTool({
    getChatTarget,
    napcatGateway: napcatClient,
    ossClient,
    fileMaxBytes,
  });
  const qqApp = new QqApp({
    napcatGateway: napcatClient,
    notificationCenter,
    notifyForegroundInput,
    botQQ,
    creatorName,
    creatorQQ,
    blockedGroupIds,
    recentMessageLimit,
    muteStore,
    sendMessageTool,
    sendResourceTool,
    listGroupFilesTool,
    downloadGroupFileTool,
    uploadGroupFileTool,
  });
  qqAppRef.current = qqApp;
  return { qqApp, outboundService };
}
