import { describe, expect, it, vi } from "vitest";
import type { ToolContext } from "@kagami/agent-runtime";
import { GbaListGamesTool } from "../../../../src/agent/capabilities/gba/tools/list-games.tool.js";
import { GbaLoadGameTool } from "../../../../src/agent/capabilities/gba/tools/load-game.tool.js";
import { GbaPressTool } from "../../../../src/agent/capabilities/gba/tools/press.tool.js";
import { GbaPressSequenceTool } from "../../../../src/agent/capabilities/gba/tools/press-sequence.tool.js";
import { GbaImportRomTool } from "../../../../src/agent/capabilities/gba/tools/import-rom.tool.js";
import { GbaError } from "../../../../src/agent/capabilities/gba/domain/errors.js";
import type { GbaClient, GbaRomView } from "../../../../src/acl/gba-client.js";
import type { OssClient } from "../../../../src/acl/oss-client.js";
import type { RootAgentEffect } from "../../../../src/agent/runtime/effect/root-agent-effect.js";
import { initTestLoggerRuntime } from "../../../helpers/logger.js";

initTestLoggerRuntime();

const context = {} as ToolContext;

const ROM: GbaRomView = {
  id: 1,
  name: "逆转裁判",
  sizeBytes: 8705280,
  sha256: "abc",
  createdAt: "2026-07-22T00:00:00.000Z",
  lastPlayedAt: null,
  hasSave: true,
};

const PRESS_OUTCOME = {
  timelineId: "gba-t1",
  startFrame: 100,
  releasedFrame: 103,
  capturedFrame: 116,
  imageBase64: Buffer.from("png-bytes").toString("base64"),
};

function createFakeClient(overrides: Partial<GbaClient> = {}): GbaClient {
  return {
    state: vi.fn().mockResolvedValue({
      loaded: true,
      romId: 1,
      romName: "逆转裁判",
      foreground: true,
      frame: 116,
      timelineId: "gba-t1",
    }),
    setForeground: vi.fn().mockResolvedValue({ foreground: true }),
    listRoms: vi.fn().mockResolvedValue([ROM]),
    loadGame: vi.fn().mockResolvedValue({ romId: 1, romName: "逆转裁判", timelineId: "gba-t1" }),
    press: vi.fn().mockResolvedValue(PRESS_OUTCOME),
    pressSequence: vi.fn().mockResolvedValue(PRESS_OUTCOME),
    screenshot: vi.fn().mockResolvedValue({
      timelineId: "gba-t1",
      capturedFrame: 116,
      imageBase64: PRESS_OUTCOME.imageBase64,
    }),
    importRom: vi.fn().mockResolvedValue(ROM),
    ...overrides,
  };
}

/** 每测新建：vitest clearMocks 会清掉模块级 mock 的实现。 */
function createFakeOss(): OssClient {
  return {
    putObject: vi.fn().mockResolvedValue("res-99"),
    getObject: vi.fn(),
  } as unknown as OssClient;
}

function appendEffect(
  effects: readonly unknown[] | undefined,
): Extract<RootAgentEffect, { type: "append_message" }> {
  expect(effects).toHaveLength(1);
  const effect = (effects as readonly RootAgentEffect[])[0]!;
  expect(effect.type).toBe("append_message");
  return effect as Extract<RootAgentEffect, { type: "append_message" }>;
}

