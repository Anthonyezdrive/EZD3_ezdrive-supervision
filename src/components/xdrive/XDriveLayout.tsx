import { createContext, useContext, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard,
  FileText,
  PieChart,
  Scale,
  Receipt,
  FileCheck,
  Download,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useXDrivePartner, useXDrivePartners } from "@/hooks/useXDrivePartner";
import { SectionErrorBoundary } from "@/components/ui/SectionErrorBoundary";
import { B2BFilterProvider } from "@/contexts/B2BFilterContext";
import type { XDrivePartner, XDriveModule } from "@/types/xdrive";

// ── Context ──────────────────────────────────────────────

interface XDriveContextValue {
  partner: XDrivePartner | null;
  isEZDriveAdmin: boolean;
  isReadOnly: (module: XDriveModule) => boolean;
}

const XDriveContext = createContext<XDriveContextValue>({
  partner: null,
  isEZDriveAdmin: false,
  isReadOnly: () => false,
});

export function useXDriveContext() {
  return useContext(XDriveContext);
}

// ── Tab definitions ───────────────────────────────────────

interface XDriveTab {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  module: XDriveModule;
  ezdriveOnly?: boolean;
}

const XDRIVE_TABS: XDriveTab[] = [
  { to: "/xdrive/dashboard",      label: "Dashboard",             icon: LayoutDashboard, module: "dashboard" },
  { to: "/xdrive/cdrs",           label: "CDR détaillés",         icon: FileText,        module: "cdrs" },
  { to: "/xdrive/breakdown",      label: "Ventilation",           icon: PieChart,        module: "breakdown" },
  { to: "/xdrive/reconciliation", label: "Rapprochement",         icon: Scale,           module: "reconciliation" },
  { to: "/xdrive/bpu",            label: "Facturation BPU",       icon: Receipt,         module: "bpu",     ezdriveOnly: true },
  { to: "/xdrive/billing",        label: "Facturation partenaire",icon: FileCheck,       module: "billing" },
  { to: "/xdrive/exports",        label: "Exports",               icon: Download,        module: "exports" },
];

// ── Default theme fallback ────────────────────────────────

const DEFAULT_THEME = {
  primaryColor: "#9ACC0E",
  accentColor: "#9ACC0E",
};

// ── Inner layout ──────────────────────────────────────────

