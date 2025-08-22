import { loadConfig } from "./config.js";
import { LlmClient } from "./llm.js";
import { SessionManager } from "./session_manager.js";

class KagamiBot {
    private sessionManager: SessionManager;
    private llmClient: LlmClient;

    constructor() {
        console.log("Initializing Kagami bot...");
        
        try {
            const config = loadConfig();
            console.log("Configuration loaded successfully");
            
            this.sessionManager = new SessionManager(config.napcat);
            this.llmClient = new LlmClient(config.llm);
            
            console.log(`Configured for ${String(config.napcat.groups.length)} groups:`, config.napcat.groups);
        } catch (error) {
            console.error("Failed to initialize bot:", error);
            process.exit(1);
        }
    }

    async start(): Promise<void> {
        try {
            console.log("Starting Kagami bot...");
            
            await this.sessionManager.initializeSessions();
            
            const connectionStatus = this.sessionManager.getConnectionStatus();
            console.log("Connection status:", connectionStatus);
            
            console.log("Kagami bot started successfully");
            console.log(`Active sessions: ${String(this.sessionManager.getSessionCount())}`);
            
            this.setupGracefulShutdown();
            
        } catch (error) {
            console.error("Failed to start bot:", error);
            process.exit(1);
        }
    }

    stop(): void {
        console.log("Stopping Kagami bot...");
        
        try {
            this.sessionManager.shutdownAllSessions();
            console.log("Kagami bot stopped successfully");
        } catch (error) {
            console.error("Error during shutdown:", error);
        }
    }

    private setupGracefulShutdown(): void {
        const shutdown = (signal: string) => {
            console.log(`Received ${signal}, shutting down gracefully...`);
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
    
    console.log("Bot is running. Press Ctrl+C to stop.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error: unknown) => {
        console.error("Fatal error:", error);
        process.exit(1);
    });

}
