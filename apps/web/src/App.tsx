import { lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";

const AuthPage = lazy(() =>
  import("@/pages/auth/AuthPage").then(module => ({ default: module.AuthPage })),
);
const AgentDashboardPage = lazy(() =>
  import("@/pages/agent-dashboard/AgentDashboardPage").then(module => ({
    default: module.AgentDashboardPage,
  })),
);
const LlmPlaygroundPage = lazy(() =>
  import("@/pages/llm-playground/LlmPlaygroundPage").then(module => ({
    default: module.LlmPlaygroundPage,
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
const StoryHistoryPage = lazy(() =>
  import("@/pages/story-history/StoryHistoryPage").then(module => ({
    default: module.StoryHistoryPage,
  })),
);

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/agent-dashboard" replace />} />
          <Route path="/auth" element={<Navigate to="/auth/codex" replace />} />
          <Route path="/auth/:provider" element={<AuthPage />} />
          <Route path="/agent-dashboard" element={<AgentDashboardPage />} />
          <Route path="/llm-playground" element={<LlmPlaygroundPage />} />
          <Route path="/llm-history" element={<LlmHistoryPage />} />
          <Route path="/app-log-history" element={<AppLogHistoryPage />} />
          <Route path="/napcat-event-history" element={<NapcatEventHistoryPage />} />
          <Route path="/napcat-group-message-history" element={<NapcatGroupMessageHistoryPage />} />
          <Route path="/story-history" element={<StoryHistoryPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
