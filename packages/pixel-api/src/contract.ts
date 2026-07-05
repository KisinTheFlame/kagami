import { defineBinaryRawRoute, defineJsonRoute } from "@kagami/http/contract";
import { z } from "zod";
import { EMPTY_GLYPH, PIXEL_PALETTE } from "./palette.js";

// 像素画服务是轻量 JSON（毫秒级内存算子），10s 是「服务真挂 / 半开」的兜底超时。
const PIXEL_TIMEOUT_MS = 10_000;

/** 画布单边上限。越大 PNG 越大、文本网格越占 token；16×16 起手，够画猫画葱。 */
export const MAX_CANVAS_SIZE = 64;

/** 坐标 / 半径的 schema 上限：远高于画布尺寸（越界由服务按语义裁剪 / 拒绝），只为封住绘制循环。 */
const COORD_MAX = 4096;

const DimensionSchema = z.number().int().min(1).max(MAX_CANVAS_SIZE);
const CoordSchema = z.number().int().min(0).max(COORD_MAX);

const VALID_GLYPHS = new Set<string>([EMPTY_GLYPH, ...PIXEL_PALETTE.map(c => c.glyph)]);

/**
 * 画布状态（单一事实源）：服务端 handler 返回类型由它反推、agent 侧 client 对响应 parse。
 * 跨字段不变量（z.object 表达不了）用 superRefine 兜：cells 行数 === height、每行长度 === width、
 * 每格 glyph 属于调色板（含空格）。服务永远产出合法画布，这里是契约层的防御性护栏。
 */
export const CanvasStateSchema = z
  .object({
    width: DimensionSchema,
    height: DimensionSchema,
    /** 长度 === height，每行 === width 个 glyph 字符（EMPTY_GLYPH = 空/透明）。 */
    cells: z.array(z.string()),
    /** 本画布用到的颜色 name（给图例，只列用到的）。 */
    colors: z.array(z.string()),
  })
  .superRefine((state, ctx) => {
    if (state.cells.length !== state.height) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `cells 行数 ${state.cells.length} 应等于 height ${state.height}`,
      });
      return;
    }
    for (const row of state.cells) {
      if (row.length !== state.width) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `某行长度 ${row.length} 应等于 width ${state.width}`,
        });
        return;
      }
      for (const glyph of row) {
        if (!VALID_GLYPHS.has(glyph)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `未知 glyph "${glyph}"` });
          return;
        }
      }
    }
  });

/**
 * 绘图 / 查看端点的响应：成功带回新画布，领域拒绝（无效颜色 / 越界 / 无画布）带回 reason
 * 与当前画布（无画布时为 null）。引擎拒绝不是服务故障——镜像 spire 的 SpireActionResponse，
 * 客户端不抛异常、由工具据 ok 分支渲染。真正的失败（校验 / 500 / 不可达）才走 HTTP 错误。
 */
export const CanvasResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), canvas: CanvasStateSchema }),
  z.object({ ok: z.literal(false), reason: z.string(), canvas: CanvasStateSchema.nullable() }),
]);

export type CanvasState = z.infer<typeof CanvasStateSchema>;
export type CanvasResponse = z.infer<typeof CanvasResponseSchema>;

const PixelSchema = z.object({ x: CoordSchema, y: CoordSchema, color: z.string().min(1) });

/**
 * kagami-pixel 进程对 agent 暴露的 RPC 契约（单一事实源，issue #230 / #365）。
 *
 * 绘图端点上行 JSON、下行 CanvasResponse；render 是 binary-raw（下行原始 PNG 字节，content-type
 * image/png 由服务端手写 header，不进 Zod）。绝不在服务端调 useRawBodyPassthrough——绘图上行是
 * JSON，需保留 JSON parser。
 */
export const pixelApiContract = {
  newCanvas: defineJsonRoute({
    method: "POST",
    path: "/canvas",
    input: z.object({ width: DimensionSchema, height: DimensionSchema }),
    output: CanvasResponseSchema,
    timeoutMs: PIXEL_TIMEOUT_MS,
  }),
  setPixels: defineJsonRoute({
    method: "POST",
    path: "/pixels",
    input: z.object({
      pixels: z
        .array(PixelSchema)
        .min(1)
        .max(MAX_CANVAS_SIZE * MAX_CANVAS_SIZE),
    }),
    output: CanvasResponseSchema,
    timeoutMs: PIXEL_TIMEOUT_MS,
  }),
  fill: defineJsonRoute({
    method: "POST",
    path: "/fill",
    input: z.object({ x: CoordSchema, y: CoordSchema, color: z.string().min(1) }),
    output: CanvasResponseSchema,
    timeoutMs: PIXEL_TIMEOUT_MS,
  }),
  line: defineJsonRoute({
    method: "POST",
    path: "/line",
    input: z.object({
      x1: CoordSchema,
      y1: CoordSchema,
      x2: CoordSchema,
      y2: CoordSchema,
      color: z.string().min(1),
    }),
    output: CanvasResponseSchema,
    timeoutMs: PIXEL_TIMEOUT_MS,
  }),
  rect: defineJsonRoute({
    method: "POST",
    path: "/rect",
    input: z.object({
      x1: CoordSchema,
      y1: CoordSchema,
      x2: CoordSchema,
      y2: CoordSchema,
      color: z.string().min(1),
      filled: z.boolean().optional(),
    }),
    output: CanvasResponseSchema,
    timeoutMs: PIXEL_TIMEOUT_MS,
  }),
  circle: defineJsonRoute({
    method: "POST",
    path: "/circle",
    input: z.object({
      cx: CoordSchema,
      cy: CoordSchema,
      radius: CoordSchema,
      color: z.string().min(1),
      filled: z.boolean().optional(),
    }),
    output: CanvasResponseSchema,
    timeoutMs: PIXEL_TIMEOUT_MS,
  }),
  ellipse: defineJsonRoute({
    method: "POST",
    path: "/ellipse",
    input: z.object({
      cx: CoordSchema,
      cy: CoordSchema,
      rx: CoordSchema,
      ry: CoordSchema,
      color: z.string().min(1),
      filled: z.boolean().optional(),
    }),
    output: CanvasResponseSchema,
    timeoutMs: PIXEL_TIMEOUT_MS,
  }),
  clear: defineJsonRoute({
    method: "POST",
    path: "/clear",
    input: z.object({}),
    output: CanvasResponseSchema,
    timeoutMs: PIXEL_TIMEOUT_MS,
  }),
  render: defineBinaryRawRoute({
    method: "GET",
    path: "/render",
    params: z.object({}),
    bytesIn: false,
  }),
};
