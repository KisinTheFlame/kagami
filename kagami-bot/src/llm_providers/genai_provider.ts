import { Content, GoogleGenAI, Part } from "@google/genai";
import { LlmProvider, ChatMessages, ChatMessagePart, GenAIProviderConfig } from "./types.js";
import { ApiKeyManager } from "../api_key_manager.js";

export class GenAIProvider implements LlmProvider {
    private apiKeyManager: ApiKeyManager;

    constructor(config: GenAIProviderConfig) {
        this.apiKeyManager = new ApiKeyManager(config.api_keys);
    }

    async oneTurnChat(model: string, messages: ChatMessages[]): Promise<string> {
        const apiKey = this.apiKeyManager.getRandomApiKey();
        const ai = new GoogleGenAI({ apiKey });

        const { contents, systemInstruction } = this.convertMessages(messages);

        try {
            const response = await ai.models.generateContent({
                model,
                contents,
                config: {
                    responseMimeType: "application/json",
                    systemInstruction,
                },
            });

            const text = response.text;

            if (!text) {
                throw new Error("GenAI API 返回空内容");
            }

            return text;
        } catch (error) {
            throw new Error(`GenAI API 调用失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private convertMessages(messages: ChatMessages[]) {
        const contents: Content[] = [];
        const systemInstruction: Part[] = [];

        for (const msg of messages) {
            const parts = this.convert(msg.content);

            if (msg.role === "system") {
                systemInstruction.push(...parts);
            } else if (msg.role === "user") {
                contents.push({
                    role: "user",
                    parts,
                });
            } else {
                // msg.role === "assistant"
                contents.push({
                    role: "model",
                    parts,
                });
            }
        }

        return {
            contents,
            systemInstruction,
        };
    }

    private convert(content: ChatMessagePart[]): Part[] {
        return content.map(part => this.convertPart(part));
    }

    private convertPart(part: ChatMessagePart): Part {
        return { text: part.value };
    }
}
