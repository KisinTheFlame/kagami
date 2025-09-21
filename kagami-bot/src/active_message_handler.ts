import { BaseMessageHandler } from "./base_message_handler.js";
import { EnergyManager } from "./energy_manager.js";
import { LlmClient } from "./llm.js";
import { Message, Session } from "./session.js";
import { BehaviorConfig, MasterConfig } from "./config.js";

export class ActiveMessageHandler extends BaseMessageHandler {
    private energyManager: EnergyManager;
    private isLlmProcessing = false;
    private hasPendingMessages = false;

    constructor(
        llmClient: LlmClient,
        botQQ: number,
        groupId: number,
        session: Session,
        behaviorConfig: BehaviorConfig,
        masterConfig?: MasterConfig,
        maxHistorySize = 40,
    ) {
        super(llmClient, botQQ, groupId, session, masterConfig, maxHistorySize);
        
        this.energyManager = new EnergyManager(
            behaviorConfig.energy_max,
            behaviorConfig.energy_cost,
            behaviorConfig.energy_recovery_rate,
            behaviorConfig.energy_recovery_interval,
        );
    }

    async handleMessage(message: Message): Promise<void> {
        // 1. 立即加入历史数组
        this.addMessageToHistory(message);

        // 2. 标记有新消息（每次都设置）
        this.hasPendingMessages = true;

        // 3. 尝试启动处理（如果已在处理则直接返回）
        await this.tryProcessAndReply();
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

                // 检查条件
                if (!this.canReply()) {
                    break;
                }

                if (!this.energyManager.consumeEnergy()) {
                    console.log(`[群 ${String(this.groupId)}] 体力不足，无法回复 (${this.energyManager.getEnergyStatus()})`);
                    break;
                }

                // LLM处理（基于当前完整历史）
                const didReply = await this.processAndReply();

                if (!didReply) {
                    this.energyManager.refundEnergy();
                    console.log(`[群 ${String(this.groupId)}] LLM 选择不回复，已退还体力`);
                }

                // 循环会自动检查 hasPendingMessages
                // 如果处理期间有新消息，hasPendingMessages 会被设置为 true
            }
        } finally {
            this.isLlmProcessing = false;
        }
    }

}
