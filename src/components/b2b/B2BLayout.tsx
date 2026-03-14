import { NavLink, Outlet } from "react-router-dom";
import { LayoutDashboard, FileText, Radio, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { B2BFilterProvider, useB2BFilters } from "@/contexts/B2BFilterContext";
import { useB2BClients, useB2BCdrs, useB2BFilterOptions, useMyB2BClients } from "@/hooks/useB2BCdrs";
import { B2BFilterBar } from "./B2BFilterBar";
import type { B2BClient } from "@/types/b2b";

const B2B_TABS = [
  { to: "/b2b/overview", label: "Vue d'ensemble", icon: LayoutDashboard },
  { to: "/b2b/monthly", label: "Rapport mensuel", icon: FileText },
  { to: "/b2b/chargepoints", label: "Par borne", icon: Radio },
  { to: "/b2b/drivers", label: "Par conducteur", icon: UserCheck },
];

function B2BLayoutInner() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const { selectedClientId, setSelectedClientId } = useB2BFilters();

  // Admin: fetch all clients; B2B user: fetch own
  const { data: allClients } = useB2BClients();
  const { data: myClients } = useMyB2BClients();

  const clients: B2BClient[] = isAdmin ? (allClients ?? []) : (myClients ?? []);

  // Auto-select first client if none selected
  const activeClient = clients.find((c) => c.id === selectedClientId) ?? clients[0] ?? null;

  // Get customer_external_ids for the active client
  const customerExternalIds = activeClient?.customer_external_ids ?? [];

  // Fetch CDRs (unfiltered by site/borne/token for filter options extraction)
  const { data: allCdrs } = useB2BCdrs(customerExternalIds);
  const filterOptions = useB2BFilterOptions(allCdrs ?? []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">
            {activeClient?.name ?? "Portail B2B"}
          </h1>
          <p className="text-sm text-foreground-muted mt-0.5">
            Rapport d'activité des bornes de recharge
          </p>
        </div>

        {/* Admin: client selector */}
        {isAdmin && clients.length > 1 && (
          <div>
            <label className="block text-[10px] text-foreground-muted uppercase tracking-wider mb-1">
              Client
            </label>
            <select
              value={activeClient?.id ?? ""}
              onChange={(e) => setSelectedClientId(e.target.value || null)}
              className="px-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground focus:border-border-focus focus:outline-none min-w-[200px]"
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Filters */}
      <B2BFilterBar
        availableSites={filterOptions.sites}
        availableBornes={filterOptions.bornes}
        availableTokens={filterOptions.tokens}
        availableYears={[2023, 2024, 2025, 2026]}
      />

      {/* Tab navigation */}
      <div className="flex items-center gap-1 border-b border-border overflow-x-auto">
        {B2B_TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-[1px]",
                isActive
                  ? "text-primary border-primary"
                  : "text-foreground-muted border-transparent hover:text-foreground hover:border-foreground-muted/30"
              )
            }
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </NavLink>
        ))}
      </div>

      {/* Page content — pass activeClient via context */}
      <Outlet context={{ activeClient, customerExternalIds }} />
    </div>
  );
}

export function B2BLayout() {
  return (
    <B2BFilterProvider>
      <B2BLayoutInner />
    </B2BFilterProvider>
  );
}
