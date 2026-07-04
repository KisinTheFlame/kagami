import { z } from "zod";
import type { ToolKind } from "@kagami/agent-runtime";
import { SpireToolComponent } from "./spire-tool-component.js";
import { renderSpireReference } from "../render/spire-screen.js";
import type { SpireClient } from "../../../../acl/spire-client.js";

export const SPIRE_LOOKUP_TOOL_NAME = "lookup";

const Schema = z.object({ query: z.string().optional() });

export class SpireLookupTool extends SpireToolComponent<typeof Schema> {
  public readonly name = SPIRE_LOOKUP_TOOL_NAME;
  public readonly description =
    "查询卡牌信息或游戏术语（不消耗任何动作）。query 可以是卡名（如 打击）或术语（如 易伤、虚弱、格挡）；不传 query 则列出全部卡牌与术语。";
  public readonly parameters = {
    type: "object",
    properties: {
      query: { type: "string", description: "卡名或术语；留空列出全部。" },
    },
    required: [],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = Schema;
  private readonly getSpireClient: () => SpireClient;

  public constructor({ getSpireClient }: { getSpireClient: () => SpireClient }) {
    super();
    this.getSpireClient = getSpireClient;
  }

  protected async executeTyped(input: z.infer<typeof Schema>): Promise<string> {
    const ref = await this.getSpireClient().lookup(input.query ?? "");
    return renderSpireReference(ref);
  }
}
