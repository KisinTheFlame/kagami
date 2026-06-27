import { z } from "zod";
import type { ToolKind } from "@kagami/agent-runtime";
import { BrowserToolComponent } from "./browser-tool-component.js";
import type { BrowserService } from "../application/browser.service.js";

export const BROWSER_CLICK_TOOL_NAME = "browser_click";

const Schema = z.object({ target: z.string().min(1) });

export class BrowserClickTool extends BrowserToolComponent<typeof Schema> {
  public readonly name = BROWSER_CLICK_TOOL_NAME;
  public readonly description =
    "点击一个元素。target 优先用 browser_observe 给的 ref（形如 7:e3）；也可传一段可见文本按文本匹配首个。";
  public readonly parameters = {
    type: "object",
    properties: {
      target: {
        type: "string",
        description: "元素 ref（形如 7:e3，来自最近一次 observe）或一段可见文本。",
      },
    },
    required: ["target"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = Schema;
  private readonly getBrowserService: () => BrowserService;

  public constructor({ getBrowserService }: { getBrowserService: () => BrowserService }) {
    super();
    this.getBrowserService = getBrowserService;
  }

  protected async executeTyped(input: z.infer<typeof Schema>): Promise<string> {
    const result = await this.getBrowserService().click(input.target);
    return JSON.stringify({ ok: true, url: result.url });
  }
}
