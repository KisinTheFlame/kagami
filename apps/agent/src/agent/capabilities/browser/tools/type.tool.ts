import { z } from "zod";
import type { ToolKind } from "@kagami/agent-runtime";
import { BrowserToolComponent } from "./browser-tool-component.js";
import { BrowserError } from "../domain/errors.js";
import type { BrowserClient } from "../../../../acl/browser-client.js";

export const BROWSER_TYPE_TOOL_NAME = "browser_type";

const Schema = z.object({
  ref: z.string().min(1),
  text: z.string().optional(),
  secret_handle: z.string().optional(),
  secret_field: z.enum(["username", "secret"]).optional(),
  submit: z.boolean().optional(),
});

export class BrowserTypeTool extends BrowserToolComponent<typeof Schema> {
  public readonly name = BROWSER_TYPE_TOOL_NAME;
  public readonly description =
    "往输入框填文本。明文走 text；填账号密码走 secret_handle（按已存凭据的 handle 取，密码永不进上下文，你看不到明文），secret_field 选 username 或 secret（默认 secret）。submit=true 时填完按回车。";
  public readonly parameters = {
    type: "object",
    properties: {
      ref: { type: "string", description: "输入框的 ref（形如 7:e3，来自最近一次 observe）。" },
      text: { type: "string", description: "要填的明文。与 secret_handle 二选一。" },
      secret_handle: {
        type: "string",
        description: "已存凭据的 handle。与 text 二选一；用它填密码而不暴露明文。",
      },
      secret_field: {
        type: "string",
        enum: ["username", "secret"],
        description: "secret_handle 取哪个字段，默认 secret（密码）。",
      },
      submit: { type: "boolean", description: "填完是否按回车提交，默认 false。" },
    },
    required: ["ref"],
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
    if (input.secret_handle) {
      const result = await this.getBrowserClient().type(
        input.ref,
        { secret: { handle: input.secret_handle, field: input.secret_field ?? "secret" } },
        submit,
      );
      return JSON.stringify({ ok: true, url: result.url, filled: "secret" });
    }
    if (input.text !== undefined) {
      const result = await this.getBrowserClient().type(input.ref, { text: input.text }, submit);
      return JSON.stringify({ ok: true, url: result.url });
    }
    throw new BrowserError("BROWSER_ERROR", "text 和 secret_handle 必须提供一个", {
      ref: input.ref,
    });
  }
}
