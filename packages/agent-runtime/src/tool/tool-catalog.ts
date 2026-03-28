import type {
  ToolComponent,
  ToolContext,
  ToolDefinition,
  ToolExecutionResult,
  ToolKind,
} from "./tool-component.js";

export type ToolSetExecutionResult = ToolExecutionResult & {
  kind: ToolKind;
};

export interface ToolExecutor<TMessage = unknown> {
  definitions(): ToolDefinition[];
  getKind(name: string): ToolKind | null;
  execute(
    name: string,
    argumentsValue: Record<string, unknown>,
    context: ToolContext<TMessage>,
  ): Promise<ToolSetExecutionResult>;
}

export class ToolCatalog<TMessage = unknown> {
  private readonly componentsByName: Map<string, ToolComponent<TMessage>>;

  public constructor(components: ToolComponent<TMessage>[]) {
    this.componentsByName = new Map<string, ToolComponent<TMessage>>();

    for (const component of components) {
      if (this.componentsByName.has(component.name)) {
        throw new Error(`Tool name is duplicated: ${component.name}`);
      }

      this.componentsByName.set(component.name, component);
    }
  }

  public pick(names: string[]): ToolSet<TMessage> {
    const components = names.map(name => {
      const component = this.componentsByName.get(name);
      if (!component) {
        throw new Error(`Tool is not registered: ${name}`);
      }

      return component;
    });

    return new ToolSet(components);
  }
}

export class ToolSet<TMessage = unknown> implements ToolExecutor<TMessage> {
  private readonly componentsByName: Map<string, ToolComponent<TMessage>>;
  private readonly orderedComponents: ToolComponent<TMessage>[];

  public constructor(components: ToolComponent<TMessage>[]) {
    this.orderedComponents = components;
    this.componentsByName = new Map(components.map(component => [component.name, component]));
  }

  public definitions(): ToolDefinition[] {
    return this.orderedComponents.map(component => component.llmTool);
  }

  public getKind(name: string): ToolKind | null {
    return this.componentsByName.get(name)?.kind ?? null;
  }

  public async execute(
    name: string,
    argumentsValue: Record<string, unknown>,
    context: ToolContext<TMessage>,
  ): Promise<ToolSetExecutionResult> {
    const component = this.componentsByName.get(name);
    if (!component) {
      return {
        kind: "business",
        content: JSON.stringify({ error: `Unknown tool: ${name}` }),
        signal: "continue",
      };
    }

    const result = await component.execute(argumentsValue, context);
    return {
      ...result,
      kind: component.kind,
    };
  }
}
