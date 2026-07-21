-- 持库服务数据库进程隔离（epic #539 子 issue 1）：browser_credential 生产库 0 行、
-- 写路径 put() 无任何调用方，是从未启用的废表。删表后 kagami-browser 彻底脱离共享
-- SQLite（与 spire / pixel 同为零持久化卫星进程），主库迁移不再需要停 browser 进程。
-- secret 打码输入（browser_type 的 secret_handle 参数）随本表一并删除。
DROP TABLE "browser_credential";
