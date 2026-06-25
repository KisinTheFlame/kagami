import { describe, expect, it } from "vitest";
import { IthomeNotificationDraft } from "../../../../src/agent/apps/ithome/ithome-notification-draft.js";

describe("IthomeNotificationDraft", () => {
  it("renders a single article with sourceId 'ithome'", () => {
    const draft = new IthomeNotificationDraft({ title: "某标题" });
    expect(draft.sourceId).toBe("ithome");
    expect(draft.render()).toBe("IT之家：1篇新文，最新《某标题》");
  });

  it("folds via merge(prev): count accumulates, title takes the latest", () => {
    const older = new IthomeNotificationDraft({ title: "旧标题" });
    const newer = new IthomeNotificationDraft({ title: "新标题" });
    // center 的调用约定：newer.merge(older)，this = 最新、prev = 历史。
    const merged = newer.merge(older);
    expect(merged.render()).toBe("IT之家：2篇新文，最新《新标题》");
  });
});
