import fs from "fs";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { LlmClient } from "./llm.js";
import { Message, MessageHandler, Session } from "./session.js";

interface LlmResponse {
    reply: string;
}

export class PassiveMessageHandler implements MessageHandler {
    private llmClient: LlmClient;
    private botQQ: number;
    private groupId: number;
    private messageHistory: Message[] = [];
    private maxHistorySize: number;
    private systemPrompt: string;
    private session: Session;

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

    async handleMessage(message: Message): Promise<void> {
        // 1. 保存用户消息到历史记录（只保存本群组消息）
        this.addMessageToHistory(message);

        // 2. 检查是否被 @
        if (message.mentions?.includes(this.botQQ)) {
            try {
                // 3. 构建 LLM 请求并生成回复
                const chatMessages = this.buildChatMessages();
                const llmResponse = await this.llmClient.oneTurnChat(chatMessages);
                const reply = this.parseResponse(llmResponse);

                // 4. 直接调用 this.session.sendMessage() 发送回复
                await this.session.sendMessage(reply);

                // 5. 将 bot 回复消息也加入历史记录
                const botMessage: Message = {
                    id: `bot_${String(Date.now())}`,
                    groupId: this.groupId,
                    userId: this.botQQ,
                    content: reply,
                    timestamp: new Date(),
                };
                this.addMessageToHistory(botMessage);

                console.log(`[群 ${String(this.groupId)}] LLM 回复成功: ${reply}`);
            } catch (error) {
                console.error(`[群 ${String(this.groupId)}] LLM 回复失败:`, error);
            }
        }
    }

    private loadSystemPrompt(): string {
        try {
            return fs.readFileSync("./static/prompt.txt", "utf-8").trim();
        } catch (error) {
            console.error("读取 prompt.txt 失败:", error);
            return "你是一个友好的群聊机器人。请以 JSON 格式回复: {\"reply\": \"你的回复\"}";
        }
    }

    private addMessageToHistory(message: Message): void {
        this.messageHistory.push(message);
        
        // 使用 LRU 策略，保持最近 N 条消息
        if (this.messageHistory.length > this.maxHistorySize) {
            this.messageHistory.shift();
        }
    }

    private buildChatMessages(): ChatCompletionMessageParam[] {
        const messages: ChatCompletionMessageParam[] = [
            { role: "system", content: this.systemPrompt },
        ];

        this.messageHistory.forEach(msg => {
            if (msg.userId === this.botQQ) {
                // Bot 的消息作为 assistant
                messages.push({
                    role: "assistant",
                    content: msg.content,
                });
            } else {
                // 用户消息作为 user
                messages.push({
                    role: "user",
                    content: `${msg.userNickname ?? String(msg.userId)}: ${msg.content}`,
                });
            }
        });

        return messages;
    }

    private parseResponse(content: string): string {
        try {
            const parsed = JSON.parse(content) as LlmResponse;
            return parsed.reply || "抱歉，我暂时无法回复。";
        } catch (error) {
            console.error("解析 LLM 响应失败:", error);
            return "抱歉，我暂时无法回复。";
        }
    }
}
