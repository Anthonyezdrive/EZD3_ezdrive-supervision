import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/contexts/AuthContext";
import { ToastProvider } from "@/contexts/ToastContext";
import { CpoProvider } from "@/contexts/CpoContext";
import { AppShell } from "@/components/layout/AppShell";
import { ProtectedRoute } from "@/components/layout/ProtectedRoute";
import { LoginPage } from "@/components/auth/LoginPage";
// ── Home ─────────────────────────────────────────────────
import { DashboardPage } from "@/components/dashboard/DashboardPage";
import { MapPage } from "@/components/map/MapPage";
import { AnalyticsPage } from "@/components/analytics/AnalyticsPage";
// ── CPO > Assets ─────────────────────────────────────────
import { StationsPage } from "@/components/stations/StationsPage";
import { LocationsPage } from "@/components/locations/LocationsPage";
import { MonitoringPage } from "@/components/monitoring/MonitoringPage";
import { SmartChargingPage } from "@/components/smart-charging/SmartChargingPage";
import { EnergyMixPage } from "@/components/energy-mix/EnergyMixPage";
// ── CPO > Network ────────────────────────────────────────
import { CpoOverviewPage } from "@/components/cpo-overview/CpoOverviewPage";
import { CpoNetworksPage } from "@/components/cpo-networks/CpoNetworksPage";
// CpoContracts fusionné dans CpoNetworksPage (onglet Contrats CPO → détail contrat)
// ── CPO > Billing (fusionné) ─────────────────────────────
import { BillingPage } from "@/components/billing/BillingPage";
import { TariffsPage } from "@/components/tariffs/TariffsPage";
import { RoamingContractsPage } from "@/components/roaming-contracts/RoamingContractsPage";
// ── CPO > Roaming ────────────────────────────────────────
import { OcpiPage } from "@/components/ocpi/OcpiPage";
// ── eMSP > Network ───────────────────────────────────────
import { EmspNetworksPage } from "@/components/emsp-networks/EmspNetworksPage";
// EmspContracts et eMSPs fusionnés dans EmspNetworksPage (onglets Contrats eMSP / eMSPs)
// ── eMSP > Customers ─────────────────────────────────────
import { CustomersPage } from "@/components/customers/CustomersPage";
import { DriversPage } from "@/components/drivers/DriversPage";
// ── eMSP > Moyens de paiement (fusionné) ─────────────────
import { PaymentMethodsPage } from "@/components/payment-methods/PaymentMethodsPage";
// ── Automation ───────────────────────────────────────────
import { ExceptionsPage } from "@/components/exceptions/ExceptionsPage";
// ── Admin ────────────────────────────────────────────────
import { B2BAdminPage } from "@/components/admin/B2BAdminPage";
import { UsersPage } from "@/components/users/UsersPage";
import { RolesPage } from "@/components/roles/RolesPage";
import { AdminConfigPage } from "@/components/admin-config/AdminConfigPage";
import { ValidateTokenPage } from "@/components/validate-token/ValidateTokenPage";
import { SupportPage } from "@/components/support/SupportPage";
import { InterventionsPage } from "@/components/technician/InterventionsPage";
// ── Portail B2B ──────────────────────────────────────────
import { B2BLayout } from "@/components/b2b/B2BLayout";
import { B2BOverviewPage } from "@/components/b2b/B2BOverviewPage";
import { B2BMonthlyPage } from "@/components/b2b/B2BMonthlyPage";
import { B2BChargepointsPage } from "@/components/b2b/B2BChargepointsPage";
import { B2BDriversPage } from "@/components/b2b/B2BDriversPage";
import { B2BCompanyPage } from "@/components/b2b/B2BCompanyPage";
// ── Auth & Public ────────────────────────────────────────
import { B2BLoginPage } from "@/components/auth/B2BLoginPage";
import { ResetPasswordPage } from "@/components/auth/ResetPasswordPage";
import { StripeOnboardingCompletePage } from "@/components/stripe/StripeOnboardingCompletePage";
import { StripeOnboardingRefreshPage } from "@/components/stripe/StripeOnboardingRefreshPage";
import { B2BLandingPage } from "@/components/commercial/B2BLandingPage";

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
        <CpoProvider>
        <BrowserRouter>
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/portail" element={<B2BLoginPage />} />
            <Route path="/offre-b2b" element={<B2BLandingPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/stripe/onboarding/complete" element={<StripeOnboardingCompletePage />} />
            <Route path="/stripe/onboarding/refresh" element={<StripeOnboardingRefreshPage />} />

            {/* Protected routes */}
            <Route element={<ProtectedRoute />}>
              <Route element={<AppShell />}>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />

                {/* ── Home ── */}
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/map" element={<MapPage />} />
                <Route path="/analytics" element={<AnalyticsPage />} />

                {/* ── CPO > Overview ── */}
                <Route path="/cpo-overview" element={<CpoOverviewPage />} />

                {/* ── CPO > Network ── */}
                <Route path="/cpo-networks" element={<CpoNetworksPage />} />
                <Route path="/cpo-contracts" element={<Navigate to="/cpo-networks" replace />} />

                {/* ── CPO > Assets ── */}
                <Route path="/stations" element={<StationsPage />} />
                <Route path="/locations" element={<LocationsPage />} />
                <Route path="/monitoring" element={<MonitoringPage />} />
                <Route path="/smart-charging" element={<SmartChargingPage />} />
                <Route path="/energy-mix" element={<EnergyMixPage />} />

                {/* ── CPO > Billing ── */}
                <Route path="/billing" element={<BillingPage />} />
                <Route path="/tariffs" element={<TariffsPage />} />
                <Route path="/roaming-contracts" element={<RoamingContractsPage />} />

                {/* ── CPO > Roaming ── */}
                <Route path="/ocpi" element={<OcpiPage />} />

                {/* ── eMSP > Network (fusionné) ── */}
                <Route path="/emsp-networks" element={<EmspNetworksPage />} />
                <Route path="/emsp-contracts" element={<Navigate to="/emsp-networks" replace />} />
                <Route path="/emsps" element={<Navigate to="/emsp-networks" replace />} />

                {/* ── eMSP > Customers ── */}
                <Route path="/customers" element={<CustomersPage />} />
                <Route path="/drivers" element={<DriversPage />} />

                {/* ── eMSP > Moyens de paiement ── */}
                <Route path="/payment-methods" element={<PaymentMethodsPage />} />

                {/* ── Automation ── */}
                <Route path="/exceptions" element={<ExceptionsPage />} />

                {/* ── Admin ── */}
                <Route path="/users" element={<UsersPage />} />
                <Route path="/roles" element={<RolesPage />} />
                <Route path="/admin-config" element={<AdminConfigPage />} />
                <Route path="/admin/b2b" element={<B2BAdminPage />} />

                {/* ── Configuration ── */}
                <Route path="/validate-token" element={<ValidateTokenPage />} />
                <Route path="/support" element={<SupportPage />} />
                <Route path="/interventions" element={<InterventionsPage />} />

                {/* ── Legacy redirects (anciennes routes → nouvelles) ── */}
                <Route path="/sessions" element={<Navigate to="/billing" replace />} />
                <Route path="/invoices" element={<Navigate to="/billing" replace />} />
                <Route path="/maintenance" element={<Navigate to="/monitoring" replace />} />
                <Route path="/rfid" element={<Navigate to="/payment-methods" replace />} />
                <Route path="/subscriptions" element={<Navigate to="/payment-methods" replace />} />
                <Route path="/coupons" element={<Navigate to="/payment-methods" replace />} />
                <Route path="/agreements" element={<Navigate to="/roaming-contracts" replace />} />
                <Route path="/reimbursement" element={<Navigate to="/roaming-contracts" replace />} />
                <Route path="/admin" element={<Navigate to="/admin-config" replace />} />
                <Route path="/settings" element={<Navigate to="/admin-config" replace />} />

                {/* ── Portail B2B ── */}
                <Route path="/b2b" element={<B2BLayout />}>
                  <Route index element={<B2BOverviewPage />} />
                  <Route path="overview" element={<B2BOverviewPage />} />
                  <Route path="monthly" element={<B2BMonthlyPage />} />
                  <Route path="chargepoints" element={<B2BChargepointsPage />} />
                  <Route path="drivers" element={<B2BDriversPage />} />
                  <Route path="company" element={<B2BCompanyPage />} />
                </Route>
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
        </CpoProvider>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
