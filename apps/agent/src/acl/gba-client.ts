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

/** press/press_sequence 成功结果（截图 + 时间线元数据）。 */
export type GbaPressOutcome = {
  timelineId: string;
  startFrame: number;
  releasedFrame: number;
  capturedFrame: number;
  imageBase64: string;
};

export type GbaScreenshotOutcome = {
  timelineId: string;
  capturedFrame: number;
  imageBase64: string;
};

export interface GbaClient {
  state(): Promise<GbaRunState>;
  setForeground(focused: boolean): Promise<{ foreground: boolean }>;
  listRoms(): Promise<GbaRomView[]>;
  loadGame(romId: number): Promise<{ romId: number; romName: string; timelineId: string }>;
  press(input: {
    buttons: GbaButton[];
    holdFrames: number;
    settleFrames: number;
  }): Promise<GbaPressOutcome>;
  pressSequence(input: {
    steps: GbaPressStepInput[];
    settleFrames: number;
  }): Promise<GbaPressOutcome>;
  screenshot(): Promise<GbaScreenshotOutcome>;
  importRom(input: { resId: string; name: string }): Promise<GbaRomView>;
}

type FetchLike = typeof fetch;

export class HttpGbaClient implements GbaClient {
  private readonly api: JsonClient<typeof gbaApiContract>;

  public constructor({ baseUrl, fetch: fetchImpl }: { baseUrl: string; fetch?: FetchLike }) {
    this.api = createClient(gbaApiContract, {
      baseUrl,
      ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
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

  public async loadGame(
    romId: number,
  ): Promise<{ romId: number; romName: string; timelineId: string }> {
    const result = await this.api.loadGame({ romId });
    if (!result.ok) {
      throw new GbaError("GBA_REJECTED", result.reason);
    }
    return { romId: result.romId, romName: result.romName, timelineId: result.timelineId };
  }

  public async press(input: {
    buttons: GbaButton[];
    holdFrames: number;
    settleFrames: number;
  }): Promise<GbaPressOutcome> {
    const result = await this.api.press(input);
    if (!result.ok) {
      throw new GbaError("GBA_REJECTED", result.reason);
    }
    return result;
  }

  public async pressSequence(input: {
    steps: GbaPressStepInput[];
    settleFrames: number;
  }): Promise<GbaPressOutcome> {
    const result = await this.api.pressSequence(input);
    if (!result.ok) {
      throw new GbaError("GBA_REJECTED", result.reason);
    }
    return result;
  }

  public async screenshot(): Promise<GbaScreenshotOutcome> {
    const result = await this.api.screenshot({});
    if (!result.ok) {
      throw new GbaError("GBA_REJECTED", result.reason);
    }
    return result;
  }

  public async importRom(input: { resId: string; name: string }): Promise<GbaRomView> {
    const result = await this.api.importRom(input);
    if (!result.ok) {
      throw new GbaError("GBA_REJECTED", result.reason);
    }
    return result.rom;
  }
}
