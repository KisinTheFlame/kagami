import { loadConfig } from "./config.js";
import { LlmClient } from "./llm.js";
import { SessionManager } from "./session_manager.js";
import { Message } from "./session.js";

class KagamiBot {
    private sessionManager: SessionManager;
    private llmClient: LlmClient;
    private botQQ?: number;

    constructor() {
        console.log("正在初始化 Kagami 机器人...");
        
        try {
            const config = loadConfig();
            console.log("配置加载成功");
            
            this.sessionManager = new SessionManager(config.napcat);
            this.llmClient = new LlmClient(config.llm);
            
            console.log(`已配置 ${String(config.napcat.groups.length)} 个群组:`, config.napcat.groups);
        } catch (error) {
            console.error("机器人初始化失败:", error);
            process.exit(1);
        }
    }


    async start(): Promise<void> {
        try {
            console.log("正在启动 Kagami 机器人...");
            
            await this.sessionManager.initializeSessions();
            
            await this.initializeBotInfo();
            
            this.sessionManager.setMessageHandlerForAllSessions({
                handleMessage: async (message: Message) => {
                    try {
                        if (message.mentions && this.botQQ && message.mentions.includes(this.botQQ)) {
                            console.log(`[群 ${String(message.groupId)}] 机器人被 @，正在复读消息`);
                            await this.sessionManager.sendMessageToGroup(message.groupId, message.content);
                        }
                    } catch (error) {
                        console.error("处理消息失败:", error);
                    }
                },
            });
            
            const connectionStatus = this.sessionManager.getConnectionStatus();
            console.log("连接状态:", connectionStatus);
            
            console.log("Kagami 机器人启动成功");
            console.log(`活跃会话数量: ${String(this.sessionManager.getSessionCount())}`);
            
            this.setupGracefulShutdown();
            
        } catch (error) {
            console.error("机器人启动失败:", error);
            process.exit(1);
        }
    }

    stop(): void {
        console.log("正在停止 Kagami 机器人...");
        
        try {
            this.sessionManager.shutdownAllSessions();
            console.log("Kagami 机器人停止成功");
        } catch (error) {
            console.error("关闭过程中发生错误:", error);
        }
    }

    private async initializeBotInfo(): Promise<void> {
        try {
            const sessions = this.sessionManager.getAllSessions();
            const firstSession = sessions[0];
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            if (firstSession) {
                this.botQQ = await firstSession.getBotQQ();
                if (this.botQQ !== undefined) {
                    console.log(`机器人 QQ 号码: ${String(this.botQQ)}`);
                } else {
                    console.warn("无法获取机器人 QQ 号码");
                }
            }
        } catch (error) {
            console.error("获取机器人 QQ 号码失败:", error);
        }
    }

    private setupGracefulShutdown(): void {
        const shutdown = (signal: string) => {
            console.log(`接收到 ${signal} 信号，正在优雅关闭...`);
            this.stop();
            process.exit(0);
        };

        process.on("SIGINT", () => { shutdown("SIGINT"); });
        process.on("SIGTERM", () => { shutdown("SIGTERM"); });
    }
}

async function main(): Promise<void> {
    const bot = new KagamiBot();
    await bot.start();
    
    console.log("机器人正在运行中。按 Ctrl+C 停止。");
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error: unknown) => {
        console.error("致命错误:", error);
        process.exit(1);
    });

}
