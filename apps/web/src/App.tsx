import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { AgentEventPage } from "@/pages/agent-event/AgentEventPage";
import { AppLogHistoryPage } from "@/pages/app-log-history/AppLogHistoryPage";
import { LlmHistoryPage } from "@/pages/llm-history/LlmHistoryPage";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/llm-history" replace />} />
          <Route path="/llm-history" element={<LlmHistoryPage />} />
          <Route path="/app-log-history" element={<AppLogHistoryPage />} />
          <Route path="/agent-event" element={<AgentEventPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
