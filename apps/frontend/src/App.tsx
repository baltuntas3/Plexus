import { Suspense, lazy } from "react";
import { Center, Loader } from "@mantine/core";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/app-layout.js";
import { ProtectedRoute } from "./components/protected-route.js";

const LoginPage = lazy(async () => ({
  default: (await import("./pages/login-page.js")).LoginPage,
}));
const RegisterPage = lazy(async () => ({
  default: (await import("./pages/register-page.js")).RegisterPage,
}));
const AcceptInvitationPage = lazy(async () => ({
  default: (await import("./pages/accept-invitation-page.js")).AcceptInvitationPage,
}));
const OrgSettingsPage = lazy(async () => ({
  default: (await import("./pages/org-settings-page.js")).OrgSettingsPage,
}));
const DashboardPage = lazy(async () => ({
  default: (await import("./pages/dashboard-page.js")).DashboardPage,
}));
const PromptsPage = lazy(async () => ({
  default: (await import("./pages/prompts-page.js")).PromptsPage,
}));
const PromptDetailPage = lazy(async () => ({
  default: (await import("./pages/prompt-detail-page.js")).PromptDetailPage,
}));
const VersionEditorPage = lazy(async () => ({
  default: (await import("./pages/version-editor-page.js")).VersionEditorPage,
}));
const VersionDetailPage = lazy(async () => ({
  default: (await import("./pages/version-detail-page.js")).VersionDetailPage,
}));
const VersionComparisonPage = lazy(async () => ({
  default: (await import("./pages/version-comparison-page.js")).VersionComparisonPage,
}));
const BenchmarkDetailPage = lazy(async () => ({
  default: (await import("./pages/benchmark-detail-page.js")).BenchmarkDetailPage,
}));

const RouteFallback = () => (
  <Center py="xl">
    <Loader size="sm" />
  </Center>
);

export const App = () => {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/invitations/accept" element={<AcceptInvitationPage />} />
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
          <Route path="/prompts/:id/compare" element={<VersionComparisonPage />} />
          <Route path="/benchmarks/:id" element={<BenchmarkDetailPage />} />
          <Route path="/organization/settings" element={<OrgSettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
};
