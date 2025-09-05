import * as fs from "fs";
import Handlebars from "handlebars";
import { MasterConfig } from "./config.js";

export interface PromptTemplateContext {
    botQQ: number;
    masterConfig?: MasterConfig;
}

export class PromptTemplateManager {
    private template?: HandlebarsTemplateDelegate<PromptTemplateContext>;
    private templatePath: string;

    constructor(templatePath = "./static/prompt.txt") {
        this.templatePath = templatePath;
        this.loadTemplate();
    }

    private loadTemplate(): void {
        try {
            if (!fs.existsSync(this.templatePath)) {
                throw new Error(`模板文件不存在: ${this.templatePath}`);
            }

            const templateContent = fs.readFileSync(this.templatePath, "utf-8");
            this.template = Handlebars.compile(templateContent);
            console.log(`Handlebars模板加载成功: ${this.templatePath}`);
            
        } catch (error) {
            console.error("加载Handlebars模板失败:", error);
            throw error;
        }
    }

    public generatePrompt(context: PromptTemplateContext): string {
        if (!this.template) {
            throw new Error("Handlebars模板未初始化");
        }

        try {
            return this.template(context);
        } catch (error) {
            console.error("生成prompt失败:", error);
            throw error;
        }
    }

    public reloadTemplate(): void {
        console.log("重新加载Handlebars模板...");
        this.loadTemplate();
    }

    public getTemplatePath(): string {
        return this.templatePath;
    }
}
