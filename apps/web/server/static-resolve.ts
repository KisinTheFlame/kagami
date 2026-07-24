// 静态托管的纯决策层：把「请求路径 + Accept 头」翻译成「发哪个文件、配什么响应头」。
// 这里不碰 fs、不碰 http，全部是可单测的纯函数；真实的存在性探测与流式发送在 index.ts。
// 分层动机与 apps/gateway 的 routing.ts / index.ts 一致：决策是回归测试的抓手，IO 不是。
//
// 行为自 apps/gateway 原样迁入（issue #578）：web 从此自己发自己的产物，gateway 退化为纯反代。
// 迁移要求响应逐条等价，故下列每条规则都保持 gateway 既有语义，不趁机"优化"。

import path from "node:path";

/** 扩展名 → Content-Type。表外一律 application/octet-stream（不猜、不嗅探）。 */
const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

// 内容指纹：Vite 产物名里的 hash 段（`-` 或 `.` 后接 8 位以上字母数字，再跟扩展名）。
// 命中即可长缓存——文件内容变了文件名一定变，故 immutable 不会发陈旧资源。
const HASHED_ASSET_NAME_PATTERN = /(?:^|[-.])[a-z0-9]{8,}(?=\.)/i;

/** 「任意媒体类型均可」的 Accept 通配串。单列成常量，免得写进块注释里把注释提前闭合。 */
const WILDCARD_MEDIA_RANGE = "*/*";

/**
 * 请求路径 → 静态根下的绝对路径。`/` 映射到 index.html。
 *
 * 路径穿越守卫：resolve 后不在 staticDir 内的（`/../../etc/passwd` 一类）**收敛回 index.html**
 * 而非报错——这是 gateway 的既有行为，等价迁移故保持不变（对单用户内网管理台，回首页比 403
 * 更少惊吓，且同样不泄漏任何根外文件）。
 */
export function resolveAssetPath(pathname: string, staticDir: string, indexPath: string): string {
  const decodedPath = decodeURIComponent(pathname);
  const relativePath = decodedPath === "/" ? "/index.html" : decodedPath;
  const resolvedPath = path.resolve(staticDir, `.${relativePath}`);

  // 以分隔符收口，而非裸前缀比较：否则静态根的兄弟目录（`dist/client-old` 之于 `dist/client`）
  // 会被误判成「在根内」。当前布局下不可利用，但这层是安全边界，按最严的写法收。
  if (!resolvedPath.startsWith(`${staticDir}${path.sep}`)) {
    return indexPath;
  }

  return resolvedPath;
}

/**
 * 目标文件不存在时的回退决策（存在性由调用方探测后才轮到这里）：
 * 返回 index.html = 交给前端路由（SPA 深链刷新），返回 null = 该回 404。
 *
 * 两条规则按序：
 * 1. 带扩展名的必是资源请求，缺了就是真 404——拿 index.html 冒充会让浏览器把 HTML 当脚本执行；
 * 2. 其余按「客户端是否接受 HTML」判定：显式限定了非 HTML 类型的（如 `Accept: application/json`）
 *    回 404，其余回 index.html 让前端路由接管。
 *
 * 关于通配 Accept 与缺失 Accept（#578 review 修正）：二者都表示「什么类型都收」，按 RFC 7231
 * 都应拿到 index.html。这不只是语义正确，更是经 gateway 反代后的必需——undici fetch 会给缺失
 * 的头自动补上通配 Accept，网关无法把「客户端原本没发 Accept」这个信息透传给上游。若把通配判为
 * 不收 HTML，无 Accept 头的深链就会从 200 静默退化成 404。
 */
export function selectMissingAssetFallback(
  targetPath: string,
  acceptHeader: string | undefined,
  indexPath: string,
): string | null {
  if (path.extname(targetPath).length > 0) {
    return null;
  }

  if (typeof acceptHeader === "string" && !acceptsHtml(acceptHeader)) {
    return null;
  }

  return indexPath;
}

/** Accept 是否接受 HTML：显式 text/html，或"什么类型都收"的通配。 */
function acceptsHtml(acceptHeader: string): boolean {
  return acceptHeader.includes("text/html") || acceptHeader.includes(WILDCARD_MEDIA_RANGE);
}

/**
 * 缓存策略：带内容指纹的资源永久缓存，其余（含 index.html）每次回源校验。
 * index.html 必须 no-cache——它引用的正是那些 immutable 资源，缓存住它就等于把整个前端钉死在旧版本。
 */
export function getCacheControlHeader(targetPath: string, indexPath: string): string {
  if (targetPath === indexPath) {
    return "no-cache";
  }

  if (isHashedAsset(path.basename(targetPath))) {
    return "public, max-age=31536000, immutable";
  }

  return "no-cache";
}

/** 扩展名 → Content-Type，表外回 application/octet-stream。 */
export function getContentType(targetPath: string): string {
  return MIME_TYPES[path.extname(targetPath).toLowerCase()] ?? "application/octet-stream";
}

function isHashedAsset(fileName: string): boolean {
  return HASHED_ASSET_NAME_PATTERN.test(fileName);
}
