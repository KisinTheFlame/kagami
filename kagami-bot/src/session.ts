import { GroupMessage as NapcatGroupMessage, SendMessageSegment } from "node-napcat-ts";
import type { Receive } from "node-napcat-ts/dist/Structs.js";
import { ConnectionManager } from "./connection_manager.js";
import { getShanghaiTimestamp } from "./utils/timezone.js";

export interface BotMessage {
    thoughts: string[];
    chat?: SendMessageSegment[];
}

export interface GroupMessage {
    id: string;
    userId: number;
    userNickname?: string;
    chat: string;
    timestamp: string;
}

export type Message =
    | {
        type: "bot_msg";
        value: BotMessage;
    }
    | {
        type: "group_msg";
        value: GroupMessage;
    };

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

    async handleMessage(context: NapcatGroupMessage): Promise<void> {
        try {
            const userNickname = await this.connectionManager.getUserNickname(this.groupId, context.user_id);

            // 转换为自然语言格式
            const chatContent = await this.convertToNaturalLanguage(context.message);

            // 在消息前添加发送者信息（单独一行）
            const senderInfo = `${userNickname ?? "未知用户"}(${String(context.user_id)}):\n`;
            const fullChatContent = senderInfo + chatContent;

            const groupMessage: GroupMessage = {
                id: String(context.message_id),
                userId: context.user_id,
                userNickname,
                chat: fullChatContent,
                timestamp: getShanghaiTimestamp(),
            };

            const message: Message = {
                type: "group_msg",
                value: groupMessage,
            };

            const displayContent = this.formatMessageForDisplay(context.message);
            console.log(`[群 ${String(this.groupId)}] ${userNickname ?? "未知用户"}(${String(context.user_id)}) 发送消息: ${displayContent}`);

            if (this.messageHandler) {
                await this.messageHandler.handleMessage(message);
            }
        } catch (error) {
            console.error(`群 ${String(this.groupId)} 消息处理失败:`, error);
        }
    }


    private async convertToNaturalLanguage(messageArray: Receive[keyof Receive][]): Promise<string> {
        const parts: string[] = [];

        for (const segment of messageArray) {
            if (segment.type === "text" && "text" in segment.data && segment.data.text) {
                // 普通文本消息保持原样
                parts.push(segment.data.text);
            } else if (segment.type === "at" && "qq" in segment.data && segment.data.qq) {
                // @消息格式化
                const atUserId = Number(segment.data.qq);
                const atUserNickname = await this.connectionManager.getUserNickname(this.groupId, atUserId);
                parts.push(`@${atUserNickname ?? "未知用户"}(${segment.data.qq}) `);
            } else if (segment.type === "reply" && "id" in segment.data) {
                // 回复消息格式化
                const replyMessageId = Number(segment.data.id);
                const replyDetail = await this.connectionManager.getMessageDetail(replyMessageId);
                if (replyDetail) {
                    const replyNickname = replyDetail.sender.nickname;
                    const replyUserId = replyDetail.sender.user_id;
                    const replyContent = await this.formatReplyContent(replyDetail.message);
                    // 处理多行消息
                    const quotedContent = replyContent.split("\n").map(line => `> ${line}`).join("\n");
                    parts.push(`> ${replyNickname}(${String(replyUserId)})\uff1a\n${quotedContent}\n\n`);
                }
                // 如果获取不到原消息，就忽略这个回复段
            }
            // 其他类型暂时忽略
        }

        return parts.join("");
    }

    private async formatReplyContent(messageArray: Receive[keyof Receive][]): Promise<string> {
        const parts: string[] = [];

        for (const segment of messageArray) {
            if (segment.type === "text" && "text" in segment.data && segment.data.text) {
                // 普通文本消息保持原样
                parts.push(segment.data.text);
            } else if (segment.type === "at" && "qq" in segment.data && segment.data.qq) {
                // @消息格式化
                const atUserId = Number(segment.data.qq);
                const atUserNickname = await this.connectionManager.getUserNickname(this.groupId, atUserId);
                parts.push(`@${atUserNickname ?? "未知用户"}(${segment.data.qq}) `);
            }
            // 忽略reply类型的分片，避免嵌套回复
            // 其他类型也暂时忽略
        }

        return parts.join("");
    }

    private formatMessageForDisplay(messageArray: Receive[keyof Receive][]): string {
        const parts: string[] = [];

        for (const msg of messageArray) {
            if (msg.type === "text" && "text" in msg.data && msg.data.text) {
                parts.push(msg.data.text);
            } else if (msg.type === "at" && "qq" in msg.data && msg.data.qq) {
                parts.push(`@${msg.data.qq}`);
            } else if (msg.type === "reply" && "id" in msg.data) {
                parts.push(`[回复:${msg.data.id}]`);
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

    getGroupId(): number {
        return this.groupId;
    }
}
