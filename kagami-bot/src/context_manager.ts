import { SendMessageSegment } from "node-napcat-ts";
import { Message } from "./session.js";
import { MasterConfig } from "./config.js";
import { PromptTemplateManager } from "./prompt_template_manager.js";
import { getShanghaiTimestamp } from "./utils/timezone.js";
import { ChatMessages } from "./llm_providers/types.js";

interface ThoughtItem {
    type: "thought";
    content: string;
}

interface ChatItem {
    type: "chat";
    content: SendMessageSegment[];
}

type LlmResponseItem = ThoughtItem | ChatItem;

export class ContextManager {
    private botQQ: number;
    private groupId: number;
    private messageHistory: Message[] = [];
    private maxHistorySize: number;
    private promptTemplateManager: PromptTemplateManager;
    private masterConfig?: MasterConfig;

    constructor(
        botQQ: number,
        groupId: number,
        masterConfig?: MasterConfig,
        maxHistorySize = 40,
    ) {
        this.botQQ = botQQ;
        this.groupId = groupId;
        this.masterConfig = masterConfig;
        this.maxHistorySize = maxHistorySize;
        this.promptTemplateManager = new PromptTemplateManager();
    }

    addMessageToHistory(message: Message): void {
        this.messageHistory.push(message);

        // 使用 LRU 策略，保持最近 N 条消息
        if (this.messageHistory.length > this.maxHistorySize) {
            this.messageHistory.shift();
        }
    }

    buildChatMessages(): ChatMessages[] {
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

    getMessageHistory(): readonly Message[] {
        return this.messageHistory;
    }
}
