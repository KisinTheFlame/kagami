import type { App } from "@kagami/agent-runtime";
import { renderServerStaticTemplate } from "@kagami/kernel/runtime/read-static-text";
import { ViewTimeTool } from "./tools/view-time.tool.js";

const CLOCK_APP_ID = "clock";

/**
 * Clock App。Agent 主动查询当前时间的最小 App。
 *
 * - 无内部状态、无后台、无 config
 * - 唯一工具 view_time()，返回当前北京时间（精确到秒）
 * - 与 wake reminder 配套：被动提醒每半小时一次给"大致几点了"，主动调
 *   view_time 给"精确到秒的当前时间"，不在稳定前缀里堆任何东西
 */
export class ClockApp implements App {
  public readonly id = CLOCK_APP_ID;
  public readonly displayName = "时钟";
  public readonly tools: readonly ViewTimeTool[];

  public constructor() {
    this.tools = [new ViewTimeTool()];
  }

  public canInvoke(): boolean {
    return true;
  }

  public async help(): Promise<string> {
    return renderServerStaticTemplate(import.meta.url, "prompts/clock-app-help.hbs");
  }
}
