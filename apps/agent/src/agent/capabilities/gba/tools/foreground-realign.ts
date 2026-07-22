import { GbaError } from "../domain/errors.js";
import type { GbaClient } from "../../../../acl/gba-client.js";

/**
 * 前台失位自愈（review #541 PR2,Codex P1）：gba 子工具只可能在 App 聚焦时被调用（框架门控）,
 * 此刻「掌机在前台」就是正确状态。但服务重启 / 短暂不可达恢复 / 看门狗超时冻结都会让服务侧
 * 掉回后台——一次性的 onFocus 通知覆盖不了这些,若不自愈,她会被 GBA_NOT_FOREGROUND 卡死在
 * App 里。首次被拒且原因是失位时,重申前台后重试一次。
 *
 * 注意这不违反「服务端不自动唤醒」的设计裁决:服务端语义不变(后台按键照样拒),自愈发生在
 * agent 侧、且仅在框架已确认 App 持有焦点的前提下——是状态修复,不是隐式焦点切换。
 */
export async function withForegroundRealign<T>(
  client: GbaClient,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (
      error instanceof GbaError &&
      error.code === "GBA_REJECTED" &&
      error.message.startsWith("GBA_NOT_FOREGROUND")
    ) {
      await client.setForeground(true);
      return await run();
    }
    throw error;
  }
}
