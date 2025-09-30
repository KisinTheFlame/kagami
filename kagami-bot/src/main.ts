import { SessionManager, newSessionManager } from "./session_manager.js";
import { newConfigManager } from "./config_manager.js";
import { newDatabase } from "./infra/db.js";
import { newLlmCallLogRepository } from "./infra/llm_call_log_repository.js";
import { newNapcatFacade } from "./connection_manager.js";
import { newPromptTemplateManager } from "./prompt_template_manager.js";
import { newLlmClientManager } from "./llm_client_manager.js";

class KagamiBot {
    private sessionManager: SessionManager;

    constructor(sessionManager: SessionManager) {
        this.sessionManager = sessionManager;
    }

    start(): void {
        console.log("Kagami 机器人启动成功");
        console.log(`活跃会话数量: ${String(this.sessionManager.getSessionCount())}`);

        this.setupGracefulShutdown();
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

export const newKagamiBot = (sessionManager: SessionManager) => {
    return new KagamiBot(sessionManager);
};

async function bootstrap() {
    try {
        console.log("正在初始化 Kagami 机器人...");

        // 1. 配置层
        console.log("正在加载配置...");
        const configManager = newConfigManager();
        console.log("配置加载成功");

        const napcatConfig = configManager.getNapcatConfig();
        console.log(`机器人 QQ 号码: ${String(napcatConfig.bot_qq)}`);
        console.log(`已配置 ${String(napcatConfig.groups.length)} 个群组:`, napcatConfig.groups);

        // 2. 基础设施层 - 数据访问
        console.log("正在初始化数据库连接...");
        const database = newDatabase();
        const llmCallLogRepository = newLlmCallLogRepository(database);

        // 3. 基础设施层 - 外部服务
        console.log("正在初始化 NapCat 连接...");
        const napcatFacade = await newNapcatFacade(configManager);
        const promptTemplateManager = newPromptTemplateManager();

        // 4. LLM 层
        console.log("正在初始化 LLM 客户端...");
        const llmClientManager = newLlmClientManager(configManager, llmCallLogRepository);

        // 5. 编排层
        console.log("正在初始化会话管理器...");
        const sessionManager = newSessionManager(
            configManager,
            napcatFacade,
            llmClientManager,
            promptTemplateManager,
        );

        // 6. 应用层
        const bot = newKagamiBot(sessionManager);

        console.log("Kagami 机器人初始化完成");
        return bot;
    } catch (error) {
        console.error("机器人初始化失败:", error);
        process.exit(1);
    }
}

async function main(): Promise<void> {
    const bot = await bootstrap();
    bot.start();

    console.log("机器人已运行");
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error: unknown) => {
        console.error("致命错误:", error);
        process.exit(1);
    });
}
