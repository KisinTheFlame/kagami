import { useGbaScreen, useGbaState } from "./useGbaLive";

/**
 * 实况画面面板(#541 PR3):页面聚焦时每秒轮询当前帧。画面用 pixelated 渲染保像素锐利;
 * 状态徽章遵循配色铁律——前台运行=正黄块黑字(进行时),后台冻结=中性;未加载=中性弱字。
 */
export function GbaScreenPanel() {
  const screenQuery = useGbaScreen();
  const stateQuery = useGbaState();
  const state = stateQuery.data ?? null;
  const imageUrl = screenQuery.data ?? null;

  return (
    <section className="rounded-none border bg-card" aria-label="GBA 实况画面">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2">
        <h2 className="font-serif text-lg">实况画面</h2>
        {state?.loaded ? (
          <>
            <span className="font-mono text-sm">{state.romName}</span>
            {state.foreground ? (
              <span className="bg-scheduler px-2 py-0.5 text-xs font-medium text-scheduler-foreground">
                前台 · 实时运行
              </span>
            ) : (
              <span className="border px-2 py-0.5 text-xs text-muted-foreground">后台 · 冻结</span>
            )}
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              frame {state.frame}
            </span>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">未加载游戏</span>
        )}
      </header>
      <div className="flex items-center justify-center bg-black p-4">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt="GBA 当前画面"
            width={480}
            height={320}
            className="max-w-full"
            style={{ imageRendering: "pixelated" }}
          />
        ) : (
          <div className="flex h-[320px] w-[480px] max-w-full items-center justify-center text-sm text-neutral-500">
            {screenQuery.isError ? "画面获取失败" : "无画面(小镜还没开机)"}
          </div>
        )}
      </div>
    </section>
  );
}
