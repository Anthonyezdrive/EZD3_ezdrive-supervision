// ============================================================
// EZDrive — CPO Networks Page
// GreenFlux-style: list view + detail view with tabs
// ============================================================

import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Network,
  Search,
  Plus,
  Pencil,
  Trash2,

  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,

  FileSignature,
  Handshake,
  Receipt,
  ExternalLink,
  Building2,
  AlertCircle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/contexts/ToastContext";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SlideOver } from "@/components/ui/SlideOver";
import { PageHelp } from "@/components/ui/PageHelp";

// ── Types ─────────────────────────────────────────────────────

interface CpoNetwork {
  id: string;
  type: "internal" | "external";
  name: string;
  remarks: string | null;
  cpo_contracts_count?: number;
  agreements_count?: number;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

interface CpoContract {
  id: string;
  type: "internal" | "external";
  name: string;
  network_id: string | null;
  country_code: string;
  party_id: string | null;
  contract_code: string | null;
  currency: string;
  url: string | null;
  updated_by: string | null;
  updated_at: string;
}

interface RoamingAgreement {
  id: string;
  status: "active" | "expired" | "planned";
  management: string | null;
  emsp_network: { name: string } | null;
  emsp_contract: { name: string } | null;
  cpo_contract: { name: string } | null;
  connection_method: string | null;
  valid_from: string | null;
  valid_to: string | null;
  professional_contact: string | null;
  professional_email: string | null;
  updated_by: string | null;
  updated_at: string;
}

interface ReimbursementRule {
  id: string;
  status: "active" | "expired" | "planned";
  tariff_code: string | null;
  country_code: string | null;
  cpo_name: string | null;
  cpo_entity: string | null;
  emsp_name: string | null;
  emsp_entity: string | null;
  cpo_network: { name: string } | null;
  cpo_contract: { name: string } | null;
  emsp_network: { name: string } | null;
  emsp_contract: { name: string } | null;
  retail_price: string | null;
  restrictions: string | null;
  price_per_kwh: number;
  price_per_min: number;
  start_fee: number;
  idle_fee_per_min: number;
  currency: string;
  valid_from: string | null;
  valid_to: string | null;
  remarks: string | null;
  updated_by: string | null;
  updated_at: string;
}

interface CpoOperator {
  id: string;
  name: string;
  code: string;
  color: string | null;
}

const EMPTY_NETWORK = {
  type: "internal" as CpoNetwork["type"],
  name: "",
  remarks: "",
  updated_by: "",
};

type SortKey = "name" | "type" | "cpo_contracts_count" | "updated_at";
type SortDir = "asc" | "desc";
type FilterTab = "all" | "internal" | "external";
type DetailTab = "details" | "contracts" | "cpos" | "agreements" | "billing";

const PAGE_SIZE = 15;

// ── Badges ──────────────────────────────────────────────────

function TypeBadge({ type }: { type: "internal" | "external" }) {
  const config = {
    internal: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/25", dot: "#60A5FA", label: "Interne" },
    external: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/25", dot: "#FBBF24", label: "Externe" },
  };
  const c = config[type] ?? config.internal;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold", c.bg, c.text, c.border)}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: c.dot }} />
      {c.label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; border: string; label: string }> = {
    active: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/25", label: "Valide" },
    expired: { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/25", label: "Expire" },
    planned: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/25", label: "Prevu" },
  };
  const c = config[status] ?? config.active;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold", c.bg, c.text, c.border)}>
      {c.label}
    </span>
  );
}

// ── Date formatter ──────────────────────────────────────────

function formatDate(d: string | null) {
  if (!d) return "\u2014";
  return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDateFull(d: string | null) {
  if (!d) return "\u2014";
  return new Date(d).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ── Skeletons ───────────────────────────────────────────────

function TableSkeleton({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <div className="border-b border-border px-4 py-3 flex gap-6">
        {Array.from({ length: cols }).map((_, i) => <Skeleton key={i} className="h-3 w-20" />)}
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="px-4 py-3.5 flex items-center gap-6">
            {Array.from({ length: cols }).map((_, j) => <Skeleton key={j} className="h-4 w-24" />)}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Page (3-level navigation) ────────────────────────────

export function CpoNetworksPage() {
  const [selectedNetwork, setSelectedNetwork] = useState<CpoNetwork | null>(null);
  const [selectedContract, setSelectedContract] = useState<CpoContract | null>(null);

  // Level 3: Contract detail (nested inside network)
  if (selectedNetwork && selectedContract) {
    return (
      <ContractDetailView
        contract={selectedContract}
        networkName={selectedNetwork.name}
        onBack={() => setSelectedContract(null)}
      />
    );
  }

  // Level 2: Network detail
  if (selectedNetwork) {
    return (
      <NetworkDetailView
        network={selectedNetwork}
        onBack={() => setSelectedNetwork(null)}
        onSelectContract={setSelectedContract}
      />
    );
  }

  // Level 1: Network list
  return <NetworkListView onSelect={setSelectedNetwork} />;
}

// ══════════════════════════════════════════════════════════════
// LIST VIEW
// ══════════════════════════════════════════════════════════════

function NetworkListView({ onSelect }: { onSelect: (n: CpoNetwork) => void }) {
  const queryClient = useQueryClient();
  const { success: toastSuccess, error: toastError } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CpoNetwork | null>(null);
  const [form, setForm] = useState(EMPTY_NETWORK);
  const [confirmDelete, setConfirmDelete] = useState<CpoNetwork | null>(null);
  const [search, setSearch] = useState("");
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [sortKey, setSortKey] = useState<SortKey>("updated_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);

  // ── Fetch networks ──
  const { data: networks, isLoading, isError, refetch, dataUpdatedAt: _dataUpdatedAt } = useQuery<CpoNetwork[]>({
    queryKey: ["cpo-networks"],
    retry: false,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("cpo_networks")
          .select("*")
          .order("created_at", { ascending: false });
        if (error) return [];
        return (data ?? []) as CpoNetwork[];
      } catch {
        return [];
      }
    },
  });

  // ── Fetch contract counts per network ──
  const { data: contractCounts, isError: _isErrorContractCounts } = useQuery({
    queryKey: ["cpo-contract-counts"],
    queryFn: async () => {
      const { data } = await supabase.from("cpo_contracts").select("network_id");
      const counts = new Map<string, number>();
      (data ?? []).forEach((c: any) => {
        if (c.network_id) counts.set(c.network_id, (counts.get(c.network_id) ?? 0) + 1);
      });
      return counts;
    },
  });

  // ── Fetch agreement counts per network ──
  const { data: agreementCounts, isError: _isErrorAgreementCounts } = useQuery({
    queryKey: ["cpo-agreement-counts"],
    queryFn: async () => {
      const { data } = await supabase.from("roaming_agreements").select("cpo_network_id");
      const counts = new Map<string, number>();
      (data ?? []).forEach((a: any) => {
        if (a.cpo_network_id) counts.set(a.cpo_network_id, (counts.get(a.cpo_network_id) ?? 0) + 1);
      });
      return counts;
    },
  });

  // ── Mutations ──
  const createMutation = useMutation({
    mutationFn: async (data: typeof EMPTY_NETWORK) => {
      const { error } = await supabase.from("cpo_networks").insert({
        type: data.type, name: data.name.trim(),
        remarks: data.remarks || null, updated_by: data.updated_by || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cpo-networks"] });
      closeModal();
      toastSuccess("Reseau cree", "Le reseau CPO a ete ajoute");
    },
    onError: (err: Error) => toastError("Erreur", err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Partial<typeof EMPTY_NETWORK>) => {
      const { error } = await supabase.from("cpo_networks").update({
        type: data.type, name: data.name?.trim(),
        remarks: data.remarks || null, updated_by: data.updated_by || null,
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cpo-networks"] });
      closeModal();
      toastSuccess("Reseau modifie", "Les modifications ont ete enregistrees");
    },
    onError: (err: Error) => toastError("Erreur", err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("cpo_networks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cpo-networks"] });
      setConfirmDelete(null);
      toastSuccess("Reseau supprime", "Le reseau CPO a ete supprime");
    },
    onError: (err: Error) => toastError("Erreur", err.message),
  });

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_NETWORK);
    setModalOpen(true);
  }

  function openEdit(e: React.MouseEvent, network: CpoNetwork) {
    e.stopPropagation();
    setEditing(network);
    setForm({ type: network.type, name: network.name, remarks: network.remarks ?? "", updated_by: network.updated_by ?? "" });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditing(null);
    setForm(EMPTY_NETWORK);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editing) updateMutation.mutate({ id: editing.id, ...form });
    else createMutation.mutate(form);
  }

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) { setSortDir((d) => (d === "asc" ? "desc" : "asc")); return key; }
      setSortDir("asc");
      return key;
    });
    setPage(1);
  }, []);

  // ── Filter + Sort ──
  const processed = useMemo(() => {
    let list = networks ?? [];
    if (filterTab !== "all") list = list.filter((n) => n.type === filterTab);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((n) =>
        n.name?.toLowerCase().includes(q) || n.remarks?.toLowerCase().includes(q) || n.updated_by?.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), "fr");
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [networks, filterTab, search, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(processed.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const paginated = processed.slice(start, start + PAGE_SIZE);

  const tabCounts = useMemo(() => {
    const list = networks ?? [];
    return { all: list.length, internal: list.filter((n) => n.type === "internal").length, external: list.filter((n) => n.type === "external").length };
  }, [networks]);

  const TABS: { key: FilterTab; label: string }[] = [
    { key: "all", label: "Tout" },
    { key: "internal", label: "Interne" },
    { key: "external", label: "Externe" },
  ];

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
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Network className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="font-heading text-xl font-bold text-foreground">
                Reseaux CPO ({tabCounts.all})
              </h1>
              <p className="text-sm text-foreground-muted">
                Gerer les reseaux de charge et accords roaming
              </p>
            </div>
          </div>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nouveau reseau
        </button>
      </div>

      <PageHelp
        summary="Reseaux CPO et accords de roaming avec les partenaires eMSP"
        items={[
          { label: "Reseau CPO", description: "Un reseau regroupe vos contrats CPO et les accords de roaming avec les partenaires eMSP." },
          { label: "Contrat CPO", description: "Identifiant OCPI de votre infrastructure (code pays, party ID, code contrat)." },
          { label: "Accord", description: "Convention de roaming avec un reseau eMSP partenaire (methode de connexion, validite)." },
          { label: "Regles de facturation", description: "Tarification appliquee aux sessions de roaming (prix/kWh, prix/min, frais de demarrage)." },
        ]}
      />

      {isError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mx-6 mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-red-700">
            <AlertCircle className="h-5 w-5" />
            <span>Erreur lors du chargement des données. Veuillez réessayer.</span>
          </div>
          <button onClick={() => refetch()} className="text-red-700 hover:text-red-900 font-medium text-sm">
            Réessayer
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-surface border border-border rounded-xl p-1 w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setFilterTab(tab.key); setPage(1); }}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              filterTab === tab.key
                ? "bg-primary/15 text-primary"
                : "text-foreground-muted hover:text-foreground hover:bg-surface-elevated"
            )}
          >
            {tab.label} <span className="opacity-60">{tabCounts[tab.key]}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
        <input
          type="text"
          placeholder="Rechercher par nom, remarques..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="w-full pl-9 pr-3 py-2.5 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-border-focus transition-colors"
        />
      </div>

      {/* Table */}
      {isLoading ? (
        <TableSkeleton rows={5} cols={7} />
      ) : processed.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-56 bg-surface border border-border rounded-2xl">
          <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
            <Network className="w-7 h-7 text-primary" />
          </div>
          <p className="text-foreground font-medium text-lg">Aucun reseau</p>
          <p className="text-sm text-foreground-muted mt-1">
            {search.trim() ? `Aucun resultat pour "${search}"` : "Creez votre premier reseau CPO."}
          </p>
          {!search.trim() && (
            <button onClick={openCreate} className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary/90 transition-colors">
              <Plus className="w-4 h-4" /> Creer un reseau
            </button>
          )}
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-border">
                <tr>
                  <th className={thClass} onClick={() => handleSort("type")}>Type de reseau <SortIcon col="type" /></th>
                  <th className={thClass} onClick={() => handleSort("name")}>Nom <SortIcon col="name" /></th>
                  <th className={thClass} onClick={() => handleSort("cpo_contracts_count")}>Contrats CPO <SortIcon col="cpo_contracts_count" /></th>
                  <th className={thClass}>Accords</th>
                  <th className={thClass} onClick={() => handleSort("updated_at")}>Derniere mise a jour <SortIcon col="updated_at" /></th>
                  <th className={thClass}>Mis a jour par</th>
                  <th className={thClass}>Remarques</th>
                  <th className={cn(thClass, "text-right w-20")} />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paginated.map((network) => (
                  <tr
                    key={network.id}
                    onClick={() => onSelect(network)}
                    className="hover:bg-surface-elevated/50 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3"><TypeBadge type={network.type} /></td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-foreground hover:text-primary transition-colors">{network.name}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground tabular-nums">
                      {contractCounts?.get(network.id) ?? 0} contrats
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground tabular-nums">
                      {agreementCounts?.get(network.id) ?? 0} agreements
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground-muted whitespace-nowrap">
                      {formatDateFull(network.updated_at)}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-foreground-muted truncate max-w-[180px]">{network.updated_by ?? "\u2014"}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-foreground-muted truncate max-w-[200px]">{network.remarks ?? "\u2014"}</p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={(e) => openEdit(e, network)}
                          className="px-3 py-1.5 text-xs font-medium text-foreground-muted hover:text-primary border border-border hover:border-primary/30 rounded-lg transition-colors"
                        >
                          Editer
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDelete(network); }}
                          className="p-1.5 text-foreground-muted hover:text-red-400 border border-border hover:border-red-400/30 rounded-lg transition-colors"
                          title="Supprimer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border">
              <span className="text-xs text-foreground-muted">
                {start + 1}\u2013{Math.min(start + PAGE_SIZE, processed.length)} sur {processed.length}
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated disabled:opacity-30 transition-colors">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs text-foreground-muted px-2">{safePage} / {totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated disabled:opacity-30 transition-colors">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create / Edit SlideOver */}
      <SlideOver open={modalOpen} onClose={closeModal} title={editing ? "Modifier le reseau" : "Nouveau reseau CPO"}>
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Type *</label>
            <select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as CpoNetwork["type"] }))}
              className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary/50"
            >
              <option value="internal">Interne</option>
              <option value="external">Externe</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Nom *</label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Nom du reseau"
              className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Remarques</label>
            <textarea
              value={form.remarks}
              onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
              rows={3}
              placeholder="Notes ou remarques..."
              className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50 resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Mis a jour par</label>
            <input
              value={form.updated_by}
              onChange={(e) => setForm((f) => ({ ...f, updated_by: e.target.value }))}
              placeholder="Email de l'operateur"
              className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50"
            />
          </div>
          {(createMutation.error || updateMutation.error) && (
            <div className="p-3 bg-red-500/10 border border-red-500/25 rounded-lg text-sm text-red-400">
              {((createMutation.error || updateMutation.error) as Error)?.message}
            </div>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={closeModal} className="px-4 py-2 text-sm text-foreground-muted hover:text-foreground border border-border rounded-xl transition-colors">
              Annuler
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending}
              className="px-5 py-2 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {createMutation.isPending || updateMutation.isPending ? "..." : editing ? "Enregistrer" : "Creer"}
            </button>
          </div>
        </form>
      </SlideOver>

      {/* Confirm Delete */}
      <ConfirmDialog
        open={!!confirmDelete}
        onConfirm={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
        onCancel={() => setConfirmDelete(null)}
        title="Supprimer ce reseau ?"
        description={`Le reseau "${confirmDelete?.name}" sera definitivement supprime.`}
        confirmLabel="Supprimer"
        variant="danger"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// DETAIL VIEW (GreenFlux-style with tabs)
// ══════════════════════════════════════════════════════════════

function NetworkDetailView({
  network,
  onBack,
  onSelectContract,
}: {
  network: CpoNetwork;
  onBack: () => void;
  onSelectContract: (c: CpoContract) => void;
}) {
  const [activeTab, setActiveTab] = useState<DetailTab>("details");
  const queryClient = useQueryClient();
  const { success: toastSuccess, error: toastError } = useToast();
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    type: network.type,
    name: network.name,
    remarks: network.remarks ?? "",
    updated_by: network.updated_by ?? "",
  });

  const updateMutation = useMutation({
    mutationFn: async (data: typeof editForm) => {
      const { error } = await supabase.from("cpo_networks").update({
        type: data.type, name: data.name.trim(),
        remarks: data.remarks || null, updated_by: data.updated_by || null,
      }).eq("id", network.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cpo-networks"] });
      setEditModalOpen(false);
      toastSuccess("Reseau modifie", "Les modifications ont ete enregistrees");
    },
    onError: (err: Error) => toastError("Erreur", err.message),
  });

  const DETAIL_TABS: { key: DetailTab; label: string; icon: typeof Network }[] = [
    { key: "details", label: "Details", icon: Network },
    { key: "contracts", label: "Contrats CPO", icon: FileSignature },
    { key: "cpos", label: "CPO", icon: Building2 },
    { key: "agreements", label: "Accords", icon: Handshake },
    { key: "billing", label: "Regles de facturation en gros", icon: Receipt },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2 rounded-xl border border-border hover:bg-surface-elevated transition-colors"
            title="Retour"
          >
            <ArrowLeft className="w-4 h-4 text-foreground-muted" />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Network className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="font-heading text-xl font-bold text-foreground">{network.name}</h1>
              <p className="text-sm text-foreground-muted">Reseau CPO</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <TypeBadge type={network.type} />
          <button
            onClick={() => setEditModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
            Editer
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {DETAIL_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium transition-colors relative whitespace-nowrap",
              activeTab === tab.key
                ? "text-primary"
                : "text-foreground-muted hover:text-foreground"
            )}
          >
            {tab.label}
            {activeTab === tab.key && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "details" && <DetailsTab network={network} />}
      {activeTab === "contracts" && <ContractsTab networkId={network.id} onSelectContract={onSelectContract} />}
      {activeTab === "cpos" && <CposTab networkId={network.id} />}
      {activeTab === "agreements" && <AgreementsTab networkId={network.id} />}
      {activeTab === "billing" && <BillingTab networkId={network.id} />}

      {/* Edit SlideOver */}
      <SlideOver open={editModalOpen} onClose={() => setEditModalOpen(false)} title="Modifier le reseau">
        <form onSubmit={(e) => { e.preventDefault(); updateMutation.mutate(editForm); }} className="p-6 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Type</label>
            <select
              value={editForm.type}
              onChange={(e) => setEditForm((f) => ({ ...f, type: e.target.value as CpoNetwork["type"] }))}
              className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary/50"
            >
              <option value="internal">Interne</option>
              <option value="external">Externe</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Nom</label>
            <input
              required
              value={editForm.name}
              onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary/50"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Remarques</label>
            <textarea
              value={editForm.remarks}
              onChange={(e) => setEditForm((f) => ({ ...f, remarks: e.target.value }))}
              rows={3}
              className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary/50 resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Mis a jour par</label>
            <input
              value={editForm.updated_by}
              onChange={(e) => setEditForm((f) => ({ ...f, updated_by: e.target.value }))}
              className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary/50"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setEditModalOpen(false)} className="px-4 py-2 text-sm text-foreground-muted hover:text-foreground border border-border rounded-xl transition-colors">
              Annuler
            </button>
            <button type="submit" disabled={updateMutation.isPending} className="px-5 py-2 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {updateMutation.isPending ? "..." : "Enregistrer"}
            </button>
          </div>
        </form>
      </SlideOver>
    </div>
  );
}

// ── Tab: Details ──────────────────────────────────────────────

function DetailsTab({ network }: { network: CpoNetwork }) {
  return (
    <div className="bg-surface border border-border rounded-2xl">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">Details</h3>
        <TypeBadge type={network.type} />
      </div>
      <div className="px-6 py-5 space-y-4">
        <DetailRow label="Identifiant externe" value={network.id} />
        <DetailRow
          label="Derniere mise a jour"
          value={
            network.updated_at
              ? `${formatDateFull(network.updated_at)}${network.updated_by ? ` (${network.updated_by})` : ""}`
              : "\u2014"
          }
          isLink
        />
        <DetailRow label="Remarques" value={network.remarks ?? "\u2014"} />
      </div>
    </div>
  );
}

function DetailRow({ label, value, isLink }: { label: string; value: string; isLink?: boolean }) {
  return (
    <div className="grid grid-cols-[200px_1fr] gap-4 items-start">
      <span className="text-sm font-medium text-foreground-muted">{label}</span>
      {isLink ? (
        <span className="text-sm text-primary">{value}</span>
      ) : (
        <span className="text-sm text-foreground">{value}</span>
      )}
    </div>
  );
}

// ── Tab: Contrats CPO ─────────────────────────────────────────

function ContractsTab({ networkId, onSelectContract }: { networkId: string; onSelectContract: (c: CpoContract) => void }) {
  const [search, setSearch] = useState("");
  const [filterTab, setFilterTab] = useState<FilterTab>("all");

  const { data: contracts, isLoading, isError: _isErrorContracts } = useQuery<CpoContract[]>({
    queryKey: ["cpo-contracts-for-network", networkId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cpo_contracts")
        .select("*")
        .eq("network_id", networkId)
        .order("name");
      if (error) return [];
      return (data ?? []) as CpoContract[];
    },
  });

  const filtered = useMemo(() => {
    let list = contracts ?? [];
    if (filterTab !== "all") list = list.filter((c) => c.type === filterTab);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((c) => c.name?.toLowerCase().includes(q) || c.contract_code?.toLowerCase().includes(q));
    }
    return list;
  }, [contracts, filterTab, search]);

  const tabCounts = useMemo(() => {
    const list = contracts ?? [];
    return { all: list.length, internal: list.filter((c) => c.type === "internal").length, external: list.filter((c) => c.type === "external").length };
  }, [contracts]);

  const TABS: { key: FilterTab; label: string }[] = [
    { key: "all", label: "Tout" },
    { key: "internal", label: "Interne" },
    { key: "external", label: "Externe" },
  ];

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileSignature className="w-4 h-4 text-foreground-muted" />
          <h3 className="text-sm font-semibold text-foreground">Contrats CPO ({tabCounts.all})</h3>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 bg-surface border border-border rounded-xl p-1 w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilterTab(tab.key)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              filterTab === tab.key ? "bg-primary/15 text-primary" : "text-foreground-muted hover:text-foreground hover:bg-surface-elevated"
            )}
          >
            {tab.label} <span className="opacity-60">{tabCounts[tab.key]}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
        <input
          type="text"
          placeholder="Rechercher..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-border-focus"
        />
      </div>

      {isLoading ? (
        <TableSkeleton rows={3} cols={7} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={FileSignature} message="Aucun contrat CPO lie a ce reseau" />
      ) : (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-border">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Nom</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Code pays</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Identifiant de groupe</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Code contrat</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Devise</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">URL du site internet</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Derniere mise a jour</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Mis a jour par</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((c) => (
                  <tr key={c.id} onClick={() => onSelectContract(c)} className="hover:bg-surface-elevated/50 transition-colors cursor-pointer">
                    <td className="px-4 py-3"><TypeBadge type={c.type} /></td>
                    <td className="px-4 py-3 text-sm font-medium text-foreground hover:text-primary transition-colors">{c.name}</td>
                    <td className="px-4 py-3 text-sm text-foreground">{c.country_code}</td>
                    <td className="px-4 py-3 text-sm text-foreground-muted">{c.party_id ?? "\u2014"}</td>
                    <td className="px-4 py-3 text-sm text-foreground-muted">{c.contract_code ?? "\u2014"}</td>
                    <td className="px-4 py-3 text-sm text-foreground">{c.currency}</td>
                    <td className="px-4 py-3">
                      {c.url ? (
                        <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline inline-flex items-center gap-1">
                          {c.url} <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-sm text-foreground-muted">\u2014</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground-muted whitespace-nowrap">{formatDateFull(c.updated_at)}</td>
                    <td className="px-4 py-3 text-sm text-foreground-muted">{c.updated_by ?? "\u2014"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: CPO ──────────────────────────────────────────────────

function CposTab({ networkId }: { networkId: string }) {
  const [search, setSearch] = useState("");

  // Show CPO operators that have contracts linked to this network
  const { data: contracts, isError: _isErrorContractsCpo } = useQuery<(CpoContract & { cpo_operator?: CpoOperator })[]>({
    queryKey: ["cpo-contracts-for-cpo-tab", networkId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cpo_contracts")
        .select("*")
        .eq("network_id", networkId)
        .order("name");
      if (error) return [];
      return (data ?? []) as CpoContract[];
    },
  });

  // Also fetch all CPO operators to cross-reference
  const { data: cpoOperators, isLoading, isError: _isErrorCpoOperators } = useQuery<CpoOperator[]>({
    queryKey: ["cpo-operators-for-network"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cpo_operators")
        .select("id, name, code, color")
        .order("name");
      if (error) return [];
      return (data ?? []) as CpoOperator[];
    },
  });

  // Filter operators: only show those referenced by contracts in this network
  const networkOperators = useMemo(() => {
    const ops = cpoOperators ?? [];
    const networkContracts = contracts ?? [];
    if (networkContracts.length === 0) return [];
    // Keep operators whose name or code appears in any contract name for this network
    return ops.filter((op) =>
      networkContracts.some((c) =>
        c.name.toLowerCase().includes(op.name.toLowerCase()) ||
        c.name.toLowerCase().includes(op.code.toLowerCase())
      )
    );
  }, [cpoOperators, contracts]);

  const filtered = useMemo(() => {
    let list = networkOperators;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
    }
    return list;
  }, [networkOperators, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-foreground-muted" />
          <h3 className="text-sm font-semibold text-foreground">CPO ({filtered.length})</h3>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
        <input
          type="text"
          placeholder="Rechercher..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-border-focus"
        />
      </div>

      {isLoading ? (
        <TableSkeleton rows={4} cols={4} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Building2} message="Aucun CPO" />
      ) : (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-border">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Nom</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Identifiant externe</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Contrat CPO</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Afficher nom OCPI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((cpo) => {
                  const linkedContract = (contracts ?? []).find((c) =>
                    c.name.toLowerCase().includes(cpo.name.toLowerCase()) ||
                    c.name.toLowerCase().includes(cpo.code.toLowerCase())
                  );
                  return (
                    <tr key={cpo.id} className="hover:bg-surface-elevated/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {cpo.color && (
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cpo.color }} />
                          )}
                          <span className="text-sm font-medium text-foreground">{cpo.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground-muted font-mono">{cpo.code}</td>
                      <td className="px-4 py-3 text-sm text-foreground-muted">{linkedContract?.name ?? "\u2014"}</td>
                      <td className="px-4 py-3 text-sm text-foreground">{cpo.name}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: Accords ──────────────────────────────────────────────

function AgreementsTab({ networkId }: { networkId: string }) {
  const [search, setSearch] = useState("");
  const [filterTab, setFilterTab] = useState<"all" | "active" | "expired">("all");
  const [page, setPage] = useState(1);

  const { data: agreements, isLoading, isError: _isErrorAgreements } = useQuery<RoamingAgreement[]>({
    queryKey: ["agreements-for-network", networkId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("roaming_agreements")
        .select(`
          id, status, management, connection_method,
          valid_from, valid_to, professional_contact, professional_email,
          updated_by, updated_at,
          emsp_network:emsp_networks(name),
          emsp_contract:emsp_contracts(name),
          cpo_contract:cpo_contracts(name)
        `)
        .eq("cpo_network_id", networkId)
        .order("updated_at", { ascending: false });
      if (error) return [];
      return (data ?? []) as unknown as RoamingAgreement[];
    },
  });

  const filtered = useMemo(() => {
    let list = agreements ?? [];
    if (filterTab === "active") list = list.filter((a) => a.status === "active");
    else if (filterTab === "expired") list = list.filter((a) => a.status === "expired");
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((a) =>
        a.emsp_network?.name?.toLowerCase().includes(q) ||
        a.management?.toLowerCase().includes(q) ||
        a.connection_method?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [agreements, filterTab, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const tabCounts = useMemo(() => {
    const list = agreements ?? [];
    return {
      all: list.length,
      active: list.filter((a) => a.status === "active").length,
      expired: list.filter((a) => a.status === "expired").length,
    };
  }, [agreements]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Handshake className="w-4 h-4 text-foreground-muted" />
          <h3 className="text-sm font-semibold text-foreground">Accords ({tabCounts.all})</h3>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 bg-surface border border-border rounded-xl p-1 w-fit">
        {[
          { key: "all" as const, label: "Tout" },
          { key: "active" as const, label: "Valide" },
          { key: "expired" as const, label: "Expire" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setFilterTab(tab.key); setPage(1); }}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              filterTab === tab.key ? "bg-primary/15 text-primary" : "text-foreground-muted hover:text-foreground hover:bg-surface-elevated"
            )}
          >
            {tab.label} <span className="opacity-60">{tabCounts[tab.key]}</span>
          </button>
        ))}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
        <input
          type="text"
          placeholder="Rechercher..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="w-full pl-9 pr-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-border-focus"
        />
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} cols={7} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Handshake} message="Aucun accord de roaming lie a ce reseau" />
      ) : (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-border">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Validite</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Gestion des accords</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Reseau eMSP</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Contrat CPO</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Contrat eMSP</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Methode de connexion</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Valide a partir de</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Valable jusqu'au</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Pro. Contact</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paginated.map((a) => (
                  <tr key={a.id} className="hover:bg-surface-elevated/50 transition-colors">
                    <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                    <td className="px-4 py-3 text-sm text-foreground">{a.management ?? "\u2014"}</td>
                    <td className="px-4 py-3 text-sm text-foreground font-medium">{a.emsp_network?.name ?? "\u2014"}</td>
                    <td className="px-4 py-3 text-sm text-foreground-muted">{a.cpo_contract?.name ?? "\u2014"}</td>
                    <td className="px-4 py-3 text-sm text-foreground-muted">{a.emsp_contract?.name ?? "\u2014"}</td>
                    <td className="px-4 py-3 text-sm text-foreground-muted">{a.connection_method ?? "\u2014"}</td>
                    <td className="px-4 py-3 text-sm text-foreground-muted whitespace-nowrap">{formatDate(a.valid_from)}</td>
                    <td className="px-4 py-3 text-sm text-foreground-muted whitespace-nowrap">
                      {a.valid_to ? formatDate(a.valid_to) : "Indefinie"}
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground-muted">{a.professional_contact ?? "\u2014"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border">
              <span className="text-xs text-foreground-muted">
                {(safePage - 1) * PAGE_SIZE + 1}\u2013{Math.min(safePage * PAGE_SIZE, filtered.length)} sur {filtered.length}
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} className="p-1.5 rounded-lg text-foreground-muted hover:bg-surface-elevated disabled:opacity-30 transition-colors">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs text-foreground-muted px-2">{safePage} / {totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} className="p-1.5 rounded-lg text-foreground-muted hover:bg-surface-elevated disabled:opacity-30 transition-colors">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Tab: Regles de facturation en gros (GreenFlux-style) ──────

type BillingFilterTab = "all" | "network" | "contract" | "agreement";

function BillingTab({ networkId }: { networkId: string }) {
  const [filterTab, setFilterTab] = useState<BillingFilterTab>("all");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [openActions, setOpenActions] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { success: toastSuccess, error: toastError, info: toastInfo } = useToast();

  const { data: rules, isLoading, isError: _isErrorRules } = useQuery<ReimbursementRule[]>({
    queryKey: ["billing-rules-for-network", networkId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reimbursement_rules")
        .select(`
          id, status, tariff_code, country_code,
          cpo_name, cpo_entity, emsp_name, emsp_entity,
          retail_price, restrictions,
          price_per_kwh, price_per_min, start_fee, idle_fee_per_min,
          currency, valid_from, valid_to, remarks, updated_by, updated_at,
          cpo_network:cpo_networks(name),
          cpo_contract:cpo_contracts(name),
          emsp_network:emsp_networks(name),
          emsp_contract:emsp_contracts(name)
        `)
        .eq("cpo_network_id", networkId)
        .order("tariff_code", { ascending: true });
      if (error) return [];
      return (data ?? []) as unknown as ReimbursementRule[];
    },
  });

  // Expire mutation
  const expireMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("reimbursement_rules")
        .update({ status: "expired", valid_to: new Date().toISOString().split("T")[0] })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["billing-rules-for-network", networkId] });
      setOpenActions(null);
      toastSuccess("Regle expiree", "La regle a ete marquee comme expiree");
    },
    onError: (err: Error) => toastError("Erreur", err.message),
  });

  // Filter by tab
  const filtered = useMemo(() => {
    let list = rules ?? [];
    if (filterTab === "network") list = list.filter((r) => r.cpo_network?.name);
    else if (filterTab === "contract") list = list.filter((r) => r.cpo_contract?.name);
    else if (filterTab === "agreement") list = list.filter((r) => r.emsp_network?.name);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) =>
        r.cpo_name?.toLowerCase().includes(q) ||
        r.emsp_name?.toLowerCase().includes(q) ||
        r.tariff_code?.toLowerCase().includes(q) ||
        r.cpo_network?.name?.toLowerCase().includes(q) ||
        r.emsp_network?.name?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [rules, filterTab, search]);

  // Group by tariff_code
  const grouped = useMemo(() => {
    const map = new Map<string, ReimbursementRule[]>();
    for (const r of filtered) {
      const key = r.tariff_code ?? r.id;
      const arr = map.get(key) ?? [];
      arr.push(r);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const toggleCollapse = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const thClass = "px-3 py-2.5 text-left text-[11px] font-semibold text-foreground-muted uppercase tracking-wider whitespace-nowrap";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Receipt className="w-4 h-4 text-foreground-muted" />
          <h3 className="text-sm font-semibold text-foreground">Regles de facturation</h3>
        </div>
        <span className="text-xs text-foreground-muted italic">
          Gerer les regles &rarr; page Roaming &amp; Contrats &gt; Remboursement
        </span>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 bg-surface border border-border rounded-xl p-1 w-fit">
        {[
          { key: "all" as BillingFilterTab, label: "Tout" },
          { key: "network" as BillingFilterTab, label: "Reseau" },
          { key: "contract" as BillingFilterTab, label: "Contrat" },
          { key: "agreement" as BillingFilterTab, label: "Accord" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilterTab(tab.key)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              filterTab === tab.key ? "bg-primary/15 text-primary" : "text-foreground-muted hover:text-foreground hover:bg-surface-elevated"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
        <input
          type="text"
          placeholder="Rechercher..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-border-focus"
        />
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} cols={10} />
      ) : grouped.length === 0 ? (
        <EmptyState icon={Receipt} message="Aucune regle de facturation en gros" />
      ) : (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          {/* Table header */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-border">
                <tr>
                  <th className={thClass}>Reseau CPO</th>
                  <th className={thClass}>Contrat CPO</th>
                  <th className={thClass}>Pays</th>
                  <th className={thClass}>CPO</th>
                  <th className={thClass}>Reseau eMSP</th>
                  <th className={thClass}>Contrat eMSP</th>
                  <th className={thClass}>eMSP</th>
                  <th className={thClass}>Forfait de vente au detail</th>
                  <th className={thClass}>Restrictions</th>
                  <th className={thClass}>Date debut</th>
                  <th className={cn(thClass, "text-right w-20")} />
                </tr>
              </thead>
              <tbody>
                {grouped.map(([tariffCode, groupRules]) => {
                  const isCollapsed = collapsed.has(tariffCode);
                  const currency = groupRules[0]?.currency ?? "EUR";
                  return (
                    <BillingGroup
                      key={tariffCode}
                      tariffCode={tariffCode}
                      currency={currency}
                      rules={groupRules}
                      isCollapsed={isCollapsed}
                      onToggle={() => toggleCollapse(tariffCode)}
                      openActions={openActions}
                      onOpenActions={setOpenActions}
                      onExpire={(id) => expireMutation.mutate(id)}
                      onToastInfo={toastInfo}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Billing Group (collapsible tariff code section) ───────────

function BillingGroup({
  tariffCode,
  currency,
  rules,
  isCollapsed,
  onToggle,
  openActions,
  onOpenActions,
  onExpire,
  onToastInfo,
}: {
  tariffCode: string;
  currency: string;
  rules: ReimbursementRule[];
  isCollapsed: boolean;
  onToggle: () => void;
  openActions: string | null;
  onOpenActions: (id: string | null) => void;
  onExpire: (id: string) => void;
  onToastInfo: (message: string, description?: string) => void;
}) {
  return (
    <>
      {/* Group header */}
      <tr
        className="bg-surface-elevated/50 border-t border-b border-border cursor-pointer hover:bg-surface-elevated/80 transition-colors"
        onClick={onToggle}
      >
        <td colSpan={11} className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            <ChevronRight
              className={cn(
                "w-4 h-4 text-foreground-muted transition-transform",
                !isCollapsed && "rotate-90"
              )}
            />
            <span className="text-sm font-medium text-foreground">
              Code tarifaire: {tariffCode}
            </span>
            <span className="text-xs text-foreground-muted">({currency})</span>
          </div>
        </td>
      </tr>

      {/* Group rows */}
      {!isCollapsed && rules.map((r) => (
        <tr key={r.id} className="border-b border-border/50 hover:bg-surface-elevated/30 transition-colors">
          <td className="px-3 py-2.5 text-sm text-foreground">{r.cpo_network?.name ?? r.cpo_name ?? "Quelconque"}</td>
          <td className="px-3 py-2.5 text-sm text-foreground-muted">{r.cpo_contract?.name ?? "Quelconque"}</td>
          <td className="px-3 py-2.5 text-sm text-foreground-muted">{r.country_code ?? "Quelconque"}</td>
          <td className="px-3 py-2.5 text-sm text-foreground-muted">{r.cpo_entity ?? "Quelconque"}</td>
          <td className="px-3 py-2.5 text-sm text-foreground">{r.emsp_network?.name ?? r.emsp_name ?? "Quelconque"}</td>
          <td className="px-3 py-2.5 text-sm text-foreground-muted">{r.emsp_contract?.name ?? "Quelconque"}</td>
          <td className="px-3 py-2.5 text-sm text-foreground-muted">{r.emsp_entity ?? "Quelconque"}</td>
          <td className="px-3 py-2.5 text-sm text-foreground-muted">{r.retail_price ?? "Quelconque"}</td>
          <td className="px-3 py-2.5 text-sm text-foreground-muted">{r.restrictions ?? "Aucun"}</td>
          <td className="px-3 py-2.5 text-sm text-foreground-muted whitespace-nowrap">{formatDate(r.valid_from)}</td>
          <td className="px-3 py-2.5 text-right relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenActions(openActions === r.id ? null : r.id);
              }}
              className="px-3 py-1 text-xs font-medium text-primary bg-primary/10 border border-primary/25 rounded-lg hover:bg-primary/20 transition-colors"
            >
              actions
              <ChevronDown className="w-3 h-3 inline ml-1" />
            </button>

            {/* Actions dropdown */}
            {openActions === r.id && (
              <>
                {/* Backdrop to close */}
                <div className="fixed inset-0 z-40" onClick={() => onOpenActions(null)} />
                <div className="absolute right-0 top-full mt-1 z-50 w-80 bg-surface border border-border rounded-xl shadow-xl py-1 text-left">
                  <button
                    className="w-full px-4 py-2.5 text-sm text-foreground hover:bg-surface-elevated transition-colors text-left"
                    onClick={() => { onOpenActions(null); onToastInfo("Action disponible ailleurs", "Cette action est disponible depuis la page Roaming & Contrats > Remboursement"); }}
                  >
                    Programmer un changement de prix pour cette regle
                  </button>
                  <button
                    className="w-full px-4 py-2.5 text-sm text-foreground hover:bg-surface-elevated transition-colors text-left"
                    onClick={() => { onOpenActions(null); onToastInfo("Action disponible ailleurs", "Cette action est disponible depuis la page Roaming & Contrats > Remboursement"); }}
                  >
                    Ajouter une version specifique au contrat CPO / accord de cette regle
                  </button>
                  <button
                    className="w-full px-4 py-2.5 text-sm text-foreground hover:bg-surface-elevated transition-colors text-left"
                    onClick={() => { onOpenActions(null); onToastInfo("Action disponible ailleurs", "Cette action est disponible depuis la page Roaming & Contrats > Remboursement"); }}
                  >
                    Copier dans la nouvelle regle
                  </button>
                  <div className="border-t border-border my-1" />
                  <button
                    className="w-full px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors text-left"
                    onClick={() => { onExpire(r.id); }}
                  >
                    Expirer cette regle
                  </button>
                </div>
              </>
            )}
          </td>
        </tr>
      ))}
    </>
  );
}

// ── Empty State ───────────────────────────────────────────────

function EmptyState({ icon: Icon, message }: { icon: typeof Network; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-40 bg-surface border border-border rounded-2xl">
      <div className="w-12 h-12 rounded-xl bg-surface-elevated flex items-center justify-center mb-3">
        <Icon className="w-6 h-6 text-foreground-muted" />
      </div>
      <p className="text-sm text-foreground-muted">{message}</p>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// CONTRACT DETAIL VIEW (nested inside Network detail)
// ══════════════════════════════════════════════════════════════

type ContractDetailTab = "details" | "cpos" | "agreements" | "billing";

function ContractDetailView({
  contract,
  networkName,
  onBack,
}: {
  contract: CpoContract;
  networkName: string;
  onBack: () => void;
}) {
  const [activeTab, setActiveTab] = useState<ContractDetailTab>("details");
  const queryClient = useQueryClient();
  const { success: toastSuccess, error: toastError } = useToast();
  const [editModalOpen, setEditModalOpen] = useState(false);

  // Fetch networks for edit dropdown
  const { data: networks, isError: _isErrorNetworksSelect } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["cpo-networks-select"],
    queryFn: async () => {
      const { data, error } = await supabase.from("cpo_networks").select("id, name").order("name");
      if (error) return [];
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const [editForm, setEditForm] = useState({
    type: contract.type,
    name: contract.name,
    network_id: contract.network_id ?? "",
    country_code: contract.country_code,
    party_id: contract.party_id ?? "",
    contract_code: contract.contract_code ?? "",
    currency: contract.currency,
    url: contract.url ?? "",
  });

  const updateMutation = useMutation({
    mutationFn: async (data: typeof editForm) => {
      const { error } = await supabase.from("cpo_contracts").update({
        type: data.type, name: data.name.trim(),
        network_id: data.network_id || null,
        country_code: data.country_code.trim(),
        party_id: data.party_id.trim() || null,
        contract_code: data.contract_code.trim() || null,
        currency: data.currency.trim() || "EUR",
        url: data.url.trim() || null,
      }).eq("id", contract.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cpo-contracts-for-network"] });
      setEditModalOpen(false);
      toastSuccess("Contrat modifie", "Les modifications ont ete enregistrees");
    },
    onError: (err: Error) => toastError("Erreur", err.message),
  });

  const CONTRACT_TABS: { key: ContractDetailTab; label: string; icon: typeof FileSignature }[] = [
    { key: "details", label: "Details", icon: FileSignature },
    { key: "cpos", label: "CPO", icon: Building2 },
    { key: "agreements", label: "Accords", icon: Handshake },
    { key: "billing", label: "Regles de facturation en gros", icon: Receipt },
  ];

  return (
    <div className="space-y-6">
      {/* Header with breadcrumb */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2 rounded-xl border border-border hover:bg-surface-elevated transition-colors"
            title="Retour au reseau"
          >
            <ArrowLeft className="w-4 h-4 text-foreground-muted" />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <FileSignature className="w-5 h-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2 text-xs text-foreground-muted mb-0.5">
                <Network className="w-3 h-3" />
                <span>{networkName}</span>
                <ChevronRight className="w-3 h-3" />
                <span>Contrat</span>
              </div>
              <h1 className="font-heading text-xl font-bold text-foreground">{contract.name}</h1>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <TypeBadge type={contract.type} />
          <button
            onClick={() => setEditModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
            Editer
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {CONTRACT_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium transition-colors relative whitespace-nowrap",
              activeTab === tab.key
                ? "text-primary"
                : "text-foreground-muted hover:text-foreground"
            )}
          >
            {tab.label}
            {activeTab === tab.key && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "details" && <ContractDetailsSubTab contract={contract} networkName={networkName} />}
      {activeTab === "cpos" && <ContractCposSubTab contractId={contract.id} />}
      {activeTab === "agreements" && <ContractAgreementsSubTab contractId={contract.id} />}
      {activeTab === "billing" && <ContractBillingSubTab contractId={contract.id} />}

      {/* Edit SlideOver */}
      <SlideOver open={editModalOpen} onClose={() => setEditModalOpen(false)} title="Modifier le contrat">
        <form onSubmit={(e) => { e.preventDefault(); updateMutation.mutate(editForm); }} className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Type</label>
              <select
                value={editForm.type}
                onChange={(e) => setEditForm((f) => ({ ...f, type: e.target.value as CpoContract["type"] }))}
                className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary/50"
              >
                <option value="internal">Interne</option>
                <option value="external">Externe</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Nom</label>
              <input required value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary/50" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Reseau CPO</label>
            <select value={editForm.network_id} onChange={(e) => setEditForm((f) => ({ ...f, network_id: e.target.value }))}
              className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary/50">
              <option value="">-- Aucun --</option>
              {(networks ?? []).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Code Pays</label>
              <input required value={editForm.country_code} onChange={(e) => setEditForm((f) => ({ ...f, country_code: e.target.value }))} maxLength={2}
                className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary/50 uppercase" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-foreground-muted mb-1.5">ID Groupe</label>
              <input value={editForm.party_id} onChange={(e) => setEditForm((f) => ({ ...f, party_id: e.target.value }))}
                className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary/50" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Code Contrat</label>
              <input value={editForm.contract_code} onChange={(e) => setEditForm((f) => ({ ...f, contract_code: e.target.value }))}
                className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary/50" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Devise</label>
              <input value={editForm.currency} onChange={(e) => setEditForm((f) => ({ ...f, currency: e.target.value }))}
                className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary/50 uppercase" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-foreground-muted mb-1.5">URL</label>
            <input type="url" value={editForm.url} onChange={(e) => setEditForm((f) => ({ ...f, url: e.target.value }))}
              className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary/50" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setEditModalOpen(false)} className="px-4 py-2 text-sm text-foreground-muted hover:text-foreground border border-border rounded-xl transition-colors">Annuler</button>
            <button type="submit" disabled={updateMutation.isPending} className="px-5 py-2 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {updateMutation.isPending ? "..." : "Enregistrer"}
            </button>
          </div>
        </form>
      </SlideOver>
    </div>
  );
}

// ── Contract Sub-Tab: Details ─────────────────────────────────

function ContractDetailsSubTab({ contract, networkName }: { contract: CpoContract; networkName: string }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-surface border border-border rounded-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Details</h3>
          <TypeBadge type={contract.type} />
        </div>
        <div className="px-6 py-5 space-y-4">
          <ContractDetailRow label="Reseau CPO" value={networkName} isLink />
          <ContractDetailRow label="Code pays" value={contract.country_code} />
          <ContractDetailRow label="Identifiant de groupe" value={contract.party_id ?? "\u2014"} />
          <ContractDetailRow label="Devise" value={contract.currency} />
          <ContractDetailRow label="Identifiant externe" value={contract.id} />
          {contract.url ? (
            <div className="grid grid-cols-[200px_1fr] gap-4 items-start">
              <span className="text-sm font-medium text-foreground-muted">URL</span>
              <a href={contract.url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline inline-flex items-center gap-1">
                {contract.url} <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          ) : (
            <ContractDetailRow label="URL" value="\u2014" />
          )}
          <ContractDetailRow
            label="Derniere mise a jour"
            value={contract.updated_at ? `${formatDateFull(contract.updated_at)}${contract.updated_by ? ` (${contract.updated_by})` : ""}` : "\u2014"}
          />
        </div>
      </div>

      <div className="space-y-6">
        <div className="bg-surface border border-border rounded-2xl">
          <div className="px-6 py-4 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">Code contrat</h3>
          </div>
          <div className="px-6 py-5">
            {contract.contract_code ? (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <FileSignature className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-lg font-bold text-foreground font-mono">{contract.contract_code}</p>
                  <p className="text-xs text-foreground-muted">Code unique du contrat</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-foreground-muted">Aucun code contrat defini</p>
            )}
          </div>
        </div>

        <div className="bg-surface border border-border rounded-2xl">
          <div className="px-6 py-4 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">Remarques</h3>
          </div>
          <div className="px-6 py-5">
            <p className="text-sm text-foreground-muted">Aucune remarque</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ContractDetailRow({ label, value, isLink }: { label: string; value: string; isLink?: boolean }) {
  return (
    <div className="grid grid-cols-[200px_1fr] gap-4 items-start">
      <span className="text-sm font-medium text-foreground-muted">{label}</span>
      {isLink ? (
        <span className="text-sm text-primary">{value}</span>
      ) : (
        <span className="text-sm text-foreground">{value}</span>
      )}
    </div>
  );
}

// ── Contract Sub-Tab: CPOs ────────────────────────────────────

function ContractCposSubTab({ contractId }: { contractId: string }) {
  const [search, setSearch] = useState("");

  const { data: cpoOperators, isLoading, isError: _isErrorCpoOperatorsContract } = useQuery<CpoOperator[]>({
    queryKey: ["cpo-operators-for-contract", contractId],
    queryFn: async () => {
      const { data, error } = await supabase.from("cpo_operators").select("id, name, code, color").order("name");
      if (error) return [];
      return (data ?? []) as CpoOperator[];
    },
  });

  const filtered = useMemo(() => {
    let list = cpoOperators ?? [];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
    }
    return list;
  }, [cpoOperators, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Building2 className="w-4 h-4 text-foreground-muted" />
        <h3 className="text-sm font-semibold text-foreground">CPO ({filtered.length})</h3>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
        <input type="text" placeholder="Rechercher..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-border-focus" />
      </div>

      {isLoading ? (
        <TableSkeleton rows={4} cols={7} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Building2} message="Aucun CPO" />
      ) : (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-border">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Nom</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Identifiant externe</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Tariff Group</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">CRM Customer ID</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">N&#176; TVA</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Afficher nom OCPI</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">URL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((cpo) => (
                  <tr key={cpo.id} className="hover:bg-surface-elevated/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {cpo.color && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cpo.color }} />}
                        <span className="text-sm font-medium text-foreground">{cpo.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground-muted font-mono">{cpo.code}</td>
                    <td className="px-4 py-3 text-sm text-foreground-muted">{"\u2014"}</td>
                    <td className="px-4 py-3 text-sm text-foreground-muted">{"\u2014"}</td>
                    <td className="px-4 py-3 text-sm text-foreground-muted">{"\u2014"}</td>
                    <td className="px-4 py-3 text-sm text-foreground">{cpo.name}</td>
                    <td className="px-4 py-3 text-sm text-foreground-muted">{"\u2014"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Contract Sub-Tab: Accords ─────────────────────────────────

function ContractAgreementsSubTab({ contractId }: { contractId: string }) {
  const [search, setSearch] = useState("");
  const [filterTab, setFilterTab] = useState<"all" | "active" | "expired">("all");
  const [page, setPage] = useState(1);

  const { data: agreements, isLoading, isError: _isErrorAgreementsContract } = useQuery<RoamingAgreement[]>({
    queryKey: ["agreements-for-contract", contractId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("roaming_agreements")
        .select(`id, status, management, connection_method, valid_from, valid_to, professional_contact, professional_email, updated_by, updated_at,
          emsp_network:emsp_networks(name), emsp_contract:emsp_contracts(name), cpo_contract:cpo_contracts(name)`)
        .eq("cpo_contract_id", contractId)
        .order("updated_at", { ascending: false });
      if (error) return [];
      return (data ?? []) as unknown as RoamingAgreement[];
    },
  });

  const filtered = useMemo(() => {
    let list = agreements ?? [];
    if (filterTab === "active") list = list.filter((a) => a.status === "active");
    else if (filterTab === "expired") list = list.filter((a) => a.status === "expired");
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((a) =>
        a.emsp_network?.name?.toLowerCase().includes(q) || a.management?.toLowerCase().includes(q) || a.connection_method?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [agreements, filterTab, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const tabCounts = useMemo(() => {
    const list = agreements ?? [];
    return { all: list.length, active: list.filter((a) => a.status === "active").length, expired: list.filter((a) => a.status === "expired").length };
  }, [agreements]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Handshake className="w-4 h-4 text-foreground-muted" />
        <h3 className="text-sm font-semibold text-foreground">Accords ({tabCounts.all})</h3>
      </div>

      <div className="flex items-center gap-1 bg-surface border border-border rounded-xl p-1 w-fit">
        {([
          { key: "all" as const, label: "Tout" },
          { key: "active" as const, label: "Valide" },
          { key: "expired" as const, label: "Expire" },
        ]).map((tab) => (
          <button key={tab.key} onClick={() => { setFilterTab(tab.key); setPage(1); }}
            className={cn("px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              filterTab === tab.key ? "bg-primary/15 text-primary" : "text-foreground-muted hover:text-foreground hover:bg-surface-elevated")}>
            {tab.label} <span className="opacity-60">{tabCounts[tab.key]}</span>
          </button>
        ))}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
        <input type="text" placeholder="Rechercher..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="w-full pl-9 pr-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-border-focus" />
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} cols={9} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Handshake} message="Aucun accord lie a ce contrat" />
      ) : (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-border">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Validite</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Gestion</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Reseau eMSP</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Contrat eMSP</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Methode connexion</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Valide a partir de</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Valable jusqu'au</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Pro. Contact</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paginated.map((a) => (
                  <tr key={a.id} className="hover:bg-surface-elevated/50 transition-colors">
                    <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                    <td className="px-4 py-3 text-sm text-foreground">{a.management ?? "\u2014"}</td>
                    <td className="px-4 py-3 text-sm text-foreground font-medium">{a.emsp_network?.name ?? "\u2014"}</td>
                    <td className="px-4 py-3 text-sm text-foreground-muted">{a.emsp_contract?.name ?? "\u2014"}</td>
                    <td className="px-4 py-3 text-sm text-foreground-muted">{a.connection_method ?? "\u2014"}</td>
                    <td className="px-4 py-3 text-sm text-foreground-muted whitespace-nowrap">{formatDate(a.valid_from)}</td>
                    <td className="px-4 py-3 text-sm text-foreground-muted whitespace-nowrap">{a.valid_to ? formatDate(a.valid_to) : "Indefinie"}</td>
                    <td className="px-4 py-3 text-sm text-foreground-muted">{a.professional_contact ?? "\u2014"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border">
              <span className="text-xs text-foreground-muted">{(safePage - 1) * PAGE_SIZE + 1}&ndash;{Math.min(safePage * PAGE_SIZE, filtered.length)} sur {filtered.length}</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} className="p-1.5 rounded-lg text-foreground-muted hover:bg-surface-elevated disabled:opacity-30 transition-colors"><ChevronLeft className="w-4 h-4" /></button>
                <span className="text-xs text-foreground-muted px-2">{safePage} / {totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} className="p-1.5 rounded-lg text-foreground-muted hover:bg-surface-elevated disabled:opacity-30 transition-colors"><ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Contract Sub-Tab: Regles de facturation en gros ───────────

type ContractBillingFilter = "all" | "network" | "contract" | "agreement";

function ContractBillingSubTab({ contractId }: { contractId: string }) {
  const [filterTab, setFilterTab] = useState<ContractBillingFilter>("all");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [openActions, setOpenActions] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { success: toastSuccess, error: toastError, info: toastInfo } = useToast();

  const { data: rules, isLoading, isError: _isErrorRulesContract } = useQuery<ReimbursementRule[]>({
    queryKey: ["billing-rules-for-contract", contractId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reimbursement_rules")
        .select(`id, status, tariff_code, country_code, cpo_name, cpo_entity, emsp_name, emsp_entity,
          retail_price, restrictions, price_per_kwh, price_per_min, start_fee, idle_fee_per_min,
          currency, valid_from, valid_to, remarks, updated_by, updated_at,
          cpo_network:cpo_networks(name), cpo_contract:cpo_contracts(name),
          emsp_network:emsp_networks(name), emsp_contract:emsp_contracts(name)`)
        .eq("cpo_contract_id", contractId)
        .order("tariff_code", { ascending: true });
      if (error) return [];
      return (data ?? []) as unknown as ReimbursementRule[];
    },
  });

  const expireMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("reimbursement_rules")
        .update({ status: "expired", valid_to: new Date().toISOString().split("T")[0] }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["billing-rules-for-contract", contractId] });
      setOpenActions(null);
      toastSuccess("Regle expiree", "La regle a ete marquee comme expiree");
    },
    onError: (err: Error) => toastError("Erreur", err.message),
  });

  const filtered = useMemo(() => {
    let list = rules ?? [];
    if (filterTab === "network") list = list.filter((r) => r.cpo_network?.name);
    else if (filterTab === "contract") list = list.filter((r) => r.cpo_contract?.name);
    else if (filterTab === "agreement") list = list.filter((r) => r.emsp_network?.name);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) =>
        r.cpo_name?.toLowerCase().includes(q) || r.emsp_name?.toLowerCase().includes(q) ||
        r.tariff_code?.toLowerCase().includes(q) || r.cpo_network?.name?.toLowerCase().includes(q) || r.emsp_network?.name?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [rules, filterTab, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, ReimbursementRule[]>();
    for (const r of filtered) {
      const key = r.tariff_code ?? r.id;
      const arr = map.get(key) ?? [];
      arr.push(r);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const toggleCollapse = (key: string) => {
    setCollapsed((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  };

  const thClass = "px-3 py-2.5 text-left text-[11px] font-semibold text-foreground-muted uppercase tracking-wider whitespace-nowrap";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Receipt className="w-4 h-4 text-foreground-muted" />
          <h3 className="text-sm font-semibold text-foreground">Regles de facturation</h3>
        </div>
        <span className="text-xs text-foreground-muted italic">
          Gerer les regles &rarr; page Roaming &amp; Contrats &gt; Remboursement
        </span>
      </div>

      <div className="flex items-center gap-1 bg-surface border border-border rounded-xl p-1 w-fit">
        {([
          { key: "all" as ContractBillingFilter, label: "Tout" },
          { key: "network" as ContractBillingFilter, label: "Reseau" },
          { key: "contract" as ContractBillingFilter, label: "Contrat" },
          { key: "agreement" as ContractBillingFilter, label: "Accord" },
        ]).map((tab) => (
          <button key={tab.key} onClick={() => setFilterTab(tab.key)}
            className={cn("px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              filterTab === tab.key ? "bg-primary/15 text-primary" : "text-foreground-muted hover:text-foreground hover:bg-surface-elevated")}>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
        <input type="text" placeholder="Rechercher..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-border-focus" />
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} cols={10} />
      ) : grouped.length === 0 ? (
        <EmptyState icon={Receipt} message="Aucune regle de facturation" />
      ) : (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-border">
                <tr>
                  <th className={thClass}>Reseau CPO</th>
                  <th className={thClass}>Contrat CPO</th>
                  <th className={thClass}>Pays</th>
                  <th className={thClass}>CPO</th>
                  <th className={thClass}>Reseau eMSP</th>
                  <th className={thClass}>Contrat eMSP</th>
                  <th className={thClass}>eMSP</th>
                  <th className={thClass}>Forfait vente detail</th>
                  <th className={thClass}>Restrictions</th>
                  <th className={thClass}>Date debut</th>
                  <th className={cn(thClass, "text-right w-20")} />
                </tr>
              </thead>
              <tbody>
                {grouped.map(([tariffCode, groupRules]) => {
                  const isCollapsed = collapsed.has(tariffCode);
                  const currency = groupRules[0]?.currency ?? "EUR";
                  return (
                    <BillingGroup
                      key={tariffCode}
                      tariffCode={tariffCode}
                      currency={currency}
                      rules={groupRules}
                      isCollapsed={isCollapsed}
                      onToggle={() => toggleCollapse(tariffCode)}
                      openActions={openActions}
                      onOpenActions={setOpenActions}
                      onExpire={(id) => expireMutation.mutate(id)}
                      onToastInfo={toastInfo}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
