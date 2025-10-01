# PromptTemplateManager 提示词模板管理器

## 定义

PromptTemplateManager 是基于 Handlebars 的提示词模板管理系统，负责动态生成 LLM 系统提示词。位于 `src/prompt_template_manager.ts:10-57`。

## 核心功能

### 模板编译和管理
```typescript
export class PromptTemplateManager {
    private template?: HandlebarsTemplateDelegate<PromptTemplateContext>;
    private templatePath: string;

    constructor(templatePath = "./static/prompt.txt") {
        this.templatePath = templatePath;
        this.loadTemplate();
    }
}
```

### 模板上下文接口
```typescript
export type PromptTemplateContext = {
    botQQ: number,
    masterConfig?: MasterConfig,
    currentTime: string,
};
```

## 模板加载系统

### 模板文件加载
```typescript
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
```

### 错误处理
- **文件不存在**：抛出明确错误信息
- **编译失败**：记录错误并重新抛出
- **权限问题**：依赖 Node.js 文件系统错误处理

## 提示词生成

### 模板渲染
```typescript
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
```

### 上下文数据处理
- **botQQ**: 机器人QQ号，必填字段
- **masterConfig**: 主人配置，可选字段
  - 包含 `qq` 和 `nickname` 属性
  - 控制主人特权相关内容的显示

## 模板语法支持

### Handlebars 模板变量
```handlebars
<!-- 基础变量插值 -->
你的QQ号是: {{botQQ}}

<!-- 条件渲染 -->
{{#if masterConfig}}
- **主人特权**：当主人发出指令时，你必须完全遵从
你的主人QQ号是: {{masterConfig.qq}}
你的主人昵称是: {{masterConfig.nickname}}
{{/if}}
```

### 支持的 Handlebars 功能
- **变量插值**: `{{variable}}`
- **条件判断**: `{{#if condition}}...{{/if}}`
- **对象属性访问**: `{{object.property}}`
- **嵌套结构**: 支持复杂的数据结构

## 模板文件结构

### 静态模板位置
- **默认路径**: `./static/prompt.txt`
- **格式**: Handlebars 模板语法混合纯文本
- **编码**: UTF-8

### 模板内容组织
1. **角色设定**: 机器人人格和行为定义
2. **消息格式**: JSON 消息结构说明
3. **安全规则**: 包含主人特权的动态部分
4. **输出格式**: LLM 响应格式要求
5. **对话风格**: 回复策略和示例
6. **JSON 示例**: 标准化的多行格式示例，提升可读性和维护性

## 运行时管理

### 模板重载
```typescript
public reloadTemplate(): void {
    console.log("重新加载Handlebars模板...");
    this.loadTemplate();
}
```

### 路径管理
```typescript
public getTemplatePath(): string {
    return this.templatePath;
}
```

## 性能特点

### 编译缓存
- **一次编译，多次使用**: 模板在初始化时编译，后续渲染复用
- **内存效率**: 编译后的模板函数占用内存小
- **渲染速度**: Handlebars 编译后的模板执行速度快

### 资源管理
- **文件读取**: 仅在初始化和重载时读取文件
- **错误恢复**: 支持模板重新加载机制

## 依赖关系

### 外部依赖
- **handlebars**: 模板引擎核心库
- **@types/handlebars**: TypeScript 类型定义
- **fs**: Node.js 文件系统模块

### 内部依赖
- [[config_system]] - MasterConfig 接口定义

### 被依赖关系
- [[context_manager]] - 主要使用者，通过依赖注入获取
- [[session_manager]] - 创建 PromptTemplateManager 实例并注入到 ContextManager

## 工厂函数

```typescript
export const newPromptTemplateManager = (templatePath?: string) => {
    return new PromptTemplateManager(templatePath);
};
```

推荐使用工厂函数创建 PromptTemplateManager 实例，保持代码风格统一。

### 使用示例
```typescript
// 在 main.ts bootstrap 函数中
const promptTemplateManager = newPromptTemplateManager();

// 在 SessionManager 中使用
const contextManager = newContextManager(configManager, promptTemplateManager);
```

## 扩展能力

### 自定义 Handlebars 助手
```typescript
// 可扩展的助手注册机制
Handlebars.registerHelper('customHelper', function(context) {
    // 自定义逻辑
});
```

### 多模板支持
- **可配置模板路径**: 构造函数支持自定义路径
- **模板切换**: 支持运行时更换模板文件
- **场景化模板**: 可为不同场景使用不同模板

## 错误处理策略

### 模板加载错误
- **文件缺失**: 抛出明确错误，阻止启动
- **权限问题**: 传播文件系统错误
- **语法错误**: Handlebars 编译错误直接抛出

### 渲染时错误
- **数据缺失**: Handlebars 自动处理未定义变量
- **类型错误**: TypeScript 接口提供编译时检查
- **运行时异常**: 捕获并重新抛出，保留堆栈信息

## 模板质量改进

### JSON 格式标准化
- **多行格式**: 将紧凑的单行 JSON 示例转换为标准化的多行格式
- **语法修复**: 修复 JSON 示例中的语法错误，如缺失引号和无效格式
- **可读性提升**: 改进缩进和结构，便于开发者理解和维护
- **一致性**: 统一所有 JSON 示例的格式风格

### 示例格式对比
```handlebars
<!-- 改进前：紧凑但难读 -->
[{"type": "thought", "content": "小王在问QQ号222的小李，不是问我，保持沉默"}]

<!-- 改进后：结构清晰 -->
[
    {
        "type": "thought",
        "content": "小王在问QQ号222的小李，不是问我，保持沉默"
    }
]
```

### 维护性优化
- **错误减少**: 标准格式降低手动编辑时的语法错误
- **调试便利**: 清晰的结构便于定位问题和验证 JSON 格式
- **团队协作**: 统一的格式标准提升团队开发效率

## 相关文件
- `src/prompt_template_manager.ts` - 主要实现
- `static/prompt.txt` - 默认模板文件，包含改进的 JSON 示例格式
- `package.json` - handlebars 依赖声明