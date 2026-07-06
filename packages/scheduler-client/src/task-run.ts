/**
 * 使用方 handler 可选返回的执行元数据（如 data-retention 的删除行数）。**当前 SDK 不转发它**：
 * run 上报 wire（SchedulerReportRunRequest）不含 metadata 字段，scheduler 侧 TaskRun 库与全局
 * run view（#493）也有意只收 status / 时间 / error，不收 metadata。保留此返回位作向后兼容 / 将来
 * 扩展的挂点——handler 若要留痕诊断信息，请自行走 metric / 日志（data-retention 即另发
 * `scheduler.retention.deleted_rows` 指标），别指望它经回报落库。
 */
export type TaskRunMetadata = Record<string, unknown>;
