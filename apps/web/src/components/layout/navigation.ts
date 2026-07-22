import {
  Bot,
  Brain,
  CalendarClock,
  FileText,
  Gamepad2,
  Gauge,
  HardDrive,
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
  { to: "/dashboard", label: "大盘", icon: Gauge },
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
  { to: "/llm-history", label: "LLM 调用历史", icon: History },
  { to: "/inner-thought", label: "内心念头", icon: Brain },
  { to: "/app-log-history", label: "应用日志", icon: FileText },
  { to: "/napcat-event-history", label: "NapCat 事件", icon: Webhook },
  { to: "/napcat-group-message-history", label: "QQ 消息", icon: MessagesSquare },
  { to: "/oss-objects", label: "OSS 对象", icon: HardDrive },
  { to: "/gba", label: "GBA 掌机", icon: Gamepad2 },
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
