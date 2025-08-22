import { NCWebsocket } from "node-napcat-ts";
import { NapcatConfig } from "./config.js";

export interface Message {
    id: string;
    groupId: number;
    userId: number;
    userNickname?: string;
    content: string;
    timestamp: Date;
    mentions?: number[];
    rawMessage?: { type: string; data: { text?: string; qq?: string } }[];
}

export interface MessageHandler {
    handleMessage(message: Message): Promise<void>;
}

export class Session {
    private napcat: NCWebsocket;
    private groupId: number;
    private isConnected: boolean;
    private messageHandler?: MessageHandler;

    constructor(groupId: number, napcatConfig: NapcatConfig) {
        this.groupId = groupId;
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
            console.log(`群 ${String(this.groupId)} 会话连接成功`);
        } catch (error) {
            console.error(`群 ${String(this.groupId)} 会话连接失败:`, error);
            throw error;
        }
    }

    disconnect(): void {
        try {
            this.napcat.disconnect();
            this.isConnected = false;
            console.log(`群 ${String(this.groupId)} 会话已断开`);
        } catch (error) {
            console.error(`群 ${String(this.groupId)} 会话断开失败:`, error);
        }
    }

    private setupEventHandlers(): void {
        this.napcat.on("message.group", context => {
            if (context.group_id === this.groupId) {
                void this.handleMessage(context);
            }
        });

        // 注意：这里暂时不监听原生的连接事件，因为 node-napcat-ts 可能不直接提供这些事件
        // 连接状态通过其他方式管理
    }

    private async handleMessage(context: unknown): Promise<void> {
        try {
            const ctx = context as {
                message_id: number;
                group_id: number;
                user_id: number;
                message: { type: string; data: { text?: string; qq?: string } }[];
            };

            const { content, mentions } = this.extractMessageContent(ctx.message);
            const userNickname = await this.getUserNickname(ctx.user_id);

            const message: Message = {
                id: String(ctx.message_id),
                groupId: ctx.group_id,
                userId: ctx.user_id,
                userNickname,
                content,
                timestamp: new Date(),
                mentions,
                rawMessage: ctx.message,
            };

            const displayContent = this.formatMessageForDisplay(ctx.message);
            console.log(`[群 ${String(this.groupId)}] ${userNickname ?? "未知用户"}(${String(ctx.user_id)}) 发送消息: ${displayContent}`);
            if (mentions && mentions.length > 0) {
                console.log(`消息提及用户: ${mentions.join(", ")}`);
            }

            if (this.messageHandler) {
                await this.messageHandler.handleMessage(message);
            }
        } catch (error) {
            console.error(`群 ${String(this.groupId)} 消息处理失败:`, error);
        }
    }

    private extractMessageContent(messageArray: { type: string; data: { text?: string; qq?: string } }[]): { content: string; mentions?: number[] } {
        const textParts: string[] = [];
        const mentions: number[] = [];

        for (const msg of messageArray) {
            if (msg.type === "text" && msg.data.text) {
                textParts.push(msg.data.text);
            } else if (msg.type === "at" && msg.data.qq) {
                const qq = Number(msg.data.qq);
                if (!isNaN(qq)) {
                    mentions.push(qq);
                }
            }
        }

        return {
            content: textParts.join(""),
            mentions: mentions.length > 0 ? mentions : undefined,
        };
    }

    private formatMessageForDisplay(messageArray: { type: string; data: { text?: string; qq?: string } }[]): string {
        const parts: string[] = [];

        for (const msg of messageArray) {
            if (msg.type === "text" && msg.data.text) {
                parts.push(msg.data.text);
            } else if (msg.type === "at" && msg.data.qq) {
                parts.push(`@${msg.data.qq}`);
            }
        }

        return parts.join("");
    }

    private async getUserNickname(userId: number): Promise<string | undefined> {
        try {
            if (!this.isConnected) {
                return undefined;
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            const memberInfo = await (this.napcat as any).get_group_member_info({
                group_id: this.groupId,
                user_id: userId,
            });
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return
            return memberInfo.nickname ?? memberInfo.card ?? undefined;
        } catch (error) {
            console.error(`获取用户 ${String(userId)} 的昵称失败:`, error);
            return undefined;
        }
    }

    async sendMessage(content: string): Promise<void> {
        try {
            if (!this.isConnected) {
                throw new Error(`群 ${String(this.groupId)} 会话未连接`);
            }

            await this.napcat.send_group_msg({
                group_id: this.groupId,
                message: [{ type: "text", data: { text: content } }],
            });

            console.log(`[群 ${String(this.groupId)}] 消息发送成功: ${content}`);
        } catch (error) {
            console.error(`群 ${String(this.groupId)} 消息发送失败:`, error);
            throw error;
        }
    }

    setMessageHandler(handler: MessageHandler): void {
        this.messageHandler = handler;
    }

    getGroupId(): number {
        return this.groupId;
    }

    isSessionConnected(): boolean {
        return this.isConnected;
    }

    async getBotQQ(): Promise<number | undefined> {
        try {
            if (!this.isConnected) {
                return undefined;
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            const loginInfo = await (this.napcat as any).get_login_info();
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            return loginInfo.user_id as number;
        } catch (error) {
            console.error(`获取 群 ${String(this.groupId)} bot QQ号失败:`, error);
            return undefined;
        }
    }

}
