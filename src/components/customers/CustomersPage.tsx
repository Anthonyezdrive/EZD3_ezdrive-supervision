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
  Plus,
  Download,
  Pencil,
  Loader2,
  BarChart3,
  Tag,
  Trash2,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useToast } from "@/contexts/ToastContext";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { useCpo } from "@/contexts/CpoContext";
import { downloadCSV, todayISO } from "@/lib/export";
import { CustomerDetailPage } from "@/components/customers/CustomerDetailPage";

// ── Types ────────────────────────────────────────────────────

interface Customer {
  id: string;
  driver_external_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null; // computed from first_name + last_name
  email: string | null;
  phone: string | null;
  customer_name: string | null;
  cpo_name: string | null;
  total_sessions: number;
  total_energy_kwh: number;
  first_session_at: string | null;
  last_session_at: string | null;
  status: string | null;
  retail_package: string | null;
  created_at: string;
  source: string | null;
}

type SortKey =
  | "full_name"
  | "customer_name"
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
          .from("all_consumers")
          .select("id, driver_external_id, first_name, last_name, email, phone, customer_name, cpo_name, total_sessions, total_energy_kwh, first_session_at, last_session_at, status, retail_package, created_at, source")
          .order("total_sessions", { ascending: false })
          .range(from, from + PAGE - 1);

        // Filter by selected CPO name
        if (selectedCpoId) {
          // all_consumers uses cpo_name instead of cpo_id — resolve name first
          const { data: cpo } = await supabase.from("cpos").select("name").eq("id", selectedCpoId).single();
          if (cpo?.name) {
            query = query.eq("cpo_name", cpo.name);
          }
        }

        const { data, error } = await query;
        if (error) throw error;
        const rows = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
          ...r,
          full_name: [r.first_name, r.last_name].filter(Boolean).join(" ") || null,
        })) as Customer[];
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
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("total_sessions");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);

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
        c.customer_name?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q)
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
        <div className="flex items-center gap-3">
          {!isLoading && customers && (
            <span className="inline-flex items-center gap-1.5 bg-primary/10 text-primary border border-primary/25 rounded-lg px-3 py-1.5 text-xs font-semibold">
              <Users className="w-3.5 h-3.5" />
              {customers.length} client{customers.length !== 1 ? "s" : ""}
            </span>
          )}
          {/* Story 76: Export CSV */}
          <button
            onClick={() => {
              if (!filtered.length) return;
              const rows = filtered.map((c) => ({
                nom: c.full_name ?? "",
                email: c.email ?? "",
                groupe: c.customer_name ?? "",
                sessions: c.total_sessions,
                energy_kwh: Number(c.total_energy_kwh).toFixed(1),
                derniere_charge: c.last_session_at ?? "",
              }));
              downloadCSV(rows, `clients-${todayISO()}.csv`);
            }}
            disabled={!filtered.length}
            className="flex items-center gap-2 px-3 py-1.5 bg-surface-elevated border border-border rounded-lg text-xs font-medium text-foreground-muted hover:text-foreground hover:bg-surface transition-colors disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
            Exporter CSV
          </button>
          {/* Story 73: Create customer */}
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Nouveau client
          </button>
        </div>
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
                  <th className={thClass} onClick={() => handleSort("customer_name")}>
                    Groupe <SortIcon col="customer_name" />
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
                      onClick={() => setSelectedCustomerId(customer.driver_external_id)}
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
                            {customer.email && (
                              <p className="text-xs text-foreground-muted truncate">
                                {customer.email}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Groupe */}
                      <td className="px-4 py-3 text-sm text-foreground-muted truncate max-w-[180px]">
                        {customer.customer_name ?? "\u2014"}
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

      {/* Customer 360° Detail Page */}
      {selectedCustomerId && (
        <CustomerDetailPage
          customerId={selectedCustomerId}
          onClose={() => setSelectedCustomerId(null)}
        />
      )}

      {/* Story 73: Create Customer Modal */}
      {showCreate && <CreateCustomerModal onClose={() => setShowCreate(false)} cpoId={selectedCpoId} onCreated={() => { setShowCreate(false); refetch(); }} />}
    </div>
  );
}

