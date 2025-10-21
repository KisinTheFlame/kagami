import { SendMessageSegment } from "node-napcat-ts";
import { Message } from "./session.js";
import { PromptTemplateManager } from "./prompt_template_manager.js";
import { getShanghaiTimestamp } from "./utils/timezone.js";
import type { ChatMessage } from "kagami-types/domain/llm";
import { ConfigManager } from "./config_manager.js";

type ThoughtItem = {
    type: "thought",
    content: string,
};

type ChatItem = {
    type: "chat",
    content: SendMessageSegment[],
};

type LlmResponseItem = ThoughtItem | ChatItem;

export class ContextManager {
    private messageHistory: Message[] = [];
    private maxHistorySize: number;
    private promptTemplateManager: PromptTemplateManager;
    private configManager: ConfigManager;

    constructor(configManager: ConfigManager, promptTemplateManager: PromptTemplateManager, maxHistorySize: number) {
        this.configManager = configManager;
        this.promptTemplateManager = promptTemplateManager;
        this.maxHistorySize = maxHistorySize;
    }

    addMessageToHistory(message: Message): void {
        this.messageHistory.push(message);

        // 使用 LRU 策略，保持最近 N 条消息
        if (this.messageHistory.length > this.maxHistorySize) {
            this.messageHistory.shift();
        }
    }

    buildChatMessages(): ChatMessage[] {
        // 使用Handlebars模板生成系统提示
        const napcatConfig = this.configManager.getNapcatConfig();
        const masterConfig = this.configManager.getMasterConfig();
        const systemPrompt = this.promptTemplateManager.generatePrompt({
            botQQ: napcatConfig.bot_qq,
            masterConfig,
            currentTime: getShanghaiTimestamp(),
        });

        const messages: ChatMessage[] = [
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

        // 检查最后一条消息是否是 LLM 的发言
        if (this.messageHistory.length > 0) {
            const lastMessage = this.messageHistory[this.messageHistory.length - 1];
            if (
                lastMessage.type === "bot_msg" &&
                lastMessage.value.chat &&
                lastMessage.value.chat.length > 0
            ) {
                // 追加系统提醒
                messages.push({
                    role: "user",
                    content: [{ type: "text", value: "<system-reminder>请注意，你刚刚才发过言，注意避免内容重复</system-reminder>" }],
                });
            }
        }

        return messages;
    }
}

export const newContextManager = (
    configManager: ConfigManager,
    promptTemplateManager: PromptTemplateManager,
    maxHistorySize?: number,
) => {
    const agentConfig = configManager.getAgentConfig();
    const actualMaxHistorySize = maxHistorySize ?? agentConfig?.history_turns ?? 40;
    return new ContextManager(configManager, promptTemplateManager, actualMaxHistorySize);
};
