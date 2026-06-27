import { describe, expect, it } from "vitest";
import { TodoReminderDraft } from "../../../../src/agent/apps/todo/todo-reminder-draft.js";
import { TodoDigestDraft } from "../../../../src/agent/apps/todo/todo-digest-draft.js";

describe("TodoReminderDraft", () => {
  it("每条 todo 一个细粒度 sourceId，渲染单行", () => {
    const draft = new TodoReminderDraft({ id: 3, title: "写周报" });
    expect(draft.sourceId).toBe("todo:reminder:3");
    expect(draft.group).toBe("待办");
    expect(draft.render()).toBe("《写周报》到点了");
  });

  it("merge 取最新（同一 todo 同窗罕见重复）", () => {
    const older = new TodoReminderDraft({ id: 3, title: "旧" });
    const newer = new TodoReminderDraft({ id: 3, title: "新" });
    expect(newer.merge(older).render()).toBe("《新》到点了");
  });
});

describe("TodoDigestDraft", () => {
  it("无截断：列出全部", () => {
    const draft = new TodoDigestDraft({
      totalCount: 2,
      items: [{ title: "a" }, { title: "b" }],
    });
    expect(draft.sourceId).toBe("todo:digest");
    expect(draft.group).toBe("待办");
    expect(draft.render()).toBe("还有 2 件没做：《a》《b》");
  });

  it("有截断：附「其余 N 件」", () => {
    const draft = new TodoDigestDraft({
      totalCount: 5,
      items: [{ title: "a" }, { title: "b" }],
    });
    expect(draft.render()).toBe("还有 5 件没做：《a》《b》…（其余 3 件）");
  });
});
