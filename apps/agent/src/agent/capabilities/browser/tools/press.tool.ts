import { z } from "zod";
import type { ToolKind } from "@kagami/agent-runtime";
import { BrowserToolComponent } from "./browser-tool-component.js";
import type { BrowserClient } from "../../../../browser/browser-client.js";

export const BROWSER_PRESS_TOOL_NAME = "browser_press";

const Schema = z.object({ key: z.string().min(1) });

export class BrowserPressTool extends BrowserToolComponent<typeof Schema> {
  public readonly name = BROWSER_PRESS_TOOL_NAME;
  public readonly description =
    "按一个键盘键（Playwright key 语法，如 Enter、Tab、Escape、ArrowDown、Control+A）。作用于当前活动页。";
  public readonly parameters = {
    type: "object",
    properties: {
      key: { type: "string", description: "键名，如 Enter / Tab / Escape / Control+A。" },
    },
    required: ["key"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = Schema;
  private readonly getBrowserClient: () => BrowserClient;

  public constructor({ getBrowserClient }: { getBrowserClient: () => BrowserClient }) {
    super();
    this.getBrowserClient = getBrowserClient;
  }

  protected async executeTyped(input: z.infer<typeof Schema>): Promise<string> {
    await this.getBrowserClient().press(input.key);
    return JSON.stringify({ ok: true });
  }
}
