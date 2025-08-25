import { BaseMessageHandler } from "./base_message_handler.js";
import { EnergyManager } from "./energy_manager.js";
import { LlmClient } from "./llm.js";
import { Message, Session } from "./session.js";
import { BehaviorConfig } from "./config.js";

export class ActiveMessageHandler extends BaseMessageHandler {
    private energyManager: EnergyManager;
    private isLlmProcessing = false;
    private messageQueue: Message[] = [];

    constructor(
        llmClient: LlmClient,
        botQQ: number,
        groupId: number,
        session: Session,
        behaviorConfig: BehaviorConfig,
        maxHistorySize = 40,
    ) {
        super(llmClient, botQQ, groupId, session, maxHistorySize);
        
        this.energyManager = new EnergyManager(
            behaviorConfig.energy_max,
            behaviorConfig.energy_cost,
            behaviorConfig.energy_recovery_rate,
            behaviorConfig.energy_recovery_interval,
        );
    }

    async handleMessage(message: Message): Promise<void> {
        // 1. 将消息加入队列
        this.messageQueue.push(message);

        // 2. 触发队列处理（如果当前没有LLM处理中）
        if (!this.isLlmProcessing) {
            await this.processQueueLoop();
        }
    }

    private canReply(): boolean {
        // 检查体力值
        if (!this.energyManager.canSendMessage()) {
            console.log(`[群 ${String(this.groupId)}] 体力不足 (${this.energyManager.getEnergyStatus()})`);
            return false;
        }

        return true;
    }

    getEnergyStatus(): string {
        return this.energyManager.getEnergyStatus();
    }

    destroy(): void {
        this.energyManager.destroy();
    }

    private async processQueueLoop(): Promise<void> {
        if (this.isLlmProcessing) {
            return;
        }

        this.isLlmProcessing = true;

        try {
            while (this.messageQueue.length > 0) {
                // 1. 一次性取出所有消息并加入历史记录
                const messages = [...this.messageQueue];
                this.messageQueue.length = 0; // 清空队列
                
                // 将所有消息加入历史
                messages.forEach(message => {
                    this.addMessageToHistory(message);
                });

                // 2. 检查是否可以回复
                if (!this.canReply()) {
                    continue;
                }

                // 3. 消耗体力值
                if (!this.energyManager.consumeEnergy()) {
                    console.log(`[群 ${String(this.groupId)}] 体力不足，无法回复 (${this.energyManager.getEnergyStatus()})`);
                    continue;
                }

                // 4. 基于完整历史进行LLM对话
                const didReply = await this.processAndReply();
                
                // 5. 如果LLM选择不回复，退还体力值
                if (!didReply) {
                    this.energyManager.refundEnergy();
                    console.log(`[群 ${String(this.groupId)}] LLM 选择不回复，已退还体力`);
                }
            }
        } finally {
            this.isLlmProcessing = false;
        }
    }
}
