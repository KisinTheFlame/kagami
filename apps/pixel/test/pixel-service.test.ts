import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PixelService } from "../src/application/pixel.service.js";
import { SaveStore } from "../src/persistence/save-store.js";
import { CanvasRejectError } from "../src/domain/errors.js";

async function freshService(): Promise<{ service: PixelService; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "pixel-svc-"));
  const service = new PixelService({ store: new SaveStore({ dir }) });
  await service.init();
  return { service, dir };
}

describe("PixelService — 无画布", () => {
  it("currentState 为 null，各算子拒绝，render 抛错", async () => {
    const { service } = await freshService();
    expect(service.currentState()).toBeNull();
    await expect(service.fill(0, 0, "red")).rejects.toThrow(CanvasRejectError);
    await expect(service.clear()).rejects.toThrow(CanvasRejectError);
    expect(() => service.renderPng()).toThrow(CanvasRejectError);
  });
});

describe("PixelService — 画布生命周期", () => {
  it("new_canvas 建画布并可绘图，render 出字节", async () => {
    const { service } = await freshService();
    await service.newCanvas(4, 4);
    const state = await service.fill(0, 0, "red");
    expect(state.width).toBe(4);
    expect(state.colors).toContain("red");
    expect(service.renderPng().subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it("画布跨服务重启从存档恢复（逐格相等）", async () => {
    const { service, dir } = await freshService();
    await service.newCanvas(3, 2);
    await service.setPixels([{ x: 0, y: 0, color: "red" }]);
    await service.flush();
    const before = service.currentState();

    const revived = new PixelService({ store: new SaveStore({ dir }) });
    await revived.init();
    expect(revived.currentState()).toEqual(before);
  });
});
