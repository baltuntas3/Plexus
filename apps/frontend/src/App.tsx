import { Navigate, Route, Routes } from "react-router-dom";
import { LoginPage } from "./pages/login-page.js";
import { DashboardPage } from "./pages/dashboard-page.js";
import { PromptsPage } from "./pages/prompts-page.js";
import { PromptDetailPage } from "./pages/prompt-detail-page.js";
import { VersionEditorPage } from "./pages/version-editor-page.js";
import { VersionDetailPage } from "./pages/version-detail-page.js";
import { AppLayout } from "./components/app-layout.js";
import { ProtectedRoute } from "./components/protected-route.js";

export const App = () => {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/prompts" element={<PromptsPage />} />
        <Route path="/prompts/:id" element={<PromptDetailPage />} />
        <Route path="/prompts/:id/versions/new" element={<VersionEditorPage />} />
        <Route path="/prompts/:id/versions/:version" element={<VersionDetailPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};
