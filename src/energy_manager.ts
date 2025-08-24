export class EnergyManager {
    private currentEnergy: number;
    private maxEnergy: number;
    private costPerMessage: number;
    private recoveryRate: number;
    private recoveryInterval: number;
    private recoveryTimer?: NodeJS.Timeout;
    private lastRecoveryTime: number;

    constructor(
        maxEnergy: number,
        costPerMessage: number,
        recoveryRate: number,
        recoveryInterval: number,
    ) {
        this.maxEnergy = maxEnergy;
        this.currentEnergy = maxEnergy;
        this.costPerMessage = costPerMessage;
        this.recoveryRate = recoveryRate;
        this.recoveryInterval = recoveryInterval;
        this.lastRecoveryTime = Date.now();
        
        this.startRecoveryTimer();
    }

    canSendMessage(): boolean {
        return this.currentEnergy >= this.costPerMessage;
    }

    consumeEnergy(): boolean {
        if (!this.canSendMessage()) {
            return false;
        }
        
        this.currentEnergy -= this.costPerMessage;
        console.log(`[体力系统] 消耗体力 ${String(this.costPerMessage)}，当前体力: ${String(this.currentEnergy)}/${String(this.maxEnergy)}`);
        return true;
    }

    getCurrentEnergy(): number {
        return this.currentEnergy;
    }

    getMaxEnergy(): number {
        return this.maxEnergy;
    }

    getEnergyStatus(): string {
        return `${String(this.currentEnergy)}/${String(this.maxEnergy)}`;
    }

    private startRecoveryTimer(): void {
        this.recoveryTimer = setInterval(() => {
            this.recoverEnergy();
        }, this.recoveryInterval * 1000);
    }

    private recoverEnergy(): void {
        if (this.currentEnergy < this.maxEnergy) {
            const newEnergy = Math.min(this.currentEnergy + this.recoveryRate, this.maxEnergy);
            const recovered = newEnergy - this.currentEnergy;
            
            if (recovered > 0) {
                this.currentEnergy = newEnergy;
                console.log(`[体力系统] 恢复体力 ${String(recovered)}，当前体力: ${String(this.currentEnergy)}/${String(this.maxEnergy)}`);
            }
        }
        
        this.lastRecoveryTime = Date.now();
    }

    destroy(): void {
        if (this.recoveryTimer) {
            clearInterval(this.recoveryTimer);
            this.recoveryTimer = undefined;
        }
    }
}
