/**
 * 宽松 JSON 解析：解析失败返回 null 而非抛错。OAuth 端点的错误响应体不保证是
 * JSON，token 交换/刷新路径用它兜住非 JSON 响应。此前 claude-code 与 codex 两个
 * oauth 文件各写了一份逐字相同的实现，收敛到这里。
 */
export function safeParseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