describe("GBA 工具", () => {
  it("press:snake_case 参数映射 + 截图以 effect 进多模态,content 无 base64 有 resid", async () => {
    const client = createFakeClient();
    const tool = new GbaPressTool({ getGbaClient: () => client, ossClient: createFakeOss() });
    const result = await tool.execute({ buttons: ["b", "right"], hold_frames: 60 }, context);
    expect(client.press).toHaveBeenCalledWith({
      buttons: ["b", "right"],
      holdFrames: 60,
      settleFrames: 12, // 默认值
    });
    // 「她看了有什么用」裁剪:content 恒为 {"ok":true},诊断元数据(timelineId/帧号)与
    // base64 都不进 tool_result;resid 只写在贴图标签里(单一位置)。
    expect(result.content).toBe('{"ok":true}');
    const effect = appendEffect(result.effects);
    expect(effect.content).toBe('<gba_screen resid="res-99" />');
    expect(effect.image?.content).toBe(PRESS_OUTCOME.imageBase64);
    expect(effect.image?.mimeType).toBe("image/png");
  });

  it("press:OSS 缺省时优雅降级(无 resid,图仍进视野)", async () => {
    const client = createFakeClient();
    const tool = new GbaPressTool({ getGbaClient: () => client });
    const result = await tool.execute({ buttons: ["a"] }, context);
    expect(result.content).not.toContain("resid");
    appendEffect(result.effects);
  });

  it("press_sequence:steps 映射到 camelCase 且步内默认值生效", async () => {
    const client = createFakeClient();
    const tool = new GbaPressSequenceTool({
      getGbaClient: () => client,
      ossClient: createFakeOss(),
    });
    await tool.execute(
      { steps: [{ buttons: ["down"] }, { buttons: ["a"], hold_frames: 5 }] },
      context,
    );
    expect(client.pressSequence).toHaveBeenCalledWith({
      steps: [
        { buttons: ["down"], holdFrames: 3, gapFrames: 3 },
        { buttons: ["a"], holdFrames: 5, gapFrames: 3 },
      ],
      settleFrames: 12,
    });
  });

  it("load_game:按名精确匹配;未命中列出现有卡带的规整失败", async () => {
    const client = createFakeClient();
    const tool = new GbaLoadGameTool({ getGbaClient: () => client });
    const ok = await tool.execute({ name: "逆转裁判" }, context);
    expect(client.loadGame).toHaveBeenCalledWith(1);
    expect(JSON.parse(ok.content)).toEqual({ ok: true, romName: "逆转裁判", hasSave: true });

    const miss = await tool.execute({ name: "口袋妖怪" }, context);
    const parsed = JSON.parse(miss.content) as Record<string, unknown>;
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("GBA_REJECTED");
    expect(String(parsed.message)).toContain("逆转裁判");
  });

  it("list_games:含库列表与当前状态", async () => {
    const client = createFakeClient();
    const tool = new GbaListGamesTool({ getGbaClient: () => client });
    const result = JSON.parse((await tool.execute({}, context)).content) as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(result.games).toEqual([{ name: "逆转裁判", hasSave: true, lastPlayedAt: null }]);
    expect(result.current).toEqual({ name: "逆转裁判" });
  });

  it("前台失位自愈(review P1):press 首拒 GBA_NOT_FOREGROUND → 重申前台后重试成功", async () => {
    const press = vi
      .fn()
      .mockRejectedValueOnce(new GbaError("GBA_REJECTED", "GBA_NOT_FOREGROUND"))
      .mockResolvedValue(PRESS_OUTCOME);
    const client = createFakeClient({ press });
    const tool = new GbaPressTool({ getGbaClient: () => client });
    const result = await tool.execute({ buttons: ["a"] }, context);
    expect(client.setForeground).toHaveBeenCalledWith(true);
    expect(press).toHaveBeenCalledTimes(2);
    expect(result.content).toBe('{"ok":true}');

    // 其他拒绝原因不自愈:原样规整失败
    const otherReject = vi
      .fn()
      .mockRejectedValue(new GbaError("GBA_REJECTED", "PRESS_IN_PROGRESS"));
    const client2 = createFakeClient({ press: otherReject });
    const failed = await new GbaPressTool({ getGbaClient: () => client2 }).execute(
      { buttons: ["a"] },
      context,
    );
    expect(otherReject).toHaveBeenCalledTimes(1);
    expect(JSON.parse(failed.content)).toMatchObject({ ok: false, message: "PRESS_IN_PROGRESS" });
  });

  it("import_rom:递交 resid+name,回冻结结构结果;领域拒绝走 GBA_REJECTED", async () => {
    const client = createFakeClient();
    const tool = new GbaImportRomTool({ getGbaClient: () => client });
    const ok = JSON.parse(
      (await tool.execute({ resid: "res-7", name: "新卡带" }, context)).content,
    ) as Record<string, unknown>;
    expect(client.importRom).toHaveBeenCalledWith({ resId: "res-7", name: "新卡带" });
    expect(ok).toEqual({ ok: true, name: "逆转裁判" });

    const rejecting = createFakeClient({
      importRom: vi.fn().mockRejectedValue(new GbaError("GBA_REJECTED", "NOT_A_GBA_ROM")),
    });
    const rejected = JSON.parse(
      (
        await new GbaImportRomTool({ getGbaClient: () => rejecting }).execute(
          { resid: "res-8", name: "假的" },
          context,
        )
      ).content,
    ) as Record<string, unknown>;
    expect(rejected).toMatchObject({ ok: false, error: "GBA_REJECTED", message: "NOT_A_GBA_ROM" });
  });
});
