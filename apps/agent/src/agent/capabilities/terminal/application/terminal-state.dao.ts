export interface TerminalStateDao {
  /**
   * 读取当前持久化的 cwd。单行表：最多一条记录。
   * 返回 null 表示从未写入过（首次启动）。
   */
  loadCwd(): Promise<string | null>;

  /**
   * 写入 cwd。若表中尚未存在任何行，则插入新行；
   * 否则更新现有的单行（按 id 最小者为准）。
   */
  saveCwd(input: { cwd: string }): Promise<void>;
}
