import type { ConfigManager } from "../../../config/config.manager.js";
import type { NapcatQqMessageDao } from "../../../napcat/infra/napcat-group-message.dao.js";
import { DefaultNapcatGatewayService } from "../../../napcat/application/napcat-gateway.impl.service.js";
import type { NapcatAgentEvent } from "../../../napcat/application/napcat-gateway.service.js";
import type { NapcatGatewayPersistenceWriter } from "../../../napcat/application/napcat-gateway/event-persistence-writer.js";
import type { NapcatImageMessageAnalyzer } from "../../../napcat/application/napcat-gateway/image-message-analyzer.js";
import type { AgentMessageService } from "../../capabilities/messaging/application/agent-message.service.js";
import { DefaultAgentMessageService } from "../../capabilities/messaging/application/default-agent-message.service.js";
import { PendingDraftStore } from "../../capabilities/messaging/application/pending-draft.store.js";
import { AiToneScorer } from "../../capabilities/messaging/infra/ai-tone-scorer.js";
import { SendMessageTool } from "../../capabilities/messaging/tools/send-message.tool.js";
import type { NotificationCenter } from "../../runtime/root-agent/notification/notification-center.js";
import { QqApp } from "./qq.app.js";

type BuildQqAppInput = {
  configManager: ConfigManager;
  /** napcat 网关的协作者：抓线持久化、图片消息分析、消息历史 DAO。由组合根注入。 */
  persistenceWriter: NapcatGatewayPersistenceWriter;
  imageMessageAnalyzer: NapcatImageMessageAnalyzer;
  qqMessageDao: NapcatQqMessageDao;
  notificationCenter: NotificationCenter;
  botQQ: string;
  listenGroupIds: string[];
  recentMessageLimit: number;
  aiTone: { enabled: boolean; blockThreshold: number };
};

export type QqAppBundle = {
  qqApp: QqApp;
  /** QQ 出站发送端口：send_message 工具与管理台直发 HTTP 都收口到这里，没人再碰裸网关。 */
  outboundService: AgentMessageService;
};

/**
 * 装配 QQ App 这条竖切——手机 OS 模型下 napcat 网关被「收纳」进 QQ App。
 *
 * 网关在这里构造、由 QqApp 独占持有：生命周期归 QqApp（onStartup 起 / onShutdown 停），
 * 出站发送统一走 outboundService（收口），不再有第二个消费方直接拿裸网关。网关的协作者
 * （持久化 / 图片分析 / DAO）仍由组合根构造后注入——它们是跨切面基础设施，不算 QQ 内部。
 *
 * 入站回调与发送之间是环依赖（网关 onEvent → QqApp.handleNapcatEvent；QqApp.send → 网关）。
 * 这里用一个局部 forward-ref（inbound holder）就地解掉，不再跨 server-runtime / factory 边界
 * 做 late-bind。回调只在网关 start() 之后才触发，那时 QqApp 必已装配完，holder 已回填。
 */
export async function buildQqApp({
  configManager,
  persistenceWriter,
  imageMessageAnalyzer,
  qqMessageDao,
  notificationCenter,
  botQQ,
  listenGroupIds,
  recentMessageLimit,
  aiTone,
}: BuildQqAppInput): Promise<QqAppBundle> {
  const inbound: { handle: (event: NapcatAgentEvent) => void } = {
    handle: () => {},
  };
  const napcatGateway = await DefaultNapcatGatewayService.create({
    configManager,
    enqueueGroupMessageEvent: event => {
      inbound.handle(event);
      return 0;
    },
    persistenceWriter,
    imageMessageAnalyzer,
    qqMessageDao,
  });
  const outboundService = new DefaultAgentMessageService({
    napcatGatewayService: napcatGateway,
  });
  const sendMessageTool = new SendMessageTool({
    agentMessageService: outboundService,
    aiToneScorer: new AiToneScorer(),
    pendingDraftStore: new PendingDraftStore(),
    aiTone,
  });
  const qqApp = new QqApp({
    napcatGateway,
    notificationCenter,
    botQQ,
    listenGroupIds,
    recentMessageLimit,
    sendMessageTool,
  });
  inbound.handle = event => qqApp.handleNapcatEvent(event);
  return { qqApp, outboundService };
}
