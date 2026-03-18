// ============================================================
// EZDrive — Tokens RFID Page
// Lists all tokens from gfx_tokens (extracted from CDRs)
// Filterable by CPO, searchable, with detail drawer
// ============================================================

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { PageHelp } from "@/components/ui/PageHelp";
import { KPICard } from "@/components/ui/KPICard";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { useCpo } from "@/contexts/CpoContext";
import {
  Nfc,
  ShieldCheck,
  ShieldOff,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  X,
  Zap,
  Users,
  CreditCard,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────

interface Token {
  id: string;
  token_uid: string;
  visual_number: string | null;
  token_type: string | null;
  contract_id: string | null;
  driver_external_id: string | null;
  driver_name: string | null;
  customer_group: string | null;
  status: string | null;
  cpo_id: string | null;
  total_sessions: number;
  total_energy_kwh: number;
  first_used_at: string | null;
  last_used_at: string | null;
  emsp: string | null;
  emsp_contract: string | null;
  source: string | null;
}

const TABS = ["Tous", "Actifs", "Inactifs"] as const;
type Tab = (typeof TABS)[number];

type SortKey = "token_uid" | "driver_name" | "total_sessions" | "total_energy_kwh" | "last_used_at";
type SortDir = "asc" | "desc";
const PAGE_SIZE = 25;

// ── Formatters ────────────────────────────────────────────────

function formatEnergy(kwh: number): string {
  if (kwh >= 1000) return (kwh / 1000).toFixed(1) + " MWh";
  return kwh.toFixed(1) + " kWh";
}

function formatRelativeDate(dateStr: string): string {
  const diffDays = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (diffDays === 0) return "Aujourd'hui";
  if (diffDays === 1) return "Hier";
  if (diffDays < 7) return `Il y a ${diffDays}j`;
  if (diffDays < 30) return `Il y a ${Math.floor(diffDays / 7)} sem.`;
  if (diffDays < 365) return `Il y a ${Math.floor(diffDays / 30)} mois`;
  return new Date(dateStr).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

// Pretty-print token UID: EZD-050A984A910000 from FR-GFX-C050A984A910000
function formatTokenId(uid: string): string {
  if (uid.startsWith("FR-GFX-C")) return "EZD-" + uid.slice(8);
  return uid;
}

// ── Component ─────────────────────────────────────────────────

export function RfidPage() {
  const { selectedCpoId } = useCpo();

  const { data: tokens, isLoading, isError, refetch } = useQuery<Token[]>({
    queryKey: ["gfx-tokens", selectedCpoId ?? "all"],
    retry: 1,
    queryFn: async () => {
      const PAGE = 1000;
      let allRows: Token[] = [];
      let from = 0;
      let hasMore = true;

      while (hasMore) {
        let query = supabase
          .from("gfx_tokens")
          .select("*")
          .order("total_sessions", { ascending: false })
          .range(from, from + PAGE - 1);

        if (selectedCpoId) query = query.eq("cpo_id", selectedCpoId);

        const { data, error } = await query;
        if (error) throw error;
        const rows = (data ?? []) as Token[];
        allRows = allRows.concat(rows);
        from += PAGE;
        hasMore = rows.length === PAGE;
      }

      return allRows;
    },
  });

  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("Tous");
  const [sortKey, setSortKey] = useState<SortKey>("total_sessions");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Token | null>(null);

  // KPIs
  const kpis = useMemo(() => {
    if (!tokens) return null;
    const active = tokens.filter((t) => {
      if (!t.last_used_at) return false;
      return Date.now() - new Date(t.last_used_at).getTime() < 90 * 86400000;
    });
    return {
      total: tokens.length,
      active: active.length,
      drivers: new Set(tokens.map((t) => t.driver_external_id).filter(Boolean)).size,
      totalEnergy: tokens.reduce((s, t) => s + (Number(t.total_energy_kwh) || 0), 0),
    };
  }, [tokens]);

  const handleSort = useCallback((key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
    setPage(1);
  }, [sortKey]);

  // Filter
  const filtered = useMemo(() => {
    if (!tokens) return [];
    let list = [...tokens];

    if (activeTab === "Actifs") {
      list = list.filter((t) => t.last_used_at && Date.now() - new Date(t.last_used_at).getTime() < 90 * 86400000);
    } else if (activeTab === "Inactifs") {
      list = list.filter((t) => !t.last_used_at || Date.now() - new Date(t.last_used_at).getTime() >= 90 * 86400000);
    }

    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter((t) =>
        t.token_uid.toLowerCase().includes(q) ||
        (t.driver_name ?? "").toLowerCase().includes(q) ||
        (t.driver_external_id ?? "").toLowerCase().includes(q) ||
        (t.customer_group ?? "").toLowerCase().includes(q) ||
        (t.contract_id ?? "").toLowerCase().includes(q)
      );
    }

    return list;
  }, [tokens, activeTab, search]);

  // Sort
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      let cmp: number;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv), "fr");
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const paginated = sorted.slice(start, start + PAGE_SIZE);

  if (isError) {
    return <ErrorState message="Impossible de charger les tokens" onRetry={() => refetch()} />;
  }

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (col !== sortKey) return null;
    return sortDir === "asc" ? <ChevronUp className="w-3.5 h-3.5 inline ml-0.5" /> : <ChevronDown className="w-3.5 h-3.5 inline ml-0.5" />;
  };

  const thClass = "px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase tracking-wider cursor-pointer hover:text-foreground transition-colors select-none whitespace-nowrap";

  return (
    <div className="space-y-6">
      <PageHelp
        summary="Tokens RFID et identifiants d'authentification utilisés pour les sessions de charge"
        items={[
          { label: "Token UID", description: "Identifiant unique du badge RFID ou de l'application (FR-GFX-C...)." },
          { label: "Conducteur", description: "Conducteur associé à ce token dans le système GreenFlux." },
          { label: "Sessions", description: "Nombre total de sessions effectuées avec ce token." },
          { label: "Actif/Inactif", description: "Un token est actif s'il a été utilisé dans les 90 derniers jours." },
        ]}
      />

      {/* KPIs */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="bg-surface border border-border rounded-2xl p-5 h-[88px] animate-pulse" />)}
        </div>
      ) : kpis ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard label="Total tokens" value={kpis.total.toLocaleString("fr-FR")} icon={Nfc} color="#6366f1" />
          <KPICard label="Actifs (90j)" value={kpis.active.toLocaleString("fr-FR")} icon={ShieldCheck} color="#10b981" />
          <KPICard label="Conducteurs liés" value={kpis.drivers.toLocaleString("fr-FR")} icon={Users} color="#f59e0b" />
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

        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
          <input
            type="text"
            placeholder="Rechercher par UID, conducteur, groupe..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-3 py-2.5 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-border-focus transition-colors"
          />
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="bg-surface border border-border rounded-2xl p-6 h-[400px] animate-pulse" />
      ) : sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 bg-surface border border-border rounded-2xl">
          <ShieldOff className="w-8 h-8 text-foreground-muted mb-3" />
          <p className="text-foreground font-medium">{search.trim() ? "Aucun résultat" : "Aucun token"}</p>
          <p className="text-sm text-foreground-muted mt-1">
            {search.trim() ? `Aucun token ne correspond à « ${search} »` : "Les tokens apparaîtront après synchronisation."}
          </p>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-border">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase tracking-wider">État</th>
                  <th className={thClass} onClick={() => handleSort("token_uid")}>Identifiant <SortIcon col="token_uid" /></th>
                  <th className={thClass} onClick={() => handleSort("driver_name")}>Conducteur <SortIcon col="driver_name" /></th>
                  <th className={thClass}>Groupe</th>
                  <th className={thClass}>eMSP</th>
                  <th className={cn(thClass, "text-right")} onClick={() => handleSort("total_sessions")}>Sessions <SortIcon col="total_sessions" /></th>
                  <th className={cn(thClass, "text-right")} onClick={() => handleSort("total_energy_kwh")}>Énergie <SortIcon col="total_energy_kwh" /></th>
                  <th className={thClass} onClick={() => handleSort("last_used_at")}>Dernière util. <SortIcon col="last_used_at" /></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paginated.map((token) => {
                  const isActive = token.last_used_at
                    ? Date.now() - new Date(token.last_used_at).getTime() < 90 * 86400000
                    : false;

                  return (
                    <tr
                      key={token.id}
                      className="hover:bg-surface-elevated/50 transition-colors cursor-pointer"
                      onClick={() => setDetail(token)}
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
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground font-mono truncate max-w-[200px]">
                            {formatTokenId(token.token_uid)}
                          </p>
                          {token.contract_id && token.contract_id !== token.token_uid && (
                            <p className="text-xs text-foreground-muted truncate max-w-[200px] font-mono">{token.contract_id}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground truncate max-w-[160px]">
                        {token.driver_name ?? token.driver_external_id ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground-muted truncate max-w-[160px]">
                        {token.customer_group ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground-muted">
                        {token.emsp ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground-muted text-right tabular-nums">
                        {token.total_sessions.toLocaleString("fr-FR")}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground-muted text-right tabular-nums">
                        {formatEnergy(Number(token.total_energy_kwh))}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground-muted whitespace-nowrap">
                        {token.last_used_at ? formatRelativeDate(token.last_used_at) : "—"}
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
                {start + 1}–{Math.min(start + PAGE_SIZE, sorted.length)} sur {sorted.length} token{sorted.length !== 1 ? "s" : ""}
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
      {detail && <TokenDetailDrawer token={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

// ── Token Detail Drawer ───────────────────────────────────────

function TokenDetailDrawer({ token, onClose }: { token: Token; onClose: () => void }) {
  const isActive = token.last_used_at
    ? Date.now() - new Date(token.last_used_at).getTime() < 90 * 86400000
    : false;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-surface border-l border-border z-50 overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center">
              <Nfc className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="font-heading font-bold text-base font-mono">{formatTokenId(token.token_uid)}</h2>
              <span className={cn(
                "inline-flex px-2 py-0.5 rounded-full text-xs font-semibold mt-0.5",
                isActive ? "bg-emerald-500/10 text-emerald-400" : "bg-foreground-muted/10 text-foreground-muted"
              )}>
                {isActive ? "Actif" : "Inactif"}
              </span>
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
                <p className="text-xl font-bold text-foreground">{token.total_sessions.toLocaleString("fr-FR")}</p>
                <p className="text-xs text-foreground-muted mt-0.5">Sessions</p>
              </div>
              <div className="bg-surface-elevated border border-border rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-foreground">{formatEnergy(Number(token.total_energy_kwh))}</p>
                <p className="text-xs text-foreground-muted mt-0.5">Énergie</p>
              </div>
            </div>
          </div>

          {/* Identifiants */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-2">Identifiants</p>
            <DetailItem label="Token UID" value={token.token_uid} />
            {token.visual_number && <DetailItem label="ID visuel" value={token.visual_number} />}
            {token.contract_id && <DetailItem label="Contrat ID" value={token.contract_id} />}
            <DetailItem label="Type" value={token.token_type ?? "RFID"} />
          </div>

          {/* Conducteur */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-2">Conducteur</p>
            <DetailItem label="Nom" value={token.driver_name ?? "—"} />
            <DetailItem label="ID externe" value={token.driver_external_id ?? "—"} />
            <DetailItem label="Groupe / Client" value={token.customer_group ?? "—"} />
          </div>

          {/* Fournisseur */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-2">Fournisseur</p>
            <DetailItem label="eMSP" value={token.emsp ?? "—"} />
            <DetailItem label="Contrat eMSP" value={token.emsp_contract ?? "—"} />
          </div>

          {/* Dates */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-2">Historique</p>
            {token.first_used_at && <DetailItem label="Première utilisation" value={formatDate(token.first_used_at)} />}
            {token.last_used_at && <DetailItem label="Dernière utilisation" value={formatRelativeDate(token.last_used_at)} />}
          </div>

          {/* ID technique */}
          <div className="pt-3 border-t border-border">
            <p className="text-xs text-foreground-muted">
              ID: <span className="font-mono text-foreground">{token.id}</span>
            </p>
            {token.source && (
              <p className="text-xs text-foreground-muted mt-1">
                Source: <span className="font-medium">{token.source === "gfx_crm" ? "API GreenFlux CRM" : "Extraction CDRs"}</span>
              </p>
            )}
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
      <span className="text-foreground font-medium text-right truncate max-w-[200px] font-mono text-xs">{value}</span>
    </div>
  );
}
