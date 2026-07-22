// 网关按 `/api` 之后的上游路径前缀，决定这条请求转发给哪个后端进程。这里只做「路径 → 上游标识」
// 的纯决策（不碰 config / URL），便于单测覆盖边界；index.ts 再把 UpstreamKey 映射到具体上游地址。

/** 上游进程标识；`agent` 是默认兜底（不命中任何专用前缀的都回 kagami-agent）。 */
export type UpstreamKey = "metric" | "llm" | "console" | "oss" | "scheduler" | "gba" | "agent";

// 这些前缀的 /api 请求路由到 console 进程（管理台后端，纯 DB 查询）；其余仍到 agent。
const CONSOLE_PATH_PREFIXES = [
  "/app-log",
  "/llm-chat-call",
  "/inner-thought",
  "/napcat-event",
  "/napcat-group-message",
  "/todo",
];
// 这些前缀路由到 kagami-llm 进程：/auth 是 OAuth 凭据中心（认证管理端点随 LLM 服务外移），
// /llm/providers 是管理台「LLM 调用历史」的 provider 列举（console-facing view，前端直连、不经 agent
// 中转）。llm 的内部 RPC 在 `/internal/*`，刻意不进网关前缀，浏览器经网关够不到。
const LLM_PATH_PREFIXES = ["/auth", "/llm/providers"];
// 整个 /metric 前缀路由到独立的 metric 进程（@kagami/metric）：查询（POST /metric/query）、
// 派生（POST /metric/derive）、raw 原始点（POST /metric/points）与摄取（POST /metric/record）。
// 内网单用户部署无安全边界考量，故不再逐个列查询端点、把写入端点排除在外（早期 #444 的做法），
// 统一整段前缀放行——新增 /metric 子端点无需再同步维护此白名单。
const METRIC_PATH_PREFIXES = ["/metric"];
// 管理台对象浏览器只读面路由到 kagami-oss 进程。仅 /oss-object（列表 / 统计 / 预览字节）过网关；
// 写操作前缀 /objects（put/delete）刻意不在此，浏览器经网关够不到 OSS 的任何写路由。
const OSS_PATH_PREFIXES = ["/oss-object"];
// 调度任务面路由到 kagami-scheduler 进程（#493 P4）：全局查询 GET /scheduler/tasks 与手动触发
// POST /scheduler/tasks/:o/:t/trigger 都落在 /scheduler/tasks 前缀下（后者是它的子路径）。register
// / status / runs、SSE tick、/internal/scheduler-trigger 都是服务间内部路由，刻意不进网关前缀，
// 前端经网关够不到它们。
const SCHEDULER_PATH_PREFIXES = ["/scheduler/tasks"];
// 管理台 GBA 面路由到 kagami-gba 进程（#541 PR3）：/gba/roms 是 ROM 管理（列表 / 上传 / 删除），
// /gba/console 是实况只读面（当前画面 PNG + 运行状态，页面聚焦时每秒轮询）。游玩路由 /gba/run/*
// 刻意不进分流表——浏览器经网关够不到按键 / 加载 / 前后台切换，那是 agent 直连的专属面。
const GBA_PATH_PREFIXES = ["/gba/roms", "/gba/console"];

/**
 * 前缀匹配：命中「等于前缀」或「前缀 + `/` 打头的子路径」。以 `/` 边界收口是关键——`/llm/providers`
 * 不会误吞 `/llm-chat-call`（后者既不等于前缀、也不以 `/llm/providers/` 打头），故仍落 console。
 */
function matchesAnyPrefix(upstreamPath: string, prefixes: string[]): boolean {
  return prefixes.some(prefix => upstreamPath === prefix || upstreamPath.startsWith(`${prefix}/`));
}

/** 纯决策：`/api` 之后的上游路径 → 目标上游进程标识。顺序即优先级，末尾兜底 agent。 */
export function selectUpstreamKey(upstreamPath: string): UpstreamKey {
  if (matchesAnyPrefix(upstreamPath, METRIC_PATH_PREFIXES)) {
    return "metric";
  }
  if (matchesAnyPrefix(upstreamPath, LLM_PATH_PREFIXES)) {
    return "llm";
  }
  if (matchesAnyPrefix(upstreamPath, CONSOLE_PATH_PREFIXES)) {
    return "console";
  }
  if (matchesAnyPrefix(upstreamPath, OSS_PATH_PREFIXES)) {
    return "oss";
  }
  if (matchesAnyPrefix(upstreamPath, SCHEDULER_PATH_PREFIXES)) {
    return "scheduler";
  }
  if (matchesAnyPrefix(upstreamPath, GBA_PATH_PREFIXES)) {
    return "gba";
  }
  return "agent";
}
