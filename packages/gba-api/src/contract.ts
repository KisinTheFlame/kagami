import { defineBinaryEnvelopeRoute, defineJsonRoute } from "@kagami/http/contract";
import { z } from "zod";

// 游玩路由多为「按住 N 帧实速推进」的同步等待：单请求帧预算 ≤300 帧（~5s，服务端校验），
// 15s 兜底覆盖「预算满帧 + PNG 编码」仍留余量；loadGame 含 OSS 拉字节（ROM ≤32MB 本机回环）。
const GBA_PRESS_TIMEOUT_MS = 15_000;
const GBA_QUERY_TIMEOUT_MS = 10_000;
const GBA_STATE_TIMEOUT_MS = 5_000;
const GBA_LOAD_TIMEOUT_MS = 30_000;

/** GBA 按键（libretro joypad 语义下的 GBA 子集）。 */
export const GbaButtonSchema = z.enum([
  "a",
  "b",
  "l",
  "r",
  "start",
  "select",
  "up",
  "down",
  "left",
  "right",
]);
export type GbaButton = z.infer<typeof GbaButtonSchema>;

/**
 * press 序列中的一步：buttons 内的键在同一帧同时按下 / 同时松开（chord）。
 * schema 只钉结构（类型 / 非空 / 正整数）；上限（chord ≤4、hold ≤120、gap ≤30、步数 ≤8、
 * 总帧预算 ≤300）与互斥方向对、重复键都是**领域校验**——超限回 `{ ok:false, reason }`
 * 而非 HTTP 400（镜像 spire 的「引擎拒绝不是服务故障」语义，见 issue #541 AC7）。
 */
export const GbaPressStepSchema = z.object({
  buttons: z.array(GbaButtonSchema).min(1),
  /** 按住帧数，默认 3（~50ms，可靠跨过逐帧采样又不触发连发）。 */
  holdFrames: z.number().int().min(1).default(3),
  /** 本步松开后的间隔帧数，默认 3。 */
  gapFrames: z.number().int().min(1).default(3),
});

/** 最后一步松开后的结算等待帧数，默认 12（~200ms，避开「刚松键画面未提交」的过渡帧）。 */
const SettleFramesSchema = z.number().int().min(0).default(12);

/**
 * press 结果的时间线元数据：帧号帮助诊断「决策-执行漂移」（LLM 推理间隙游戏在实时继续跑），
 * 不做乐观锁。timelineId 在 loadGame / 服务重启时更换，防不同时间线的帧号被混为一谈。
 * releasedFrame = 最后一个「按住」帧之后的时刻（尾部 gap/settle 里键已松开，不计入）。
 */
export const GbaFrameMetaSchema = z.object({
  timelineId: z.string(),
  startFrame: z.number().int(),
  releasedFrame: z.number().int(),
  capturedFrame: z.number().int(),
});

/** 各结果 schema 共用的失败分支：领域拒绝统一 `{ ok:false, reason }`。 */
const GbaFailureSchema = z.object({ ok: z.literal(false), reason: z.string() });

/**
 * 画面以 base64 PNG 走 JSON 回传（240×160 放大 2x，数十 KB、本机回环）：不值得为「上行 JSON +
 * 下行 binary」发明新契约原语；大块数据由 agent 侧工具拦下转多模态 effect，不进主 Agent 上下文。
 */
export const GbaPressResultSchema = z.discriminatedUnion("ok", [
  GbaFrameMetaSchema.extend({ ok: z.literal(true), imageBase64: z.string() }),
  GbaFailureSchema,
]);

export const GbaScreenshotResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    timelineId: z.string(),
    capturedFrame: z.number().int(),
    imageBase64: z.string(),
  }),
  GbaFailureSchema,
]);

export const GbaLoadResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    romId: z.number().int(),
    romName: z.string(),
    timelineId: z.string(),
  }),
  GbaFailureSchema,
]);

export const GbaRunStateSchema = z.object({
  loaded: z.boolean(),
  romId: z.number().int().nullable(),
  romName: z.string().nullable(),
  foreground: z.boolean(),
  /** 自核心冷启动以来的帧计数；未加载时为 0。 */
  frame: z.number().int(),
  timelineId: z.string().nullable(),
});

/** ROM 库列表行（sqlite `rom` 表视图）。 */
export const GbaRomViewSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  sizeBytes: z.number().int(),
  sha256: z.string(),
  createdAt: z.string(),
  lastPlayedAt: z.string().nullable(),
  /** 是否已有电池存档（battery_save 行存在）。 */
  hasSave: z.boolean(),
});

