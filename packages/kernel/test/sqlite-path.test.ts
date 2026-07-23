import { describe, expect, it } from "vitest";
import path from "node:path";
import { sqliteFilePathFromUrl } from "../src/utils/sqlite-path.js";

// 四个持库服务的 db client 共用的路径解析（#539 子 issue 5 收敛到 kernel）。
// 纯路径逻辑，四条分支各钉一例，防止单点改动让所有服务的库文件路径一起解析错。
describe("sqliteFilePathFromUrl", () => {
  it(":memory: 与 file::memory: 透传为 :memory:", () => {
    expect(sqliteFilePathFromUrl(":memory:")).toBe(":memory:");
    expect(sqliteFilePathFromUrl("file::memory:")).toBe(":memory:");
  });

  it("file: + 绝对路径直接剥掉 scheme", () => {
    expect(sqliteFilePathFromUrl("file:/abs/dir/kagami.db")).toBe("/abs/dir/kagami.db");
  });

  it("file:// 三斜杠形态剥 scheme 后已是绝对路径,原样返回(POSIX 多斜杠等价)", () => {
    expect(sqliteFilePathFromUrl("file:///abs/dir/kagami.db")).toBe("///abs/dir/kagami.db");
    expect(path.resolve(sqliteFilePathFromUrl("file:///abs/dir/kagami.db"))).toBe(
      "/abs/dir/kagami.db",
    );
  });

  it("非 file: 的裸路径按 cwd resolve 成绝对路径", () => {
    expect(sqliteFilePathFromUrl("data/sqlite/kagami.db")).toBe(
      path.resolve("data/sqlite/kagami.db"),
    );
  });
});
