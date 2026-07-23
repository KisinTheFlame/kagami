import type { z } from "zod";
import { createClient, notReadyFallbackMapper, type JsonClient } from "@kagami/rpc-client/client";
import {
  gbaApiContract,
  type GbaButton,
  type GbaPressStepSchema,
  type GbaRomViewSchema,
  type GbaRunStateSchema,
} from "@kagami/gba-api/contract";
import { GbaError } from "../agent/capabilities/gba/domain/errors.js";

// === GBA 掌机客户端：把游玩动作经 HTTP 打到独立的 kagami-gba 进程（issue #541）===
//
// 运行模型：App 前台=服务端以真机速率实时运行、后台=冻结；press 是同步等待（服务端把按键
// 计划逐帧消费完、settle 走完才回图,最长 ~5s+编码）。领域拒绝（{ ok:false, reason }——后台
// 按键 / 超预算 / 并发 / 未加载等）统一抛 GBA_REJECTED,连接失败/超时归一 GBA_NOT_READY,
// 工具层序列化成冻结结构失败结果。

export type GbaRunState = z.infer<typeof GbaRunStateSchema>;
export type GbaRomView = z.infer<typeof GbaRomViewSchema>;
/** 序列一步（holdFrames/gapFrames 已解析,client 层不吃 zod 默认值——工具层补齐后递交）。 */
export type GbaPressStepInput = z.infer<typeof GbaPressStepSchema>;

export interface GbaClient {
  state(): Promise<GbaRunState>;
  setForeground(focused: boolean): Promise<{ foreground: boolean }>;
  listRoms(): Promise<GbaRomView[]>;
  loadGame(romId: number): Promise<{ romName: string }>;
  /** press 类成功结果就是画面本身（base64 PNG）——契约不设诊断元数据。 */
  press(input: { buttons: GbaButton[]; holdFrames: number; settleFrames: number }): Promise<string>;
  pressSequence(input: { steps: GbaPressStepInput[]; settleFrames: number }): Promise<string>;
  screenshot(): Promise<string>;
  importRom(input: { resId: string; name: string }): Promise<GbaRomView>;
}

type FetchLike = typeof fetch;
type SleepFn = (ms: number) => Promise<void>;

/** 重试节奏：总等待 ~3s，覆盖 deploy gba 的常规重启窗口（进程停到端口重开约 1-3 秒）。 */
const CONN_REFUSED_RETRY_DELAYS_MS: readonly number[] = [300, 700, 1000, 1000];

const defaultSleep: SleepFn = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 连接级短重试（GBA 无感重启的 agent 半边）：只重试「连接被拒」——请求根本没进服务，对
 * press 这类非幂等调用也安全。已建立连接后的失败（超时 / RESET / 非 2xx）服务端可能已有
 * 副作用，一律不重试，交给上层归一 GBA_NOT_READY。重试间隙里若整体超时信号已触发则放弃。
 */
export function withConnRefusedRetry(
  fetchImpl: FetchLike,
  opts: { delaysMs?: readonly number[]; sleep?: SleepFn } = {},
): FetchLike {
  const delaysMs = opts.delaysMs ?? CONN_REFUSED_RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? defaultSleep;
  return async (input, init) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fetchImpl(input, init);
      } catch (error) {
        const delayMs = delaysMs[attempt];
        if (delayMs === undefined || !isConnRefused(error) || init?.signal?.aborted === true) {
          throw error;
        }
        await sleep(delayMs);
      }
    }
  };
}

/** undici 的连接被拒形状：TypeError("fetch failed")，ECONNREFUSED 藏在 cause 链或 AggregateError.errors 里。 */
function isConnRefused(error: unknown, depth = 0): boolean {
  if (depth > 4 || typeof error !== "object" || error === null) {
    return false;
  }
  if ((error as { code?: unknown }).code === "ECONNREFUSED") {
    return true;
  }
  if (error instanceof AggregateError && error.errors.some(e => isConnRefused(e, depth + 1))) {
    return true;
  }
  return isConnRefused((error as { cause?: unknown }).cause, depth + 1);
}

export class HttpGbaClient implements GbaClient {
  private readonly api: JsonClient<typeof gbaApiContract>;

  public constructor({ baseUrl, fetch: fetchImpl }: { baseUrl: string; fetch?: FetchLike }) {
    this.api = createClient(gbaApiContract, {
      baseUrl,
      // bind 到 globalThis 再包重试：与 createClient 内部的默认 fetch 处理一致（brand-check）。
      fetch: withConnRefusedRetry(fetchImpl ?? fetch.bind(globalThis)),
      // 服务端错误信封是 { error: { message, statusCode } }（非 BizErrorWire），非 2xx 一律
      // 走 mapFallbackError 归一成 GBA_NOT_READY。
      decodeError: () => undefined,
      mapFallbackError: notReadyFallbackMapper(
        "GBA 掌机服务",
        message => new GbaError("GBA_NOT_READY", message),
      ),
    });
  }

  public async state(): Promise<GbaRunState> {
    return await this.api.state({});
  }

  public async setForeground(focused: boolean): Promise<{ foreground: boolean }> {
    return await this.api.setForeground({ focused });
  }

  public async listRoms(): Promise<GbaRomView[]> {
    const { roms } = await this.api.listRoms({});
    return roms;
  }

  public async loadGame(romId: number): Promise<{ romName: string }> {
    const result = await this.api.loadGame({ romId });
    if (!result.ok) {
      throw new GbaError("GBA_REJECTED", result.reason);
    }
    return { romName: result.romName };
  }

  public async press(input: {
    buttons: GbaButton[];
    holdFrames: number;
    settleFrames: number;
  }): Promise<string> {
    const result = await this.api.press(input);
    if (!result.ok) {
      throw new GbaError("GBA_REJECTED", result.reason);
    }
    return result.imageBase64;
  }

  public async pressSequence(input: {
    steps: GbaPressStepInput[];
    settleFrames: number;
  }): Promise<string> {
    const result = await this.api.pressSequence(input);
    if (!result.ok) {
      throw new GbaError("GBA_REJECTED", result.reason);
    }
    return result.imageBase64;
  }

  public async screenshot(): Promise<string> {
    const result = await this.api.screenshot({});
    if (!result.ok) {
      throw new GbaError("GBA_REJECTED", result.reason);
    }
    return result.imageBase64;
  }

  public async importRom(input: { resId: string; name: string }): Promise<GbaRomView> {
    const result = await this.api.importRom(input);
    if (!result.ok) {
      throw new GbaError("GBA_REJECTED", result.reason);
    }
    return result.rom;
  }
}
