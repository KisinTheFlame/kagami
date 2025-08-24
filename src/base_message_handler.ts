import fs from "fs";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { SendMessageSegment } from "node-napcat-ts";
import { LlmClient } from "./llm.js";
import { Message, MessageHandler, Session } from "./session.js";

interface LlmResponse {
    reply?: SendMessageSegment[];
}

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

    protected async processAndReply(_message: Message): Promise<void> {
        try {
            // 构建 LLM 请求并生成回复
            const chatMessages = this.buildChatMessages();
            const llmResponse = await this.llmClient.oneTurnChat(chatMessages);
            const replyContent = this.parseResponse(llmResponse);

            // 发送回复
            await this.session.sendMessage(replyContent);

            // 将 bot 回复消息也加入历史记录
            const botMessage: Message = {
                id: `bot_${String(Date.now())}`,
                groupId: this.groupId,
                userId: this.botQQ,
                content: replyContent,
                timestamp: new Date(),
            };
            this.addMessageToHistory(botMessage);

            // 格式化显示消息
            const displayText = this.formatContentForDisplay(replyContent);
            console.log(`[群 ${String(this.groupId)}] LLM 回复成功: ${displayText}`);
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
        const messages: ChatCompletionMessageParam[] = [
            { role: "system", content: this.systemPrompt },
        ];

        this.messageHistory.forEach(msg => {
            if (msg.userId === this.botQQ) {
                // Bot 的消息作为 assistant - bot 消息的 content 现在是结构化数组
                messages.push({
                    role: "assistant",
                    content: JSON.stringify({ reply: msg.content }),
                });
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

    protected parseResponse(content: string): SendMessageSegment[] {
        try {
            const parsed = JSON.parse(content) as LlmResponse;
            return parsed.reply ?? [{ type: "text", data: { text: "抱歉，我暂时无法回复。" } }];
        } catch (error) {
            console.error("解析 LLM 响应失败:", error);
            return [{ type: "text", data: { text: "抱歉，我暂时无法回复。" } }];
        }
    }

    protected formatContentForDisplay(content: SendMessageSegment[]): string {
        const parts: string[] = [];
        
        for (const item of content) {
            if (item.type === "text" && item.data.text) {
                parts.push(item.data.text);
            } else if (item.type === "at" && item.data.qq) {
                parts.push(`@${item.data.qq}`);
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
