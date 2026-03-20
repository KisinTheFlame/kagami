import { Suspense, lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";

const CodexAuthPage = lazy(() =>
  import("@/pages/codex-auth/CodexAuthPage").then(module => ({ default: module.CodexAuthPage })),
);
const LlmPlaygroundPage = lazy(() =>
  import("@/pages/llm-playground/LlmPlaygroundPage").then(module => ({
    default: module.LlmPlaygroundPage,
  })),
);
const LlmHistoryPage = lazy(() =>
  import("@/pages/llm-history/LlmHistoryPage").then(module => ({ default: module.LlmHistoryPage })),
);
const EmbeddingCacheHistoryPage = lazy(() =>
  import("@/pages/embedding-cache-history/EmbeddingCacheHistoryPage").then(module => ({
    default: module.EmbeddingCacheHistoryPage,
  })),
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

function App() {
  return (
    <BrowserRouter>
      <Suspense
        fallback={<div className="flex flex-1 items-center justify-center text-sm">加载中...</div>}
      >
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<Navigate to="/llm-history" replace />} />
            <Route path="/codex-auth" element={<CodexAuthPage />} />
            <Route path="/llm-playground" element={<LlmPlaygroundPage />} />
            <Route path="/llm-history" element={<LlmHistoryPage />} />
            <Route path="/embedding-cache-history" element={<EmbeddingCacheHistoryPage />} />
            <Route path="/app-log-history" element={<AppLogHistoryPage />} />
            <Route path="/napcat-event-history" element={<NapcatEventHistoryPage />} />
            <Route
              path="/napcat-group-message-history"
              element={<NapcatGroupMessageHistoryPage />}
            />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
