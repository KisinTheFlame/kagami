export const TERMINAL_ERROR = {
  /** spawn 失败（shell 找不到、权限不足等） */
  SPAWN_FAILED: "SPAWN_FAILED",
  /** 命令执行超过 commandTimeoutMs，进程组已被强制终止 */
  TIMEOUT: "TIMEOUT",
  /** 子进程被信号杀死（非正常退出，且非 timeout 场景） */
  KILLED: "KILLED",
  /** 已有 bash 在执行，拒绝并发调用 */
  BUSY: "BUSY",
  /** 当前 cwd 目录不存在（被外部删除），已回退到 initialCwd */
  CWD_MISSING: "CWD_MISSING",
  /** bash command 参数为空 / 全空白 / 超长 */
  INVALID_COMMAND: "INVALID_COMMAND",
  /** read_bash_output 传入的 output_id 不存在 */
  OUTPUT_NOT_FOUND: "OUTPUT_NOT_FOUND",
  /** read_bash_output 传入非法 stream */
  INVALID_STREAM: "INVALID_STREAM",
  /** TerminalService 启动/初始化阶段失败 */
  INITIALIZATION_FAILED: "INITIALIZATION_FAILED",
} as const;

export type TerminalErrorCode = (typeof TERMINAL_ERROR)[keyof typeof TERMINAL_ERROR];
