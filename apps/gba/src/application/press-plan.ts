import type { z } from "zod";
import type { GbaButton, GbaPressStepSchema } from "@kagami/gba-api/contract";

type PressStep = z.infer<typeof GbaPressStepSchema>;

// === press 领域上限（超限回 { ok:false, reason }，不是 HTTP 400——镜像 spire「引擎拒绝不是
// 服务故障」；数值定稿于 issue #541 的 Codex 咨询）===
const MAX_CHORD_BUTTONS = 4;
const MAX_HOLD_FRAMES = 120;
const MAX_GAP_FRAMES = 30;
const MAX_SETTLE_FRAMES = 120;
const MAX_STEPS = 8;
/** 单请求总帧预算：Σ每步(hold+gap) + settle ≤ 300（实速 ~5s）。 */
const MAX_TOTAL_FRAMES = 300;

/** 全松开的按键集合。无活动 plan 时每帧都用它——按键状态完全由 plan 派生。 */
export const EMPTY_HELD: ReadonlySet<GbaButton> = new Set();

/**
 * 把 press 序列展开成逐帧按键计划。领域校验失败返回 reason 字符串（`{ ok:false }` 语义），
 * 通过则返回 frames（每帧一个 held 集合）。
 *
 * 纯函数、不碰会话状态：帧推进权归帧循环，这里只负责「未来 N 帧各按什么」的展开与校验。
 */
export function buildPressPlan(
  steps: PressStep[],
  settleFrames: number,
): { frames: ReadonlySet<GbaButton>[] } | string {
  if (steps.length > MAX_STEPS) {
    return `INVALID_PRESS: steps 数量 ${steps.length} 超上限 ${MAX_STEPS}`;
  }
  if (settleFrames > MAX_SETTLE_FRAMES) {
    return `INVALID_PRESS: settleFrames ${settleFrames} 超上限 ${MAX_SETTLE_FRAMES}`;
  }
  const frames: ReadonlySet<GbaButton>[] = [];
  for (const [index, step] of steps.entries()) {
    const buttons = new Set(step.buttons);
    if (buttons.size !== step.buttons.length) {
      return `INVALID_PRESS: 第 ${index + 1} 步 buttons 含重复键`;
    }
    if (buttons.size > MAX_CHORD_BUTTONS) {
      return `INVALID_PRESS: 第 ${index + 1} 步同时按 ${buttons.size} 键，超上限 ${MAX_CHORD_BUTTONS}`;
    }
    if (buttons.has("up") && buttons.has("down")) {
      return `INVALID_PRESS: 第 ${index + 1} 步同时按 up+down（物理不可能的互斥方向）`;
    }
    if (buttons.has("left") && buttons.has("right")) {
      return `INVALID_PRESS: 第 ${index + 1} 步同时按 left+right（物理不可能的互斥方向）`;
    }
    if (step.holdFrames > MAX_HOLD_FRAMES) {
      return `INVALID_PRESS: 第 ${index + 1} 步 holdFrames ${step.holdFrames} 超上限 ${MAX_HOLD_FRAMES}`;
    }
    if (step.gapFrames > MAX_GAP_FRAMES) {
      return `INVALID_PRESS: 第 ${index + 1} 步 gapFrames ${step.gapFrames} 超上限 ${MAX_GAP_FRAMES}`;
    }
    const chord: ReadonlySet<GbaButton> = buttons;
    for (let i = 0; i < step.holdFrames; i++) {
      frames.push(chord);
    }
    for (let i = 0; i < step.gapFrames; i++) {
      frames.push(EMPTY_HELD);
    }
  }
  for (let i = 0; i < settleFrames; i++) {
    frames.push(EMPTY_HELD);
  }
  if (frames.length > MAX_TOTAL_FRAMES) {
    return `INVALID_PRESS: 总帧数 ${frames.length} 超预算 ${MAX_TOTAL_FRAMES}（Σ每步(hold+gap)+settle ≤ ${MAX_TOTAL_FRAMES}）`;
  }
  return { frames };
}
