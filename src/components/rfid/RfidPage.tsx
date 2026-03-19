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
  Plus,
  Globe,
  Calendar,
  FileText,
  Loader2,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

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
  const [showCreate, setShowCreate] = useState(false);

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

        <div className="flex items-center gap-3">
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
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Ajouter Token
          </button>
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

      {/* Create Token Modal */}
      {showCreate && <CreateTokenModal onClose={() => setShowCreate(false)} cpoId={selectedCpoId} onCreated={() => { setShowCreate(false); refetch(); }} />}
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

// ── Create Token Modal ────────────────────────────────────────

type CreateTab = "details" | "facturation";

interface DriverOption {
  id: string;
  driver_external_id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  customer_name: string | null;
}

function CreateTokenModal({ onClose, cpoId, onCreated }: { onClose: () => void; cpoId: string | null; onCreated: () => void }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<CreateTab>("details");

  // ── Details tab state ──
  const [driverSearch, setDriverSearch] = useState("");
  const [selectedDriver, setSelectedDriver] = useState<DriverOption | null>(null);
  const [showDriverDropdown, setShowDriverDropdown] = useState(false);
  const [tokenUid, setTokenUid] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [expiresAt, setExpiresAt] = useState("");
  const [remarks, setRemarks] = useState("");

  // ── Facturation tab state ──
  const [billingType, setBillingType] = useState<"postpaid" | "prepaid">("postpaid");
  const [prepaidAmount, setPrepaidAmount] = useState<number>(50);
  const [roamingEnabled, setRoamingEnabled] = useState(false);
  const [roamingFee, setRoamingFee] = useState<number>(0);
  const [roamingInterval, setRoamingInterval] = useState<"monthly" | "yearly">("monthly");

  // ── Driver search ──
  const { data: drivers } = useQuery<DriverOption[]>({
    queryKey: ["drivers-search", driverSearch, cpoId],
    enabled: driverSearch.length >= 2,
    queryFn: async () => {
      let q = supabase
        .from("gfx_consumers")
        .select("id, driver_external_id, full_name, first_name, last_name, customer_name")
        .or(`full_name.ilike.%${driverSearch}%,driver_external_id.ilike.%${driverSearch}%,first_name.ilike.%${driverSearch}%,last_name.ilike.%${driverSearch}%`)
        .limit(10);
      if (cpoId) q = q.eq("cpo_id", cpoId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as DriverOption[];
    },
  });

  // ── Save mutation ──
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!tokenUid.trim()) throw new Error("Le numéro du token est requis");

      const { error } = await supabase.from("gfx_tokens").insert({
        id: crypto.randomUUID(),
        token_uid: tokenUid.trim(),
        visual_number: tokenUid.trim(),
        driver_external_id: selectedDriver?.driver_external_id ?? null,
        driver_name: selectedDriver
          ? (selectedDriver.full_name ?? ([selectedDriver.first_name, selectedDriver.last_name].filter(Boolean).join(" ") || selectedDriver.driver_external_id))
          : null,
        customer_group: selectedDriver?.customer_name ?? null,
        status: enabled ? "active" : "inactive",
        cpo_id: cpoId,
        token_type: "RFID",
        total_sessions: 0,
        total_energy_kwh: 0,
        source: "manual",
        emsp: "EZdrive",
        contract_id: null,
        emsp_contract: null,
        first_used_at: null,
        last_used_at: null,
      });
      if (error) throw error;

      // Save billing info if needed
      const { error: billingError } = await supabase.from("token_billing").upsert({
        token_uid: tokenUid.trim(),
        billing_type: billingType,
        prepaid_amount: billingType === "prepaid" ? prepaidAmount : null,
        prepaid_balance: billingType === "prepaid" ? prepaidAmount : null,
        roaming_enabled: roamingEnabled,
        roaming_fee: roamingEnabled ? roamingFee : 0,
        roaming_interval: roamingEnabled ? roamingInterval : null,
        expires_at: expiresAt || null,
        remarks: remarks || null,
        cpo_id: cpoId,
      });
      // token_billing table may not exist yet — silently ignore
      if (billingError) console.warn("token_billing insert warning:", billingError.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gfx-tokens"] });
      onCreated();
    },
  });

  const driverDisplayName = (d: DriverOption) => {
    if (d.full_name) return d.full_name;
    if (d.first_name || d.last_name) return [d.first_name, d.last_name].filter(Boolean).join(" ");
    return d.driver_external_id;
  };

  const tabs: { key: CreateTab; label: string; icon: typeof Nfc }[] = [
    { key: "details", label: "Détails", icon: Nfc },
    { key: "facturation", label: "Facturation", icon: CreditCard },
  ];

  const labelClass = "block text-sm font-medium text-foreground mb-1.5";
  const inputClass = "w-full px-3 py-2.5 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-border-focus transition-colors";

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed inset-x-4 top-[5%] bottom-[5%] md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[720px] bg-surface border border-border rounded-2xl z-50 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Nfc className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="font-heading font-bold text-lg">Ajouter Token</h2>
              <p className="text-xs text-foreground-muted">Créer un nouveau badge RFID ou token d'authentification</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-elevated rounded-lg transition-colors">
            <X className="w-5 h-5 text-foreground-muted" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border px-6">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                "flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors relative",
                tab === key ? "text-primary" : "text-foreground-muted hover:text-foreground"
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
              {tab === key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {tab === "details" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left column */}
              <div className="space-y-5">
                <div>
                  <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-3">1. Conducteur</p>

                  <label className={labelClass}>Conducteur *</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
                    <input
                      type="text"
                      placeholder="Saisissez le nom du conducteur..."
                      value={selectedDriver ? driverDisplayName(selectedDriver) : driverSearch}
                      onChange={(e) => {
                        setDriverSearch(e.target.value);
                        setSelectedDriver(null);
                        setShowDriverDropdown(true);
                      }}
                      onFocus={() => driverSearch.length >= 2 && setShowDriverDropdown(true)}
                      className={cn(inputClass, "pl-9")}
                    />
                    {selectedDriver && (
                      <button
                        onClick={() => { setSelectedDriver(null); setDriverSearch(""); }}
                        className="absolute right-3 top-1/2 -translate-y-1/2"
                      >
                        <X className="w-4 h-4 text-foreground-muted hover:text-foreground" />
                      </button>
                    )}
                    {showDriverDropdown && drivers && drivers.length > 0 && !selectedDriver && (
                      <div className="absolute z-10 mt-1 w-full bg-surface border border-border rounded-xl shadow-lg max-h-48 overflow-y-auto">
                        {drivers.map((d) => (
                          <button
                            key={d.id}
                            onClick={() => {
                              setSelectedDriver(d);
                              setDriverSearch("");
                              setShowDriverDropdown(false);
                            }}
                            className="w-full px-3 py-2.5 text-left hover:bg-surface-elevated transition-colors text-sm"
                          >
                            <p className="font-medium text-foreground">{driverDisplayName(d)}</p>
                            {d.customer_name && (
                              <p className="text-xs text-foreground-muted">{d.customer_name}</p>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {selectedDriver?.customer_name && (
                    <div className="mt-2">
                      <label className="text-xs text-foreground-muted">Client</label>
                      <p className="text-sm text-foreground mt-0.5 bg-surface-elevated border border-border rounded-lg px-3 py-2 italic text-foreground-muted">
                        {selectedDriver.customer_name}
                      </p>
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-3">2. Information du token</p>

                  <label className={labelClass}>Numéro du token (Visual ID / UID) *</label>
                  <input
                    type="text"
                    placeholder="EZD-050A984A910000"
                    value={tokenUid}
                    onChange={(e) => setTokenUid(e.target.value)}
                    className={cn(inputClass, "font-mono")}
                  />
                  <p className="text-xs text-foreground-muted mt-1">Ce numéro est inscrit sur le badge RFID physique</p>
                </div>
              </div>

              {/* Right column */}
              <div className="space-y-5">
                <div>
                  <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-3">3. État du token</p>

                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-foreground">Authentification par token</label>
                    <button
                      onClick={() => setEnabled(!enabled)}
                      className={cn(
                        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                        enabled ? "bg-primary" : "bg-foreground-muted/30"
                      )}
                    >
                      <span className={cn(
                        "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                        enabled ? "translate-x-6" : "translate-x-1"
                      )} />
                    </button>
                  </div>

                  <div className="mt-4">
                    <label className={labelClass}>
                      <Calendar className="w-3.5 h-3.5 inline mr-1.5" />
                      Expire le
                    </label>
                    <input
                      type="date"
                      value={expiresAt}
                      onChange={(e) => setExpiresAt(e.target.value)}
                      className={inputClass}
                    />
                    <p className="text-xs text-foreground-muted mt-1">Laissez vide pour une durée illimitée</p>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-3">4. Remarques</p>
                  <textarea
                    placeholder="Saisissez éventuellement des remarques sur le Token..."
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    rows={4}
                    className={cn(inputClass, "resize-none")}
                  />
                </div>
              </div>
            </div>
          )}

          {tab === "facturation" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left column */}
              <div className="space-y-5">
                <div>
                  <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-3">1. Type de facturation</p>

                  <div className="flex gap-3">
                    <button
                      onClick={() => setBillingType("postpaid")}
                      className={cn(
                        "flex-1 p-4 rounded-xl border-2 text-left transition-all",
                        billingType === "postpaid"
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-border-focus"
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <div className={cn("w-4 h-4 rounded-full border-2 flex items-center justify-center",
                          billingType === "postpaid" ? "border-primary" : "border-foreground-muted/40"
                        )}>
                          {billingType === "postpaid" && <div className="w-2 h-2 rounded-full bg-primary" />}
                        </div>
                        <span className="text-sm font-semibold text-foreground">Postpaid</span>
                      </div>
                      <p className="text-xs text-foreground-muted pl-6">Facturation en fin de mois</p>
                    </button>

                    <button
                      onClick={() => setBillingType("prepaid")}
                      className={cn(
                        "flex-1 p-4 rounded-xl border-2 text-left transition-all",
                        billingType === "prepaid"
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-border-focus"
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <div className={cn("w-4 h-4 rounded-full border-2 flex items-center justify-center",
                          billingType === "prepaid" ? "border-primary" : "border-foreground-muted/40"
                        )}>
                          {billingType === "prepaid" && <div className="w-2 h-2 rounded-full bg-primary" />}
                        </div>
                        <span className="text-sm font-semibold text-foreground">Prépayé</span>
                      </div>
                      <p className="text-xs text-foreground-muted pl-6">Solde prédéfini, coupure auto à épuisement</p>
                    </button>
                  </div>

                  {billingType === "prepaid" && (
                    <div className="mt-4 p-4 bg-surface-elevated border border-border rounded-xl">
                      <label className={labelClass}>Montant prépayé (€)</label>
                      <div className="relative">
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={prepaidAmount}
                          onChange={(e) => setPrepaidAmount(Number(e.target.value))}
                          className={cn(inputClass, "pr-8")}
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-foreground-muted">€</span>
                      </div>
                      <p className="text-xs text-foreground-muted mt-1.5">
                        La recharge sera automatiquement coupée quand le solde atteint 0€
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Right column */}
              <div className="space-y-5">
                <div>
                  <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-3">2. Itinérance (OCPI)</p>

                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-foreground-muted" />
                      <label className="text-sm font-medium text-foreground">Itinérance activée</label>
                    </div>
                    <button
                      onClick={() => setRoamingEnabled(!roamingEnabled)}
                      className={cn(
                        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                        roamingEnabled ? "bg-primary" : "bg-foreground-muted/30"
                      )}
                    >
                      <span className={cn(
                        "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                        roamingEnabled ? "translate-x-6" : "translate-x-1"
                      )} />
                    </button>
                  </div>

                  {roamingEnabled ? (
                    <div className="p-4 bg-surface-elevated border border-border rounded-xl space-y-4">
                      <p className="text-xs text-foreground-muted">
                        Ce token aura accès au réseau OCPI (bornes partenaires). Vous pouvez facturer un frais d'itinérance au propriétaire du token.
                      </p>

                      <div>
                        <label className={labelClass}>Frais d'itinérance (€)</label>
                        <div className="relative">
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            value={roamingFee}
                            onChange={(e) => setRoamingFee(Number(e.target.value))}
                            className={cn(inputClass, "pr-8")}
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-foreground-muted">€</span>
                        </div>
                        <p className="text-xs text-foreground-muted mt-1">0€ par défaut (itinérance gratuite)</p>
                      </div>

                      {roamingFee > 0 && (
                        <div>
                          <label className={labelClass}>Périodicité</label>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setRoamingInterval("monthly")}
                              className={cn(
                                "flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors",
                                roamingInterval === "monthly"
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border text-foreground-muted hover:border-border-focus"
                              )}
                            >
                              Mensuel
                            </button>
                            <button
                              onClick={() => setRoamingInterval("yearly")}
                              className={cn(
                                "flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors",
                                roamingInterval === "yearly"
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border text-foreground-muted hover:border-border-focus"
                              )}
                            >
                              Annuel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="p-4 bg-surface-elevated/50 border border-border/50 rounded-xl">
                      <p className="text-xs text-foreground-muted">
                        L'itinérance est désactivée. Ce token ne pourra charger que sur les bornes du réseau EZDrive.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border">
          <p className="text-xs text-foreground-muted">
            {tab === "details" ? "Étape 1/2 — Informations du token" : "Étape 2/2 — Facturation & itinérance"}
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-red-400 hover:text-red-300 transition-colors"
            >
              Annuler
            </button>
            {tab === "details" ? (
              <button
                onClick={() => setTab("facturation")}
                disabled={!tokenUid.trim()}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Suivant
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTab("details")}
                  className="flex items-center gap-1 px-4 py-2.5 text-sm font-medium text-foreground-muted hover:text-foreground transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Précédent
                </button>
                <button
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending || !tokenUid.trim()}
                  className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Créer le token
                </button>
              </div>
            )}
          </div>
          {saveMutation.isError && (
            <p className="absolute bottom-14 right-6 text-xs text-red-400">
              {(saveMutation.error as Error)?.message ?? "Erreur lors de la création"}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
