import { GbaRomManager } from "./GbaRomManager";
import { GbaScreenPanel } from "./GbaScreenPanel";

/**
 * GBA 掌机页(#541 PR3):上=实况画面(页面聚焦时每秒轮询,失焦自动停),下=ROM 库管理。
 * 游玩本身是小镜的事(agent 直连游玩面);这里只是「从她肩膀后面看屏幕」+ 给她递卡带。
 */
export function GbaPage() {
  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4">
      <GbaScreenPanel />
      <GbaRomManager />
    </div>
  );
}
