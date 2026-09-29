import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useSession } from "@/api/hooks";
import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/ui/primitives";
import { AuditLogPage } from "@/features/audit/AuditLogPage";
import { LoginPage } from "@/features/auth/LoginPage";
import { CustomerPage } from "@/features/customers/CustomerPage";
import { CustomersPage } from "@/features/customers/CustomersPage";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { DisputeWorkspacePage } from "@/features/disputes/DisputeWorkspacePage";
import { NotFoundPage } from "@/features/NotFoundPage";
import { PlansPage } from "@/features/plans/PlansPage";
import { ReportsPage } from "@/features/reports/ReportsPage";
import { SettingsPage } from "@/features/settings/SettingsPage";

/** Everything except /login needs a session; a signed-out visitor is sent to sign in and brought back afterwards. */
function RequireAuth() {
  const session = useSession();
  const location = useLocation();
  if (session.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-8 w-40" />
      </div>
    );
  }
  if (!session.data) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="customers" element={<CustomersPage />} />
          <Route path="customers/:msisdn" element={<CustomerPage />} />
          <Route path="disputes" element={<DisputeWorkspacePage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="plans" element={<PlansPage />} />
          <Route path="audit" element={<AuditLogPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
