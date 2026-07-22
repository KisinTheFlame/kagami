import type { App } from "@kagami/agent-runtime";
import { renderServerStaticTemplate } from "@kagami/kernel/runtime/read-static-text";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { GbaListGamesTool } from "../../capabilities/gba/tools/list-games.tool.js";
import { GbaLoadGameTool } from "../../capabilities/gba/tools/load-game.tool.js";
import { GbaPressTool } from "../../capabilities/gba/tools/press.tool.js";
import { GbaPressSequenceTool } from "../../capabilities/gba/tools/press-sequence.tool.js";
import { GbaScreenshotTool } from "../../capabilities/gba/tools/screenshot.tool.js";
import { GbaImportRomTool } from "../../capabilities/gba/tools/import-rom.tool.js";
import type { RootAgentEffect } from "../../runtime/effect/root-agent-effect.js";
import type { GbaClient } from "../../../acl/gba-client.js";
import type { OssClient } from "../../../acl/oss-client.js";

const GBA_APP_ID = "gba";

const logger = new AppLogger({ source: "agent.gba.app" });

type GbaAppDeps = {
  /** 游玩动作客户端：打到独立的 kagami-gba 进程（issue #541）。 */
  gbaClient: GbaClient;
  /** 截图叠加落 OSS 用；缺省（OSS 关闭）时图仍入上下文，只是没有 resid。 */
  ossClient?: OssClient;
};

/**
 * GBA 掌机 App：把 GBA 模拟器的 6 个工具包成 Kagami 桌面上的一个能力单元。结构照抄 SpireApp。
 *
 * 运行模型（issue #541 硬约束）：**进入本 App = 拿起掌机**——onFocus 通知服务转前台,模拟器
 * 以真机速率实时运行;**离开 = 放下**——onBlur 通知转后台,整体冻结（先 flush 电池存档）。
 * 前后台通知都是 best-effort:服务未起时照样能进 App（portal 是静态屏）,后续按键会得到
 * GBA_NOT_READY 的规整失败。服务端另有看门狗兜底（前台空闲 10 分钟自动冻结）,agent 崩掉
 * 没来得及 onBlur 也不会让掌机空转。
 *
 * - 工具：list_games / load_game / press / press_sequence / screenshot / import_rom。
 * - canInvoke 恒 true（粗门控）：按键是否合法（前后台 / 帧预算 / 并发）由掌机服务权威裁定。
 * - 无状态持久化：模拟器状态 + 电池存档归 kagami-gba 进程独占,本 App 无 exportState。
 */
export class GbaApp implements App {
  public readonly id = GBA_APP_ID;
  public readonly displayName = "GBA 掌机";
  public readonly description = "玩 GBA 游戏：插卡带、按键、看画面；收到的 ROM 也能收进卡带库。";
  public readonly tools: readonly [
    GbaListGamesTool,
    GbaLoadGameTool,
    GbaPressTool,
    GbaPressSequenceTool,
    GbaScreenshotTool,
    GbaImportRomTool,
  ];

  private readonly gbaClient: GbaClient;

  public constructor({ gbaClient, ossClient }: GbaAppDeps) {
    this.gbaClient = gbaClient;
    const getGbaClient = (): GbaClient => gbaClient;
    this.tools = [
      new GbaListGamesTool({ getGbaClient }),
      new GbaLoadGameTool({ getGbaClient }),
      new GbaPressTool({ getGbaClient, ...(ossClient ? { ossClient } : {}) }),
      new GbaPressSequenceTool({ getGbaClient, ...(ossClient ? { ossClient } : {}) }),
      new GbaScreenshotTool({ getGbaClient, ...(ossClient ? { ossClient } : {}) }),
      new GbaImportRomTool({ getGbaClient }),
    ];
  }

  public canInvoke(): boolean {
    return true;
  }

  public async help(): Promise<string> {
    return renderServerStaticTemplate(import.meta.url, "prompts/gba-app-help.hbs");
  }

  public async onFocus(): Promise<readonly RootAgentEffect[]> {
    // 拿起掌机：best-effort 转前台（实时运行）。失败不阻断进入——portal 是静态屏,
    // 服务未起时后续按键会拿到 GBA_NOT_READY 规整失败。
    await this.setForegroundBestEffort(true);
    return [
      {
        type: "append_message",
        content: renderServerStaticTemplate(import.meta.url, "prompts/gba-portal.hbs", {}),
      },
    ];
  }

  public async onBlur(): Promise<readonly RootAgentEffect[]> {
    // 放下掌机：best-effort 转后台（冻结 + flush 电池存档）。失败有服务端看门狗兜底。
    await this.setForegroundBestEffort(false);
    return [];
  }

  private async setForegroundBestEffort(focused: boolean): Promise<void> {
    try {
      await this.gbaClient.setForeground(focused);
    } catch (error) {
      logger.warn("GBA 前后台切换通知失败（best-effort，服务端看门狗兜底）", {
        event: "agent.gba.set_foreground_failed",
        focused,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
