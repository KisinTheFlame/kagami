import { SendMessageSegment } from "node-napcat-ts";
import { LlmClient } from "./llm.js";
import { Message, MessageHandler, Session, BotMessage } from "./session.js";
import { MasterConfig } from "./config.js";
import { PromptTemplateManager } from "./prompt_template_manager.js";
import { logger } from "./middleware/logger.js";
import { getShanghaiTimestamp } from "./utils/timezone.js";
import { ChatMessages } from "./llm_providers/types.js";

// 新的JSON数组结构化输出接口
interface ThoughtItem {
    type: "thought";
    content: string;
}

interface ChatItem {
    type: "chat";
    content: SendMessageSegment[];
}

type LlmResponseItem = ThoughtItem | ChatItem;
type LlmResponse = [ThoughtItem, ...LlmResponseItem[]];



export abstract class BaseMessageHandler implements MessageHandler {
    protected llmClient: LlmClient;
    protected botQQ: number;
    protected groupId: number;
    protected messageHistory: Message[] = [];
    protected maxHistorySize: number;
    protected promptTemplateManager: PromptTemplateManager;
    protected session: Session;
    protected masterConfig?: MasterConfig;

    constructor(
        llmClient: LlmClient,
        botQQ: number,
        groupId: number,
        session: Session,
        masterConfig?: MasterConfig,
        maxHistorySize = 40,
    ) {
        this.llmClient = llmClient;
        this.botQQ = botQQ;
        this.groupId = groupId;
        this.session = session;
        this.masterConfig = masterConfig;
        this.maxHistorySize = maxHistorySize;
        this.promptTemplateManager = new PromptTemplateManager();
    }

    abstract handleMessage(message: Message): Promise<void>;

    protected async processAndReply(): Promise<boolean> {
        let inputForLog = "";
        let status: "success" | "fail" = "fail";
        let llmResponse = "";
        
        try {
            // 构建数据结构和LLM请求
            const chatMessages = this.buildChatMessages();

            // 生成美观的输入字符串用于记录
            inputForLog = JSON.stringify(chatMessages, null, 2);
            
            llmResponse = await this.llmClient.oneTurnChat(chatMessages);
            
            // 如果LLM返回空字符串，说明调用失败
            if (llmResponse === "") {
                status = "fail";
                void logger.logLLMCall(status, inputForLog, "LLM调用失败");
                throw new Error("LLM调用失败");
            }
            
            status = "success";
            const { thoughts, reply } = this.parseResponse(llmResponse);

            // 记录成功的LLM调用
            void logger.logLLMCall(status, inputForLog, llmResponse);

            // 记录LLM的思考过程
            if (thoughts.length > 0) {
                console.log(`[群 ${String(this.groupId)}] LLM 思考:`);
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
            const errorMessage = error instanceof Error ? error.message : JSON.stringify(error, null, 2);
            
            // 记录失败的LLM调用
            if (inputForLog) {
                void logger.logLLMCall("fail", inputForLog, errorMessage);
            }
            
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

    private buildChatMessages(): ChatMessages[] {
        // 使用Handlebars模板生成系统提示
        const systemPrompt = this.promptTemplateManager.generatePrompt({
            botQQ: this.botQQ,
            masterConfig: this.masterConfig,
            currentTime: getShanghaiTimestamp(),
        });

        const messages: ChatMessages[] = [
            {
                role: "system",
                content: [{ type: "text", value: systemPrompt }],
            },
        ];

        this.messageHistory.forEach(msg => {
            switch (msg.type) {
                case "bot_msg": {
                    // Bot 的消息作为 assistant
                    const responseArray: LlmResponseItem[] = [];
                    
                    // 添加所有thoughts
                    msg.value.thoughts.forEach(thought => {
                        responseArray.push({ type: "thought", content: thought });
                    });
                    
                    // 添加chat（如果有）
                    if (msg.value.chat && msg.value.chat.length > 0) {
                        responseArray.push({ type: "chat", content: msg.value.chat });
                    }
                    
                    messages.push({
                        role: "assistant",
                        content: [{ type: "text", value: JSON.stringify(responseArray) }],
                    });
                    break;
                }
                case "group_msg": {
                    // 用户消息作为 user - 使用自然语言格式的chat字段
                    messages.push({
                        role: "user",
                        content: [{ type: "text", value: msg.value.chat }],
                    });
                    break;
                }
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

}
