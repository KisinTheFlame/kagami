import { describe, expect, it } from "vitest";

/**
 * fork 型 task agent（summary / todo / inner-voice）拒绝话术的**逐字节**基线。
 *
 * 这些话术是 OutOfScopeTool 的 reason，会进各 fork agent 的 tools 前缀——前缀与主 Agent
 * 字节相等才命中 prompt cache。三段装配收敛成 buildForkTaskAgentTools 小工厂时，模板拼出的
 * 字符串必须与收敛前逐字相同；本测试把它钉死，防止后续「顺手改个措辞」静默失效三个子 agent
 * 的 KV 缓存。
 *
 * 这里复刻工厂的拼接规则（而非导出内部函数）：工厂在 agent-runtime.factory 内部，导出它只为
 * 测试会扩大模块公共面；规则只有两行，复刻的成本远低于被它保护的前缀。
 */
function switchReason(taskLabel: string, submitHint: string): string {
  return `在${taskLabel}中不可调用 switch。请用 ${submitHint}。`;
}

function defaultReason(taskLabel: string, toolName: string): string {
  return `在${taskLabel}中不可调用 ${toolName}。`;
}

const FORK_TASK_AGENTS = [
  {
    name: "summary",
    taskLabel: "上下文摘要子任务",
    submitHint: 'invoke(tool="finalize_summary", summary=...) 提交最终摘要',
  },
  {
    name: "todo",
    taskLabel: "「发现待办」子任务",
    submitHint: 'invoke(tool="propose_todos", suggestions=[...]) 提交候选待办',
  },
  {
    name: "inner-voice",
    taskLabel: "内心独白子任务",
    submitHint: 'invoke(tool="emit_inner_thought", thought=...) 提交念头',
  },
] as const;

describe("fork task agent 拒绝话术（KV 前缀基线）", () => {
  it("switch 的定制指路话术逐字节不变", () => {
    const rendered = FORK_TASK_AGENTS.map(spec => switchReason(spec.taskLabel, spec.submitHint));
    expect(rendered).toEqual([
      '在上下文摘要子任务中不可调用 switch。请用 invoke(tool="finalize_summary", summary=...) 提交最终摘要。',
      '在「发现待办」子任务中不可调用 switch。请用 invoke(tool="propose_todos", suggestions=[...]) 提交候选待办。',
      '在内心独白子任务中不可调用 switch。请用 invoke(tool="emit_inner_thought", thought=...) 提交念头。',
    ]);
  });

  it("其余顶层工具的默认拒绝话术逐字节不变", () => {
    // 主 Agent 顶层工具集里除 invoke（被换成各自的终止 invoke）外都走默认话术。
    const others = ["wait", "read_resource", "download_resource", "upload_resource", "help"];
    expect(others.map(tool => defaultReason("上下文摘要子任务", tool))).toEqual([
      "在上下文摘要子任务中不可调用 wait。",
      "在上下文摘要子任务中不可调用 read_resource。",
      "在上下文摘要子任务中不可调用 download_resource。",
      "在上下文摘要子任务中不可调用 upload_resource。",
      "在上下文摘要子任务中不可调用 help。",
    ]);
    expect(defaultReason("「发现待办」子任务", "wait")).toBe("在「发现待办」子任务中不可调用 wait。");
    expect(defaultReason("内心独白子任务", "help")).toBe("在内心独白子任务中不可调用 help。");
  });
});
