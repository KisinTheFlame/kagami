import { Session, Message } from "./session.js";
import { NapcatConfig } from "./config.js";

export class SessionManager {
    private sessions: Map<number, Session>;
    private napcatConfig: NapcatConfig;

    constructor(napcatConfig: NapcatConfig) {
        this.sessions = new Map();
        this.napcatConfig = napcatConfig;
    }

    async initializeSessions(): Promise<void> {
        console.log("Initializing sessions for groups:", this.napcatConfig.groups);
        
        const initPromises = this.napcatConfig.groups.map(async groupId => {
            try {
                const session = new Session(groupId, this.napcatConfig);
                await session.connect();
                this.sessions.set(groupId, session);
                console.log(`Session initialized successfully for group ${String(groupId)}`);
            } catch (error) {
                console.error(`Failed to initialize session for group ${String(groupId)}:`, error);
            }
        });

        await Promise.allSettled(initPromises);
        console.log(`SessionManager initialized with ${String(this.sessions.size)} active sessions`);
    }

    shutdownAllSessions(): void {
        console.log("Shutting down all sessions...");
        
        for (const [groupId, session] of this.sessions) {
            try {
                session.disconnect();
                console.log(`Session for group ${String(groupId)} shut down`);
            } catch (error) {
                console.error(`Error shutting down session for group ${String(groupId)}:`, error);
            }
        }

        this.sessions.clear();
        console.log("All sessions shut down");
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
            console.error(`No session found for group ${String(groupId)}`);
            return false;
        }

        try {
            await session.sendMessage(content);
            return true;
        } catch (error) {
            console.error(`Failed to send message to group ${String(groupId)}:`, error);
            return false;
        }
    }

    async broadcastMessage(content: string): Promise<number> {
        const sendPromises = Array.from(this.sessions.entries()).map(async ([groupId, session]) => {
            try {
                await session.sendMessage(content);
                return true;
            } catch (error) {
                console.error(`Failed to broadcast message to group ${String(groupId)}:`, error);
                return false;
            }
        });

        const results = await Promise.allSettled(sendPromises);
        const successCount = results.filter(result => 
            result.status === "fulfilled" && result.value,
        ).length;

        console.log(`Broadcast message sent to ${String(successCount)}/${String(this.sessions.size)} sessions`);
        return successCount;
    }

    getAllMessages(): Map<number, Message[]> {
        const allMessages = new Map<number, Message[]>();
        for (const [groupId, session] of this.sessions) {
            allMessages.set(groupId, session.getMessages());
        }
        return allMessages;
    }

    getMessagesFromGroup(groupId: number): Message[] {
        const session = this.sessions.get(groupId);
        return session ? session.getMessages() : [];
    }

    clearMessagesFromGroup(groupId: number): boolean {
        const session = this.sessions.get(groupId);
        if (session) {
            session.clearMessages();
            return true;
        }
        return false;
    }

    clearAllMessages(): void {
        for (const session of this.sessions.values()) {
            session.clearMessages();
        }
        console.log("All message queues cleared");
    }

}