// ── Customer Detail Drawer ────────────────────────────────────

function CustomerDetailDrawer({
  customer,
  onClose,
  onRefresh,
}: {
  customer: Customer;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const hue = nameToHue(customer.full_name ?? customer.driver_external_id);
  const displayName = customer.full_name || customer.driver_external_id;
  const queryClient = useQueryClient();

  // Story 74: Edit state
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ first_name: customer.first_name ?? "", last_name: customer.last_name ?? "", email: customer.email ?? "", phone: customer.phone ?? "" });

  const editMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("gfx_consumers").update({
        first_name: editForm.first_name || null,
        last_name: editForm.last_name || null,
        email: editForm.email || null,
        phone: editForm.phone || null,
      }).eq("id", customer.id);
      if (error) throw error;
    },
    onSuccess: () => { setEditing(false); onRefresh(); },
  });

  // Story 75: Revenue data
  const { data: revenueData } = useQuery<Array<{ month: string; revenue: number }>>({
    queryKey: ["customer-revenue", customer.driver_external_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("ocpi_cdrs")
        .select("start_date_time, total_cost")
        .eq("driver_external_id", customer.driver_external_id);
      if (!data) return [];
      // Group by month
      const byMonth: Record<string, number> = {};
      for (const cdr of data) {
        const d = new Date(cdr.start_date_time as string);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        byMonth[key] = (byMonth[key] ?? 0) + (Number(cdr.total_cost) || 0);
      }
      return Object.entries(byMonth)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-6)
        .map(([month, revenue]) => ({ month, revenue }));
    },
  });
  const totalRevenue = (revenueData ?? []).reduce((s, r) => s + r.revenue, 0);
  const maxRevenue = Math.max(...(revenueData ?? []).map((r) => r.revenue), 1);

  // Story 77: Subscription offers
  const [showRetailPlan, setShowRetailPlan] = useState(false);
  const { data: subscriptionOffers } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["subscription-offers"],
    enabled: showRetailPlan,
    queryFn: async () => {
      const { data } = await supabase.from("subscription_offers").select("id, name").order("name");
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
  });

  const assignPlanMutation = useMutation({
    mutationFn: async (planName: string) => {
      const { error } = await supabase.from("gfx_consumers").update({ retail_package: planName }).eq("id", customer.id);
      if (error) throw error;
    },
    onSuccess: () => { setShowRetailPlan(false); onRefresh(); },
  });

  // Soft delete
  const { toast } = useToast();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const displayNameForDelete = customer.full_name || customer.driver_external_id;

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("gfx_consumers")
        .update({ status: "deleted", deleted_at: new Date().toISOString() })
        .eq("driver_external_id", customer.driver_external_id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast("Client supprimé", "success");
      setShowDeleteConfirm(false);
      onClose();
    },
    onError: (err) => {
      toast("Erreur : " + ((err as Error)?.message ?? "inconnue"), "error");
    },
  });

  const inputClass = "w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-border-focus transition-colors";

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
              {customer.customer_name && (
                <p className="text-xs text-foreground-muted">{customer.customer_name}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setEditing(!editing)} className="p-1.5 hover:bg-surface-elevated rounded-lg transition-colors" title="Modifier">
              <Pencil className="w-4 h-4 text-foreground-muted" />
            </button>
            <button onClick={() => setShowDeleteConfirm(true)} className="p-1.5 hover:bg-red-500/10 rounded-lg transition-colors" title="Supprimer">
              <Trash2 className="w-4 h-4 text-red-400" />
            </button>
            <button onClick={onClose} className="p-1.5 hover:bg-surface-elevated rounded-lg transition-colors">
              <X className="w-5 h-5 text-foreground-muted" />
            </button>
          </div>
        </div>
        <div className="p-5 space-y-5">
          {/* Story 74: Edit form */}
          {editing ? (
            <div className="space-y-3 p-4 bg-surface-elevated border border-border rounded-xl">
              <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-2">Modifier le client</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-foreground-muted mb-1 block">Prénom</label>
                  <input type="text" value={editForm.first_name} onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className="text-xs text-foreground-muted mb-1 block">Nom</label>
                  <input type="text" value={editForm.last_name} onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })} className={inputClass} />
                </div>
              </div>
              <div>
                <label className="text-xs text-foreground-muted mb-1 block">Email</label>
                <input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="text-xs text-foreground-muted mb-1 block">Téléphone</label>
                <input type="tel" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} className={inputClass} />
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => setEditing(false)} className="flex-1 px-3 py-2 text-sm text-foreground-muted hover:text-foreground transition-colors">Annuler</button>
                <button onClick={() => editMutation.mutate()} disabled={editMutation.isPending} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                  {editMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  Enregistrer
                </button>
              </div>
            </div>
          ) : (
            <>
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

              {/* Story 75: Revenue */}
              <div>
                <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-2">
                  <BarChart3 className="w-3.5 h-3.5 inline mr-1" />
                  Revenus ({totalRevenue.toFixed(2)} €)
                </p>
                {revenueData && revenueData.length > 0 ? (
                  <div className="flex items-end gap-1 h-16">
                    {revenueData.map((r) => (
                      <div key={r.month} className="flex-1 flex flex-col items-center gap-1">
                        <div
                          className="w-full bg-primary/60 rounded-t"
                          style={{ height: `${Math.max(4, (r.revenue / maxRevenue) * 48)}px` }}
                          title={`${r.month}: ${r.revenue.toFixed(2)} €`}
                        />
                        <span className="text-[9px] text-foreground-muted">{r.month.split("-")[1]}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-foreground-muted">Aucune donnée de revenus</p>
                )}
              </div>

              {/* Informations */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-2">Informations</p>
                <DetailItem label="Groupe client" value={customer.customer_name ?? "—"} />
                {customer.email && <DetailItem label="Email" value={customer.email} />}
                {customer.phone && <DetailItem label="Téléphone" value={customer.phone} />}
                <DetailItem label="Statut" value={customer.status ?? "—"} />
                <DetailItem label="Forfait" value={customer.retail_package ?? "—"} />
                {customer.first_session_at && (
                  <DetailItem label="Première charge" value={new Date(customer.first_session_at).toLocaleDateString("fr-FR")} />
                )}
                {customer.last_session_at && (
                  <DetailItem label="Dernière charge" value={formatRelativeDate(customer.last_session_at)} />
                )}
              </div>

              {/* Story 77: Retail plan */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider">Forfait</p>
                  <button onClick={() => setShowRetailPlan(!showRetailPlan)} className="text-xs text-primary hover:underline flex items-center gap-1">
                    <Tag className="w-3 h-3" /> Changer
                  </button>
                </div>
                {showRetailPlan && (
                  <div className="p-3 bg-surface-elevated border border-border rounded-xl">
                    <select
                      onChange={(e) => { if (e.target.value) assignPlanMutation.mutate(e.target.value); }}
                      className={inputClass}
                      defaultValue=""
                    >
                      <option value="" disabled>Sélectionner un forfait...</option>
                      {(subscriptionOffers ?? []).map((o) => (
                        <option key={o.id} value={o.name}>{o.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Identifiant externe */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-2">Identifiant externe</p>
            <p className="text-xs text-foreground font-mono bg-surface-elevated border border-border rounded-lg px-3 py-2 break-all">
              {customer.driver_external_id}
            </p>
            {customer.source && (
              <p className="text-xs text-foreground-muted">Source: <span className="font-medium">{customer.source}</span></p>
            )}
          </div>
          {/* ID technique */}
          <div className="pt-3 border-t border-border">
            <p className="text-xs text-foreground-muted">
              ID: <span className="font-mono text-foreground">{customer.id}</span>
            </p>
          </div>

          {/* Supprimer le client */}
          <div className="pt-3 border-t border-border">
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl text-sm font-medium hover:bg-red-500/20 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Supprimer ce client
            </button>
          </div>
        </div>
      </div>

      {/* Delete confirmation with name typing */}
      {showDeleteConfirm && (
        <>
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[150]"
            onClick={() => { if (!deleteMutation.isPending) setShowDeleteConfirm(false); }}
          />
          <div className="fixed inset-0 z-[151] flex items-center justify-center p-4">
            <div
              className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-4 p-6 pb-0">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 bg-red-500/10">
                  <Trash2 className="w-6 h-6 text-red-400" />
                </div>
                <div className="flex-1 min-w-0 pt-1">
                  <h3 className="text-base font-heading font-bold text-foreground">Supprimer ce client</h3>
                  <p className="text-sm text-foreground-muted mt-1.5 leading-relaxed">
                    Pour confirmer, saisissez le nom du client : <strong className="text-foreground">{displayNameForDelete}</strong>
                  </p>
                  <input
                    type="text"
                    value={deleteConfirmName}
                    onChange={(e) => setDeleteConfirmName(e.target.value)}
                    placeholder={displayNameForDelete}
                    className="w-full mt-3 px-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/40 focus:outline-none focus:border-red-500/50"
                    autoFocus
                  />
                </div>
                <button
                  onClick={() => { if (!deleteMutation.isPending) { setShowDeleteConfirm(false); setDeleteConfirmName(""); } }}
                  disabled={deleteMutation.isPending}
                  className="p-1 text-foreground-muted hover:text-foreground rounded-lg transition-colors shrink-0 -mt-1 -mr-1 disabled:opacity-50"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center justify-end gap-3 p-6">
                <button
                  onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmName(""); }}
                  disabled={deleteMutation.isPending}
                  className="px-4 py-2.5 text-sm font-medium text-foreground-muted hover:text-foreground border border-border rounded-xl transition-colors disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending || deleteConfirmName !== displayNameForDelete}
                  className="px-5 py-2.5 text-sm font-semibold text-white rounded-xl transition-colors disabled:opacity-50 min-w-[100px] bg-red-500 hover:bg-red-600"
                >
                  {deleteMutation.isPending ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Suppression...
                    </span>
                  ) : (
                    "Supprimer"
                  )}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
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

// ── Story 73: Create Customer Modal ───────────────────────────

function CreateCustomerModal({ onClose, cpoId, onCreated }: { onClose: () => void; cpoId: string | null; onCreated: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", customer_external_id: "", group: "" });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Le nom est requis");
      const parts = form.name.trim().split(" ");
      const firstName = parts[0] ?? "";
      const lastName = parts.slice(1).join(" ") ?? "";
      const driverExternalId = form.customer_external_id.trim() || `cust-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { error } = await supabase.from("gfx_consumers").insert({
        id: crypto.randomUUID(),
        driver_external_id: driverExternalId,
        first_name: firstName,
        last_name: lastName,
        full_name: form.name.trim(),
        customer_name: form.group.trim() || null,
        cpo_id: cpoId,
        status: "active",
        total_sessions: 0,
        total_energy_kwh: 0,
        source: "manual",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      onCreated();
    },
  });

  const inputClass = "w-full px-3 py-2.5 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-border-focus transition-colors";

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed inset-x-4 top-[10%] md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[480px] bg-surface border border-border rounded-2xl z-50 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Users className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="font-heading font-bold text-lg">Nouveau client</h2>
              <p className="text-xs text-foreground-muted">Ajouter manuellement</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-elevated rounded-lg transition-colors">
            <X className="w-5 h-5 text-foreground-muted" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Nom *</label>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jean Dupont" className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">ID externe</label>
            <input type="text" value={form.customer_external_id} onChange={(e) => setForm({ ...form, customer_external_id: e.target.value })} placeholder="customer-123" className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Groupe</label>
            <input type="text" value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value })} placeholder="Client B2B" className={inputClass} />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-foreground-muted hover:text-foreground transition-colors">Annuler</button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !form.name.trim()}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors"
          >
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Créer
          </button>
        </div>
        {saveMutation.isError && (
          <p className="px-6 pb-3 text-xs text-red-400">{(saveMutation.error as Error)?.message ?? "Erreur"}</p>
        )}
      </div>
    </>
  );
}
