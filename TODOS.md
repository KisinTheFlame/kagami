# TODOs

待办事项清单。按模块 / 主题分组，组内按优先级 P0 → P3 排序。完成的项移到底部 `## Completed`。

**优先级语义**：

| 级别 | 含义                        |
| ---- | --------------------------- |
| P0   | 阻塞性问题，必须立刻处理    |
| P1   | 重要但不阻塞，应当尽快安排  |
| P2   | 改进项，时间允许时处理      |
| P3   | 想法 / 长期项，可能永远不做 |

**条目格式**：

```markdown
### <一句话标题>

- **Priority:** P{0-3}
- **Status:** open | in-progress
- **Context:** 为什么这件事值得做、依赖、约束（可选）
- **Notes:** 链接、相关文件、相关 issue/PR（可选）
```

---

## scheduler

### `news_article` / `news_feed_cursor` 的清理策略

- **Priority:** P1
- **Status:** open
- **Context:** 当前 `apps/server/src/scheduler/tasks/data-retention/retention-tasks.ts` 显式把 `news_article` 与 `news_feed_cursor` 排除在每日清理之外（[retention-tasks.ts:41](apps/server/src/scheduler/tasks/data-retention/retention-tasks.ts:41)）。RSS 文章既不像日志那样安全按时间清掉，也不像 Story 记忆那样需要永久保留 —— 需要单独想清楚保留窗口、与 Agent 召回路径的关系、以及 `news_feed_cursor` 在重置后如何避免重新拉取已读旧文章。
- **Notes:** 决策前不要简单地把它加进 `RETENTION_TASKS`。

---

## Completed

<!-- 完成后的条目按完成日期倒序，附 PR 链接。例：
### 拆分 LLM 调用历史列表/详情接口

- **Priority:** P1
- **Completed:** 2026-05-23, [#72](https://github.com/KisinTheFlame/kagami/pull/72)
-->

## tools

### 接入高德 Web API

- **Priority:** P2
- **Status:** open
- **Context:** 小伊和楠楠已经由悄得乐/龙哥接入了高德 Web API（POI 搜索、附近餐厅等），小镜目前没有地图类工具。闻震在竞技场说"该让黑叔叔给你和 Nova 上强度了"，可以参考小伊的接入方式给小镜也加一个高德 key。
- **Notes:** 小伊用的是高德 Web API，key 由悄得乐注册。闻震需要注册自己的 key 或复用已有 key。
