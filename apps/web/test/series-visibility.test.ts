import { describe, expect, it } from "vitest";
import { toggleHiddenId } from "@/components/metric/useSeriesVisibility";

describe("toggleHiddenId：不可变切换", () => {
  it("缺则加、有则删", () => {
    const empty = new Set<string>();
    const added = toggleHiddenId(empty, "tokens");
    expect(added.has("tokens")).toBe(true);
    const removed = toggleHiddenId(added, "tokens");
    expect(removed.has("tokens")).toBe(false);
  });

  it("返回新 Set，不原地改旧集（否则 React 不重渲染）", () => {
    const prev = new Set<string>(["ratePct"]);
    const next = toggleHiddenId(prev, "tokens");
    expect(next).not.toBe(prev);
    expect([...prev]).toEqual(["ratePct"]);
    expect(next.has("ratePct")).toBe(true);
    expect(next.has("tokens")).toBe(true);
  });
});
