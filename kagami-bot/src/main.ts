import { newSessionManager } from "./session_manager.js";
import { newConfigManager, HttpConfig } from "./config_manager.js";
import { newDatabase } from "./infra/db.js";
import { newLlmCallLogRepository } from "./infra/llm_call_log_repository.js";
import { newNapcatFacade } from "./connection_manager.js";
import { newPromptTemplateManager } from "./prompt_template_manager.js";
import { newLlmClientManager } from "./llm_client_manager.js";
import { createHttpServer } from "./api/server.js";
import { createLlmLogsRouter } from "./api/routes/llm_logs.js";

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
        newSessionManager(configManager, napcatFacade, llmClientManager, promptTemplateManager);

        console.log("Kagami 机器人已启动");

        console.log("正在初始化 HTTP 服务器...");

        // 7. HTTP Handler 层
        const httpConfig: HttpConfig = configManager.getHttpConfig();
        const llmLogsRouter = createLlmLogsRouter(llmCallLogRepository);

        // 8. HTTP 服务层
        await createHttpServer(llmLogsRouter, httpConfig);

        console.log(`HTTP 服务器已启动，监听端口 ${String(httpConfig.port)}`);
    } catch (error) {
        console.error("机器人初始化失败:", error);
        process.exit(1);
    }
}

async function main(): Promise<void> {
    await bootstrap();
    console.log("bootstrap 完成");
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error: unknown) => {
        console.error("致命错误:", error);
        process.exit(1);
    });
}
