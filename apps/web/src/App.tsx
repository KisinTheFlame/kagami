import { lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";

const AuthPage = lazy(() =>
  import("@/pages/auth/AuthPage").then(module => ({ default: module.AuthPage })),
);
const MainAgentContextPage = lazy(() =>
  import("@/pages/main-agent-context/MainAgentContextPage").then(module => ({
    default: module.MainAgentContextPage,
  })),
);
const DashboardPage = lazy(() =>
  import("@/pages/dashboard/DashboardPage").then(module => ({
    default: module.DashboardPage,
  })),
);
const ControlPanelPage = lazy(() =>
  import("@/pages/control-panel/ControlPanelPage").then(module => ({
    default: module.ControlPanelPage,
  })),
);
const SchedulerTasksPage = lazy(() =>
  import("@/pages/scheduler-tasks/SchedulerTasksPage").then(module => ({
    default: module.SchedulerTasksPage,
  })),
);
const LlmHistoryPage = lazy(() =>
  import("@/pages/llm-history/LlmHistoryPage").then(module => ({ default: module.LlmHistoryPage })),
);
const AppLogHistoryPage = lazy(() =>
  import("@/pages/app-log-history/AppLogHistoryPage").then(module => ({
    default: module.AppLogHistoryPage,
  })),
);
const InnerThoughtPage = lazy(() =>
  import("@/pages/inner-thought/InnerThoughtPage").then(module => ({
    default: module.InnerThoughtPage,
  })),
);
const NapcatEventHistoryPage = lazy(() =>
  import("@/pages/napcat-event-history/NapcatEventHistoryPage").then(module => ({
    default: module.NapcatEventHistoryPage,
  })),
);
const NapcatGroupMessageHistoryPage = lazy(() =>
  import("@/pages/napcat-group-message-history/NapcatGroupMessageHistoryPage").then(module => ({
    default: module.NapcatGroupMessageHistoryPage,
  })),
);
const TodosPage = lazy(() =>
  import("@/pages/todos/TodosPage").then(module => ({
    default: module.TodosPage,
  })),
);
const OssObjectsPage = lazy(() =>
  import("@/pages/oss-objects/OssObjectsPage").then(module => ({
    default: module.OssObjectsPage,
  })),
);

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/main-agent-context" replace />} />
          <Route path="/auth" element={<Navigate to="/auth/claude-code" replace />} />
          <Route path="/auth/:provider" element={<AuthPage />} />
          <Route path="/main-agent-context" element={<MainAgentContextPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/control-panel" element={<ControlPanelPage />} />
          <Route path="/scheduler-tasks" element={<SchedulerTasksPage />} />
          <Route path="/llm-history" element={<LlmHistoryPage />} />
          <Route path="/inner-thought" element={<InnerThoughtPage />} />
          <Route path="/app-log-history" element={<AppLogHistoryPage />} />
          <Route path="/napcat-event-history" element={<NapcatEventHistoryPage />} />
          <Route path="/napcat-group-message-history" element={<NapcatGroupMessageHistoryPage />} />
          <Route path="/todos" element={<TodosPage />} />
          <Route path="/oss-objects" element={<OssObjectsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
