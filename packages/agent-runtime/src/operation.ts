export interface Operation<TInput, TOutput> {
  execute(input: TInput): Promise<TOutput>;
}
