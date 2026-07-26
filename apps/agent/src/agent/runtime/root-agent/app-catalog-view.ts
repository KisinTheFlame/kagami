/**
 * App 名单的唯一 view-model 来源。system prompt（稳定前缀）与 inner-voice 的 R1 指令
 * （fork 子 agent 尾部）都渲染这份名单，必须共用同一个映射与同一个顺序——否则两处的
 * 名称 / 描述 / App 集合迟早漂移，说的不是一回事（issue #596）。
 */
export type AppCatalogEntryView = {
  id: string;
  displayName: string;
  description: string;
};

export function toAppCatalogView(
  apps: ReadonlyArray<{ id: string; displayName: string; description: string }>,
): AppCatalogEntryView[] {
  return apps.map(app => ({
    id: app.id,
    displayName: app.displayName,
    description: app.description,
  }));
}
