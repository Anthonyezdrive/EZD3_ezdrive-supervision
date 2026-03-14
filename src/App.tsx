import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/contexts/AuthContext";
import { ToastProvider } from "@/contexts/ToastContext";
import { AppShell } from "@/components/layout/AppShell";
import { ProtectedRoute } from "@/components/layout/ProtectedRoute";
import { LoginPage } from "@/components/auth/LoginPage";
// ── Supervision ───────────────────────────────────────────
import { DashboardPage } from "@/components/dashboard/DashboardPage";
import { MapPage } from "@/components/map/MapPage";
import { AnalyticsPage } from "@/components/analytics/AnalyticsPage";
// ── CPO ───────────────────────────────────────────────────
import { StationsPage } from "@/components/stations/StationsPage";
import { LocationsPage } from "@/components/locations/LocationsPage";
import { MaintenancePage } from "@/components/maintenance/MaintenancePage";
import { MonitoringPage } from "@/components/monitoring/MonitoringPage";
import { SmartChargingPage } from "@/components/smart-charging/SmartChargingPage";
// ── Clients ───────────────────────────────────────────────
import { CustomersPage } from "@/components/customers/CustomersPage";
import { SubscriptionsPage } from "@/components/subscriptions/SubscriptionsPage";
import { RfidPage } from "@/components/rfid/RfidPage";
// ── Facturation ───────────────────────────────────────────
import { SessionsPage } from "@/components/sessions/SessionsPage";
import { InvoicesPage } from "@/components/invoices/InvoicesPage";
import { TariffsPage } from "@/components/tariffs/TariffsPage";
// ── Intégrations ──────────────────────────────────────────
import { OcpiPage } from "@/components/ocpi/OcpiPage";
// ── Nouveautés (GreenFlux parity) ────────────────────────
import { CouponsPage } from "@/components/coupons/CouponsPage";
import { RolesPage } from "@/components/roles/RolesPage";
import { EnergyMixPage } from "@/components/energy-mix/EnergyMixPage";
import { ExceptionsPage } from "@/components/exceptions/ExceptionsPage";
// ── Roaming CPO ──────────────────────────────────────────
import { CpoOverviewPage } from "@/components/cpo-overview/CpoOverviewPage";
import { CpoNetworksPage } from "@/components/cpo-networks/CpoNetworksPage";
import { CpoContractsPage } from "@/components/cpo-contracts/CpoContractsPage";
import { ReimbursementPage } from "@/components/reimbursement/ReimbursementPage";
import { AgreementsPage } from "@/components/agreements/AgreementsPage";
// ── Roaming eMSP ─────────────────────────────────────────
import { EmspNetworksPage } from "@/components/emsp-networks/EmspNetworksPage";
import { EmspContractsPage } from "@/components/emsp-contracts/EmspContractsPage";
import { EmspsPage } from "@/components/emsps/EmspsPage";
import { DriversPage } from "@/components/drivers/DriversPage";
import { ValidateTokenPage } from "@/components/validate-token/ValidateTokenPage";
// ── Administration ────────────────────────────────────────
import { AdminPage } from "@/components/admin/AdminPage";
import { UsersPage } from "@/components/users/UsersPage";
import { SettingsPage } from "@/components/settings/SettingsPage";
// ── Portail B2B ──────────────────────────────────────────
import { B2BLayout } from "@/components/b2b/B2BLayout";
import { B2BOverviewPage } from "@/components/b2b/B2BOverviewPage";
import { B2BMonthlyPage } from "@/components/b2b/B2BMonthlyPage";
import { B2BChargepointsPage } from "@/components/b2b/B2BChargepointsPage";
import { B2BDriversPage } from "@/components/b2b/B2BDriversPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      refetchOnWindowFocus: true,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<AppShell />}>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                {/* Supervision */}
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/map" element={<MapPage />} />
                <Route path="/analytics" element={<AnalyticsPage />} />
                {/* CPO */}
                <Route path="/stations" element={<StationsPage />} />
                <Route path="/locations" element={<LocationsPage />} />
                <Route path="/maintenance" element={<MaintenancePage />} />
                <Route path="/monitoring" element={<MonitoringPage />} />
                <Route path="/smart-charging" element={<SmartChargingPage />} />
                <Route path="/energy-mix" element={<EnergyMixPage />} />
                {/* Clients */}
                <Route path="/customers" element={<CustomersPage />} />
                <Route path="/subscriptions" element={<SubscriptionsPage />} />
                <Route path="/rfid" element={<RfidPage />} />
                <Route path="/coupons" element={<CouponsPage />} />
                {/* Facturation */}
                <Route path="/sessions" element={<SessionsPage />} />
                <Route path="/invoices" element={<InvoicesPage />} />
                <Route path="/tariffs" element={<TariffsPage />} />
                {/* Intégrations */}
                <Route path="/ocpi" element={<OcpiPage />} />
                {/* Roaming CPO */}
                <Route path="/cpo-overview" element={<CpoOverviewPage />} />
                <Route path="/cpo-networks" element={<CpoNetworksPage />} />
                <Route path="/cpo-contracts" element={<CpoContractsPage />} />
                <Route path="/reimbursement" element={<ReimbursementPage />} />
                <Route path="/agreements" element={<AgreementsPage />} />
                {/* Roaming eMSP */}
                <Route path="/emsp-networks" element={<EmspNetworksPage />} />
                <Route path="/emsp-contracts" element={<EmspContractsPage />} />
                <Route path="/emsps" element={<EmspsPage />} />
                <Route path="/drivers" element={<DriversPage />} />
                <Route path="/validate-token" element={<ValidateTokenPage />} />
                {/* Administration */}
                <Route path="/admin" element={<AdminPage />} />
                <Route path="/users" element={<UsersPage />} />
                <Route path="/roles" element={<RolesPage />} />
                <Route path="/exceptions" element={<ExceptionsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                {/* Portail B2B */}
                <Route path="/b2b" element={<B2BLayout />}>
                  <Route index element={<B2BOverviewPage />} />
                  <Route path="overview" element={<B2BOverviewPage />} />
                  <Route path="monthly" element={<B2BMonthlyPage />} />
                  <Route path="chargepoints" element={<B2BChargepointsPage />} />
                  <Route path="drivers" element={<B2BDriversPage />} />
                </Route>
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
