import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";
import { BizError } from "@kagami/kernel/errors/biz-error";
import { renderServerStaticTemplate } from "@kagami/kernel/runtime/read-static-text";
import { normalizeImageForLlm } from "@kagami/image/normalize";
import type { RootAgentEffect } from "../../../runtime/effect/root-agent-effect.js";
import type { ResourceService } from "../application/resource.service.js";

const READ_RESOURCE_TOOL_NAME = "read_resource";

const ReadResourceArgumentsSchema = z.object({
  resid: z.string().trim().min(1),
});

/**
 * 按 resId 把一份已存资源调回当前上下文。图片原图进多模态上下文（你能直接看到图）；
 * 非图片只回元数据（v1 只有图片能真正入你的视野）。resId 形如 `res-N`，来自你看到的
 * `[resid: res-N]` 占位符或截图返回。
 *
 * **全局工具**：和 download_resource / upload_resource 同级。结果只往尾部追加，KV 友好。
 */
export class ReadResourceTool extends ZodToolComponent<typeof ReadResourceArgumentsSchema> {
  public readonly name = READ_RESOURCE_TOOL_NAME;
  public readonly description =
    "按 resId 把一份已存资源（图片）调回你的上下文，原图直接进你的视野。resId 形如 res-N，" +
    "取自消息里的 [resid: res-N] 占位符或截图返回。非图片资源只回元数据、不入图。";
  public readonly parameters = {
    type: "object",
    properties: {
      resid: {
        type: "string",
        description: "要调回的资源 id，形如 res-N（含 res- 前缀）。",
      },
    },
    required: ["resid"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = ReadResourceArgumentsSchema;
  private readonly resourceService: ResourceService;

  public constructor({ resourceService }: { resourceService: ResourceService }) {
    super();
    this.resourceService = resourceService;
  }

  protected async executeTyped(
    input: z.infer<typeof ReadResourceArgumentsSchema>,
  ): Promise<ToolExecutionResult> {
    let resolved;
    try {
      resolved = await this.resourceService.resolve(input.resid);
    } catch (error) {
      // 顶层工具失败不享受 invoke 的 schema 追加提示，错误文案要自包含。
      const reason =
        error instanceof BizError ? (error.meta?.reason ?? "READ_FAILED") : "READ_FAILED";
      return {
        content: JSON.stringify({
          ok: false,
          resid: input.resid,
          error: reason,
          note: error instanceof Error ? error.message : String(error),
        }),
      };
    }

    if (!resolved.isImage) {
      return {
        content: JSON.stringify({
          ok: true,
          resid: resolved.resId,
          kind: "non_image",
          mime: resolved.mimeType,
          size: resolved.size,
          note: "该资源不是图片，未加载进上下文；当前只有图片能直接进你的视野。",
        }),
      };
    }

    // 归一化（#556）：超大图缩到可读尺寸、极端长图切片，原图绝不直接入持久上下文——
    // 一张 >8000px 的图进上下文就是每轮 400 的毒消息（2026-07-23 事故）。
    const normalized = await normalizeImageForLlm(resolved.bytes, resolved.mimeType);
    const tiled = normalized.parts.length > 1;
    const appendEffect: RootAgentEffect = {
      type: "append_message",
      content: renderServerStaticTemplate(import.meta.url, "context/resource-image.hbs", {
        resid: resolved.resId,
        mime: resolved.mimeType,
        tiled,
        tileCount: normalized.parts.length,
      }).trim(),
      // base64 字符串：图片要进持久上下文（快照/ledger 走 JSON），Buffer 会被 JSON 毒坏。
      images: normalized.parts.map(part => ({
        content: part.bytes.toString("base64"),
        mimeType: part.mimeType,
        filename: part.tile
          ? `${resolved.resId}-part-${part.tile.index}of${part.tile.total}`
          : resolved.resId,
      })),
    };
    return {
      content: JSON.stringify({
        ok: true,
        resid: resolved.resId,
        mime: resolved.mimeType,
        size: resolved.size,
      }),
      effects: [appendEffect],
    };
  }
}
