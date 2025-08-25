import { BaseMessageHandler } from "./base_message_handler.js";
import { EnergyManager } from "./energy_manager.js";
import { LlmClient } from "./llm.js";
import { Message, Session } from "./session.js";
import { BehaviorConfig } from "./config.js";

export class ActiveMessageHandler extends BaseMessageHandler {
    private energyManager: EnergyManager;

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
        // 1. 保存用户消息到历史记录（只保存本群组消息）
        this.addMessageToHistory(message);

        // 2. 检查是否可以回复
        if (!this.canReply()) {
            return;
        }

        // 3. 消耗体力值
        if (!this.energyManager.consumeEnergy()) {
            console.log(`[群 ${String(this.groupId)}] 体力不足，无法回复 (${this.energyManager.getEnergyStatus()})`);
            return;
        }

        // 4. 处理消息并回复
        await this.processAndReply(message);
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
}
