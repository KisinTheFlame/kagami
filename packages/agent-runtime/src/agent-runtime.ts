export interface TaskAgent<TInput, TOutput> {
  invoke(input: TInput): Promise<TOutput>;
}
