import { z } from "zod";
import type { ToolKind } from "@kagami/agent-runtime";
import { BrowserToolComponent } from "./browser-tool-component.js";
import type { BrowserClient } from "../../../../acl/browser-client.js";

const BROWSER_TYPE_TOOL_NAME = "browser_type";

const Schema = z.object({
  ref: z.string().min(1),
  text: z.string(),
  submit: z.boolean().optional(),
});

export class BrowserTypeTool extends BrowserToolComponent<typeof Schema> {
  public readonly name = BROWSER_TYPE_TOOL_NAME;
  public readonly description = "往输入框填文本。submit=true 时填完按回车。";
  public readonly parameters = {
    type: "object",
    properties: {
      ref: { type: "string", description: "输入框的 ref（形如 7:e3，来自最近一次 observe）。" },
      text: { type: "string", description: "要填的文本。" },
      submit: { type: "boolean", description: "填完是否按回车提交，默认 false。" },
    },
    required: ["ref", "text"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = Schema;
  private readonly getBrowserClient: () => BrowserClient;

  public constructor({ getBrowserClient }: { getBrowserClient: () => BrowserClient }) {
    super();
    this.getBrowserClient = getBrowserClient;
  }

  protected async executeTyped(input: z.infer<typeof Schema>): Promise<string> {
    const submit = input.submit ?? false;
    const result = await this.getBrowserClient().type(input.ref, { text: input.text }, submit);
    return JSON.stringify({ ok: true, url: result.url });
  }
}
