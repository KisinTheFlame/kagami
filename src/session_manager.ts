import { Session } from "./session.js";
import { NapcatConfig, AgentConfig, BehaviorConfig } from "./config.js";
import { LlmClient } from "./llm.js";
import { PassiveMessageHandler } from "./passive_message_handler.js";
import { ActiveMessageHandler } from "./active_message_handler.js";
import { ConnectionManager } from "./connection_manager.js";

export class SessionManager {
    private sessions: Map<number, Session>;
    private activeHandlers = new Map<number, ActiveMessageHandler>();
    private connectionManager: ConnectionManager;
    private llmClient: LlmClient;
    private botQQ: number;
    private agentConfig?: AgentConfig;
    private behaviorConfig: BehaviorConfig;

    constructor(napcatConfig: NapcatConfig, llmClient: LlmClient, botQQ: number, behaviorConfig: BehaviorConfig, agentConfig?: AgentConfig) {
        this.sessions = new Map();
        this.connectionManager = new ConnectionManager(napcatConfig);
        this.connectionManager.setMessageDispatcher(this.handleIncomingMessage.bind(this));
        this.llmClient = llmClient;
        this.botQQ = botQQ;
        this.behaviorConfig = behaviorConfig;
        this.agentConfig = agentConfig;
    }

    async initializeSessions(): Promise<void> {
        console.log("正在为群组初始化会话:", this.connectionManager.getGroupIds());
        
        // 先连接 ConnectionManager
        await this.connectionManager.connect();
        
        // 为每个群组创建 Session（不再需要独立连接）
        for (const groupId of this.connectionManager.getGroupIds()) {
            try {
                const session = new Session(groupId, this.connectionManager);
                const maxHistory = this.agentConfig?.history_turns ?? 40;
                
                // 根据配置选择消息处理策略
                let handler;
                if (this.behaviorConfig.message_handler_type === "active") {
                    handler = new ActiveMessageHandler(
                        this.llmClient,
                        this.botQQ,
                        groupId,
                        session,
                        this.behaviorConfig,
                        maxHistory,
                    );
                    this.activeHandlers.set(groupId, handler);
                    console.log(`群 ${String(groupId)} 使用主动回复策略`);
                } else {
                    handler = new PassiveMessageHandler(
                        this.llmClient,
                        this.botQQ,
                        groupId,
                        session,
                        maxHistory,
                    );
                    console.log(`群 ${String(groupId)} 使用被动回复策略`);
                }
                
                session.setMessageHandler(handler);
                this.sessions.set(groupId, session);
                
                console.log(`群 ${String(groupId)} 会话和处理器初始化成功`);
            } catch (error) {
                console.error(`群 ${String(groupId)} 初始化失败:`, error);
            }
        }
        
        console.log(`会话管理器初始化完成，共 ${String(this.sessions.size)} 个活跃会话`);
    }

    private handleIncomingMessage(context: unknown): void {
        try {
            const ctx = context as {
                group_id: number;
                [key: string]: unknown;
            };

            const groupId = ctx.group_id;
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

    shutdownAllSessions(): void {
        console.log("正在关闭所有会话...");
        
        try {
            // 清理 ActiveMessageHandler 中的定时器
            for (const handler of this.activeHandlers.values()) {
                handler.destroy();
            }
            this.activeHandlers.clear();
            
            this.connectionManager.disconnect();
            console.log("连接管理器已关闭");
        } catch (error) {
            console.error("关闭连接管理器失败:", error);
        }

        this.sessions.clear();
        console.log("所有会话已关闭");
    }

    getSession(groupId: number): Session | undefined {
        return this.sessions.get(groupId);
    }

    getAllSessions(): Session[] {
        return Array.from(this.sessions.values());
    }

    getActiveGroupIds(): number[] {
        return Array.from(this.sessions.keys());
    }

    getSessionCount(): number {
        return this.sessions.size;
    }

    getConnectionStatus(): Map<number, boolean> {
        const status = new Map<number, boolean>();
        const isConnected = this.connectionManager.isConnectionActive();
        for (const [groupId] of this.sessions) {
            status.set(groupId, isConnected);
        }
        return status;
    }

    async sendMessageToGroup(groupId: number, content: string): Promise<boolean> {
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

    async broadcastMessage(content: string): Promise<number> {
        const sendPromises = Array.from(this.sessions.entries()).map(async ([groupId, session]) => {
            try {
                await session.sendMessage(content);
                return true;
            } catch (error) {
                console.error(`向群 ${String(groupId)} 广播消息失败:`, error);
                return false;
            }
        });

        const results = await Promise.allSettled(sendPromises);
        const successCount = results.filter(result => 
            result.status === "fulfilled" && result.value,
        ).length;

        console.log(`广播消息发送完成: ${String(successCount)}/${String(this.sessions.size)} 个会话`);
        return successCount;
    }
}
