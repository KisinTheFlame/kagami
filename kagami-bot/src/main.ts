import { loadConfig, Config } from "./config.js";
import { LlmClient } from "./llm.js";
import { SessionManager } from "./session_manager.js";

class KagamiBot {
    private sessionManager?: SessionManager;
    private llmClient: LlmClient;
    private config: Config;

    constructor() {
        console.log("正在初始化 Kagami 机器人...");
        
        try {
            this.config = loadConfig();
            console.log("配置加载成功");
            
            if (!this.config.llm_providers) {
                throw new Error("配置文件缺少 llm_providers 配置项");
            }
            this.llmClient = new LlmClient(this.config.llm_providers, this.config.llm.model);
            
            console.log(`机器人 QQ 号码: ${String(this.config.napcat.bot_qq)}`);
            console.log(`已配置 ${String(this.config.napcat.groups.length)} 个群组:`, this.config.napcat.groups);
        } catch (error) {
            console.error("机器人初始化失败:", error);
            process.exit(1);
        }
    }


    async start(): Promise<void> {
        try {
            console.log("正在启动 Kagami 机器人...");
            
            this.sessionManager = new SessionManager(
                this.config.napcat, 
                this.llmClient, 
                this.config.napcat.bot_qq, 
                this.config.master,
                this.config.agent,
            );
            await this.sessionManager.initializeSessions();
            
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
            if (this.sessionManager) {
                this.sessionManager.shutdownAllSessions();
            }
            console.log("Kagami 机器人停止成功");
        } catch (error) {
            console.error("关闭过程中发生错误:", error);
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
