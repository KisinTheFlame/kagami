import { NCWebsocket } from "node-napcat-ts";
import { NapcatConfig } from "./config.js";

export interface Message {
    id: string;
    groupId: number;
    userId: number;
    content: string;
    timestamp: Date;
}

export class Session {
    private napcat: NCWebsocket;
    private groupId: number;
    private messageQueue: Message[];
    private isConnected: boolean;

    constructor(groupId: number, napcatConfig: NapcatConfig) {
        this.groupId = groupId;
        this.messageQueue = [];
        this.isConnected = false;
        
        this.napcat = new NCWebsocket({
            baseUrl: napcatConfig.base_url,
            accessToken: napcatConfig.access_token,
            reconnection: napcatConfig.reconnection,
        }, false);
    }

    async connect(): Promise<void> {
        try {
            await this.napcat.connect();
            this.setupEventHandlers();
            this.isConnected = true;
            console.log(`Session for group ${String(this.groupId)} connected successfully`);
        } catch (error) {
            console.error(`Failed to connect session for group ${String(this.groupId)}:`, error);
            throw error;
        }
    }

    disconnect(): void {
        try {
            this.napcat.disconnect();
            this.isConnected = false;
            console.log(`Session for group ${String(this.groupId)} disconnected`);
        } catch (error) {
            console.error(`Error disconnecting session for group ${String(this.groupId)}:`, error);
        }
    }

    private setupEventHandlers(): void {
        this.napcat.on("message.group", context => {
            if (context.group_id === this.groupId) {
                this.handleMessage(context);
            }
        });

        // 注意：这里暂时不监听原生的连接事件，因为 node-napcat-ts 可能不直接提供这些事件
        // 连接状态通过其他方式管理
    }

    private handleMessage(context: unknown): void {
        try {
            const ctx = context as {
                message_id: number;
                group_id: number;
                user_id: number;
                message: { type: string; data: { text: string } }[];
            };

            const message: Message = {
                id: String(ctx.message_id),
                groupId: ctx.group_id,
                userId: ctx.user_id,
                content: this.extractTextContent(ctx.message),
                timestamp: new Date(),
            };

            this.messageQueue.push(message);
            console.log(`Group ${String(this.groupId)} received message:`, message.content);
        } catch (error) {
            console.error(`Error handling message for group ${String(this.groupId)}:`, error);
        }
    }

    private extractTextContent(messageArray: { type: string; data: { text: string } }[]): string {
        return messageArray
            .filter(msg => msg.type === "text")
            .map(msg => msg.data.text)
            .join("");
    }

    async sendMessage(content: string): Promise<void> {
        try {
            if (!this.isConnected) {
                throw new Error(`Session for group ${String(this.groupId)} is not connected`);
            }

            await this.napcat.send_msg({
                user_id: this.groupId,
                message: [{ type: "text", data: { text: content } }],
            });

            console.log(`Message sent to group ${String(this.groupId)}: ${content}`);
        } catch (error) {
            console.error(`Failed to send message to group ${String(this.groupId)}:`, error);
            throw error;
        }
    }

    getMessages(): Message[] {
        return [...this.messageQueue];
    }

    clearMessages(): void {
        this.messageQueue = [];
    }

    getGroupId(): number {
        return this.groupId;
    }

    isSessionConnected(): boolean {
        return this.isConnected;
    }

}
