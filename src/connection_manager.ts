import { NCWebsocket } from "node-napcat-ts";
import { NapcatConfig } from "./config.js";

export type MessageDispatcher = (context: unknown) => void;

export class ConnectionManager {
    private napcat: NCWebsocket;
    private isConnected: boolean;
    private messageDispatcher?: MessageDispatcher;
    private napcatConfig: NapcatConfig;

    constructor(napcatConfig: NapcatConfig) {
        this.napcatConfig = napcatConfig;
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
            console.log("连接管理器连接成功");
        } catch (error) {
            console.error("连接管理器连接失败:", error);
            throw error;
        }
    }

    disconnect(): void {
        try {
            this.napcat.disconnect();
            this.isConnected = false;
            console.log("连接管理器已断开");
        } catch (error) {
            console.error("连接管理器断开失败:", error);
        }
    }

    setMessageDispatcher(dispatcher: MessageDispatcher): void {
        this.messageDispatcher = dispatcher;
    }

    private setupEventHandlers(): void {
        this.napcat.on("message.group", context => {
            if (this.messageDispatcher) {
                this.messageDispatcher(context);
            } else {
                console.warn("收到消息但未设置消息分发器");
            }
        });
    }

    async sendGroupMessage(groupId: number, content: string): Promise<void> {
        try {
            if (!this.isConnected) {
                throw new Error("连接管理器未连接");
            }

            await this.napcat.send_group_msg({
                group_id: groupId,
                message: [{ type: "text", data: { text: content } }],
            });
        } catch (error) {
            console.error(`群 ${String(groupId)} 消息发送失败:`, error);
            throw error;
        }
    }

    async getUserNickname(groupId: number, userId: number): Promise<string | undefined> {
        try {
            if (!this.isConnected) {
                return undefined;
            }
            const memberInfo = await this.napcat.get_group_member_info({
                group_id: groupId,
                user_id: userId,
            });
            return memberInfo.nickname || memberInfo.card || undefined;
        } catch (error) {
            console.error(`获取用户 ${String(userId)} 的昵称失败:`, error);
            return undefined;
        }
    }

    async getBotQQ(): Promise<number | undefined> {
        try {
            if (!this.isConnected) {
                return undefined;
            }
            const loginInfo = await this.napcat.get_login_info();
            return loginInfo.user_id;
        } catch (error) {
            console.error("获取机器人QQ号失败:", error);
            return undefined;
        }
    }

    isConnectionActive(): boolean {
        return this.isConnected;
    }

    getGroupIds(): number[] {
        return this.napcatConfig.groups;
    }
}
