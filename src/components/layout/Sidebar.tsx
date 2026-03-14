import { useState, useMemo } from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Radio,
  Wrench,
  Zap,
  Map,
  Tag,
  Settings,
  BarChart2,
  Globe,
  X,
  ChevronDown,
  Users,
  CreditCard,
  FileText,
  Wallet,
  KeyRound,
  Activity,
  MonitorCheck,
  MapPin,
  BatteryCharging,
  Ticket,
  Leaf,
  Shield,
  ShieldAlert,
  PieChart,
  Network,
  FileSignature,
  Receipt,
  Handshake,
  Building2,
  UserCheck,
  ScanLine,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

// ── Section + Item types ──────────────────────────────────

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    id: "supervision",
    label: "Supervision",
    items: [
      { to: "/dashboard", label: "Vue d'ensemble", icon: LayoutDashboard },
      { to: "/map", label: "Carte", icon: Map },
      { to: "/analytics", label: "Analytics SLA", icon: BarChart2 },
    ],
  },
  {
    id: "cpo",
    label: "CPO",
    items: [
      { to: "/stations", label: "Bornes", icon: Radio },
      { to: "/locations", label: "Localisations", icon: MapPin },
      { to: "/maintenance", label: "Maintenance", icon: Wrench },
      { to: "/monitoring", label: "Monitoring", icon: MonitorCheck },
      { to: "/smart-charging", label: "Smart Charging", icon: BatteryCharging },
      { to: "/energy-mix", label: "Energy Mix", icon: Leaf },
    ],
  },
  {
    id: "emsp",
    label: "Clients",
    items: [
      { to: "/customers", label: "Gestion Clients", icon: Users },
      { to: "/subscriptions", label: "Abonnements", icon: CreditCard },
      { to: "/rfid", label: "Tokens RFID", icon: KeyRound },
      { to: "/coupons", label: "Coupons", icon: Ticket },
    ],
  },
  {
    id: "billing",
    label: "Facturation",
    items: [
      { to: "/sessions", label: "Sessions CDR", icon: Activity },
      { to: "/invoices", label: "Factures", icon: FileText },
      { to: "/tariffs", label: "Tarifs", icon: Wallet },
    ],
  },
  {
    id: "integrations",
    label: "Intégrations",
    items: [
      { to: "/ocpi", label: "OCPI Gireve", icon: Globe },
    ],
  },
  {
    id: "roaming-cpo",
    label: "Roaming CPO",
    items: [
      { to: "/cpo-overview", label: "Vue d'ensemble CPO", icon: PieChart },
      { to: "/cpo-networks", label: "Réseaux CPO", icon: Network },
      { to: "/cpo-contracts", label: "Contrats CPO", icon: FileSignature },
      { to: "/reimbursement", label: "Remboursement", icon: Receipt },
      { to: "/agreements", label: "Accords", icon: Handshake },
    ],
  },
  {
    id: "roaming-emsp",
    label: "Roaming eMSP",
    items: [
      { to: "/emsp-networks", label: "Réseaux eMSP", icon: Network },
      { to: "/emsp-contracts", label: "Contrats eMSP", icon: FileSignature },
      { to: "/emsps", label: "eMSPs", icon: Building2 },
      { to: "/drivers", label: "Conducteurs", icon: UserCheck },
      { to: "/validate-token", label: "Valider Token", icon: ScanLine },
    ],
  },
  {
    id: "admin",
    label: "Administration",
    items: [
      { to: "/admin", label: "Gestion CPO", icon: Tag },
      { to: "/admin/b2b", label: "Gestion B2B", icon: Handshake },
      { to: "/users", label: "Utilisateurs", icon: Users },
      { to: "/roles", label: "Rôles & Permissions", icon: Shield },
      { to: "/exceptions", label: "Exceptions", icon: ShieldAlert },
      { to: "/settings", label: "Paramètres", icon: Settings },
    ],
  },
  {
    id: "b2b-portal",
    label: "Portail B2B",
    items: [
      { to: "/b2b/overview", label: "Vue d'ensemble", icon: LayoutDashboard },
      { to: "/b2b/monthly", label: "Rapport mensuel", icon: FileText },
      { to: "/b2b/chargepoints", label: "Par borne", icon: Radio },
      { to: "/b2b/drivers", label: "Par conducteur", icon: UserCheck },
    ],
  },
];

// ── Sidebar Component ─────────────────────────────────────

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ isOpen = false, onClose }: SidebarProps) {
  const { profile } = useAuth();

  // Role-based section filtering
  const visibleSections = useMemo(() => {
    if (profile?.role === "b2b_client") {
      // B2B clients only see the B2B portal
      return NAV_SECTIONS.filter((s) => s.id === "b2b-portal");
    }
    // Admin/operator/tech see everything
    return NAV_SECTIONS;
  }, [profile?.role]);

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    NAV_SECTIONS.forEach((s) => {
      // All sections open by default
      initial[s.id] = true;
    });
    return initial;
  });

  function toggleSection(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <aside
      className={cn(
        "w-[250px] h-screen bg-surface border-r border-border flex flex-col shrink-0",
        "fixed inset-y-0 left-0 z-50 transition-transform duration-300",
        isOpen ? "translate-x-0" : "-translate-x-full",
        "md:relative md:translate-x-0 md:z-auto"
      )}
    >
      {/* Logo */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary/15 border border-primary flex items-center justify-center shrink-0">
            <Zap className="w-4 h-4 text-primary" />
          </div>
          <div>
            <span className="font-heading font-bold text-foreground text-sm tracking-tight">
              EZDrive
            </span>
            <span className="block text-[10px] text-foreground-muted leading-tight">
              Supervision
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="md:hidden p-1.5 text-foreground-muted hover:text-foreground transition-colors rounded-lg hover:bg-surface-elevated"
          aria-label="Fermer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Navigation sections */}
      <nav className="flex-1 overflow-y-auto py-2 custom-scrollbar">
        {visibleSections.map((section) => (
          <div key={section.id} className="mb-0.5">
            {/* Section header */}
            <button
              onClick={() => toggleSection(section.id)}
              className="w-full flex items-center justify-between px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted/70 hover:text-foreground-muted transition-colors"
            >
              <span>{section.label}</span>
              <ChevronDown
                className={cn(
                  "w-3 h-3 transition-transform duration-200",
                  expanded[section.id] ? "rotate-0" : "-rotate-90"
                )}
              />
            </button>

            {/* Section items */}
            <div
              className={cn(
                "overflow-hidden transition-all duration-200",
                expanded[section.id]
                  ? "max-h-[500px] opacity-100"
                  : "max-h-0 opacity-0"
              )}
            >
              <div className="px-2 pb-1 space-y-0.5">
                {section.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => onClose?.()}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all",
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-foreground-muted hover:text-foreground hover:bg-surface-elevated"
                      )
                    }
                  >
                    <item.icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border">
        <p className="text-[10px] text-foreground-muted/50">
          EZDrive Supervision v1.0
        </p>
      </div>
    </aside>
  );
}
