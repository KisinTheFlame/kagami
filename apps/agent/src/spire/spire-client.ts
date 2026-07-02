import { ZodError } from "zod";
import { createClient, type JsonClient } from "@kagami/rpc-client/client";
import {
  spireApiContract,
  type SpireAction,
  type SpireReference,
  type SpireScreen,
} from "@kagami/spire-api/contract";
import { SpireError } from "../agent/capabilities/spire/domain/errors.js";

// === 尖塔客户端：把游戏动作经 HTTP 打到独立的 kagami-spire 进程 ===
//
// 路由 / 类型的单一事实源是 @kagami/spire-api（#279 PR2）：门面类型全部由 z.infer 派生，
// 改服务端 ScreenView 字段这里同时编译报错。客户端缓存 lastVersion，每个动作自动带
// expectedVersion——HTTP 超时后主 Agent 重发同一动作时服务判为重放、不重复出牌（issue #234 B
// 幂等）。错误语义与旧手写实现逐字节一致（wire 基线测试钉死）：连接失败/超时/非 2xx/坏响应
// 统一 SPIRE_NOT_READY；引擎拒绝（200 ok:false）→ SPIRE_REJECTED。

const CLIENT_TIMEOUT_MS = 15_000;

export interface SpireClient {
  startRun(): Promise<SpireScreen>;
  act(action: SpireAction): Promise<SpireScreen>;
  getState(): Promise<SpireScreen | null>;
  lookup(query: string): Promise<SpireReference>;
}

type FetchLike = typeof fetch;

export class HttpSpireClient implements SpireClient {
  private readonly rpc: JsonClient<typeof spireApiContract>;
  /** 最近一次见到的对局版本号；随每个响应更新，作为下一动作的 expectedVersion。 */
  private lastVersion: number | undefined;

  public constructor({ baseUrl, fetch: fetchImpl }: { baseUrl: string; fetch?: FetchLike }) {
    this.rpc = createClient(spireApiContract, {
      baseUrl,
      fetch: fetchImpl,
      timeoutMs: CLIENT_TIMEOUT_MS,
      // spire 无富错误信封（BizErrorWire），非 2xx 一律走兜底映射成 SPIRE_NOT_READY。
      decodeError: () => undefined,
      mapFallbackError: info => {
        switch (info.reason) {
          case "unreachable":
            return new SpireError(
              "SPIRE_NOT_READY",
              `尖塔服务不可达（未启动 / 半开 / 超时）：${
                info.cause instanceof Error ? info.cause.message : String(info.cause)
              }`,
            );
          case "bad_status":
            return new SpireError("SPIRE_NOT_READY", `尖塔服务返回 HTTP ${info.status}`);
          case "invalid_response_body":
            return new SpireError("SPIRE_NOT_READY", "尖塔服务返回了无法解析的响应体");
        }
      },
    });
  }

  public async startRun(): Promise<SpireScreen> {
    const screen = await this.guard(() => this.rpc.startRun({}));
    this.lastVersion = screen.version;
    return screen;
  }

  public async act(action: SpireAction): Promise<SpireScreen> {
    // 键序保持 action → expectedVersion（wire 字节基线）；无已知版本时键整体缺席。
    const response = await this.guard(() =>
      this.rpc.action({ action, expectedVersion: this.lastVersion }),
    );
    if (!response.ok) {
      // 引擎拒绝（能量不足 / 目标非法等）不是服务故障：带回当前屏幕，作为可读失败让主 Agent 纠正。
      if (response.screen) {
        this.lastVersion = response.screen.version;
      }
      throw new SpireError("SPIRE_REJECTED", response.reason);
    }
    this.lastVersion = response.screen.version;
    return response.screen;
  }

  public async getState(): Promise<SpireScreen | null> {
    const screen = await this.guard(() => this.rpc.getState({}));
    if (screen) {
      this.lastVersion = screen.version;
    }
    return screen;
  }

  public async lookup(query: string): Promise<SpireReference> {
    return this.guard(() => this.rpc.reference({ q: query }));
  }

  /** 把 output.parse 的 ZodError 归入 SPIRE_NOT_READY（响应形状不对 == 服务返回了坏响应）。 */
  private async guard<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof ZodError) {
        throw new SpireError("SPIRE_NOT_READY", "尖塔服务返回了无法解析的响应体");
      }
      throw error;
    }
  }
}
