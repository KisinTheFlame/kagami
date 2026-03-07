import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { ApiLabPage } from "@/pages/api-lab/ApiLabPage";
import { AppLogHistoryPage } from "@/pages/app-log-history/AppLogHistoryPage";
import { LlmHistoryPage } from "@/pages/llm-history/LlmHistoryPage";
import { NapcatEventHistoryPage } from "@/pages/napcat-event-history/NapcatEventHistoryPage";
import { NapcatGroupMessageHistoryPage } from "@/pages/napcat-group-message-history/NapcatGroupMessageHistoryPage";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/llm-history" replace />} />
          <Route path="/llm-history" element={<LlmHistoryPage />} />
          <Route path="/app-log-history" element={<AppLogHistoryPage />} />
          <Route path="/napcat-event-history" element={<NapcatEventHistoryPage />} />
          <Route path="/napcat-group-message-history" element={<NapcatGroupMessageHistoryPage />} />
          <Route path="/api-lab" element={<ApiLabPage />} />
          <Route path="/agent-event" element={<Navigate to="/api-lab" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
