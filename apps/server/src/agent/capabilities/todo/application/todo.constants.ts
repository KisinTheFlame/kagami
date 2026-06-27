/**
 * TODO capability 的代码常量。
 *
 * 这些值在不同环境之间不变、也没有运维会在活系统上调，按 Kagami 约定它们属于
 * 代码常量而非 config.yaml（详见 CLAUDE.md 配置原则 / 学习 config-yaml-is-for-ops-not-code）。
 * scheduled task 直接用这里的字面值注册，不进 config.loader / config.yaml。
 */

/** 到点提醒扫描节拍：reminder poller 每隔这么久跑一次 runOnce。 */
export const REMINDER_TICK_MS = 60_000;

/**
 * 每日待办回顾的 cron 表达式。
 *
 * 时区：cron 解析依赖进程本地时区。部署机需设 `TZ=Asia/Shanghai`，否则 UTC 机器上
 * 小镜会在本地凌晨唠叨。（若调度层将来支持显式 TZ，应在那里指定，把这条注释收紧。）
 */
export const DAILY_DIGEST_CRON = "0 9 * * *";

/** active（pending）待办上限，防爆。 */
export const MAX_ACTIVE_TODOS = 200;

/** repeatEvery 的下限，防止荒谬的小间隔把提醒打成连刷。 */
export const MIN_REPEAT_MS = 60_000;

/** list_todos / digest 列出条目的输出封顶，超出截断为「…其余 N 件」。 */
export const TODO_LIST_RENDER_LIMIT = 20;
