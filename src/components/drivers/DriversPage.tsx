// ============================================================
// EZDrive — Drivers Page
// View and manage consumer/driver profiles (from GFX CDR sync)
// ============================================================

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Users,
  Search,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  UserCheck,
  UserX,
  Zap,
  X,
  Activity,
  Plus,
  Download,
  Pencil,
  Building2,
  GitMerge,
  Loader2,
  CreditCard,
  BarChart3,
  Info,
  Trash2,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { KPICard } from "@/components/ui/KPICard";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHelp } from "@/components/ui/PageHelp";
import { useCpo } from "@/contexts/CpoContext";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SlideOver } from "@/components/ui/SlideOver";
import { downloadCSV, todayISO } from "@/lib/export";
import { DriverTokenLink } from "@/components/drivers/DriverTokenLink";
import { useDriverSessions, useSoftDeleteDriver } from "@/hooks/useDriverTokens";

// ── Types ─────────────────────────────────────────────────────

interface Driver {
  id: string;
  driver_external_id: string;
  full_name: string | null; // computed from first_name + last_name
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  status: string | null;
  retail_package: string | null;
  emsp_contract: string | null;
  customer_name: string | null;
  cpo_name: string | null;
  total_sessions: number;
  total_energy_kwh: number;
  first_session_at: string | null;
  last_session_at: string | null;
  source: string | null;
  created_at: string;
  // eMSP P1: Extended fields
  address?: string | null;
  postal_code?: string | null;
  city?: string | null;
  billing_mode?: string | null;
  siret?: string | null;
  cost_center?: string | null;
  validity_date?: string | null;
  // Road Phase 2 fields
  road_account_id?: string | null;
  billing_plan?: string | null;
}

const SOURCE_OPTIONS = [
  { value: "", label: "Toutes les sources" },
  { value: "road", label: "Road.io" },
  { value: "gfx", label: "GreenFlux" },
  { value: "ocpp", label: "OCPP Direct" },
] as const;

function getSourceBadge(source: string | null) {
  if (source === "road") return { label: "Road.io", color: "bg-blue-500/10 text-blue-400" };
  if (source === "gfx") return { label: "GreenFlux", color: "bg-purple-500/10 text-purple-400" };
  if (source === "ocpp") return { label: "OCPP", color: "bg-green-500/10 text-green-400" };
  return { label: source ?? "—", color: "bg-foreground-muted/10 text-foreground-muted" };
}

const TABS = ["Tous", "Actifs", "Inactifs"] as const;
type Tab = (typeof TABS)[number];

type SortKey =
  | "full_name"
  | "customer_name"
  | "total_sessions"
  | "total_energy_kwh"
  | "last_session_at"
  | "first_session_at";

type SortDir = "asc" | "desc";
const PAGE_SIZE = 25;

// ── Formatters ───────────────────────────────────────────────

