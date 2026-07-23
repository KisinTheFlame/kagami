import { z } from "zod";
import type { ToolKind } from "@kagami/agent-runtime";
import { BrowserToolComponent } from "./browser-tool-component.js";
import type { BrowserClient } from "../../../../acl/browser-client.js";

const BROWSER_OBSERVE_TOOL_NAME = "browser_observe";

const Schema = z.object({});

export class BrowserObserveTool extends BrowserToolComponent<typeof Schema> {
  public readonly name = BROWSER_OBSERVE_TOOL_NAME;
  public readonly description =
    "读当前页的语义树（无障碍快照，含可点元素的 [ref=<epoch>:eN] 与 [box=x,y,w,h]，含 iframe）。要点击/输入某元素时，先 observe 拿它的 ref。ref 仅本次 observe 的 epoch 有效，页面变了要重新 observe。";
  public readonly parameters = {
    type: "object",
    properties: {},
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = Schema;
  private readonly getBrowserClient: () => BrowserClient;

  public constructor({ getBrowserClient }: { getBrowserClient: () => BrowserClient }) {
    super();
    this.getBrowserClient = getBrowserClient;
  }

  protected async executeTyped(): Promise<string> {
    const result = await this.getBrowserClient().observe();
    return [
      `<browser_screen epoch="${result.epoch}" url="${result.url}" title="${result.title}">`,
      result.snapshot,
      "</browser_screen>",
    ].join("\n");
  }
}
