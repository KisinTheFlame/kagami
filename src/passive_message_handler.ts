import { BaseMessageHandler } from "./base_message_handler.js";
import { LlmClient } from "./llm.js";
import { Message, Session } from "./session.js";

export class PassiveMessageHandler extends BaseMessageHandler {
    constructor(
        llmClient: LlmClient,
        botQQ: number,
        groupId: number,
        session: Session,
        maxHistorySize = 40,
    ) {
        super(llmClient, botQQ, groupId, session, maxHistorySize);
    }

    async handleMessage(message: Message): Promise<void> {
        // 1. 保存用户消息到历史记录（只保存本群组消息）
        this.addMessageToHistory(message);

        // 2. 检查是否被 @
        if (this.isBotMentioned(message)) {
            await this.processAndReply();
        }
    }

    private isBotMentioned(message: Message): boolean {
        return message.content.some(item => 
            item.type === "at" && item.data.qq === this.botQQ.toString(),
        );
    }
}
