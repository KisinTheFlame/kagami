import { z } from "zod";
import type { ToolKind } from "@kagami/agent-runtime";
import { BrowserToolComponent } from "./browser-tool-component.js";
import type { BrowserClient } from "../../../../browser/browser-client.js";

export const BROWSER_NAVIGATE_TOOL_NAME = "browser_navigate";

const Schema = z.object({ url: z.string().min(1) });

export class BrowserNavigateTool extends BrowserToolComponent<typeof Schema> {
  public readonly name = BROWSER_NAVIGATE_TOOL_NAME;
  public readonly description =
    "在浏览器里打开一个网址（page.goto）。返回到达后的 url 和标题。打开后通常接 browser_observe 看页面。";
  public readonly parameters = {
    type: "object",
    properties: {
      url: { type: "string", description: "完整网址，含 http(s):// 前缀。" },
    },
    required: ["url"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = Schema;
  private readonly getBrowserClient: () => BrowserClient;

  public constructor({ getBrowserClient }: { getBrowserClient: () => BrowserClient }) {
    super();
    this.getBrowserClient = getBrowserClient;
  }

  protected async executeTyped(input: z.infer<typeof Schema>): Promise<string> {
    const result = await this.getBrowserClient().navigate(input.url);
    return JSON.stringify({ ok: true, url: result.url, title: result.title });
  }
}
