import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { LlmHistoryPage } from "@/pages/llm-history/LlmHistoryPage";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/llm-history" replace />} />
          <Route path="/llm-history" element={<LlmHistoryPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
