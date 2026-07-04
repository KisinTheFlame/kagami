import { z } from "zod";
import type { ToolKind } from "@kagami/agent-runtime";
import { BrowserToolComponent } from "./browser-tool-component.js";
import type { BrowserClient } from "../../../../acl/browser-client.js";

export const BROWSER_EVAL_TOOL_NAME = "browser_eval";

const Schema = z.object({ script: z.string().min(1) });

/**
 * 全权逃生舷：在页面里跑任意 JS（page.evaluate），读写全开。用于结构化工具搞不定的
 * canvas / 奇葵 SPA。明示的全权后门，无静态限制——与「v1 无护栏、相信 AI」同一姿态。
 */
export class BrowserEvalTool extends BrowserToolComponent<typeof Schema> {
  public readonly name = BROWSER_EVAL_TOOL_NAME;
  public readonly description =
    "在当前页里执行一段 JavaScript（page.evaluate），返回值会 JSON 化截断回传。读写全开的逃生舷，处理结构化工具够不着的页面。谨慎用。";
  public readonly parameters = {
    type: "object",
    properties: {
      script: {
        type: "string",
        description: "在页面上下文里执行的 JS 表达式或语句，返回可序列化值。",
      },
    },
    required: ["script"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = Schema;
  private readonly getBrowserClient: () => BrowserClient;

  public constructor({ getBrowserClient }: { getBrowserClient: () => BrowserClient }) {
    super();
    this.getBrowserClient = getBrowserClient;
  }

  protected async executeTyped(input: z.infer<typeof Schema>): Promise<string> {
    const result = await this.getBrowserClient().evaluate(input.script);
    return JSON.stringify({ ok: true, result });
  }
}
