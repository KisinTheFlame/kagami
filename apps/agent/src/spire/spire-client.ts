import type { z } from "zod";
import { createClient, type JsonClient } from "@kagami/rpc-client/client";
import {
  spireApiContract,
  SpireActionSchema,
  SpireCardRefSchema,
  SpireCombatViewSchema,
  SpireEnemyViewSchema,
  SpireGlossaryEntrySchema,
  SpireHandCardViewSchema,
  SpireIntentSchema,
  SpirePowerSchema,
  SpireReferenceSchema,
  SpireRelicViewSchema,
  SpireScreenSchema,
} from "@kagami/spire-api/contract";
import { SpireError } from "../agent/capabilities/spire/domain/errors.js";

// === 尖塔客户端：把游戏动作经 HTTP 打到独立的 kagami-spire 进程 ===
//
// 服务返回结构化 ScreenView（渲染成文字屏幕的活在 agent 侧 render/）。客户端缓存 lastVersion，
// 每个动作自动带 expectedVersion——HTTP 超时后主 Agent 重发同一动作时服务判为重放、不重复出牌
// （issue #234 B 幂等）。连接失败/超时/坏响应统一映射 SPIRE_NOT_READY。
//
// wire 层走 @kagami/spire-api 契约驱动的 createClient（issue #230）：请求/响应形状与服务端
// handler 共享同一份 Zod schema，改契约两端同时编译报错。此前这里手写 fetch + 独立重定义
// ScreenView 各类型 + `as` 断言，HTTP 这一跳是类型空洞。

export type SpirePower = z.infer<typeof SpirePowerSchema>;
export type SpireIntent = z.infer<typeof SpireIntentSchema>;
export type SpireEnemyView = z.infer<typeof SpireEnemyViewSchema>;
export type SpireHandCardView = z.infer<typeof SpireHandCardViewSchema>;
export type SpireCombatView = z.infer<typeof SpireCombatViewSchema>;
export type SpireRelicView = z.infer<typeof SpireRelicViewSchema>;
export type SpireScreen = z.infer<typeof SpireScreenSchema>;
export type SpireAction = z.infer<typeof SpireActionSchema>;
export type SpireCardRef = z.infer<typeof SpireCardRefSchema>;
export type SpireGlossaryEntry = z.infer<typeof SpireGlossaryEntrySchema>;
export type SpireReference = z.infer<typeof SpireReferenceSchema>;

export interface SpireClient {
  startRun(): Promise<SpireScreen>;
  act(action: SpireAction): Promise<SpireScreen>;
  getState(): Promise<SpireScreen | null>;
  lookup(query: string): Promise<SpireReference>;
}

type FetchLike = typeof fetch;

export class HttpSpireClient implements SpireClient {
  private readonly api: JsonClient<typeof spireApiContract>;
  /** 最近一次见到的对局版本号；随每个响应更新，作为下一动作的 expectedVersion。 */
  private lastVersion: number | undefined;

  public constructor({ baseUrl, fetch: fetchImpl }: { baseUrl: string; fetch?: FetchLike }) {
    this.api = createClient(spireApiContract, {
      baseUrl: baseUrl.replace(/\/+$/, ""),
      ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
      // 服务端错误信封是 { error: { message, statusCode } }（非 BizErrorWire），非 2xx 一律
      // 走 mapFallbackError 归一成 SPIRE_NOT_READY——与拆契约前的行为一致。
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
    const screen = await this.api.startRun({});
    this.lastVersion = screen.version;
    return screen;
  }

  public async act(action: SpireAction): Promise<SpireScreen> {
    const response = await this.api.action({
      action,
      ...(this.lastVersion === undefined ? {} : { expectedVersion: this.lastVersion }),
    });
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
    const screen = await this.api.state({});
    if (screen) {
      this.lastVersion = screen.version;
    }
    return screen;
  }

  public async lookup(query: string): Promise<SpireReference> {
    return await this.api.reference({ q: query });
  }
}
