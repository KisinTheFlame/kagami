import type { Tool } from "../../../llm/types.js";
import type {
  ToolContext,
  ToolExecutionResult,
  ToolKind,
  ToolComponent,
} from "./tool-component.js";

export type ToolSetExecutionResult = ToolExecutionResult & {
  kind: ToolKind;
};

export interface ToolExecutor {
  definitions(): Tool[];
  getKind(name: string): ToolKind | null;
  execute(
    name: string,
    argumentsValue: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolSetExecutionResult>;
}

export class ToolCatalog {
  private readonly componentsByName: Map<string, ToolComponent>;

  public constructor(components: ToolComponent[]) {
    this.componentsByName = new Map<string, ToolComponent>();

    for (const component of components) {
      if (this.componentsByName.has(component.name)) {
        throw new Error(`Tool name is duplicated: ${component.name}`);
      }

      this.componentsByName.set(component.name, component);
    }
  }

  public pick(names: string[]): ToolSet {
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

export class ToolSet implements ToolExecutor {
  private readonly componentsByName: Map<string, ToolComponent>;
  private readonly orderedComponents: ToolComponent[];

  public constructor(components: ToolComponent[]) {
    this.orderedComponents = components;
    this.componentsByName = new Map(components.map(component => [component.name, component]));
  }

  public definitions(): Tool[] {
    return this.orderedComponents.map(component => component.llmTool);
  }

  public getKind(name: string): ToolKind | null {
    return this.componentsByName.get(name)?.kind ?? null;
  }

  public async execute(
    name: string,
    argumentsValue: Record<string, unknown>,
    context: ToolContext,
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