export const GbaRomListSchema = z.object({ roms: z.array(GbaRomViewSchema) });

export const GbaUploadResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), rom: GbaRomViewSchema }),
  GbaFailureSchema,
]);

export const GbaDeleteResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  GbaFailureSchema,
]);

/**
 * kagami-gba 进程对 agent 暴露的游玩 RPC 契约（单一事实源，issue #541）。agent 经 HttpGbaClient
 * 直连（不过 gateway，不受其 30s 响应头超时约束）。运行模型：前台=真机速率（59.7275fps）实时
 * 运行、后台=冻结；帧推进权唯一归属服务端帧循环，press 只登记按键计划。
 */
export const gbaApiContract = {
  state: defineJsonRoute({
    method: "GET",
    path: "/gba/run/state",
    input: z.object({}),
    output: GbaRunStateSchema,
    timeoutMs: GBA_STATE_TIMEOUT_MS,
  }),
  setForeground: defineJsonRoute({
    method: "POST",
    path: "/gba/run/foreground",
    input: z.object({ focused: z.boolean() }),
    // blur 会先 flush 电池存档再冻结；flush 失败是服务故障（HTTP 500），不是领域拒绝。
    output: z.object({ foreground: z.boolean() }),
    timeoutMs: GBA_QUERY_TIMEOUT_MS,
  }),
  loadGame: defineJsonRoute({
    method: "POST",
    path: "/gba/run/load",
    input: z.object({ romId: z.number().int().positive() }),
    output: GbaLoadResultSchema,
    timeoutMs: GBA_LOAD_TIMEOUT_MS,
  }),
  press: defineJsonRoute({
    method: "POST",
    path: "/gba/run/press",
    // 单 chord 的平铺形态（press 工具）：等价于单步序列的语法糖，服务端同一条执行路径。
    input: z.object({
      buttons: z.array(GbaButtonSchema).min(1),
      holdFrames: z.number().int().min(1).default(3),
      settleFrames: SettleFramesSchema,
    }),
    output: GbaPressResultSchema,
    timeoutMs: GBA_PRESS_TIMEOUT_MS,
  }),
  pressSequence: defineJsonRoute({
    method: "POST",
    path: "/gba/run/press-sequence",
    input: z.object({
      steps: z.array(GbaPressStepSchema).min(1),
      settleFrames: SettleFramesSchema,
    }),
    output: GbaPressResultSchema,
    timeoutMs: GBA_PRESS_TIMEOUT_MS,
  }),
  screenshot: defineJsonRoute({
    method: "POST",
    path: "/gba/run/screenshot",
    input: z.object({}),
    // 前后台皆可（冻结帧也能看）；未加载 ROM 时领域拒绝。
    output: GbaScreenshotResultSchema,
    timeoutMs: GBA_QUERY_TIMEOUT_MS,
  }),
  listRoms: defineJsonRoute({
    method: "GET",
    path: "/gba/roms",
    input: z.object({}),
    output: GbaRomListSchema,
    timeoutMs: GBA_QUERY_TIMEOUT_MS,
  }),
};

/**
 * 控制台 ROM 管理面（管理台上传 / 列表 / 删除）。gateway 分流在 #541 PR3 落地：只放行
 * `/gba/roms` 前缀——游玩路由
 * `/gba/run/*` 不进分流表，浏览器够不到（镜像 OSS「写前缀物理隔离」的思路，方向相反：这里
 * 隔离的是游玩面）。listRoms 与 agent 共用同一条路由。
 */
export const gbaRomsContract = {
  listRoms: gbaApiContract.listRoms,
  uploadRom: defineBinaryEnvelopeRoute({
    method: "POST",
    path: "/gba/roms",
    params: z.object({}),
    bytesIn: true,
    // ROM 名走 header（上行 body 是裸字节流）。HTTP header 仅安全承载 latin-1：值经
    // encodeURIComponent 编码，服务端 decode——中文 ROM 名由此过关。
    headers: z.object({ "x-gba-rom-name": z.string().min(1) }),
    output: GbaUploadResultSchema,
  }),
  deleteRom: defineJsonRoute({
    method: "POST",
    path: "/gba/roms/delete",
    input: z.object({ romId: z.number().int().positive() }),
    output: GbaDeleteResultSchema,
    timeoutMs: GBA_QUERY_TIMEOUT_MS,
  }),
};
