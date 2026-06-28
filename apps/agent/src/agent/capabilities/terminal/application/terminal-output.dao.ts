export type TerminalOutputRecord = {
  outputId: string;
  stdout: string;
  stderr: string;
  createdAt: Date;
};

export interface TerminalOutputDao {
  /** 保存一条完整的命令输出（stdout + stderr 原始完整内容）。 */
  save(input: { outputId: string; stdout: string; stderr: string }): Promise<void>;

  /** 按 outputId 查询完整输出；不存在返回 null。 */
  findByOutputId(input: { outputId: string }): Promise<TerminalOutputRecord | null>;
}
