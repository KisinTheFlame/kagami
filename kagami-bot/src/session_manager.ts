import { Session, newSession } from "./session.js";
import { newMessageHandler } from "./message_handler.js";
import { GroupMessage, SendMessageSegment } from "node-napcat-ts";
import { NapcatFacade } from "./connection_manager.js";
import { ConfigManager } from "./config_manager.js";
import { LlmClientManager } from "./llm_client_manager.js";
import { PromptTemplateManager } from "./prompt_template_manager.js";
import { newContextManager } from "./context_manager.js";

export class SessionManager {
    private sessions: Map<number, Session>;
    private napcatFacade: NapcatFacade;
    private configManager: ConfigManager;
    private llmClientManager: LlmClientManager;
    private promptTemplateManager: PromptTemplateManager;

    constructor(
        configManager: ConfigManager,
        napcatFacade: NapcatFacade,
        llmClientManager: LlmClientManager,
        promptTemplateManager: PromptTemplateManager,
    ) {
        this.sessions = new Map();
        this.configManager = configManager;
        this.napcatFacade = napcatFacade;
        this.llmClientManager = llmClientManager;
        this.promptTemplateManager = promptTemplateManager;
        this.napcatFacade.setMessageDispatcher(this.handleIncomingMessage.bind(this));
    }

    initializeSessions(): void {
        console.log("正在为群组初始化会话:", this.napcatFacade.getGroupIds());

        // 为每个群组创建 Session
        for (const groupId of this.napcatFacade.getGroupIds()) {
            try {
                const session = newSession(groupId, this.napcatFacade);
                const contextManager = newContextManager(this.configManager, this.promptTemplateManager);
                const handler = newMessageHandler(session, contextManager, this.llmClientManager);

                session.setMessageHandler(handler);
                this.sessions.set(groupId, session);

                console.log(`群 ${String(groupId)} 会话和处理器初始化成功`);
            } catch (error) {
                console.error(`群 ${String(groupId)} 初始化失败:`, error);
            }
        }

        console.log(`会话管理器初始化完成，共 ${String(this.sessions.size)} 个活跃会话`);
    }

    private handleIncomingMessage(context: GroupMessage): void {
        try {
            const groupId = context.group_id;
            const session = this.sessions.get(groupId);
            if (session) {
                void session.handleMessage(context);
            } else {
                console.warn(`收到群 ${String(groupId)} 的消息，但未找到对应的会话`);
            }
        } catch (error) {
            console.error("消息分发失败:", error);
        }
    }

    countSessions(): number {
        return this.sessions.size;
    }

    getConnectionStatus(): Map<number, boolean> {
        const status = new Map<number, boolean>();
        const isConnected = this.napcatFacade.isConnectionActive();
        for (const [groupId] of this.sessions) {
            status.set(groupId, isConnected);
        }
        return status;
    }

    async sendMessageToGroup(groupId: number, content: SendMessageSegment[]): Promise<boolean> {
        const session = this.sessions.get(groupId);
        if (!session) {
            console.error(`未找到群 ${String(groupId)} 的会话`);
            return false;
        }

        try {
            await session.sendMessage(content);
            return true;
        } catch (error) {
            console.error(`向群 ${String(groupId)} 发送消息失败:`, error);
            return false;
        }
    }
}

export const newSessionManager = (
    configManager: ConfigManager,
    napcatFacade: NapcatFacade,
    llmClientManager: LlmClientManager,
    promptTemplateManager: PromptTemplateManager,
) => {
    const instance = new SessionManager(configManager, napcatFacade, llmClientManager, promptTemplateManager);
    instance.initializeSessions();
    return instance;
};
