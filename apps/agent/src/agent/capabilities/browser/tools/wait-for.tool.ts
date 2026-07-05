import { z } from "zod";
import type { ToolKind } from "@kagami/agent-runtime";
import { BrowserToolComponent } from "./browser-tool-component.js";
import { BrowserError } from "../domain/errors.js";
import type { BrowserClient } from "../../../../acl/browser-client.js";

const BROWSER_WAIT_FOR_TOOL_NAME = "browser_wait_for";

const Schema = z.object({
  selector: z.string().optional(),
  ms: z.number().int().positive().optional(),
});

export class BrowserWaitForTool extends BrowserToolComponent<typeof Schema> {
  public readonly name = BROWSER_WAIT_FOR_TOOL_NAME;
  public readonly description =
    "等页面稳定：传 selector 等某 CSS 选择器出现，或传 ms 死等若干毫秒。多数动作 Playwright 已自动等，仅在动态页（SPA 异步加载）需要时用。";
  public readonly parameters = {
    type: "object",
    properties: {
      selector: { type: "string", description: "等待出现的 CSS 选择器。" },
      ms: { type: "number", description: "死等的毫秒数。与 selector 二选一。" },
    },
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = Schema;
  private readonly getBrowserClient: () => BrowserClient;

  public constructor({ getBrowserClient }: { getBrowserClient: () => BrowserClient }) {
    super();
    this.getBrowserClient = getBrowserClient;
  }

  protected async executeTyped(input: z.infer<typeof Schema>): Promise<string> {
    if (input.selector === undefined && input.ms === undefined) {
      throw new BrowserError("BROWSER_ERROR", "selector 和 ms 必须提供一个");
    }
    await this.getBrowserClient().waitFor({ selector: input.selector, ms: input.ms });
    return JSON.stringify({ ok: true });
  }
}
