/** Browser App 的网站凭据存取端口。实现见 infra/prisma-browser-credential.dao.ts。 */

export type BrowserCredential = {
  handle: string;
  username: string;
  secret: string;
};

/**
 * 按 handle 存取网站登录凭据。Kagami 运行期可自己增改（区别于 config 静态密钥）。
 *
 * 安全约定：调用方拿到 secret 后只能注入到 Playwright fill 层，
 * **永不**回灌进 tool result / 语义树 / 截图 / 上下文。
 */
export interface BrowserCredentialDao {
  /** 取一条凭据；不存在返 null。 */
  get(handle: string): Promise<BrowserCredential | null>;
  /** upsert 一条凭据（Kagami 自主存新登录用）。 */
  put(credential: BrowserCredential): Promise<void>;
  /** 列出所有 handle（不含 secret），供 Kagami 知道自己有哪些账号。 */
  listHandles(): Promise<string[]>;
}
