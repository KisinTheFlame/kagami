export interface AgentRuntime<TInput, TOutput> {
  invoke(input: TInput): Promise<TOutput>;
}