function XDriveLayoutInner() {
  const { profile } = useAuth();
  const { isAdmin } = usePermissions();
  const isEZDriveAdmin = isAdmin;

  // For B2B users — look up their partner by b2b_client_id
  // profile.b2b_client_id may not exist on UserProfile type; we cast safely
  const b2bClientId = (profile as Record<string, unknown>)?.b2b_client_id as string | undefined;

  // Admin: fetch all partners; B2B user: fetch own partner
  const { data: allPartners } = useXDrivePartners();
  const { data: myPartner } = useXDrivePartner(!isEZDriveAdmin ? b2bClientId : undefined);

  const partners = isEZDriveAdmin ? (allPartners ?? []) : [];

  // Partner selector state (admins can switch)
  // For B2B users, auto-select their partner (no dropdown shown)
  const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(null);

  const activePartner: XDrivePartner | null = isEZDriveAdmin
    ? (partners.find((p) => p.id === selectedPartnerId) ?? partners[0] ?? null)
    : (myPartner ?? null);

  const theme = activePartner?.theme_config ?? DEFAULT_THEME;
  const enabledModules = activePartner?.enabled_modules ?? (XDRIVE_TABS.map((t) => t.module) as XDriveModule[]);
  const readOnlyModules = activePartner?.read_only_modules ?? [];

  // Helper: check if a module is read-only for the current user
  const isReadOnly = (module: XDriveModule): boolean => {
    if (isEZDriveAdmin) return false; // EZDrive admins always have full access
    return readOnlyModules.includes(module);
  };

  // Filter tabs by enabled modules and role
  const visibleTabs = XDRIVE_TABS.filter((tab) => {
    if (tab.ezdriveOnly && !isEZDriveAdmin) return false;
    if (!enabledModules.includes(tab.module)) return false;
    return true;
  });

  return (
    <XDriveContext.Provider value={{ partner: activePartner, isEZDriveAdmin, isReadOnly }}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            {/* Partner logo */}
            {activePartner?.logo_url ? (
              <img
                src={activePartner.logo_url}
                alt={activePartner.display_name}
                style={{ height: activePartner.theme_config?.logoHeight ?? 48 }}
                className="rounded-xl object-contain bg-white border border-border p-1.5 shrink-0"
              />
            ) : (
              <div
                className="w-12 h-12 rounded-xl border flex items-center justify-center shrink-0"
                style={{
                  backgroundColor: `${theme.primaryColor}18`,
                  borderColor: `${theme.primaryColor}40`,
                }}
              >
                <span className="text-lg font-bold" style={{ color: theme.primaryColor }}>
                  {activePartner?.display_name?.charAt(0)?.toUpperCase() ?? "X"}
                </span>
              </div>
            )}
            <div>
              <h1 className="text-2xl font-heading font-bold text-foreground">
                {activePartner?.display_name ?? "X-DRIVE"}
              </h1>
              <p className="text-sm text-foreground-muted mt-0.5">
                Portail partenaire — supervision et facturation
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* EZDrive admin: partner selector (B2B users see no dropdown — auto-selected) */}
            {isEZDriveAdmin && partners.length > 1 && (
              <div>
                <label className="block text-xs text-foreground-muted uppercase tracking-wider mb-1">
                  Partenaire
                </label>
                <select
                  value={activePartner?.id ?? ""}
                  onChange={(e) => setSelectedPartnerId(e.target.value || null)}
                  className="px-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground focus:border-border-focus focus:outline-none min-w-[200px]"
                >
                  {partners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.display_name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* EZDrive branding */}
            <div className="flex items-center gap-2">
              <div className="h-8 w-px bg-border hidden sm:block" />
              <img src="/logo-ezdrive.png" alt="EZDrive" className="h-6 opacity-60 hidden sm:block" />
              <span className="text-xs font-semibold opacity-50 hidden sm:inline tracking-wide">
                X-DRIVE
              </span>
            </div>
          </div>
        </div>

        {/* Tab navigation */}
        <div className="flex items-center gap-1 border-b border-border overflow-x-auto">
          {visibleTabs.map((tab) => {
            const tabReadOnly = isReadOnly(tab.module);
            return (
              <NavLink
                key={tab.to}
                to={tab.to}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-[1px]",
                    isActive
                      ? "border-b-2"
                      : "text-foreground-muted border-transparent hover:text-foreground hover:border-foreground-muted/30"
                  )
                }
                style={({ isActive }) =>
                  isActive
                    ? { color: theme.primaryColor, borderBottomColor: theme.primaryColor }
                    : {}
                }
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
                {/* Read-only badge for partner users */}
                {tabReadOnly && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-elevated text-foreground-muted border border-border ml-1">
                    <Eye className="w-3 h-3" />
                    Lecture seule
                  </span>
                )}
              </NavLink>
            );
          })}
        </div>

        {/* Page content */}
        <B2BFilterProvider>
          <SectionErrorBoundary section="Portail X-DRIVE" fallbackUrl="/xdrive/dashboard">
            <Outlet context={{ partner: activePartner, isEZDriveAdmin, theme, isReadOnly }} />
          </SectionErrorBoundary>
        </B2BFilterProvider>

        {/* Co-branding footer */}
        <div className="flex items-center justify-center gap-2 pt-6 pb-2">
          <img src="/logo-ezdrive.png" alt="EZDrive" className="h-4 opacity-30" />
          <span className="text-[11px] text-foreground-muted/40">
            Propulsé par EZDrive {activePartner ? `× ${activePartner.display_name}` : ""}
          </span>
        </div>
      </div>
    </XDriveContext.Provider>
  );
}

export function XDriveLayout() {
  return <XDriveLayoutInner />;
}
