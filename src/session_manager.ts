import { Session } from "./session.js";
import { NapcatConfig, AgentConfig } from "./config.js";
import { LlmClient } from "./llm.js";
import { PassiveMessageHandler } from "./passive_message_handler.js";

export class SessionManager {
    private sessions: Map<number, Session>;
    private napcatConfig: NapcatConfig;
    private llmClient: LlmClient;
    private botQQ: number;
    private agentConfig?: AgentConfig;

    constructor(napcatConfig: NapcatConfig, llmClient: LlmClient, botQQ: number, agentConfig?: AgentConfig) {
        this.sessions = new Map();
        this.napcatConfig = napcatConfig;
        this.llmClient = llmClient;
        this.botQQ = botQQ;
        this.agentConfig = agentConfig;
    }

    async initializeSessions(): Promise<void> {
        console.log("正在为群组初始化会话:", this.napcatConfig.groups);
        
        const initPromises = this.napcatConfig.groups.map(async groupId => {
            try {
                const session = new Session(groupId, this.napcatConfig);
                await session.connect();
                
                // 为每个 Session 创建对应的 PassiveMessageHandler
                const handler = new PassiveMessageHandler(
                    this.llmClient,
                    this.botQQ,
                    groupId,
                    session,
                    this.agentConfig?.history_turns ?? 40,
                );
                
                session.setMessageHandler(handler);
                this.sessions.set(groupId, session);
                
                console.log(`群 ${String(groupId)} 会话和处理器初始化成功`);
            } catch (error) {
                console.error(`群 ${String(groupId)} 初始化失败:`, error);
            }
        });

        await Promise.allSettled(initPromises);
        console.log(`会话管理器初始化完成，共 ${String(this.sessions.size)} 个活跃会话`);
    }

    shutdownAllSessions(): void {
        console.log("正在关闭所有会话...");
        
        for (const [groupId, session] of this.sessions) {
            try {
                session.disconnect();
                console.log(`群 ${String(groupId)} 会话已关闭`);
            } catch (error) {
                console.error(`关闭群 ${String(groupId)} 会话失败:`, error);
            }
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
        for (const [groupId, session] of this.sessions) {
            status.set(groupId, session.isSessionConnected());
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
