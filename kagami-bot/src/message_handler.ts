import { SendMessageSegment } from "node-napcat-ts";
import { Message, MessageHandler as IMessageHandler, Session, BotMessage } from "./session.js";
import { MasterConfig } from "./config.js";
import { ContextManager } from "./context_manager.js";
import { llmClientManager } from "./llm_client_manager.js";

// 新的JSON数组结构化输出接口
interface ThoughtItem {
    type: "thought";
    content: string;
}

interface ChatItem {
    type: "chat";
    content: SendMessageSegment[];
}

type ChatResponseItem = ThoughtItem | ChatItem;
type ChatResponse = [ThoughtItem, ...ChatResponseItem[]];

export class MessageHandler implements IMessageHandler {
    private contextManager: ContextManager;
    protected session: Session;

    // 来自ActiveMessageHandler的属性
    private isLlmProcessing = false;
    private hasPendingMessages = false;

    constructor(
        botQQ: number,
        groupId: number,
        session: Session,
        masterConfig?: MasterConfig,
        maxHistorySize = 40,
    ) {
        this.session = session;
        this.contextManager = new ContextManager(botQQ, groupId, masterConfig, maxHistorySize);
    }

    async handleMessage(message: Message): Promise<void> {
        // 1. 立即加入历史数组
        this.contextManager.addMessageToHistory(message);

        // 2. 标记有新消息（每次都设置）
        this.hasPendingMessages = true;

        // 3. 尝试启动处理（如果已在处理则直接返回）
        await this.tryProcessAndReply();
    }

    private async tryProcessAndReply(): Promise<void> {
        // 如果已经在处理中，直接返回（关键：避免并发）
        if (this.isLlmProcessing) {
            return;
        }

        // 开始处理循环
        this.isLlmProcessing = true;

        try {
            // 持续处理直到没有新消息
            while (this.hasPendingMessages) {
                // 重置标志（开始处理这一轮的消息）
                this.hasPendingMessages = false;

                // LLM处理（基于当前完整历史）
                await this.processAndReply();

                // 循环会自动检查 hasPendingMessages
                // 如果处理期间有新消息，hasPendingMessages 会被设置为 true
            }
        } finally {
            this.isLlmProcessing = false;
        }
    }

    protected async processAndReply(): Promise<void> {
        try {
            // 构建数据结构和LLM请求
            const chatMessages = this.contextManager.buildChatMessages();

            const llmResponse = await llmClientManager.callWithFallback({
                messages: chatMessages,
                tools: [],
                outputFormat: "json",
            });

            if (!llmResponse.content) {
                throw new Error("LLM 返回的响应中没有文本内容");
            }

            const { thoughts, reply } = this.parseResponse(llmResponse.content);

            // 记录LLM的思考过程
            if (thoughts.length > 0) {
                console.log(`[群 ${String(this.session.getGroupId())}] LLM 思考:`);
                thoughts.forEach((thought, index) => {
                    console.log(`  ${String(index + 1)}. ${thought}`);
                });
            }

            // 将LLM响应存储为新的BotMessage类型
            const botMessageValue: BotMessage = {
                thoughts,
                chat: reply,
            };

            const botMessage: Message = {
                type: "bot_msg",
                value: botMessageValue,
            };
            this.contextManager.addMessageToHistory(botMessage);

            // 如果有回复内容，则发送
            if (reply && reply.length > 0) {
                await this.session.sendMessage(reply);
            }
        } catch (error) {
            console.error(`[群 ${String(this.session.getGroupId())}] LLM 回复失败:`, error);
            throw error;
        }
    }

    protected parseResponse(content: string): { thoughts: string[], reply?: SendMessageSegment[] } {
        try {
            const parsed = JSON.parse(content) as unknown;

            // 现在只支持数组格式
            if (Array.isArray(parsed)) {
                return this.parseArrayResponse(parsed as ChatResponse);
            }

            // 非数组格式不支持
            console.error("不支持的LLM响应格式，期望数组格式");
            return {
                thoughts: [],
                reply: undefined,
            };
        } catch (error) {
            console.error("解析 LLM 响应失败:", error);
            return {
                thoughts: [],
                reply: undefined,
            };
        }
    }

    private parseArrayResponse(response: ChatResponse): { thoughts: string[], reply?: SendMessageSegment[] } {
        const thoughts: string[] = [];
        let reply: SendMessageSegment[] | undefined;

        for (const item of response) {
            if (item.type === "thought") {
                thoughts.push(item.content);
            } else {
                // item.type === "chat"
                if (reply) {
                    console.warn("发现多个reply项，只使用第一个");
                } else {
                    reply = item.content;
                }
            }
        }

        return { thoughts, reply };
    }
}
