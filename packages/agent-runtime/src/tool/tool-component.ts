import { z } from "zod";

export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
};

export type ToolDefinition = {
  name: string;
  description?: string;
  parameters: JsonSchema;
};

export type ToolKind = "business" | "control";
export type ToolSignal = "continue" | "finish_round" | "sleep";

export type ToolContext<TMessage = unknown> = {
  groupId?: string;
  systemPrompt?: string;
  messages?: TMessage[];
};

export type ToolExecutionResult = {
  content: string;
  signal: ToolSignal;
  sleepMs?: number;
};

export interface ToolComponent<TMessage = unknown> {
  readonly name: string;
  readonly description?: string;
  readonly parameters: JsonSchema;
  readonly kind: ToolKind;
  readonly llmTool: ToolDefinition;
  execute(
    argumentsValue: Record<string, unknown>,
    context: ToolContext<TMessage>,
  ): Promise<ToolExecutionResult>;
}

type ToolResultFormatter = (error: z.ZodError | unknown) => string;

const DEFAULT_INVALID_ARGUMENTS_FORMATTER: ToolResultFormatter = error => {
  if (error instanceof z.ZodError) {
    return JSON.stringify({
      ok: false,
      error: "INVALID_ARGUMENTS",
      details: error.issues.map(issue => issue.message),
    });
  }

  return JSON.stringify({
    ok: false,
    error: "INVALID_ARGUMENTS",
  });
};

const DEFAULT_EXECUTION_ERROR_FORMATTER: ToolResultFormatter = error =>
  JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });

export abstract class ZodToolComponent<
  TInput extends z.ZodTypeAny,
  TMessage = unknown,
> implements ToolComponent<TMessage> {
  public abstract readonly name: string;
  public abstract readonly description?: string;
  public abstract readonly parameters: JsonSchema;
  public abstract readonly kind: ToolKind;
  protected abstract readonly inputSchema: TInput;

  public get llmTool(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      parameters: this.parameters,
    };
  }

  public async execute(
    argumentsValue: Record<string, unknown>,
    context: ToolContext<TMessage>,
  ): Promise<ToolExecutionResult> {
    const parsed = this.inputSchema.safeParse(argumentsValue);
    if (!parsed.success) {
      return {
        content: this.formatInvalidArguments(parsed.error),
        signal: "continue",
      };
    }

    try {
      const result = await this.executeTyped(parsed.data, context);
      if (typeof result === "string") {
        return {
          content: result,
          signal: "continue",
        };
      }

      return result;
    } catch (error) {
      return {
        content: this.formatExecutionError(error),
        signal: "continue",
      };
    }
  }

  protected formatInvalidArguments(error: z.ZodError): string {
    return DEFAULT_INVALID_ARGUMENTS_FORMATTER(error);
  }

  protected formatExecutionError(error: unknown): string {
    return DEFAULT_EXECUTION_ERROR_FORMATTER(error);
  }

  protected abstract executeTyped(
    input: z.infer<TInput>,
    context: ToolContext<TMessage>,
  ): Promise<string | ToolExecutionResult> | string | ToolExecutionResult;
}
