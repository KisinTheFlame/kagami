import fs from "fs";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { SendMessageSegment } from "node-napcat-ts";
import { LlmClient } from "./llm.js";
import { Message, MessageHandler, Session } from "./session.js";

// 新的JSON数组结构化输出接口
interface ThoughtItem {
    type: "thought";
    content: string;
}

interface ReplyItem {
    type: "reply";
    content: SendMessageSegment[];
}

type LlmResponseItem = ThoughtItem | ReplyItem;
type LlmResponse = [ThoughtItem, ...LlmResponseItem[]];


export abstract class BaseMessageHandler implements MessageHandler {
    protected llmClient: LlmClient;
    protected botQQ: number;
    protected groupId: number;
    protected messageHistory: Message[] = [];
    protected maxHistorySize: number;
    protected systemPrompt: string;
    protected session: Session;

    constructor(
        llmClient: LlmClient,
        botQQ: number,
        groupId: number,
        session: Session,
        maxHistorySize = 40,
    ) {
        this.llmClient = llmClient;
        this.botQQ = botQQ;
        this.groupId = groupId;
        this.session = session;
        this.maxHistorySize = maxHistorySize;
        this.systemPrompt = this.loadSystemPrompt();
    }

    abstract handleMessage(message: Message): Promise<void>;

    protected async processAndReply(): Promise<boolean> {
        try {
            // 构建 LLM 请求并生成回复
            const chatMessages = this.buildChatMessages();
            const llmResponse = await this.llmClient.oneTurnChat(chatMessages);
            const { thoughts, reply } = this.parseResponse(llmResponse);

            // 记录LLM的思考过程
            if (thoughts.length > 0) {
                console.log(`[群 ${String(this.groupId)}] LLM 思考:`);
                thoughts.forEach((thought, index) => {
                    console.log(`  ${String(index + 1)}. ${thought}`);
                });
            }

            // 将完整的LLM响应存储到历史记录（包括思考和回复）
            const botMessage: Message = {
                id: `bot_${String(Date.now())}`,
                groupId: this.groupId,
                userId: this.botQQ,
                content: reply ?? [], // 存储实际的回复内容
                timestamp: new Date(),
                // 可以考虑在这里存储完整的响应，包括thoughts
                metadata: { thoughts, hasReply: !!reply },
            };
            this.addMessageToHistory(botMessage);

            // 如果有回复内容，则发送
            if (reply && reply.length > 0) {
                await this.session.sendMessage(reply); // 直接发送LLM生成的内容，让LLM自己决定是否包含reply段
                const displayText = this.formatContentForDisplay(reply);
                console.log(`[群 ${String(this.groupId)}] LLM 回复成功: ${displayText}`);
                return true;
            } else {
                console.log(`[群 ${String(this.groupId)}] LLM 选择不回复`);
                return false;
            }
        } catch (error) {
            console.error(`[群 ${String(this.groupId)}] LLM 回复失败:`, error);
            throw error;
        }
    }

    protected addMessageToHistory(message: Message): void {
        this.messageHistory.push(message);
        
        // 使用 LRU 策略，保持最近 N 条消息
        if (this.messageHistory.length > this.maxHistorySize) {
            this.messageHistory.shift();
        }
    }

    protected buildChatMessages(): ChatCompletionMessageParam[] {
        // 构建包含机器人QQ号的系统提示
        const systemPromptWithContext = `${this.systemPrompt}

<bot_context>
你的QQ号是: ${String(this.botQQ)}
</bot_context>`;

        const messages: ChatCompletionMessageParam[] = [
            { role: "system", content: systemPromptWithContext },
        ];

        this.messageHistory.forEach(msg => {
            if (msg.userId === this.botQQ) {
                // Bot 的消息作为 assistant
                if (msg.metadata?.thoughts) {
                    // 新格式：构建包含thoughts和reply的数组
                    const responseArray: LlmResponseItem[] = [];
                    
                    // 添加所有thoughts
                    msg.metadata.thoughts.forEach(thought => {
                        responseArray.push({ type: "thought", content: thought });
                    });
                    
                    // 添加reply（如果有）
                    if (msg.metadata.hasReply && msg.content.length > 0) {
                        responseArray.push({ type: "reply", content: msg.content });
                    }
                    
                    messages.push({
                        role: "assistant",
                        content: JSON.stringify(responseArray),
                    });
                } else {
                    // 没有metadata的历史消息，跳过（可能是旧数据）
                    console.warn(`[群 ${String(this.groupId)}] 发现没有metadata的bot消息，跳过`);
                }
            } else {
                // 用户消息作为 user - 传递完整的 Message JSON
                messages.push({
                    role: "user",
                    content: JSON.stringify(msg),
                });
            }
        });

        return messages;
    }

    protected parseResponse(content: string): { thoughts: string[], reply?: SendMessageSegment[] } {
        try {
            const parsed = JSON.parse(content) as unknown;
            
            // 现在只支持数组格式
            if (Array.isArray(parsed)) {
                return this.parseArrayResponse(parsed as LlmResponse);
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

    private parseArrayResponse(response: LlmResponse): { thoughts: string[], reply?: SendMessageSegment[] } {
        const thoughts: string[] = [];
        let reply: SendMessageSegment[] | undefined;

        for (const item of response) {
            if (item.type === "thought") {
                thoughts.push(item.content);
            } else {
                // item.type === "reply"
                if (reply) {
                    console.warn("发现多个reply项，只使用第一个");
                } else {
                    reply = item.content;
                }
            }
        }

        return { thoughts, reply };
    }


    protected formatContentForDisplay(content: SendMessageSegment[]): string {
        const parts: string[] = [];
        
        for (const item of content) {
            if (item.type === "text" && item.data.text) {
                parts.push(item.data.text);
            } else if (item.type === "at" && item.data.qq) {
                parts.push(`@${item.data.qq}`);
            } else if (item.type === "reply" && item.data.id) {
                parts.push(`[回复:${item.data.id}]`);
            }
        }
        
        return parts.join("");
    }

    private loadSystemPrompt(): string {
        try {
            return fs.readFileSync("./static/prompt.txt", "utf-8").trim();
        } catch (error) {
            console.error("读取 prompt.txt 失败:", error);
            return "你是一个友好的群聊机器人，名字是小镜。请以 JSON 格式回复: {\"reply\": \"你的回复\"}";
        }
    }
}