function formatEnergy(kwh: number): string {
  if (kwh >= 1000) return (kwh / 1000).toFixed(1) + " MWh";
  return kwh.toFixed(1) + " kWh";
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Aujourd'hui";
  if (diffDays === 1) return "Hier";
  if (diffDays < 7) return `Il y a ${diffDays}j`;
  if (diffDays < 30) return `Il y a ${Math.floor(diffDays / 7)} sem.`;
  if (diffDays < 365) return `Il y a ${Math.floor(diffDays / 30)} mois`;
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getInitials(name: string | null): string {
  if (!name) return "?";
  return name.split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

function nameToHue(name: string | null): number {
  if (!name) return 200;
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return Math.abs(hash) % 360;
}

// ── Main Page ─────────────────────────────────────────────────

export function DriversPage() {
  const { selectedCpoId } = useCpo();
  const [sourceFilter, setSourceFilter] = useState("");

  const {
    data: drivers,
    isLoading,
    isError,
    refetch,
  } = useQuery<Driver[]>({
    queryKey: ["drivers", selectedCpoId ?? "all", sourceFilter],
    retry: 1,
    queryFn: async () => {
      const PAGE = 1000;
      let allRows: Driver[] = [];
      let from = 0;
      let hasMore = true;

      // Resolve CPO name for filtering if needed
      let cpoName: string | null = null;
      if (selectedCpoId) {
        const { data: cpo } = await supabase.from("cpos").select("name").eq("id", selectedCpoId).single();
        cpoName = cpo?.name ?? null;
      }

      while (hasMore) {
        let query = supabase
          .from("all_consumers")
          .select("id, driver_external_id, first_name, last_name, email, phone, country, status, retail_package, emsp_contract, customer_name, cpo_name, total_sessions, total_energy_kwh, first_session_at, last_session_at, source, created_at, address, postal_code, city, billing_mode, siret, cost_center, validity_date, road_account_id, billing_plan")
          .order("total_sessions", { ascending: false })
          .range(from, from + PAGE - 1);

        if (cpoName) {
          query = query.eq("cpo_name", cpoName);
        }
        if (sourceFilter) {
          query = query.eq("source", sourceFilter);
        }

        const { data, error } = await query;
        if (error) throw error;
        const rows = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
          ...r,
          full_name: [r.first_name, r.last_name].filter(Boolean).join(" ") || null,
        })) as Driver[];
        allRows = allRows.concat(rows);
        from += PAGE;
        hasMore = rows.length === PAGE;
      }

      return allRows;
    },
  });

  // ── State ──
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("Tous");
  const [sortKey, setSortKey] = useState<SortKey>("total_sessions");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Driver | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // ── KPIs ──
  const kpis = useMemo(() => {
    if (!drivers) return null;
    const identified = drivers.filter((d) => d.full_name);
    const active30d = drivers.filter((d) => {
      if (!d.last_session_at) return false;
      const diff = Date.now() - new Date(d.last_session_at).getTime();
      return diff < 30 * 24 * 60 * 60 * 1000;
    });
    return {
      total: drivers.length,
      identified: identified.length,
      active30d: active30d.length,
      totalEnergy: drivers.reduce((s, d) => s + (Number(d.total_energy_kwh) || 0), 0),
    };
  }, [drivers]);

  // ── Sorting ──
  const handleSort = useCallback(
    (key: SortKey) => {
      if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      else { setSortKey(key); setSortDir("desc"); }
      setPage(1);
    },
    [sortKey]
  );

  // ── Filter ──
  const filtered = useMemo(() => {
    if (!drivers) return [];
    let list = [...drivers];

    // Tab filter
    if (activeTab === "Actifs") {
      list = list.filter((d) => {
        if (!d.last_session_at) return false;
        return Date.now() - new Date(d.last_session_at).getTime() < 90 * 24 * 60 * 60 * 1000;
      });
    } else if (activeTab === "Inactifs") {
      list = list.filter((d) => {
        if (!d.last_session_at) return true;
        return Date.now() - new Date(d.last_session_at).getTime() >= 90 * 24 * 60 * 60 * 1000;
      });
    }

    // Search
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter((d) =>
        (d.full_name ?? "").toLowerCase().includes(q) ||
        d.driver_external_id.toLowerCase().includes(q) ||
        (d.customer_name ?? "").toLowerCase().includes(q) ||
        (d.email ?? "").toLowerCase().includes(q)
      );
    }

    return list;
  }, [drivers, activeTab, search]);

  // ── Sort ──
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      let cmp: number;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv), "fr");
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  // ── Pagination ──
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const paginated = sorted.slice(start, start + PAGE_SIZE);

  const handleSearchChange = useCallback((value: string) => { setSearch(value); setPage(1); }, []);

  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-xl font-bold text-foreground">Conducteurs</h1>
          <p className="text-sm text-foreground-muted mt-1">Profils des conducteurs extraits des sessions de charge</p>
        </div>
        <ErrorState message="Impossible de charger les conducteurs" onRetry={() => refetch()} />
      </div>
    );
  }

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (col !== sortKey) return null;
    return sortDir === "asc" ? <ChevronUp className="w-3.5 h-3.5 inline ml-0.5" /> : <ChevronDown className="w-3.5 h-3.5 inline ml-0.5" />;
  };

  const thClass = "px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase tracking-wider cursor-pointer hover:text-foreground transition-colors select-none whitespace-nowrap";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-xl font-bold text-foreground">Conducteurs</h1>
          <p className="text-sm text-foreground-muted mt-0.5">
            Profils extraits des sessions de charge (CDRs)
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!isLoading && drivers && (
            <span className="inline-flex items-center gap-1.5 bg-primary/10 text-primary border border-primary/25 rounded-lg px-3 py-1.5 text-xs font-semibold">
              <Users className="w-3.5 h-3.5" />
              {drivers.length.toLocaleString("fr-FR")} conducteur{drivers.length !== 1 ? "s" : ""}
            </span>
          )}
          {/* Story 71: Export CSV */}
          <button
            onClick={() => {
              if (!filtered.length) return;
              const rows = filtered.map((d) => ({
                nom: d.full_name ?? "",
                email: d.email ?? "",
                phone: d.phone ?? "",
                groupe: d.customer_name ?? "",
                sessions: d.total_sessions,
                energy_kwh: Number(d.total_energy_kwh).toFixed(1),
                derniere_charge: d.last_session_at ?? "",
              }));
              downloadCSV(rows, `conducteurs-${todayISO()}.csv`);
            }}
            disabled={!filtered.length}
            className="flex items-center gap-2 px-3 py-1.5 bg-surface-elevated border border-border rounded-lg text-xs font-medium text-foreground-muted hover:text-foreground hover:bg-surface transition-colors disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
            Exporter CSV
          </button>
          {/* Story 67: Create driver */}
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Nouveau conducteur
          </button>
        </div>
      </div>

      <PageHelp
        summary="Gestion des conducteurs (utilisateurs finaux) identifiés via les sessions de charge"
        items={[
          { label: "Conducteur", description: "Identifié par son driver_external_id dans les CDRs (nom, UUID, ou ID GFX App)." },
          { label: "Token", description: "Badge RFID ou identifiant d'application utilisé pour s'authentifier sur les bornes." },
          { label: "Groupe", description: "Client B2B ou customer_external_id rattaché au conducteur." },
          { label: "Actif/Inactif", description: "Un conducteur est considéré actif s'il a chargé dans les 90 derniers jours." },
        ]}
      />

      {/* KPIs */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-5 h-[88px] animate-pulse" />
          ))}
        </div>
      ) : kpis ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard label="Total conducteurs" value={kpis.total.toLocaleString("fr-FR")} icon={Users} color="#6366f1" />
          <KPICard label="Identifiés" value={kpis.identified.toLocaleString("fr-FR")} icon={UserCheck} color="#10b981" />
          <KPICard label="Actifs (30j)" value={kpis.active30d.toLocaleString("fr-FR")} icon={Activity} color="#f59e0b" />
          <KPICard label="Énergie totale" value={formatEnergy(kpis.totalEnergy)} icon={Zap} color="#8b5cf6" />
        </div>
      ) : null}

      {/* Tabs + Search */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex gap-1 border-b border-border">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setPage(1); }}
              className={cn(
                "px-4 py-2.5 text-sm font-medium transition-colors relative",
                activeTab === tab ? "text-primary" : "text-foreground-muted hover:text-foreground"
              )}
            >
              {tab}
              {activeTab === tab && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />}
            </button>
          ))}
        </div>

        <select
          value={sourceFilter}
          onChange={(e) => { setSourceFilter(e.target.value); }}
          className="px-3 py-2.5 bg-surface-elevated border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-border-focus transition-colors"
        >
          {SOURCE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
          <input
            type="text"
            placeholder="Rechercher par nom, token, groupe..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-border-focus transition-colors"
          />
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="bg-surface border border-border rounded-2xl p-6 h-[400px] animate-pulse" />
      ) : sorted.length === 0 && search.trim() ? (
        <div className="flex flex-col items-center justify-center h-48 bg-surface border border-border rounded-2xl">
          <Search className="w-8 h-8 text-foreground-muted mb-3" />
          <p className="text-foreground font-medium">Aucun résultat</p>
          <p className="text-sm text-foreground-muted mt-1">Aucun conducteur ne correspond à « {search} »</p>
        </div>
      ) : sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-56 bg-surface border border-border rounded-2xl">
          <UserX className="w-10 h-10 text-foreground-muted mb-4" />
          <p className="text-foreground font-medium text-lg">Aucun conducteur</p>
          <p className="text-sm text-foreground-muted mt-1">Les conducteurs apparaîtront après synchronisation des CDRs.</p>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-border">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase tracking-wider">État</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase tracking-wider">Source</th>
                  <th className={thClass} onClick={() => handleSort("full_name")}>Conducteur <SortIcon col="full_name" /></th>
                  <th className={thClass} onClick={() => handleSort("customer_name")}>Forfait / Groupe <SortIcon col="customer_name" /></th>
                  <th className={thClass}>Pays</th>
                  <th className={cn(thClass, "text-right")} onClick={() => handleSort("total_sessions")}>Sessions <SortIcon col="total_sessions" /></th>
                  <th className={cn(thClass, "text-right")} onClick={() => handleSort("total_energy_kwh")}>Énergie <SortIcon col="total_energy_kwh" /></th>
                  <th className={thClass} onClick={() => handleSort("last_session_at")}>Dernière charge <SortIcon col="last_session_at" /></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paginated.map((driver) => {
                  const hue = nameToHue(driver.full_name ?? driver.driver_external_id);
                  const displayName = driver.full_name || driver.driver_external_id;
                  const isActive = driver.last_session_at
                    ? Date.now() - new Date(driver.last_session_at).getTime() < 90 * 24 * 60 * 60 * 1000
                    : false;

                  return (
                    <tr
                      key={driver.id}
                      className="hover:bg-surface-elevated/50 transition-colors cursor-pointer"
                      onClick={() => setDetail(driver)}
                    >
                      <td className="px-4 py-3">
                        <span className={cn(
                          "inline-flex px-2 py-0.5 rounded-full text-xs font-semibold",
                          isActive ? "bg-emerald-500/10 text-emerald-400" : "bg-foreground-muted/10 text-foreground-muted"
                        )}>
                          {isActive ? "Actif" : "Inactif"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {(() => {
                          const badge = getSourceBadge(driver.source);
                          return (
                            <span className={cn("inline-flex px-2 py-0.5 rounded-full text-xs font-medium", badge.color)}>
                              {badge.label}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                            style={{ backgroundColor: `hsl(${hue}, 45%, 25%)`, color: `hsl(${hue}, 70%, 75%)` }}
                          >
                            {getInitials(driver.full_name ?? driver.driver_external_id)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate max-w-[200px]">{displayName}</p>
                            <p className="text-xs text-foreground-muted truncate max-w-[200px]">
                              {driver.email ?? driver.driver_external_id}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground-muted truncate max-w-[180px]">
                        {driver.retail_package ?? driver.customer_name ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground-muted">
                        {driver.country ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground-muted text-right tabular-nums">
                        {driver.total_sessions.toLocaleString("fr-FR")}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground-muted text-right tabular-nums">
                        {formatEnergy(Number(driver.total_energy_kwh))}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground-muted whitespace-nowrap">
                        {driver.last_session_at ? formatRelativeDate(driver.last_session_at) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border">
              <span className="text-xs text-foreground-muted">
                {start + 1}–{Math.min(start + PAGE_SIZE, sorted.length)} sur {sorted.length} conducteur{sorted.length !== 1 ? "s" : ""}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
                  .reduce<(number | "…")[]>((acc, p, idx, arr) => {
                    if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push("…");
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((p, i) =>
                    p === "…" ? (
                      <span key={"e" + i} className="px-1.5 text-xs text-foreground-muted">…</span>
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
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Detail Drawer */}
      {detail && <DriverDetailDrawer driver={detail} onClose={() => setDetail(null)} onRefresh={() => refetch()} />}

      {/* Story 67: Create Driver Modal */}
      {showCreate && <CreateDriverModal onClose={() => setShowCreate(false)} cpoId={selectedCpoId} onCreated={() => { setShowCreate(false); refetch(); }} />}
    </div>
  );
}

// ── Driver Detail Drawer (SlideOver with Tabs) ───────────────

type DetailTab = "informations" | "tokens" | "sessions";

function DriverDetailDrawer({ driver, onClose, onRefresh }: { driver: Driver; onClose: () => void; onRefresh: () => void }) {
  const hue = nameToHue(driver.full_name ?? driver.driver_external_id);
  const displayName = driver.full_name || driver.driver_external_id;
  const isActive = driver.last_session_at
    ? Date.now() - new Date(driver.last_session_at).getTime() < 90 * 24 * 60 * 60 * 1000
    : false;

  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<DetailTab>("informations");
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    first_name: driver.first_name ?? "",
    last_name: driver.last_name ?? "",
    email: driver.email ?? "",
    phone: driver.phone ?? "",
    address: driver.address ?? "",
    postal_code: driver.postal_code ?? "",
    city: driver.city ?? "",
    country: driver.country ?? "FR",
    billing_mode: driver.billing_mode ?? "POSTPAID",
    siret: driver.siret ?? "",
    cost_center: driver.cost_center ?? "",
  });
  const [showB2BAssign, setShowB2BAssign] = useState(false);
  const [b2bSearch, setB2bSearch] = useState("");
  const [showMerge, setShowMerge] = useState(false);
  const [mergeSearch, setMergeSearch] = useState("");
  const [mergeTarget, setMergeTarget] = useState<Driver | null>(null);
  const [showMergeConfirm, setShowMergeConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);

  // Story 68: Edit mutation (enriched with extended fields)
  const editMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("gfx_consumers").update({
        first_name: editForm.first_name || null,
        last_name: editForm.last_name || null,
        email: editForm.email || null,
        phone: editForm.phone || null,
        address: editForm.address || null,
        postal_code: editForm.postal_code || null,
        city: editForm.city || null,
        country: editForm.country || null,
        billing_mode: editForm.billing_mode || "POSTPAID",
        siret: editForm.siret || null,
        cost_center: editForm.cost_center || null,
      }).eq("id", driver.id);
      if (error) throw error;
    },
    onSuccess: () => { setEditing(false); onRefresh(); },
  });

  // Task 5.3: Soft delete driver mutation
  const softDeleteMutation = useSoftDeleteDriver();

  // eMSP P1: Change driver status mutation
  const statusMutation = useMutation({
    mutationFn: async (newStatus: string) => {
      const { error } = await supabase.from("gfx_consumers").update({ status: newStatus }).eq("id", driver.id);
      if (error) throw error;
    },
    onSuccess: () => { setShowStatusMenu(false); onRefresh(); },
  });

  // Story 69: B2B clients list
  const { data: b2bClients } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["b2b-clients-list"],
    enabled: showB2BAssign,
    queryFn: async () => {
      const { data } = await supabase.from("b2b_clients").select("id, name").order("name");
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
  });

  const b2bAssignMutation = useMutation({
    mutationFn: async (clientName: string) => {
      const { error } = await supabase.from("gfx_consumers").update({ customer_name: clientName }).eq("id", driver.id);
      if (error) throw error;
    },
    onSuccess: () => { setShowB2BAssign(false); onRefresh(); },
  });

  // Task 5.2: Driver sessions from OCPP transactions via linked tokens
  const { data: driverSessions, isLoading: sessionsLoading } = useDriverSessions(driver.driver_external_id);

  // Story 72: Merge - search duplicates
  const { data: mergeCandidates } = useQuery<Driver[]>({
    queryKey: ["merge-driver-search", mergeSearch],
    enabled: mergeSearch.length >= 2 && showMerge,
    queryFn: async () => {
      const { data } = await supabase
        .from("all_consumers")
        .select("id, driver_external_id, first_name, last_name, email, phone, country, status, retail_package, emsp_contract, customer_name, cpo_name, total_sessions, total_energy_kwh, first_session_at, last_session_at, source, created_at")
        .or(`first_name.ilike.%${mergeSearch}%,last_name.ilike.%${mergeSearch}%,driver_external_id.ilike.%${mergeSearch}%`)
        .neq("id", driver.id)
        .limit(10);
      return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({ ...r, full_name: [r.first_name, r.last_name].filter(Boolean).join(" ") || null })) as Driver[];
    },
  });

  const mergeMutation = useMutation({
    mutationFn: async () => {
      if (!mergeTarget) throw new Error("Sélectionnez un conducteur");
      // Transfer tokens from mergeTarget to current driver
      await supabase.from("gfx_tokens").update({ driver_external_id: driver.driver_external_id, driver_name: displayName }).eq("driver_external_id", mergeTarget.driver_external_id);
      // Delete the duplicate
      await supabase.from("gfx_consumers").delete().eq("id", mergeTarget.id);
    },
    onSuccess: () => { setShowMerge(false); setShowMergeConfirm(false); onRefresh(); },
  });

  const inputClass = "w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-border-focus transition-colors";

  const DETAIL_TABS: Array<{ key: DetailTab; label: string; icon: typeof Info }> = [
    { key: "informations", label: "Informations", icon: Info },
    { key: "tokens", label: "Tokens", icon: CreditCard },
    { key: "sessions", label: "Sessions", icon: BarChart3 },
  ];

  return (
    <>
      <SlideOver
        open={true}
        onClose={onClose}
        title={displayName}
        subtitle={driver.customer_name ?? undefined}
        maxWidth="max-w-lg"
      >
        {/* Driver identity + Tabs */}
        <div className="px-6 pt-4 pb-4 border-b border-border">
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
              style={{ backgroundColor: `hsl(${hue}, 45%, 25%)`, color: `hsl(${hue}, 70%, 75%)` }}
            >
              {getInitials(driver.full_name ?? driver.driver_external_id)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={cn(
                  "inline-flex px-2 py-0.5 rounded-full text-xs font-semibold",
                  isActive ? "bg-emerald-500/10 text-emerald-400" : "bg-foreground-muted/10 text-foreground-muted"
                )}>
                  {isActive ? "Actif" : "Inactif"}
                </span>
                <span className="text-xs text-foreground-muted">{driver.total_sessions.toLocaleString("fr-FR")} sessions</span>
              </div>
            </div>
            <button onClick={() => setEditing(!editing)} className="p-1.5 hover:bg-surface-elevated rounded-lg transition-colors shrink-0" title="Modifier">
              <Pencil className="w-4 h-4 text-foreground-muted" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1">
            {DETAIL_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors",
                  activeTab === tab.key
                    ? "bg-primary/15 text-primary border border-primary/30"
                    : "text-foreground-muted hover:text-foreground hover:bg-surface-elevated"
                )}
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-5 space-y-5">
          {/* ── Tab: Informations ── */}
          {activeTab === "informations" && (
            <>
              {/* Story 68: Edit form */}
              {editing ? (
                <div className="space-y-3 p-4 bg-surface-elevated border border-border rounded-xl">
                  <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-2">Modifier le conducteur</p>
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
                  {/* eMSP P1: Extended fields */}
                  <div className="border-t border-border/50 pt-3 mt-3">
                    <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-2">Adresse</p>
                    <div className="space-y-2">
                      <input type="text" value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} placeholder="Adresse" className={inputClass} />
                      <div className="grid grid-cols-2 gap-2">
                        <input type="text" value={editForm.postal_code} onChange={(e) => setEditForm({ ...editForm, postal_code: e.target.value })} placeholder="Code postal" className={inputClass} />
                        <input type="text" value={editForm.city} onChange={(e) => setEditForm({ ...editForm, city: e.target.value })} placeholder="Ville" className={inputClass} />
                      </div>
                      <input type="text" value={editForm.country} onChange={(e) => setEditForm({ ...editForm, country: e.target.value })} placeholder="Pays (FR)" className={inputClass} />
                    </div>
                  </div>
                  <div className="border-t border-border/50 pt-3 mt-3">
                    <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-2">Facturation</p>
                    <div className="space-y-2">
                      <div>
                        <label className="text-xs text-foreground-muted mb-1 block">Mode de facturation</label>
                        <select value={editForm.billing_mode} onChange={(e) => setEditForm({ ...editForm, billing_mode: e.target.value })} className={inputClass}>
                          <option value="POSTPAID">Postpaid</option>
                          <option value="PREPAID">Prépayé</option>
                        </select>
                      </div>
                      <input type="text" value={editForm.siret} onChange={(e) => setEditForm({ ...editForm, siret: e.target.value })} placeholder="SIRET (B2B)" className={inputClass} />
                      <input type="text" value={editForm.cost_center} onChange={(e) => setEditForm({ ...editForm, cost_center: e.target.value })} placeholder="Centre de coût" className={inputClass} />
                    </div>
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
                        <p className="text-xl font-bold text-foreground">{driver.total_sessions.toLocaleString("fr-FR")}</p>
                        <p className="text-xs text-foreground-muted mt-0.5">Sessions</p>
                      </div>
                      <div className="bg-surface-elevated border border-border rounded-xl p-3 text-center">
                        <p className="text-xl font-bold text-foreground">{formatEnergy(Number(driver.total_energy_kwh))}</p>
                        <p className="text-xs text-foreground-muted mt-0.5">Énergie</p>
                      </div>
                    </div>
                  </div>

                  {/* Informations personnelles */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-2">Informations</p>
                    {driver.first_name && <DetailItem label="Prénom" value={driver.first_name} />}
                    {driver.last_name && <DetailItem label="Nom" value={driver.last_name} />}
                    {driver.email && <DetailItem label="Email" value={driver.email} />}
                    {driver.phone && <DetailItem label="Téléphone" value={driver.phone} />}
                    <DetailItem label="Pays" value={driver.country ?? "—"} />
                    <DetailItem label="Statut GFX" value={driver.status ?? "—"} />
                  </div>

                  {/* Abonnement & rattachement */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider">Forfait & Rattachement</p>
                      {/* Story 69: B2B association button */}
                      <button onClick={() => setShowB2BAssign(!showB2BAssign)} className="text-xs text-primary hover:underline flex items-center gap-1">
                        <Building2 className="w-3 h-3" /> Client B2B
                      </button>
                    </div>
                    <DetailItem label="Forfait" value={driver.retail_package ?? "—"} />
                    <DetailItem label="Contrat eMSP" value={driver.emsp_contract ?? "—"} />
                    <DetailItem label="Groupe / Client" value={driver.customer_name ?? "—"} />
                    <DetailItem label="CPO" value={driver.cpo_name ?? "—"} />

                    {/* Story 69: B2B assign dropdown */}
                    {showB2BAssign && (
                      <div className="mt-2 p-3 bg-surface-elevated border border-border rounded-xl space-y-2">
                        <label className="text-xs text-foreground-muted">Associer à un client B2B</label>
                        <select
                          onChange={(e) => { if (e.target.value) b2bAssignMutation.mutate(e.target.value); }}
                          className={inputClass}
                          defaultValue=""
                        >
                          <option value="" disabled>Sélectionner un client...</option>
                          {(b2bClients ?? []).map((c) => (
                            <option key={c.id} value={c.name}>{c.name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Charge dates */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-2">Historique de charge</p>
                    {driver.first_session_at && <DetailItem label="Première charge" value={formatDate(driver.first_session_at)} />}
                    {driver.last_session_at && <DetailItem label="Dernière charge" value={formatRelativeDate(driver.last_session_at)} />}
                  </div>

                  {/* Actions */}
                  <div className="space-y-3 pt-3 border-t border-border">
                    <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-2">Actions</p>

                    {/* eMSP P1: Status toggle */}
                    <div className="flex items-center justify-between p-3 bg-surface-elevated border border-border rounded-xl">
                      <div>
                        <p className="text-xs font-medium text-foreground">Statut du compte</p>
                        <p className="text-xs text-foreground-muted mt-0.5">
                          {driver.status === "active" ? "Actif — peut charger" : driver.status === "suspended" ? "Suspendu — charge bloquée" : "Inactif — compte désactivé"}
                        </p>
                      </div>
                      <div className="relative">
                        <button
                          onClick={() => setShowStatusMenu(!showStatusMenu)}
                          className={cn(
                            "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors",
                            driver.status === "active" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                            driver.status === "suspended" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                            "bg-foreground-muted/10 text-foreground-muted border-foreground-muted/20"
                          )}
                        >
                          {driver.status === "active" ? "Actif" : driver.status === "suspended" ? "Suspendu" : "Inactif"}
                          <ChevronDown className="w-3 h-3" />
                        </button>
                        {showStatusMenu && (
                          <div className="absolute right-0 mt-1 w-40 bg-surface border border-border rounded-lg shadow-lg z-10 overflow-hidden">
                            {[
                              { value: "active", label: "Actif", color: "text-emerald-400" },
                              { value: "inactive", label: "Inactif", color: "text-foreground-muted" },
                              { value: "suspended", label: "Suspendu", color: "text-amber-400" },
                            ].filter((s) => s.value !== driver.status).map((s) => (
                              <button
                                key={s.value}
                                onClick={() => statusMutation.mutate(s.value)}
                                disabled={statusMutation.isPending}
                                className={cn("w-full px-3 py-2 text-left text-xs font-medium hover:bg-surface-elevated transition-colors", s.color)}
                              >
                                {statusMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : null}
                                {s.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {/* Story 72: Merge */}
                      <button onClick={() => setShowMerge(!showMerge)} className="flex items-center gap-1.5 px-3 py-2 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-lg text-xs font-medium hover:bg-amber-500/20 transition-colors">
                        <GitMerge className="w-3.5 h-3.5" /> Fusionner
                      </button>
                    </div>
                    {showMerge && (
                      <div className="p-3 bg-surface-elevated border border-border rounded-xl space-y-2">
                        <label className="text-xs text-foreground-muted">Rechercher un doublon à fusionner</label>
                        <input
                          type="text"
                          placeholder="Rechercher par nom..."
                          value={mergeTarget ? (mergeTarget.full_name ?? mergeTarget.driver_external_id) : mergeSearch}
                          onChange={(e) => { setMergeSearch(e.target.value); setMergeTarget(null); }}
                          className={inputClass}
                        />
                        {mergeCandidates && mergeCandidates.length > 0 && !mergeTarget && (
                          <div className="max-h-36 overflow-y-auto border border-border rounded-lg">
                            {mergeCandidates.map((d) => (
                              <button key={d.id} onClick={() => setMergeTarget(d)} className="w-full px-3 py-2 text-left hover:bg-surface text-sm text-foreground">
                                {d.full_name ?? d.driver_external_id} <span className="text-foreground-muted">({d.total_sessions} sessions)</span>
                              </button>
                            ))}
                          </div>
                        )}
                        {mergeTarget && (
                          <button onClick={() => setShowMergeConfirm(true)} className="w-full px-3 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-500 transition-colors">
                            Fusionner avec {mergeTarget.full_name ?? mergeTarget.driver_external_id}
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ID externe */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-2">Identifiants</p>
                    <p className="text-xs text-foreground font-mono bg-surface-elevated border border-border rounded-lg px-3 py-2 break-all">
                      {driver.driver_external_id}
                    </p>
                    {driver.source && (
                      <p className="text-xs text-foreground-muted">
                        Source: <span className="font-medium">{driver.source === "gfx_crm" ? "API GreenFlux CRM" : "Extraction CDRs"}</span>
                      </p>
                    )}
                  </div>

                  {/* ID technique */}
                  <div className="pt-3 border-t border-border">
                    <p className="text-xs text-foreground-muted">
                      ID: <span className="font-mono text-foreground">{driver.id}</span>
                    </p>
                  </div>
                </>
              )}
            </>
          )}

          {/* ── Tab: Tokens ── */}
          {activeTab === "tokens" && (
            <DriverTokenLink driverExternalId={driver.driver_external_id} />
          )}

          {/* ── Tab: Sessions ── */}
          {activeTab === "sessions" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-foreground-muted" />
                <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider">
                  Sessions de charge
                </p>
              </div>

              {sessionsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-foreground-muted" />
                </div>
              ) : driverSessions && driverSessions.length > 0 ? (
                <div className="border border-border rounded-xl overflow-hidden">
                  {/* Table header */}
                  <div className="grid grid-cols-[1fr_1fr_70px_70px_60px] gap-1 px-3 py-2.5 bg-surface-elevated border-b border-border">
                    <span className="text-xs font-semibold text-foreground-muted uppercase tracking-wider">Date</span>
                    <span className="text-xs font-semibold text-foreground-muted uppercase tracking-wider">Station</span>
                    <span className="text-xs font-semibold text-foreground-muted uppercase tracking-wider text-right">Énergie</span>
                    <span className="text-xs font-semibold text-foreground-muted uppercase tracking-wider text-right">Durée</span>
                    <span className="text-xs font-semibold text-foreground-muted uppercase tracking-wider text-right">Coût</span>
                  </div>

                  {/* Session rows */}
                  <div className="divide-y divide-border max-h-[400px] overflow-y-auto">
                    {driverSessions.map((session) => {
                      const startDate = session.start_timestamp
                        ? new Date(session.start_timestamp).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })
                        : "—";
                      const startTime = session.start_timestamp
                        ? new Date(session.start_timestamp).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
                        : "";
                      const durationMin =
                        session.start_timestamp && session.stop_timestamp
                          ? Math.round((new Date(session.stop_timestamp).getTime() - new Date(session.start_timestamp).getTime()) / 60000)
                          : null;
                      const durationStr = durationMin != null
                        ? durationMin >= 60
                          ? `${Math.floor(durationMin / 60)}h${String(durationMin % 60).padStart(2, "0")}`
                          : `${durationMin} min`
                        : "—";
                      const energy = session.total_energy_kwh != null ? `${Number(session.total_energy_kwh).toFixed(1)} kWh` : "—";
                      const cost = session.total_cost != null ? `${Number(session.total_cost).toFixed(2)} €` : "—";
                      const stationName = session.location_name ?? session.charge_point_id ?? "—";

                      return (
                        <div
                          key={session.id}
                          className="grid grid-cols-[1fr_1fr_70px_70px_60px] gap-1 px-3 py-2.5 items-center hover:bg-surface-elevated/50 transition-colors"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-foreground">{startDate}</p>
                            <p className="text-xs text-foreground-muted">{startTime}</p>
                          </div>
                          <p className="text-xs text-foreground truncate" title={stationName}>
                            {stationName}
                          </p>
                          <p className="text-xs text-foreground tabular-nums text-right">{energy}</p>
                          <p className="text-xs text-foreground-muted tabular-nums text-right">{durationStr}</p>
                          <p className="text-xs text-foreground tabular-nums text-right">{cost}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 bg-surface-elevated border border-border rounded-xl">
                  <BarChart3 className="w-8 h-8 text-foreground-muted mb-3" />
                  <p className="text-sm font-medium text-foreground">Aucune session trouvée</p>
                  <p className="text-xs text-foreground-muted mt-1">
                    Les sessions apparaîtront une fois des tokens associés
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Task 5.3: Soft Delete Button (visible on all tabs) ── */}
          <div className="pt-6 mt-4 border-t border-border">
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl text-sm font-medium hover:bg-red-500/20 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Supprimer ce conducteur
            </button>
          </div>
        </div>
      </SlideOver>

      {/* Story 72: Merge confirmation */}
      <ConfirmDialog
        open={showMergeConfirm}
        onConfirm={() => mergeMutation.mutate()}
        onCancel={() => setShowMergeConfirm(false)}
        title="Fusionner les conducteurs"
        description={`Les tokens et sessions de "${mergeTarget?.full_name ?? mergeTarget?.driver_external_id ?? ""}" seront transférés vers "${displayName}". Le doublon sera supprimé.`}
        confirmLabel="Fusionner"
        variant="warning"
        loading={mergeMutation.isPending}
        loadingLabel="Fusion..."
      />

      {/* Task 5.3: Soft delete confirmation with name typing */}
      {showDeleteConfirm && <DeleteConfirmWithName
        driverName={displayName}
        onConfirm={() => {
          softDeleteMutation.mutate(driver.driver_external_id, {
            onSuccess: () => {
              setShowDeleteConfirm(false);
              onClose();
            },
          });
        }}
        onCancel={() => setShowDeleteConfirm(false)}
        loading={softDeleteMutation.isPending}
      />}
    </>
  );
}

// ── Delete Confirmation with Name Typing ──────────────────────

function DeleteConfirmWithName({
  driverName,
  onConfirm,
  onCancel,
  loading,
}: {
  driverName: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [value, setValue] = useState("");
  const isMatch = value.trim().toLowerCase() === driverName.trim().toLowerCase();

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[150] transition-opacity duration-200"
        onClick={() => !loading && onCancel()}
        aria-hidden="true"
      />
      {/* Dialog */}
      <div className="fixed inset-0 z-[151] flex items-center justify-center p-4" role="dialog" aria-modal="true">
        <div className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-start gap-4 p-6 pb-0">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 bg-red-500/10">
              <Trash2 className="w-6 h-6 text-red-400" />
            </div>
            <div className="flex-1 min-w-0 pt-1">
              <h3 className="text-base font-heading font-bold text-foreground">Supprimer ce conducteur</h3>
              <p className="text-sm text-foreground-muted mt-1.5 leading-relaxed">
                Pour confirmer la suppression de « <span className="font-semibold text-foreground">{driverName}</span> », tapez son nom ci-dessous. Le conducteur sera marqué comme supprimé.
              </p>
            </div>
            <button
              onClick={() => !loading && onCancel()}
              disabled={loading}
              aria-label="Fermer"
              className="p-1 text-foreground-muted hover:text-foreground rounded-lg transition-colors shrink-0 -mt-1 -mr-1 disabled:opacity-50"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Name input */}
          <div className="px-6 pt-4">
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={driverName}
              className="w-full px-3 py-2.5 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/30 focus:outline-none focus:border-red-500/50 transition-colors"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && isMatch && !loading) onConfirm();
                if (e.key === "Escape" && !loading) onCancel();
              }}
            />
            {value.length > 0 && !isMatch && (
              <p className="text-xs text-red-400 mt-1">Le nom ne correspond pas</p>
            )}
            {isMatch && (
              <p className="text-xs text-emerald-400 mt-1">Nom confirmé</p>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 p-6">
            <button
              onClick={onCancel}
              disabled={loading}
              className="px-4 py-2.5 text-sm font-medium text-foreground-muted hover:text-foreground border border-border rounded-xl transition-colors disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              onClick={onConfirm}
              disabled={!isMatch || loading}
              className="px-5 py-2.5 text-sm font-semibold text-white rounded-xl transition-colors disabled:opacity-50 min-w-[100px] bg-red-500 hover:bg-red-600 disabled:hover:bg-red-500"
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Suppression...
                </span>
              ) : (
                "Supprimer définitivement"
              )}
            </button>
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

// ── Story 67: Create Driver Modal ─────────────────────────────

function CreateDriverModal({ onClose, cpoId, onCreated }: { onClose: () => void; cpoId: string | null; onCreated: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    first_name: "", last_name: "", email: "", phone: "", customer_group: "",
    address: "", postal_code: "", city: "", country: "FR",
    billing_mode: "POSTPAID", siret: "", cost_center: "", status: "active",
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form.first_name.trim() || !form.last_name.trim()) throw new Error("Prénom et nom requis");
      const driverExternalId = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { error } = await supabase.from("gfx_consumers").insert({
        id: crypto.randomUUID(),
        driver_external_id: driverExternalId,
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        full_name: `${form.first_name.trim()} ${form.last_name.trim()}`,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        customer_name: form.customer_group.trim() || null,
        cpo_id: cpoId,
        status: form.status,
        address: form.address.trim() || null,
        postal_code: form.postal_code.trim() || null,
        city: form.city.trim() || null,
        country: form.country.trim() || "FR",
        billing_mode: form.billing_mode,
        siret: form.siret.trim() || null,
        cost_center: form.cost_center.trim() || null,
        total_sessions: 0,
        total_energy_kwh: 0,
        source: "manual",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      onCreated();
    },
  });

  const inputClass = "w-full px-3 py-2.5 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-border-focus transition-colors";

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed inset-x-4 top-[10%] md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[520px] bg-surface border border-border rounded-2xl z-50 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Users className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="font-heading font-bold text-lg">Nouveau conducteur</h2>
              <p className="text-xs text-foreground-muted">Créer un profil manuellement</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-elevated rounded-lg transition-colors">
            <X className="w-5 h-5 text-foreground-muted" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Prénom *</label>
              <input type="text" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} placeholder="Jean" className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Nom *</label>
              <input type="text" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} placeholder="Dupont" className={inputClass} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Email</label>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jean.dupont@email.com" className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Téléphone</label>
            <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+33 6 12 34 56 78" className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Groupe client</label>
            <input type="text" value={form.customer_group} onChange={(e) => setForm({ ...form, customer_group: e.target.value })} placeholder="Nom du client B2B" className={inputClass} />
          </div>

          {/* eMSP P1: Extended fields */}
          <div className="border-t border-border pt-4 mt-2">
            <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-3">Adresse & Facturation</p>
            <div className="space-y-3">
              <input type="text" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Adresse" className={inputClass} />
              <div className="grid grid-cols-3 gap-3">
                <input type="text" value={form.postal_code} onChange={(e) => setForm({ ...form, postal_code: e.target.value })} placeholder="Code postal" className={inputClass} />
                <input type="text" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Ville" className={inputClass} />
                <input type="text" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} placeholder="Pays" className={inputClass} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Mode facturation</label>
                  <select value={form.billing_mode} onChange={(e) => setForm({ ...form, billing_mode: e.target.value })} className={inputClass}>
                    <option value="POSTPAID">Postpaid</option>
                    <option value="PREPAID">Prépayé</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Statut initial</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={inputClass}>
                    <option value="active">Actif</option>
                    <option value="inactive">Inactif</option>
                    <option value="suspended">Suspendu</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input type="text" value={form.siret} onChange={(e) => setForm({ ...form, siret: e.target.value })} placeholder="SIRET (B2B)" className={inputClass} />
                <input type="text" value={form.cost_center} onChange={(e) => setForm({ ...form, cost_center: e.target.value })} placeholder="Centre de coût" className={inputClass} />
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-foreground-muted hover:text-foreground transition-colors">Annuler</button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !form.first_name.trim() || !form.last_name.trim()}
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
