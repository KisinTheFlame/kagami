import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getCacheControlHeader,
  getContentType,
  resolveAssetPath,
  selectMissingAssetFallback,
} from "../server/static-resolve.js";

// 静态托管的决策边界回归（#578：这套逻辑从 gateway 迁到 web 自持）。这层错一个分支的后果是
// 具体的：SPA 深链回 404、或 index.html 被长缓存钉死在旧版本、或根外文件被读出去。

const STATIC_DIR = path.resolve("/srv/web/dist/client");
const INDEX_PATH = path.join(STATIC_DIR, "index.html");

describe("resolveAssetPath", () => {
  it("根路径映射到 index.html", () => {
    expect(resolveAssetPath("/", STATIC_DIR, INDEX_PATH)).toBe(INDEX_PATH);
  });

  it("普通资源路径解析到静态根之下", () => {
    expect(resolveAssetPath("/assets/app-a1b2c3d4.js", STATIC_DIR, INDEX_PATH)).toBe(
      path.join(STATIC_DIR, "assets", "app-a1b2c3d4.js"),
    );
  });

  it("路径穿越收敛回 index.html，绝不逃出静态根", () => {
    // 关键安全边界：resolve 后落在静态根之外的一律回 index，不泄漏根外任何文件。
    const escaped = resolveAssetPath("/../../etc/passwd", STATIC_DIR, INDEX_PATH);
    expect(escaped).toBe(INDEX_PATH);
    expect(escaped.startsWith(STATIC_DIR)).toBe(true);
  });

  it("百分号编码的穿越同样被收敛（先解码再判定）", () => {
    expect(resolveAssetPath("/%2e%2e/%2e%2e/etc/passwd", STATIC_DIR, INDEX_PATH)).toBe(INDEX_PATH);
  });

  it("路径中段的 .. 归一化后仍在根内则照常放行", () => {
    expect(resolveAssetPath("/assets/../favicon.ico", STATIC_DIR, INDEX_PATH)).toBe(
      path.join(STATIC_DIR, "favicon.ico"),
    );
  });
});

describe("selectMissingAssetFallback", () => {
  it("无扩展名 + 收 HTML → 回 index.html（SPA 深链刷新）", () => {
    expect(
      selectMissingAssetFallback(
        path.join(STATIC_DIR, "dashboard"),
        "text/html,application/xhtml+xml",
        INDEX_PATH,
      ),
    ).toBe(INDEX_PATH);
  });

  it("无 Accept 头也按导航处理 → 回 index.html", () => {
    expect(selectMissingAssetFallback(path.join(STATIC_DIR, "todos"), undefined, INDEX_PATH)).toBe(
      INDEX_PATH,
    );
  });

  it("无扩展名但明确不收 HTML → 404，不拿 index.html 冒充", () => {
    // fetch 的 `Accept: application/json` 落到这里，回 index.html 会让调用方解析 HTML 报错。
    expect(
      selectMissingAssetFallback(path.join(STATIC_DIR, "todos"), "application/json", INDEX_PATH),
    ).toBeNull();
  });

  it("带扩展名的缺失资源 → 404，不回退", () => {
    // 缺失的 js/css 必须是真 404：回 index.html 会让浏览器把 HTML 当脚本执行。
    expect(
      selectMissingAssetFallback(
        path.join(STATIC_DIR, "assets", "nope.js"),
        "text/html",
        INDEX_PATH,
      ),
    ).toBeNull();
  });
});

describe("getCacheControlHeader", () => {
  it("index.html 永不长缓存", () => {
    // 它引用着那些 immutable 资源，缓存住它等于把整个前端钉死在旧版本。
    expect(getCacheControlHeader(INDEX_PATH, INDEX_PATH)).toBe("no-cache");
  });

  it("带内容指纹的资源长缓存且 immutable", () => {
    expect(
      getCacheControlHeader(path.join(STATIC_DIR, "assets", "app-a1b2c3d4.js"), INDEX_PATH),
    ).toBe("public, max-age=31536000, immutable");
  });

  it("无指纹的静态文件不长缓存", () => {
    expect(getCacheControlHeader(path.join(STATIC_DIR, "favicon.ico"), INDEX_PATH)).toBe(
      "no-cache",
    );
  });
});

describe("getContentType", () => {
  it("按扩展名给出 MIME", () => {
    expect(getContentType(path.join(STATIC_DIR, "index.html"))).toBe("text/html; charset=utf-8");
    expect(getContentType(path.join(STATIC_DIR, "a.js"))).toBe("text/javascript; charset=utf-8");
    expect(getContentType(path.join(STATIC_DIR, "a.woff2"))).toBe("font/woff2");
  });

  it("扩展名大小写不敏感", () => {
    expect(getContentType(path.join(STATIC_DIR, "LOGO.PNG"))).toBe("image/png");
  });

  it("表外扩展名退化为 octet-stream，不猜不嗅探", () => {
    expect(getContentType(path.join(STATIC_DIR, "archive.tar.gz"))).toBe(
      "application/octet-stream",
    );
  });
});
