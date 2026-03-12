import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { AppLogHistoryPage } from "@/pages/app-log-history/AppLogHistoryPage";
import { LlmHistoryPage } from "@/pages/llm-history/LlmHistoryPage";
import { LlmPlaygroundPage } from "@/pages/llm-playground/LlmPlaygroundPage";
import { NapcatEventHistoryPage } from "@/pages/napcat-event-history/NapcatEventHistoryPage";
import { NapcatGroupMessageHistoryPage } from "@/pages/napcat-group-message-history/NapcatGroupMessageHistoryPage";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/llm-history" replace />} />
          <Route path="/llm-playground" element={<LlmPlaygroundPage />} />
          <Route path="/llm-history" element={<LlmHistoryPage />} />
          <Route path="/app-log-history" element={<AppLogHistoryPage />} />
          <Route path="/napcat-event-history" element={<NapcatEventHistoryPage />} />
          <Route path="/napcat-group-message-history" element={<NapcatGroupMessageHistoryPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
