import type { App } from "@kagami/agent-runtime";
import { renderServerStaticTemplate } from "@kagami/kernel/runtime/read-static-text";
import { SpireStartRunTool } from "../../capabilities/spire/tools/start-run.tool.js";
import { SpirePlayCardTool } from "../../capabilities/spire/tools/play-card.tool.js";
import { SpireEndTurnTool } from "../../capabilities/spire/tools/end-turn.tool.js";
import { SpireChooseTool } from "../../capabilities/spire/tools/choose.tool.js";
import { SpireUsePotionTool } from "../../capabilities/spire/tools/use-potion.tool.js";
import { SpireLookTool } from "../../capabilities/spire/tools/look.tool.js";
import { SpireLookupTool } from "../../capabilities/spire/tools/lookup.tool.js";
import { renderSpirePortal } from "../../capabilities/spire/render/spire-screen.js";
import type { RootAgentEffect } from "../../runtime/effect/root-agent-effect.js";
import type { SpireClient } from "../../../acl/spire-client.js";

const SPIRE_APP_ID = "spire";

type SpireAppDeps = {
  /** 游戏动作客户端：打到独立的 kagami-spire 进程（issue #234）。 */
  spireClient: SpireClient;
};

/**
 * 尖塔 App：把杀戮尖塔式卡牌游戏的 7 个工具包成 Kagami 桌面上的一个能力单元。结构照抄 BrowserApp。
 *
 * 拆进程：本 App 不持有游戏引擎，只持有一个打到独立 kagami-spire 进程的 HttpSpireClient。
 * 游戏进程有自己的 PM2 生命周期与存档，agent 重启不影响进行中的对局。
 *
 * - 工具：start_run / play_card / end_turn / choose / use_potion / look / lookup。
 * - canInvoke 恒 true（粗门控）：出牌是否合法（能量 / 目标 / 屏幕）由游戏服务权威裁定，
 *   非法动作回一条可读的 SPIRE_REJECTED 失败（issue #234 C2）。
 * - onFocus 只给静态提示屏，不做网络 I/O（永不因服务未就绪而进不去，issue #234 B）。
 * - 无状态持久化：对局状态归游戏进程独占，本 App 无 exportState/restoreState。
 *
 * 设计依据：仓库根 AGENTS.md +（office-hours 设计文档 / issue #234）。
 */
export class SpireApp implements App {
  public readonly id = SPIRE_APP_ID;
  public readonly displayName = "尖塔";
  public readonly tools: readonly [
    SpireStartRunTool,
    SpirePlayCardTool,
    SpireEndTurnTool,
    SpireChooseTool,
    SpireUsePotionTool,
    SpireLookTool,
    SpireLookupTool,
  ];

  public constructor({ spireClient }: SpireAppDeps) {
    const getSpireClient = (): SpireClient => spireClient;
    this.tools = [
      new SpireStartRunTool({ getSpireClient }),
      new SpirePlayCardTool({ getSpireClient }),
      new SpireEndTurnTool({ getSpireClient }),
      new SpireChooseTool({ getSpireClient }),
      new SpireUsePotionTool({ getSpireClient }),
      new SpireLookTool({ getSpireClient }),
      new SpireLookupTool({ getSpireClient }),
    ];
  }

  public canInvoke(): boolean {
    return true;
  }

  public async help(): Promise<string> {
    return renderServerStaticTemplate(import.meta.url, "prompts/spire-app-help.hbs");
  }

  public async onFocus(): Promise<readonly RootAgentEffect[]> {
    return [{ type: "append_message", content: renderSpirePortal() }];
  }
}
