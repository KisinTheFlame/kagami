export interface TaskAgent<TInput, TOutput> {
  invoke(input: TInput): Promise<TOutput>;
}

/**
 * @deprecated Use TaskAgent instead.
 */
export type AgentRuntime<TInput, TOutput> = TaskAgent<TInput, TOutput>;
