import { useState, useMemo } from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Radio,
  Map,
  Settings,
  BarChart2,
  Globe,
  X,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Users,
  CreditCard,
  FileText,
  Wallet,
  MonitorCheck,
  MapPin,
  BatteryCharging,
  Leaf,
  Shield,
  ShieldAlert,
  PieChart,
  Network,
  FileSignature,
  Handshake,
  Building2,
  UserCheck,
  ScanLine,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { CpoSelector } from "./CpoSelector";

// ── Section + Item types ──────────────────────────────────

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavSubSection {
  label: string;
  items: NavItem[];
}

interface NavSection {
  id: string;
  label: string;
  items?: NavItem[];
  subsections?: NavSubSection[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    id: "home",
    label: "Home",
    items: [
      { to: "/dashboard", label: "Business Overview", icon: LayoutDashboard },
      { to: "/map", label: "Carte", icon: Map },
      { to: "/analytics", label: "Analytics SLA", icon: BarChart2 },
    ],
  },
  {
    id: "cpo",
    label: "CPO",
    subsections: [
      {
        label: "Overview",
        items: [
          { to: "/cpo-overview", label: "Vue d'ensemble CPO", icon: PieChart },
        ],
      },
      {
        label: "Network",
        items: [
          { to: "/cpo-networks", label: "Réseaux CPO", icon: Network },
        ],
      },
      {
        label: "Assets",
        items: [
          { to: "/stations", label: "Bornes", icon: Radio },
          { to: "/locations", label: "Localisations", icon: MapPin },
          { to: "/monitoring", label: "Monitoring", icon: MonitorCheck },
          { to: "/smart-charging", label: "Smart Charging", icon: BatteryCharging },
          { to: "/energy-mix", label: "Energy Mix", icon: Leaf },
        ],
      },
      {
        label: "Billing",
        items: [
          { to: "/billing", label: "CDRs & Factures", icon: FileText },
          { to: "/tariffs", label: "Tarifs", icon: Wallet },
          { to: "/roaming-contracts", label: "Accords & Remboursement", icon: Handshake },
        ],
      },
      {
        label: "Roaming",
        items: [
          { to: "/ocpi", label: "OCPI Gireve", icon: Globe },
        ],
      },
    ],
  },
  {
    id: "emsp",
    label: "eMSP",
    subsections: [
      {
        label: "Network",
        items: [
          { to: "/emsp-networks", label: "Réseaux eMSP", icon: Network },
          { to: "/emsp-contracts", label: "Contrats eMSP", icon: FileSignature },
          { to: "/emsps", label: "eMSPs", icon: Building2 },
        ],
      },
      {
        label: "Customers",
        items: [
          { to: "/customers", label: "Clients", icon: Users },
          { to: "/drivers", label: "Conducteurs", icon: UserCheck },
        ],
      },
      {
        label: "Moyens de paiement",
        items: [
          { to: "/payment-methods", label: "Tokens & Abonnements", icon: CreditCard },
        ],
      },
    ],
  },
  {
    id: "automation",
    label: "Automation",
    items: [
      { to: "/exceptions", label: "Exceptions", icon: ShieldAlert },
    ],
  },
  {
    id: "admin",
    label: "Admin",
    items: [
      { to: "/users", label: "Utilisateurs", icon: Users },
      { to: "/roles", label: "Rôles & Permissions", icon: Shield },
      { to: "/admin-config", label: "Configuration", icon: Settings },
      { to: "/admin/b2b", label: "Gestion B2B", icon: Handshake },
    ],
  },
  {
    id: "configuration",
    label: "Configuration",
    items: [
      { to: "/validate-token", label: "Valider Token", icon: ScanLine },
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

// ── Helper: get all items from a section (flat) ───────────

function getAllSectionItems(section: NavSection): NavItem[] {
  if (section.items) return section.items;
  if (section.subsections) {
    return section.subsections.flatMap((sub) => sub.items);
  }
  return [];
}

// ── Sidebar Component ─────────────────────────────────────

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function Sidebar({ isOpen = false, onClose, collapsed = false, onToggleCollapse }: SidebarProps) {
  const { profile } = useAuth();

  // Role-based section filtering
  const visibleSections = useMemo(() => {
    if (profile?.role === "b2b_client") {
      return NAV_SECTIONS.filter((s) => s.id === "b2b-portal");
    }
    return NAV_SECTIONS;
  }, [profile?.role]);

  // Section-level expand/collapse — Home and CPO expanded by default
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    NAV_SECTIONS.forEach((s) => {
      initial[s.id] = s.id === "home" || s.id === "cpo";
    });
    return initial;
  });

  // Subsection-level expand/collapse — all expanded by default
  const [subExpanded, setSubExpanded] = useState<Record<string, boolean>>({});

  function toggleSection(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function isSubExpanded(sectionId: string, subLabel: string): boolean {
    const key = `${sectionId}::${subLabel}`;
    // Default to expanded if not explicitly set
    return subExpanded[key] !== false;
  }

  function toggleSubSection(sectionId: string, subLabel: string) {
    const key = `${sectionId}::${subLabel}`;
    setSubExpanded((prev) => ({ ...prev, [key]: prev[key] === false }));
  }

  // ── Render a single NavItem ─────────────────────────────

  function renderNavItem(item: NavItem, indented: boolean = false) {
    return (
      <NavLink
        key={item.to}
        to={item.to}
        onClick={() => onClose?.()}
        title={collapsed ? item.label : undefined}
        className={({ isActive }) =>
          cn(
            "flex items-center rounded-lg font-medium transition-all",
            collapsed
              ? "justify-center p-2.5"
              : cn("gap-2.5 py-2 text-[13px]", indented ? "pl-7 pr-3" : "px-3"),
            isActive
              ? "bg-primary/10 text-primary"
              : "text-foreground-muted hover:text-foreground hover:bg-surface-elevated"
          )
        }
      >
        <item.icon className="w-4 h-4 shrink-0" />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </NavLink>
    );
  }

  // ── Render section content (items or subsections) ───────

  function renderSectionContent(section: NavSection) {
    // Flat items (no subsections)
    if (section.items) {
      return (
        <div
          className={cn(
            "space-y-0.5",
            collapsed ? "px-1.5 pb-0.5" : "px-2 pb-1"
          )}
        >
          {section.items.map((item) => renderNavItem(item))}
        </div>
      );
    }

    // Subsections
    if (section.subsections) {
      // In collapsed mode, show all items flat (no subsection headers)
      if (collapsed) {
        return (
          <div className="space-y-0.5 px-1.5 pb-0.5">
            {getAllSectionItems(section).map((item) => renderNavItem(item))}
          </div>
        );
      }

      return (
        <div className="px-2 pb-1">
          {section.subsections.map((sub) => {
            const isOpen = isSubExpanded(section.id, sub.label);
            return (
              <div key={sub.label} className="mb-0.5">
                {/* Subsection header */}
                <button
                  onClick={() => toggleSubSection(section.id, sub.label)}
                  className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-foreground-muted/60 hover:text-foreground-muted transition-colors"
                >
                  <ChevronDown
                    className={cn(
                      "w-2.5 h-2.5 transition-transform duration-200",
                      isOpen ? "rotate-0" : "-rotate-90"
                    )}
                  />
                  <span>{sub.label}</span>
                </button>

                {/* Subsection items */}
                <div
                  className={cn(
                    "overflow-hidden transition-all duration-200",
                    isOpen
                      ? "max-h-[500px] opacity-100"
                      : "max-h-0 opacity-0"
                  )}
                >
                  <div className="space-y-0.5">
                    {sub.items.map((item) => renderNavItem(item, true))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    return null;
  }

  return (
    <aside
      className={cn(
        "h-screen bg-surface border-r border-border flex flex-col shrink-0 transition-all duration-300",
        collapsed ? "w-[68px]" : "w-[250px]",
        "fixed inset-y-0 left-0 z-50",
        isOpen ? "translate-x-0" : "-translate-x-full",
        "md:relative md:translate-x-0 md:z-auto"
      )}
    >
      {/* Logo */}
      <div className={cn(
        "flex items-center border-b border-border",
        collapsed ? "justify-center px-2 py-4" : "justify-between px-5 py-4"
      )}>
        <div className="flex items-center gap-2.5">
          <img
            src="/favicon.png"
            alt="EZDrive"
            className="w-8 h-8 rounded-lg shrink-0"
          />
          {!collapsed && (
            <div>
              <span className="font-heading font-bold text-foreground text-sm tracking-tight">
                EZDrive
              </span>
              <span className="block text-[10px] text-foreground-muted leading-tight">
                Supervision
              </span>
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="md:hidden p-1.5 text-foreground-muted hover:text-foreground transition-colors rounded-lg hover:bg-surface-elevated"
          aria-label="Fermer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* CPO Selector */}
      {profile?.role !== "b2b_client" && (
        <CpoSelector collapsed={collapsed} />
      )}

      {/* Navigation sections */}
      <nav className="flex-1 overflow-y-auto py-2 custom-scrollbar">
        {visibleSections.map((section) => (
          <div key={section.id} className="mb-0.5">
            {/* Section header */}
            {collapsed ? (
              <div className="px-2 pt-3 pb-1">
                <div className="h-px bg-border" />
              </div>
            ) : (
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
            )}

            {/* Section content */}
            <div
              className={cn(
                "overflow-hidden transition-all duration-200",
                collapsed || expanded[section.id]
                  ? "max-h-[1000px] opacity-100"
                  : "max-h-0 opacity-0"
              )}
            >
              {renderSectionContent(section)}
            </div>
          </div>
        ))}
      </nav>

      {/* Collapse toggle (desktop only) */}
      <div className="hidden md:block px-2 py-2 border-t border-border">
        <button
          onClick={onToggleCollapse}
          className={cn(
            "flex items-center gap-2 w-full rounded-lg py-2 text-xs font-medium text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors",
            collapsed ? "justify-center px-2" : "px-3"
          )}
          title={collapsed ? "Déplier le menu" : "Réduire le menu"}
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <>
              <ChevronLeft className="w-4 h-4 shrink-0" />
              <span>Réduire</span>
            </>
          )}
        </button>
      </div>

      {/* Footer */}
      {!collapsed && (
        <div className="px-4 py-3 border-t border-border">
          <p className="text-[10px] text-foreground-muted/50">
            EZDrive Supervision v2.0
          </p>
        </div>
      )}
    </aside>
  );
}
