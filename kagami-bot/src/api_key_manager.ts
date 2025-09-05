export class ApiKeyManager {
    private apiKeys: string[];

    constructor(apiKeys: string[]) {
        if (apiKeys.length === 0) {
            throw new Error("API Keys 数组不能为空");
        }
        this.apiKeys = [...apiKeys];
    }

    getRandomApiKey(): string {
        const randomIndex = Math.floor(Math.random() * this.apiKeys.length);
        return this.apiKeys[randomIndex];
    }

    getApiKeyCount(): number {
        return this.apiKeys.length;
    }
}
