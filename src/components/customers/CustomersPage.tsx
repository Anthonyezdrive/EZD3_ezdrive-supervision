// ============================================================
// EZDrive — Customers CRM Page
// eMSP customer management dashboard
// ============================================================

import { useState, useMemo, useCallback } from "react";
import { PageHelp } from "@/components/ui/PageHelp";
import { useQuery } from "@tanstack/react-query";
import {
  Users,
  CreditCard,
  Search,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  UserX,
  Zap,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { useCpo } from "@/contexts/CpoContext";

// ── Types ────────────────────────────────────────────────────

interface Customer {
  id: string;
  driver_external_id: string;
  full_name: string | null;
  primary_token_uid: string | null;
  customer_group: string | null;
  total_sessions: number;
  total_energy_kwh: number;
  first_session_at: string | null;
  last_session_at: string | null;
  is_active: boolean;
  admin_notes: string | null;
  created_at: string;
  cpo_id: string | null;
}

type SortKey =
  | "full_name"
  | "customer_group"
  | "total_sessions"
  | "total_energy_kwh"
  | "last_session_at"
  | "created_at";

type SortDir = "asc" | "desc";

const PAGE_SIZE = 20;

// ── Formatters ───────────────────────────────────────────────

function formatEnergy(kwh: number): string {
  return kwh.toFixed(1) + " kWh";
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Aujourd'hui";
  if (diffDays === 1) return "Hier";
  if (diffDays < 7) return `Il y a ${diffDays} jours`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `Il y a ${weeks} sem.`;
  }
  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return `Il y a ${months} mois`;
  }
  return date.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function getInitials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** Deterministic hue from a string, for avatar backgrounds */
function nameToHue(name: string | null): number {
  if (!name) return 200;
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

// ── Subscription badge ───────────────────────────────────────

function SubscriptionBadge({
  status,
  offer,
}: {
  status: string | null;
  offer: string | null;
}) {
  const config = getSubscriptionConfig(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold",
        config.bg,
        config.text,
        config.border
      )}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: config.dotColor }}
      />
      {offer ?? config.label}
    </span>
  );
}

function getSubscriptionConfig(status: string | null) {
  switch (status?.toUpperCase()) {
    case "ACTIVE":
      return {
        bg: "bg-emerald-500/10",
        text: "text-emerald-400",
        border: "border-emerald-500/25",
        dotColor: "#34D399",
        label: "Actif",
      };
    case "CANCELLED":
    case "CANCELED":
      return {
        bg: "bg-red-500/10",
        text: "text-red-400",
        border: "border-red-500/25",
        dotColor: "#F87171",
        label: "Annulé",
      };
    case "PAST_DUE":
      return {
        bg: "bg-amber-500/10",
        text: "text-amber-400",
        border: "border-amber-500/25",
        dotColor: "#FBBF24",
        label: "Impayé",
      };
    case "TRIALING":
      return {
        bg: "bg-blue-500/10",
        text: "text-blue-400",
        border: "border-blue-500/25",
        dotColor: "#60A5FA",
        label: "Essai",
      };
    default:
      return {
        bg: "bg-foreground-muted/5",
        text: "text-foreground-muted",
        border: "border-border",
        dotColor: "#8892B0",
        label: "Aucun",
      };
  }
}

// ── KPI Card (local, supports string values) ─────────────────

function CustomerKPICard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
}) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-5 flex items-center gap-4 transition-all hover:border-opacity-80">
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
        style={{ backgroundColor: `${color}15` }}
      >
        <Icon className="w-6 h-6" style={{ color }} />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-heading font-bold text-foreground truncate">
          {value}
        </p>
        <p className="text-xs text-foreground-muted mt-0.5">{label}</p>
      </div>
    </div>
  );
}

// ── Loading skeletons ────────────────────────────────────────

function CustomersKPISkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="bg-surface border border-border rounded-2xl p-5 space-y-3"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="w-12 h-12 rounded-xl" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-3 w-28" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CustomersTableSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <div className="border-b border-border px-4 py-3 flex gap-6">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-20" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="px-4 py-3.5 flex items-center gap-6">
            <div className="flex items-center gap-3 flex-[2]">
              <Skeleton className="w-9 h-9 rounded-full" />
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-2.5 w-1/2" />
              </div>
            </div>
            <Skeleton className="h-3 w-36" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Page Component ──────────────────────────────────────

