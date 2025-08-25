import { SendMessageSegment } from "node-napcat-ts";
import { ConnectionManager } from "./connection_manager.js";

export interface Message {
    id: string;
    groupId: number;
    userId: number;
    userNickname?: string;
    content: SendMessageSegment[];
    timestamp: Date;
    metadata?: {
        thoughts?: string[];
        hasReply?: boolean;
    };
}

export interface MessageHandler {
    handleMessage(message: Message): Promise<void>;
}

export class Session {
    private session_id: number;
    private connectionManager: ConnectionManager;
    private groupId: number;
    private messageHandler?: MessageHandler;

    constructor(groupId: number, connectionManager: ConnectionManager) {
        this.session_id = Math.random();
        this.groupId = groupId;
        this.connectionManager = connectionManager;
    }

    async handleMessage(context: unknown): Promise<void> {
        try {
            const ctx = context as {
                message_id: number;
                group_id: number;
                user_id: number;
                message: SendMessageSegment[];
            };

            const userNickname = await this.connectionManager.getUserNickname(this.groupId, ctx.user_id);

            const message: Message = {
                id: String(ctx.message_id),
                groupId: ctx.group_id,
                userId: ctx.user_id,
                userNickname,
                content: ctx.message,
                timestamp: new Date(),
            };

            const displayContent = this.formatMessageForDisplay(message.content);
            console.log(`[群 ${String(this.groupId)}] ${userNickname ?? "未知用户"}(${String(ctx.user_id)}) 发送消息: ${displayContent}`);

            if (this.messageHandler) {
                await this.messageHandler.handleMessage(message);
            }
        } catch (error) {
            console.error(`群 ${String(this.groupId)} 消息处理失败:`, error);
        }
    }


    private formatMessageForDisplay(messageArray: SendMessageSegment[]): string {
        const parts: string[] = [];

        for (const msg of messageArray) {
            if (msg.type === "text" && "text" in msg.data && msg.data.text) {
                parts.push(msg.data.text);
            } else if (msg.type === "at" && "qq" in msg.data && msg.data.qq) {
                parts.push(`@${msg.data.qq}`);
            }
        }

        return parts.join("");
    }


    async sendMessage(content: SendMessageSegment[]): Promise<void> {
        return this.connectionManager.sendGroupMessage(this.groupId, content);
    }

    setMessageHandler(handler: MessageHandler): void {
        this.messageHandler = handler;
    }
}
