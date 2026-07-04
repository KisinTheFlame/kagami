import {
  Activity,
  Bot,
  Brain,
  CalendarClock,
  FileText,
  FlaskConical,
  Gauge,
  History,
  type LucideIcon,
  KeyRound,
  ListTodo,
  MessagesSquare,
  SlidersHorizontal,
  Webhook,
} from "lucide-react";

type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  matchPrefixes?: readonly string[];
};

export const navItems: readonly NavItem[] = [
  { to: "/main-agent-context", label: "主 Agent 上下文", icon: Bot },
  { to: "/control-panel", label: "控制面板", icon: SlidersHorizontal },
  { to: "/scheduler-tasks", label: "调度任务", icon: CalendarClock },
  { to: "/todos", label: "待办", icon: ListTodo },
  {
    to: "/auth/claude-code",
    label: "内置登录",
    icon: KeyRound,
    matchPrefixes: ["/auth", "/auth/"],
  },
  { to: "/llm-playground", label: "LLM Playground", icon: FlaskConical },
  { to: "/observatory", label: "观察台", icon: Gauge },
  { to: "/metric-charts", label: "Metric 图表", icon: Activity },
  { to: "/llm-history", label: "LLM 调用历史", icon: History },
  { to: "/inner-thought", label: "内心念头", icon: Brain },
  { to: "/app-log-history", label: "应用日志", icon: FileText },
  { to: "/napcat-event-history", label: "NapCat 事件", icon: Webhook },
  { to: "/napcat-group-message-history", label: "QQ 消息", icon: MessagesSquare },
];

export function getPageTitle(pathname: string): string {
  const matchedItem = navItems.find(
    ({ to, matchPrefixes }) =>
      pathname === to ||
      pathname.startsWith(`${to}/`) ||
      matchPrefixes?.some(prefix => pathname === prefix || pathname.startsWith(prefix)) === true,
  );
  return matchedItem?.label ?? "Kagami";
}