export function CustomersPage() {
  const { selectedCpoId } = useCpo();

  // ── Data fetching (direct Supabase, filtered by CPO, paginated) ──
  const {
    data: customers,
    isLoading,
    isError,
    refetch,
  } = useQuery<Customer[]>({
    queryKey: ["customers", selectedCpoId ?? "all"],
    retry: 1,
    queryFn: async () => {
      const PAGE = 1000;
      let allRows: Customer[] = [];
      let from = 0;
      let hasMore = true;

      while (hasMore) {
        let query = supabase
          .from("gfx_consumers")
          .select("id, driver_external_id, full_name, primary_token_uid, customer_group, total_sessions, total_energy_kwh, first_session_at, last_session_at, is_active, admin_notes, created_at, cpo_id")
          .order("total_sessions", { ascending: false })
          .range(from, from + PAGE - 1);

        // Filter by selected CPO
        if (selectedCpoId) {
          query = query.eq("cpo_id", selectedCpoId);
        }

        const { data, error } = await query;
        if (error) throw error;
        const rows = (data ?? []) as Customer[];
        allRows = allRows.concat(rows);
        from += PAGE;
        hasMore = rows.length === PAGE;
      }

      return allRows;
    },
  });

  // Computed KPIs
  const stats = useMemo(() => {
    if (!customers) return null;
    const withName = customers.filter((c) => c.full_name);
    return {
      total_customers: customers.length,
      identified: withName.length,
      total_sessions: customers.reduce((s, c) => s + c.total_sessions, 0),
      total_energy: customers.reduce((s, c) => s + (Number(c.total_energy_kwh) || 0), 0),
    };
  }, [customers]);

  // ── Local state ──
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("total_sessions");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);

  // ── Sorting handler ──
  const handleSort = useCallback(
    (key: SortKey) => {
      if (key === sortKey) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir("asc");
      }
      setPage(1);
    },
    [sortKey]
  );

  // ── Search filter ──
  const filtered = useMemo(() => {
    if (!customers) return [];
    if (!search.trim()) return customers;

    const q = search.toLowerCase().trim();
    return customers.filter((c) => {
      return (
        c.full_name?.toLowerCase().includes(q) ||
        c.driver_external_id?.toLowerCase().includes(q) ||
        c.customer_group?.toLowerCase().includes(q) ||
        c.primary_token_uid?.toLowerCase().includes(q)
      );
    });
  }, [customers, search]);

  // ── Sort ──
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];

      // Handle null
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;

      let cmp: number;
      if (typeof av === "number" && typeof bv === "number") {
        cmp = av - bv;
      } else {
        cmp = String(av).localeCompare(String(bv), "fr");
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  // ── Pagination ──
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const paginated = sorted.slice(start, start + PAGE_SIZE);

  // Reset page when search changes
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-xl font-bold text-foreground">
            Gestion Clients
          </h1>
          <p className="text-sm text-foreground-muted mt-1">
            Base de données clients eMSP
          </p>
        </div>
        <ErrorState
          message="Impossible de charger les données clients"
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  // ── Sort icon helper ──
  const SortIcon = ({ col }: { col: SortKey }) => {
    if (col !== sortKey) return null;
    return sortDir === "asc" ? (
      <ChevronUp className="w-3.5 h-3.5 inline ml-0.5" />
    ) : (
      <ChevronDown className="w-3.5 h-3.5 inline ml-0.5" />
    );
  };

  const thClass =
    "px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase tracking-wider cursor-pointer hover:text-foreground transition-colors select-none whitespace-nowrap";

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-xl font-bold text-foreground">
            Gestion Clients
          </h1>
          <p className="text-sm text-foreground-muted mt-0.5">
            Base de données clients eMSP
          </p>
        </div>
        {!isLoading && customers && (
          <span className="inline-flex items-center gap-1.5 bg-primary/10 text-primary border border-primary/25 rounded-lg px-3 py-1.5 text-xs font-semibold">
            <Users className="w-3.5 h-3.5" />
            {customers.length} conducteur{customers.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      <PageHelp
        summary="Liste et gestion de vos utilisateurs finaux (conducteurs de véhicules électriques)"
        items={[
          { label: "Profil client", description: "Informations personnelles, véhicule enregistré et méthode de paiement." },
          { label: "Abonnement", description: "Type de forfait actif (gratuit, standard, premium) et date d'expiration." },
          { label: "Historique de charge", description: "Toutes les sessions de charge effectuées par ce client avec détails énergétiques." },
          { label: "Carte RFID", description: "Badge physique associé au client pour s'authentifier sur les bornes." },
        ]}
        tips={["Les clients s'inscrivent via l'application mobile EZDrive. Vous pouvez aussi créer des comptes manuellement."]}
      />

      {/* ── KPI Row ── */}
      {isLoading ? (
        <CustomersKPISkeleton />
      ) : stats ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <CustomerKPICard
            label="Total clients"
            value={stats.total_customers.toLocaleString("fr-FR")}
            icon={Users}
            color="#8892B0"
          />
          <CustomerKPICard
            label="Identifiés"
            value={stats.identified.toLocaleString("fr-FR")}
            icon={CreditCard}
            color="#00D4AA"
          />
          <CustomerKPICard
            label="Total sessions"
            value={stats.total_sessions.toLocaleString("fr-FR")}
            icon={Zap}
            color="#4ECDC4"
          />
          <CustomerKPICard
            label="Énergie totale"
            value={formatEnergy(stats.total_energy)}
            icon={Zap}
            color="#A78BFA"
          />
        </div>
      ) : null}

      {/* ── Search bar ── */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
        <input
          type="text"
          placeholder="Rechercher par nom, groupe, token..."
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="w-full pl-9 pr-3 py-2.5 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-border-focus transition-colors"
        />
      </div>

      {/* ── Data table ── */}
      {isLoading ? (
        <CustomersTableSkeleton rows={10} />
      ) : sorted.length === 0 && search.trim() ? (
        /* Empty search results */
        <div className="flex flex-col items-center justify-center h-48 bg-surface border border-border rounded-2xl">
          <div className="w-12 h-12 rounded-xl bg-foreground-muted/10 flex items-center justify-center mb-3">
            <Search className="w-6 h-6 text-foreground-muted" />
          </div>
          <p className="text-foreground font-medium">Aucun résultat</p>
          <p className="text-sm text-foreground-muted mt-1">
            Aucun client ne correspond à « {search} »
          </p>
        </div>
      ) : sorted.length === 0 ? (
        /* No customers at all */
        <div className="flex flex-col items-center justify-center h-56 bg-surface border border-border rounded-2xl">
          <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
            <UserX className="w-7 h-7 text-primary" />
          </div>
          <p className="text-foreground font-medium text-lg">
            Aucun client enregistré
          </p>
          <p className="text-sm text-foreground-muted mt-1 max-w-sm text-center">
            Les clients apparaîtront ici dès qu'ils s'inscriront sur
            la plateforme eMSP.
          </p>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-border">
                <tr>
                  <th className={thClass} onClick={() => handleSort("full_name")}>
                    Conducteur <SortIcon col="full_name" />
                  </th>
                  <th className={thClass} onClick={() => handleSort("customer_group")}>
                    Groupe <SortIcon col="customer_group" />
                  </th>
                  <th className={cn(thClass, "text-right")} onClick={() => handleSort("total_sessions")}>
                    Sessions <SortIcon col="total_sessions" />
                  </th>
                  <th className={cn(thClass, "text-right")} onClick={() => handleSort("total_energy_kwh")}>
                    Énergie <SortIcon col="total_energy_kwh" />
                  </th>
                  <th className={thClass} onClick={() => handleSort("last_session_at")}>
                    Dernière charge <SortIcon col="last_session_at" />
                  </th>
                  <th className={thClass} onClick={() => handleSort("created_at")}>
                    Première charge <SortIcon col="created_at" />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paginated.map((customer) => {
                  const hue = nameToHue(customer.full_name ?? customer.driver_external_id);
                  const displayName = customer.full_name || customer.driver_external_id;

                  return (
                    <tr
                      key={customer.id}
                      className="hover:bg-surface-elevated/50 transition-colors cursor-pointer"
                      onClick={() => setSelectedCustomer(customer)}
                    >
                      {/* Conducteur */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                            style={{
                              backgroundColor: `hsl(${hue}, 45%, 25%)`,
                              color: `hsl(${hue}, 70%, 75%)`,
                            }}
                          >
                            {getInitials(customer.full_name ?? customer.driver_external_id)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">
                              {displayName}
                            </p>
                            {customer.primary_token_uid && (
                              <p className="text-xs text-foreground-muted truncate font-mono">
                                {customer.primary_token_uid}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Groupe */}
                      <td className="px-4 py-3 text-sm text-foreground-muted truncate max-w-[180px]">
                        {customer.customer_group ?? "\u2014"}
                      </td>

                      {/* Sessions */}
                      <td className="px-4 py-3 text-sm text-foreground-muted text-right tabular-nums">
                        {customer.total_sessions.toLocaleString("fr-FR")}
                      </td>

                      {/* Energy */}
                      <td className="px-4 py-3 text-sm text-foreground-muted text-right tabular-nums">
                        {formatEnergy(Number(customer.total_energy_kwh))}
                      </td>

                      {/* Dernière charge */}
                      <td className="px-4 py-3 text-sm text-foreground-muted whitespace-nowrap">
                        {customer.last_session_at ? formatRelativeDate(customer.last_session_at) : "\u2014"}
                      </td>

                      {/* Première charge */}
                      <td className="px-4 py-3 text-sm text-foreground-muted whitespace-nowrap">
                        {customer.first_session_at ? formatRelativeDate(customer.first_session_at) : "\u2014"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Pagination footer ── */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border">
              <span className="text-xs text-foreground-muted">
                {start + 1}\u2013
                {Math.min(start + PAGE_SIZE, sorted.length)} sur{" "}
                {sorted.length} client{sorted.length !== 1 ? "s" : ""}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  aria-label="Page précédente"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(
                    (p) =>
                      p === 1 ||
                      p === totalPages ||
                      Math.abs(p - safePage) <= 1
                  )
                  .reduce<(number | "\u2026")[]>((acc, p, idx, arr) => {
                    if (idx > 0 && p - (arr[idx - 1] as number) > 1)
                      acc.push("\u2026");
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((p, i) =>
                    p === "\u2026" ? (
                      <span
                        key={"e" + i}
                        className="px-1.5 text-xs text-foreground-muted"
                      >
                        \u2026
                      </span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setPage(p as number)}
                        className={`min-w-[2rem] h-8 px-2 rounded-lg text-xs font-medium transition-colors ${
                          safePage === p
                            ? "bg-primary/15 text-primary border border-primary/30"
                            : "text-foreground-muted hover:text-foreground hover:bg-surface-elevated"
                        }`}
                      >
                        {p}
                      </button>
                    )
                  )}

                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                  className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  aria-label="Page suivante"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Customer Detail Drawer */}
      {selectedCustomer && (
        <CustomerDetailDrawer
          customer={selectedCustomer}
          onClose={() => setSelectedCustomer(null)}
        />
      )}
    </div>
  );
}

// ── Customer Detail Drawer ────────────────────────────────────

function CustomerDetailDrawer({
  customer,
  onClose,
}: {
  customer: Customer;
  onClose: () => void;
}) {
  const hue = nameToHue(customer.full_name ?? customer.driver_external_id);
  const displayName = customer.full_name || customer.driver_external_id;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-surface border-l border-border z-50 overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
              style={{
                backgroundColor: `hsl(${hue}, 45%, 25%)`,
                color: `hsl(${hue}, 70%, 75%)`,
              }}
            >
              {getInitials(customer.full_name ?? customer.driver_external_id)}
            </div>
            <div>
              <h2 className="font-heading font-bold text-base">{displayName}</h2>
              {customer.customer_group && (
                <p className="text-xs text-foreground-muted">{customer.customer_group}</p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-elevated rounded-lg transition-colors">
            <X className="w-5 h-5 text-foreground-muted" />
          </button>
        </div>
        <div className="p-5 space-y-5">
          {/* Activité */}
          <div>
            <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-2">Activité</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-surface-elevated border border-border rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-foreground">{customer.total_sessions.toLocaleString("fr-FR")}</p>
                <p className="text-xs text-foreground-muted mt-0.5">Sessions</p>
              </div>
              <div className="bg-surface-elevated border border-border rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-foreground">{formatEnergy(Number(customer.total_energy_kwh))}</p>
                <p className="text-xs text-foreground-muted mt-0.5">Énergie</p>
              </div>
            </div>
          </div>
          {/* Informations */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-2">Informations</p>
            <DetailItem label="Groupe client" value={customer.customer_group ?? "—"} />
            <DetailItem label="Token principal" value={customer.primary_token_uid ?? "—"} />
            <DetailItem label="Statut" value={customer.is_active ? "Actif" : "Inactif"} />
            {customer.first_session_at && (
              <DetailItem label="Première charge" value={new Date(customer.first_session_at).toLocaleDateString("fr-FR")} />
            )}
            {customer.last_session_at && (
              <DetailItem label="Dernière charge" value={formatRelativeDate(customer.last_session_at)} />
            )}
          </div>
          {/* ID GreenFlux */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-2">Identifiant GreenFlux</p>
            <p className="text-xs text-foreground font-mono bg-surface-elevated border border-border rounded-lg px-3 py-2 break-all">
              {customer.driver_external_id}
            </p>
          </div>
          {/* Notes */}
          {customer.admin_notes && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-2">Notes</p>
              <p className="text-sm text-foreground-muted">{customer.admin_notes}</p>
            </div>
          )}
          {/* ID technique */}
          <div className="pt-3 border-t border-border">
            <p className="text-xs text-foreground-muted">
              ID: <span className="font-mono text-foreground">{customer.id}</span>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm py-1.5 border-b border-border/50 last:border-0">
      <span className="text-foreground-muted">{label}</span>
      <span className="text-foreground font-medium">{value}</span>
    </div>
  );
}
