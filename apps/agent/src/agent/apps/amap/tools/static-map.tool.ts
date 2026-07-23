import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";
import { AppLogger } from "@kagami/kernel/logger/logger";
import type { AmapClient, StaticMapMarker, StaticMapPath } from "../client/amap-client.js";
import { escapeAttr } from "../amap-screen.js";
import type { RootAgentEffect } from "../../../runtime/effect/root-agent-effect.js";
import type { OssClient } from "../../../../acl/oss-client.js";

const STATIC_MAP_TOOL_NAME = "static_map";

const logger = new AppLogger({ source: "agent.amap.static_map" });

const SizeSchema = z
  .string()
  .regex(/^\d{1,4}\*\d{1,4}$/, "size 形如 '宽*高'")
  .refine(
    s => {
      const [w, h] = s.split("*").map(Number);
      return w >= 1 && w <= 1024 && h >= 1 && h <= 1024;
    },
    { message: "size 单边需在 1-1024" },
  );

// points 上限：客户端最终只取 marker 前 10 点 / path 前 100 点，这里在校验层就封顶，
// 避免超大数组在 Zod 遍历阶段吃 CPU/内存。
const MarkerSchema = z.object({
  label: z.string().optional(),
  color: z.string().optional(),
  size: z.enum(["small", "mid", "large"]).optional(),
  points: z.array(z.string().min(1)).min(1).max(10),
});
const PathSchema = z.object({
  weight: z.number().int().positive().optional(),
  color: z.string().optional(),
  points: z.array(z.string().min(1)).min(1).max(100),
});

const Schema = z
  .object({
    location: z.string().min(1).optional(),
    zoom: z.number().int().min(1).max(17).optional(),
    size: SizeSchema.optional(),
    markers: z.array(MarkerSchema).max(10).optional(),
    paths: z.array(PathSchema).max(4).optional(),
  })
  // 无覆盖物时高德要求 location 居中，否则只带 key/size 的请求必然参数错误。
  .refine(v => Boolean(v.location) || (v.markers?.length ?? 0) > 0 || (v.paths?.length ?? 0) > 0, {
    message: "没有 markers/paths 时必须给 location（用于地图居中）",
  });

type Deps = {
  getClient: () => AmapClient;
  getDefaultSize: () => string;
  getScale: () => 1 | 2;
  ossClient?: OssClient;
};

/**
 * 静态地图：取一张带标注的 PNG，**原图直接进多模态上下文**（append_message 带 image），
 * 并叠加落 OSS 拿 resid 便于日后转发 / 重看。无覆盖物时给 location+zoom 居中。
 *
 * fetch 层已保证：非 image/png 的错误页不会当图片返回（amapFetchImage 会抛 AmapError）。
 */
export class StaticMapTool extends ZodToolComponent<typeof Schema> {
  public readonly name = STATIC_MAP_TOOL_NAME;
  public readonly description =
    "生成一张带标注的静态地图 PNG，原图直接进你的上下文（你能看到图）。无 markers/paths 时给 location+zoom 居中。只能在 amap App 里通过 invoke 调用。";
  public readonly parameters = {
    type: "object",
    properties: {
      location: {
        type: "string",
        description: "地图中心坐标 GCJ-02 '经度,纬度'。无 markers/paths 时必给。",
      },
      zoom: { type: "number", description: "缩放级别 1-17（数字越大越细）。无覆盖物时建议给。" },
      size: { type: "string", description: "图片尺寸 '宽*高'，单边 ≤1024，省略用默认。" },
      markers: {
        type: "array",
        description: '标注点，最多 10 个点。每项 { label?, color?, size?, points:["lng,lat"] }。',
        items: {
          type: "object",
          properties: {
            label: {
              type: "string",
              description: "标注字符，仅单个 0-9 或大写 A-Z（其他会被忽略）。",
            },
            color: { type: "string", description: "颜色，如 '0xFF0000'。" },
            size: { type: "string", enum: ["small", "mid", "large"], description: "标注大小。" },
            points: {
              type: "array",
              items: { type: "string" },
              description: "坐标列表 'lng,lat'。",
            },
          },
          required: ["points"],
        },
      },
      paths: {
        type: "array",
        description: '折线，最多 4 条。每项 { weight?, color?, points:["lng,lat"...] }。',
        items: {
          type: "object",
          properties: {
            weight: { type: "number", description: "线宽。" },
            color: { type: "string", description: "颜色，如 '0x0000FF'。" },
            points: {
              type: "array",
              items: { type: "string" },
              description: "坐标列表 'lng,lat'。",
            },
          },
          required: ["points"],
        },
      },
    },
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = Schema;

  private readonly getClient: () => AmapClient;
  private readonly getDefaultSize: () => string;
  private readonly getScale: () => 1 | 2;
  private readonly ossClient: OssClient | undefined;

  public constructor({ getClient, getDefaultSize, getScale, ossClient }: Deps) {
    super();
    this.getClient = getClient;
    this.getDefaultSize = getDefaultSize;
    this.getScale = getScale;
    this.ossClient = ossClient;
  }

  protected async executeTyped(input: z.infer<typeof Schema>): Promise<ToolExecutionResult> {
    const image = await this.getClient().staticMap({
      location: input.location,
      zoom: input.zoom,
      size: input.size ?? this.getDefaultSize(),
      scale: this.getScale(),
      markers: input.markers as StaticMapMarker[] | undefined,
      paths: input.paths as StaticMapPath[] | undefined,
    });
    const resid = await this.tryPutToOss(image.bytes, image.mimeType);
    const residAttr = resid ? ` resid="${escapeAttr(resid)}"` : "";
    const appendEffect: RootAgentEffect = {
      type: "append_message",
      content: `<amap_static_map${residAttr} />`,
      images: [
        {
          content: image.bytes.toString("base64"),
          mimeType: image.mimeType,
          filename: "amap-static.png",
        },
      ],
    };
    return {
      content: JSON.stringify({
        ok: true,
        ...(resid ? { resid } : {}),
      }),
      effects: [appendEffect],
    };
  }

  private async tryPutToOss(bytes: Buffer, mimeType: string): Promise<string | undefined> {
    if (!this.ossClient) {
      return undefined;
    }
    try {
      return await this.ossClient.putObject({ bytes, mimeType });
    } catch (error) {
      logger.warn("静态地图落 OSS 失败，降级为仅入上下文", {
        event: "agent.amap.static_map.oss_put_failed",
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }
}
