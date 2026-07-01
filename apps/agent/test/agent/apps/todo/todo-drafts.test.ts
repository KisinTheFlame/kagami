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

const NUDGE = "顺便想想接下来打算做什么，去 todo App 按自己的计划添几条新待办吧。";

describe("TodoDigestDraft", () => {
  it("无截断：列出全部，附创建提示", () => {
    const draft = new TodoDigestDraft({
      totalCount: 2,
      items: [{ title: "a" }, { title: "b" }],
    });
    expect(draft.sourceId).toBe("todo:digest");
    expect(draft.group).toBe("待办");
    expect(draft.render()).toBe(`还有 2 件没做：《a》《b》。${NUDGE}`);
  });

  it("有截断：附「其余 N 件」与创建提示", () => {
    const draft = new TodoDigestDraft({
      totalCount: 5,
      items: [{ title: "a" }, { title: "b" }],
    });
    expect(draft.render()).toBe(`还有 5 件没做：《a》《b》…（其余 3 件）。${NUDGE}`);
  });

  it("零未完成项：兜底文案 + 创建提示", () => {
    const draft = new TodoDigestDraft({ totalCount: 0, items: [] });
    expect(draft.render()).toBe(`待办都清空了，没有未完成的事。${NUDGE}`);
  });

  it("有建议：前两段后换行追加第三段", () => {
    const draft = new TodoDigestDraft({
      totalCount: 2,
      items: [{ title: "a" }, { title: "b" }],
      suggestions: ["写周报", "回复闻震"],
    });
    expect(draft.render()).toBe(
      `还有 2 件没做：《a》《b》。${NUDGE}\n这些事你或许可以做：《写周报》《回复闻震》`,
    );
  });

  it("无建议（默认空数组）：只两段，无第三段", () => {
    const draft = new TodoDigestDraft({
      totalCount: 1,
      items: [{ title: "a" }],
      suggestions: [],
    });
    expect(draft.render()).toBe(`还有 1 件没做：《a》。${NUDGE}`);
  });

  it("空待办 + 有建议：兜底文案后仍追加第三段", () => {
    const draft = new TodoDigestDraft({
      totalCount: 0,
      items: [],
      suggestions: ["整理下周计划"],
    });
    expect(draft.render()).toBe(
      `待办都清空了，没有未完成的事。${NUDGE}\n这些事你或许可以做：《整理下周计划》`,
    );
  });

  it("空待办 + 无建议：只兜底文案", () => {
    const draft = new TodoDigestDraft({ totalCount: 0, items: [], suggestions: [] });
    expect(draft.render()).toBe(`待办都清空了，没有未完成的事。${NUDGE}`);
  });
});
