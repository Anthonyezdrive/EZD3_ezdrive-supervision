// ============================================================
// EZDrive — Reimbursement Rules Page (GFX-style)
// Grouped by CPO network, with detail modal + add/edit modal
// ============================================================

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  X,
  AlertCircle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/contexts/ToastContext";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

// ── Types ─────────────────────────────────────────────────────

interface ReimbursementRule {
  id: string;
  status: "active" | "expired" | "planned";
  cpo_network_id: string | null;
  cpo_contract_id: string | null;
  cpo_name: string | null;
  emsp_network_id: string | null;
  emsp_contract_id: string | null;
  emsp_name: string | null;
  agreement_id: string | null;
  valid_from: string | null;
  valid_to: string | null;
  price_per_kwh: number;
  price_per_min: number;
  start_fee: number;
  idle_fee_per_min: number;
  currency: string;
  remarks: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

interface NetworkRef { id: string; name: string }
interface ContractRef { id: string; name: string }
interface AgreementRef { id: string; management: string | null; status: string }

const EMPTY_RULE = {
  status: "active" as ReimbursementRule["status"],
  cpo_network_id: "",
  cpo_contract_id: "",
  cpo_name: "",
  emsp_network_id: "",
  emsp_contract_id: "",
  emsp_name: "",
  agreement_id: "",
  valid_from: "",
  valid_to: "",
  price_per_kwh: 0,
  price_per_min: 0,
  start_fee: 0,
  idle_fee_per_min: 0,
  currency: "EUR",
  remarks: "",
  updated_by: "",
};

type FilterTab = "normal" | "cpo" | "accord";
const PAGE_SIZE = 25;

// ── Helpers ───────────────────────────────────────────────────

const formatDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "2-digit", year: "numeric" }) : "Indéfini";

function StatusDot({ status }: { status: string }) {
  const color = status === "active" ? "#3B82F6" : status === "expired" ? "#EF4444" : "#F59E0B";
  return <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ backgroundColor: color }} />;
}

function SourceBadge({ source }: { source: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-primary/15 text-primary border border-primary/25 uppercase">
      {source}
    </span>
  );
}

// ── Actions Dropdown ──────────────────────────────────────────

function ActionsDropdown({
  onDetail,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  onDetail: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        onClick={() => onEdit()}
        className="px-3 py-1 text-xs font-medium text-primary bg-primary/10 border border-primary/25 rounded-l-lg hover:bg-primary/20 transition-colors"
      >
        actions
      </button>
      <button
        onClick={() => setOpen(!open)}
        className="px-1.5 py-1 text-primary bg-primary/10 border border-l-0 border-primary/25 rounded-r-lg hover:bg-primary/20 transition-colors"
      >
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-surface border border-border rounded-lg shadow-xl z-30 min-w-[220px] py-1">
          <button onClick={() => { onDetail(); setOpen(false); }} className="w-full text-left px-4 py-2 text-sm text-foreground hover:bg-surface-elevated transition-colors">
            Détails
          </button>
          <button onClick={() => { onEdit(); setOpen(false); }} className="w-full text-left px-4 py-2 text-sm text-foreground hover:bg-surface-elevated transition-colors">
            Programmer Un Changement De Prix
          </button>
          <button onClick={() => { onDuplicate(); setOpen(false); }} className="w-full text-left px-4 py-2 text-sm text-foreground hover:bg-surface-elevated transition-colors">
            Copier Dans La Nouvelle Règle
          </button>
          <div className="border-t border-border my-1" />
          <button onClick={() => { onDelete(); setOpen(false); }} className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors">
            Supprimer
          </button>
        </div>
      )}
    </div>
  );
}

// ── Detail Modal ──────────────────────────────────────────────

function RuleDetailModal({
  rule,
  onClose,
  cpoNetworkMap,
  cpoContractMap,
  emspNetworkMap,
  emspContractMap,
}: {
  rule: ReimbursementRule;
  onClose: () => void;
  cpoNetworkMap: Map<string, string>;
  cpoContractMap: Map<string, string>;
  emspNetworkMap: Map<string, string>;
  emspContractMap: Map<string, string>;
}) {
  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <h2 className="text-lg font-semibold text-foreground">
              Détails de la règle de facturation
            </h2>
            <span className="px-3 py-1 text-xs font-semibold text-primary bg-primary/10 border border-primary/25 rounded">
              Network
            </span>
          </div>

          <div className="p-6">
            <div className="grid grid-cols-4 gap-6">
              {/* Col 1: Données de règle */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground">Données de règle</h3>
                <div>
                  <p className="text-xs text-foreground-muted">Identifiant de la règle</p>
                  <p className="text-sm text-foreground font-mono mt-0.5">{rule.id.slice(0, 20)}...</p>
                </div>
                <h3 className="text-sm font-semibold text-foreground pt-2">Période de validité</h3>
                <div>
                  <p className="text-xs text-foreground-muted">Date de début</p>
                  <p className="text-sm text-foreground mt-0.5">{formatDate(rule.valid_from)}</p>
                </div>
                <div>
                  <p className="text-xs text-foreground-muted">Date de fin</p>
                  <p className="text-sm text-foreground mt-0.5 italic">{formatDate(rule.valid_to)}</p>
                </div>
                <h3 className="text-sm font-semibold text-foreground pt-2">Frais</h3>
                <div>
                  <p className="text-xs text-foreground-muted">Frais d'opérateur</p>
                  <p className="text-sm text-foreground mt-0.5">{rule.start_fee.toFixed(2)} {rule.currency}</p>
                </div>
                <div>
                  <p className="text-xs text-foreground-muted">Frais de marge de l'opérateur (par min)</p>
                  <p className="text-sm text-foreground mt-0.5">{rule.idle_fee_per_min.toFixed(2)} {rule.currency}</p>
                </div>
              </div>

              {/* Col 2: CPO */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground">CPO</h3>
                <div>
                  <p className="text-xs text-foreground-muted">Réseau CPO</p>
                  <p className="text-sm text-foreground mt-0.5">{rule.cpo_network_id ? cpoNetworkMap.get(rule.cpo_network_id) ?? "—" : "Quelconque"}</p>
                </div>
                <div>
                  <p className="text-xs text-foreground-muted">Contrat CPO</p>
                  <p className="text-sm text-foreground mt-0.5">{rule.cpo_contract_id ? cpoContractMap.get(rule.cpo_contract_id) ?? "—" : "Quelconque"}</p>
                </div>
                <div>
                  <p className="text-xs text-foreground-muted">CPO</p>
                  <p className="text-sm text-foreground mt-0.5">{rule.cpo_name ?? "Quelconque"}</p>
                </div>
              </div>

              {/* Col 3: eMSP */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground">eMSP</h3>
                <div>
                  <p className="text-xs text-foreground-muted">Réseau eMSP</p>
                  <p className="text-sm text-foreground mt-0.5">{rule.emsp_network_id ? emspNetworkMap.get(rule.emsp_network_id) ?? "—" : "Quelconque"}</p>
                </div>
                <div>
                  <p className="text-xs text-foreground-muted">Contrat eMSP</p>
                  <p className="text-sm text-foreground mt-0.5">{rule.emsp_contract_id ? emspContractMap.get(rule.emsp_contract_id) ?? "—" : "Quelconque"}</p>
                </div>
                <div>
                  <p className="text-xs text-foreground-muted">eMSP</p>
                  <p className="text-sm text-foreground mt-0.5">{rule.emsp_name ?? "Quelconque"}</p>
                </div>
              </div>

              {/* Col 4: Pricing */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground">Prix de départ</h3>
                <p className="text-sm text-foreground">{rule.start_fee.toFixed(4)} {rule.currency}</p>

                <h3 className="text-sm font-semibold text-foreground pt-2">Prix/kWh</h3>
                <p className="text-sm text-foreground">{rule.price_per_kwh.toFixed(4)} {rule.currency} (constant)</p>

                <h3 className="text-sm font-semibold text-foreground pt-2">Prix/minute</h3>
                <p className="text-sm text-foreground">{rule.price_per_min.toFixed(4)} {rule.currency} (constant)</p>
              </div>
            </div>

            {/* Divers */}
            <div className="mt-6 pt-4 border-t border-border">
              <h3 className="text-sm font-semibold text-foreground mb-2">Divers</h3>
              <details className="group">
                <summary className="text-sm text-foreground-muted cursor-pointer hover:text-foreground transition-colors flex items-center gap-1">
                  <ChevronRight className="w-4 h-4 group-open:rotate-90 transition-transform" />
                  Remarques
                </summary>
                <p className="mt-2 text-sm text-foreground pl-5">{rule.remarks ?? "—"}</p>
              </details>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end px-6 py-4 border-t border-border">
            <button onClick={onClose} className="px-4 py-2 text-sm text-red-400 hover:text-red-300 transition-colors">
              Fermer
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────

export function ReimbursementPage() {
  const queryClient = useQueryClient();
  const { success: toastSuccess, error: toastError } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ReimbursementRule | null>(null);
  const [detailRule, setDetailRule] = useState<ReimbursementRule | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ReimbursementRule | null>(null);
  const [form, setForm] = useState(EMPTY_RULE);
  const [filterTab, setFilterTab] = useState<FilterTab>("normal");
  const [page, setPage] = useState(1);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // ── Related data ──
  const { data: cpoNetworks, isError: _isErrorCpoNetworks } = useQuery<NetworkRef[]>({
    queryKey: ["cpo-networks"], retry: false,
    queryFn: async () => { try { const { data, error } = await supabase.from("cpo_networks").select("id, name").order("name"); if (error) return []; return (data ?? []) as NetworkRef[]; } catch { return []; } },
  });
  const { data: cpoContracts, isError: _isErrorCpoContracts } = useQuery<ContractRef[]>({
    queryKey: ["cpo-contracts"], retry: false,
    queryFn: async () => { try { const { data, error } = await supabase.from("cpo_contracts").select("id, name").order("name"); if (error) return []; return (data ?? []) as ContractRef[]; } catch { return []; } },
  });
  const { data: emspNetworks, isError: _isErrorEmspNetworks } = useQuery<NetworkRef[]>({
    queryKey: ["emsp-networks"], retry: false,
    queryFn: async () => { try { const { data, error } = await supabase.from("emsp_networks").select("id, name").order("name"); if (error) return []; return (data ?? []) as NetworkRef[]; } catch { return []; } },
  });
  const { data: emspContracts, isError: _isErrorEmspContracts } = useQuery<ContractRef[]>({
    queryKey: ["emsp-contracts"], retry: false,
    queryFn: async () => { try { const { data, error } = await supabase.from("emsp_contracts").select("id, name").order("name"); if (error) return []; return (data ?? []) as ContractRef[]; } catch { return []; } },
  });
  const { data: agreementsList, isError: _isErrorAgreements } = useQuery<AgreementRef[]>({
    queryKey: ["roaming-agreements-ref"], retry: false,
    queryFn: async () => { try { const { data, error } = await supabase.from("roaming_agreements").select("id, management, status").order("created_at", { ascending: false }); if (error) return []; return (data ?? []) as AgreementRef[]; } catch { return []; } },
  });

  // Lookup maps
  const cpoNetworkMap = useMemo(() => { const m = new Map<string, string>(); (cpoNetworks ?? []).forEach((n) => m.set(n.id, n.name)); return m; }, [cpoNetworks]);
  const cpoContractMap = useMemo(() => { const m = new Map<string, string>(); (cpoContracts ?? []).forEach((c) => m.set(c.id, c.name)); return m; }, [cpoContracts]);
  const emspNetworkMap = useMemo(() => { const m = new Map<string, string>(); (emspNetworks ?? []).forEach((n) => m.set(n.id, n.name)); return m; }, [emspNetworks]);
  const emspContractMap = useMemo(() => { const m = new Map<string, string>(); (emspContracts ?? []).forEach((c) => m.set(c.id, c.name)); return m; }, [emspContracts]);

  // ── Data fetching ──
  const { data: rules, isLoading, isError, refetch, dataUpdatedAt } = useQuery<ReimbursementRule[]>({
    queryKey: ["reimbursement-rules"], retry: false,
    queryFn: async () => { try { const { data, error } = await supabase.from("reimbursement_rules").select("*").order("created_at", { ascending: false }); if (error) return []; return (data ?? []) as ReimbursementRule[]; } catch { return []; } },
  });

  // ── Mutations ──
  const createMutation = useMutation({
    mutationFn: async (data: typeof EMPTY_RULE) => {
      const { error } = await supabase.from("reimbursement_rules").insert({
        status: data.status, cpo_network_id: data.cpo_network_id || null, cpo_contract_id: data.cpo_contract_id || null, cpo_name: data.cpo_name || null,
        emsp_network_id: data.emsp_network_id || null, emsp_contract_id: data.emsp_contract_id || null, emsp_name: data.emsp_name || null,
        agreement_id: data.agreement_id || null, valid_from: data.valid_from || null, valid_to: data.valid_to || null,
        price_per_kwh: Number(data.price_per_kwh) || 0, price_per_min: Number(data.price_per_min) || 0,
        start_fee: Number(data.start_fee) || 0, idle_fee_per_min: Number(data.idle_fee_per_min) || 0,
        currency: data.currency || "EUR", remarks: data.remarks || null, updated_by: data.updated_by || null,
      });
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["reimbursement-rules"] }); closeModal(); toastSuccess("Règle créée", "La règle de facturation a été ajoutée"); },
    onError: (err: Error) => toastError("Erreur", err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Partial<typeof EMPTY_RULE>) => {
      const { error } = await supabase.from("reimbursement_rules").update({
        status: data.status, cpo_network_id: data.cpo_network_id || null, cpo_contract_id: data.cpo_contract_id || null, cpo_name: data.cpo_name || null,
        emsp_network_id: data.emsp_network_id || null, emsp_contract_id: data.emsp_contract_id || null, emsp_name: data.emsp_name || null,
        agreement_id: data.agreement_id || null, valid_from: data.valid_from || null, valid_to: data.valid_to || null,
        price_per_kwh: Number(data.price_per_kwh) || 0, price_per_min: Number(data.price_per_min) || 0,
        start_fee: Number(data.start_fee) || 0, idle_fee_per_min: Number(data.idle_fee_per_min) || 0,
        currency: data.currency || "EUR", remarks: data.remarks || null, updated_by: data.updated_by || null,
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["reimbursement-rules"] }); closeModal(); toastSuccess("Règle modifiée", "Les modifications ont été enregistrées"); },
    onError: (err: Error) => toastError("Erreur", err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("reimbursement_rules").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["reimbursement-rules"] }); setConfirmDelete(null); toastSuccess("Règle supprimée", "La règle a été supprimée"); },
    onError: (err: Error) => toastError("Erreur", err.message),
  });

  function openCreate() { setEditing(null); setForm(EMPTY_RULE); setModalOpen(true); }
  function openEdit(rule: ReimbursementRule) {
    setEditing(rule);
    setForm({
      status: rule.status, cpo_network_id: rule.cpo_network_id ?? "", cpo_contract_id: rule.cpo_contract_id ?? "", cpo_name: rule.cpo_name ?? "",
      emsp_network_id: rule.emsp_network_id ?? "", emsp_contract_id: rule.emsp_contract_id ?? "", emsp_name: rule.emsp_name ?? "",
      agreement_id: rule.agreement_id ?? "", valid_from: rule.valid_from ? rule.valid_from.slice(0, 10) : "", valid_to: rule.valid_to ? rule.valid_to.slice(0, 10) : "",
      price_per_kwh: rule.price_per_kwh, price_per_min: rule.price_per_min, start_fee: rule.start_fee, idle_fee_per_min: rule.idle_fee_per_min,
      currency: rule.currency, remarks: rule.remarks ?? "", updated_by: rule.updated_by ?? "",
    });
    setModalOpen(true);
  }
  function duplicateRule(rule: ReimbursementRule) {
    setEditing(null);
    setForm({
      status: "active", cpo_network_id: rule.cpo_network_id ?? "", cpo_contract_id: rule.cpo_contract_id ?? "", cpo_name: rule.cpo_name ?? "",
      emsp_network_id: rule.emsp_network_id ?? "", emsp_contract_id: rule.emsp_contract_id ?? "", emsp_name: rule.emsp_name ?? "",
      agreement_id: rule.agreement_id ?? "", valid_from: "", valid_to: "",
      price_per_kwh: rule.price_per_kwh, price_per_min: rule.price_per_min, start_fee: rule.start_fee, idle_fee_per_min: rule.idle_fee_per_min,
      currency: rule.currency, remarks: rule.remarks ?? "", updated_by: "",
    });
    setModalOpen(true);
  }
  function closeModal() { setModalOpen(false); setEditing(null); setForm(EMPTY_RULE); }
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editing) { updateMutation.mutate({ id: editing.id, ...form }); }
    else { createMutation.mutate(form); }
  }

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // ── Filtered list (all rules) ──
  const filtered = useMemo(() => rules ?? [], [rules]);

  const totalRules = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalRules / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  // ── Paginate BEFORE grouping ──
  const paginatedRules = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

  // ── Grouped data (from paginated subset) ──
  const groupedRules = useMemo(() => {
    const groups = new Map<string, ReimbursementRule[]>();

    paginatedRules.forEach((r) => {
      let groupKey: string;
      if (filterTab === "cpo") {
        groupKey = r.cpo_network_id ? (cpoNetworkMap.get(r.cpo_network_id) ?? "CPO inconnu") : "Sans CPO";
      } else if (filterTab === "accord") {
        groupKey = r.agreement_id ? `Accord ${r.agreement_id.slice(0, 8)}` : "Sans accord";
      } else {
        // Group by a composite key
        const cpoNet = r.cpo_network_id ? (cpoNetworkMap.get(r.cpo_network_id) ?? "?") : "—";
        groupKey = `${r.id.slice(0, 8).toUpperCase()} (${cpoNet})`;
      }
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey)!.push(r);
    });

    return groups;
  }, [paginatedRules, filterTab, cpoNetworkMap]);

  const thClass = "px-3 py-2 text-left text-[11px] font-semibold text-foreground-muted uppercase tracking-wider whitespace-nowrap";

  const selClass = "w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm focus:outline-none focus:border-primary/50";
  const inpClass = "w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-xl font-bold text-foreground">
          Règles de facturation de remboursement ({totalRules})
        </h1>
        {/* Add new split button */}
        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary/90 transition-colors">
          <Plus className="w-4 h-4" />
          Ajouter Nouveau
        </button>
      </div>

      {/* Error banner */}
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
      <div className="flex gap-1 border-b border-border">
        {([
          { key: "normal" as FilterTab, label: "Normal" },
          { key: "cpo" as FilterTab, label: "CPO" },
          { key: "accord" as FilterTab, label: "Accord" },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setFilterTab(tab.key); setPage(1); }}
            className={cn(
              "px-4 py-2.5 text-sm font-medium transition-colors relative",
              filterTab === tab.key ? "text-primary" : "text-foreground-muted hover:text-foreground"
            )}
          >
            {tab.label}
            {filterTab === tab.key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />}
          </button>
        ))}
      </div>

      {/* Table with grouped rules */}
      {isLoading ? (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden divide-y divide-border">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="px-4 py-3.5 flex items-center gap-6">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      ) : totalRules === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 bg-surface border border-border rounded-2xl">
          <p className="text-foreground font-medium">Aucune règle</p>
          <p className="text-sm text-foreground-muted mt-1">Créez votre première règle de facturation.</p>
          <button onClick={openCreate} className="mt-3 flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary/90 transition-colors">
            <Plus className="w-4 h-4" /> Ajouter
          </button>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          {/* Column headers */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className={thClass}>Réseau CPO</th>
                  <th className={thClass}>Contrat CPO</th>
                  <th className={thClass}>CPO</th>
                  <th className={thClass}>Réseau eMSP</th>
                  <th className={thClass}>Contrat eMSP</th>
                  <th className={thClass}>eMSP</th>
                  <th className={thClass}>Date de début</th>
                  <th className={thClass}>Date de fin</th>
                  <th className={cn(thClass, "text-right")}>Prix de départ</th>
                  <th className={cn(thClass, "text-right")}>Prix/kWh</th>
                  <th className={cn(thClass, "text-right")}>Prix/minute</th>
                  <th className={thClass}>Source</th>
                  <th className={thClass}>Remarques</th>
                  <th className={cn(thClass, "w-28")}></th>
                </tr>
              </thead>
            </table>
          </div>

          {/* Grouped content */}
          {Array.from(groupedRules.entries()).map(([groupName, groupRules]) => {
            const isCollapsed = collapsedGroups.has(groupName);
            // Build group subtitle
            const firstRule = groupRules[0];
            const cpoNet = firstRule.cpo_network_id ? cpoNetworkMap.get(firstRule.cpo_network_id) : null;
            const cpoContr = firstRule.cpo_contract_id ? cpoContractMap.get(firstRule.cpo_contract_id) : null;
            const emspNet = firstRule.emsp_network_id ? emspNetworkMap.get(firstRule.emsp_network_id) : null;
            const emspContr = firstRule.emsp_contract_id ? emspContractMap.get(firstRule.emsp_contract_id) : null;

            return (
              <div key={groupName}>
                {/* Group header */}
                <button
                  onClick={() => toggleGroup(groupName)}
                  className="w-full flex items-center gap-2 px-4 py-3 bg-surface-elevated/50 border-b border-border text-left hover:bg-surface-elevated transition-colors"
                >
                  {isCollapsed ? <ChevronRight className="w-4 h-4 text-foreground-muted shrink-0" /> : <ChevronDown className="w-4 h-4 text-foreground-muted shrink-0" />}
                  <span className="text-sm font-semibold text-foreground">
                    Code Tarifaire: {groupName} ({groupRules.length})
                  </span>
                </button>

                {!isCollapsed && (
                  <>
                    {/* Sub-header with network info */}
                    <button
                      onClick={() => toggleGroup(groupName + "-sub")}
                      className="w-full flex items-center gap-2 px-8 py-2 bg-surface-elevated/30 border-b border-border text-left"
                    >
                      {collapsedGroups.has(groupName + "-sub") ? <ChevronRight className="w-3 h-3 text-foreground-muted shrink-0" /> : <ChevronDown className="w-3 h-3 text-foreground-muted shrink-0" />}
                      <span className="text-xs text-foreground-muted">
                        <span className="font-semibold">RÉSEAU CPO:</span> {cpoNet ?? "—"},
                        <span className="font-semibold ml-2">CONTRAT CPO:</span> {cpoContr ?? "Quelconque"},
                        <span className="font-semibold ml-2">CPO:</span> {firstRule.cpo_name ?? "—"},
                        <span className="font-semibold ml-2">RÉSEAU EMSP:</span> {emspNet ?? "Quelconque"},
                        <span className="font-semibold ml-2">CONTRAT EMSP:</span> {emspContr ?? "Quelconque"},
                        <span className="font-semibold ml-2">EMSP:</span> {firstRule.emsp_name ?? "Quelconque"}
                      </span>
                    </button>

                    {/* Rule rows */}
                    {!collapsedGroups.has(groupName + "-sub") && (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <tbody className="divide-y divide-border">
                          {groupRules.map((rule) => {
                            const rowBg = rule.status === "active"
                              ? "bg-blue-500/[0.03]"
                              : rule.status === "expired"
                                ? "bg-red-500/[0.03]"
                                : "bg-amber-500/[0.03]";

                            return (
                              <tr key={rule.id} className={cn("transition-colors hover:bg-surface-elevated/50", rowBg)}>
                                <td className="px-3 py-2.5 text-sm text-foreground-muted truncate max-w-[120px]">
                                  {rule.cpo_network_id ? (cpoNetworkMap.get(rule.cpo_network_id) ?? "—").slice(0, 14) + "..." : "—"}
                                </td>
                                <td className="px-3 py-2.5 text-sm text-foreground-muted">
                                  {rule.cpo_contract_id ? cpoContractMap.get(rule.cpo_contract_id) ?? "Quelconque" : "Quelconque"}
                                </td>
                                <td className="px-3 py-2.5 text-sm text-foreground-muted">
                                  {rule.cpo_name ?? "Quelconque"}
                                </td>
                                <td className="px-3 py-2.5 text-sm text-foreground-muted">
                                  {rule.emsp_network_id ? emspNetworkMap.get(rule.emsp_network_id) ?? "Quelconque" : "Quelconque"}
                                </td>
                                <td className="px-3 py-2.5 text-sm text-foreground-muted">
                                  {rule.emsp_contract_id ? emspContractMap.get(rule.emsp_contract_id) ?? "Quelconque" : "Quelconque"}
                                </td>
                                <td className="px-3 py-2.5 text-sm text-foreground-muted">
                                  {rule.emsp_name ?? "Quelconque"}
                                </td>
                                <td className="px-3 py-2.5 text-sm text-foreground-muted whitespace-nowrap">
                                  {formatDate(rule.valid_from)}
                                </td>
                                <td className="px-3 py-2.5 text-sm text-foreground-muted whitespace-nowrap">
                                  {formatDate(rule.valid_to)}
                                </td>
                                <td className="px-3 py-2.5 text-sm text-foreground tabular-nums text-right font-medium">
                                  {rule.start_fee.toFixed(1)}
                                </td>
                                <td className="px-3 py-2.5 text-sm text-foreground tabular-nums text-right font-medium">
                                  {rule.price_per_kwh.toFixed(2)}
                                </td>
                                <td className="px-3 py-2.5 text-sm text-foreground tabular-nums text-right font-medium">
                                  {rule.price_per_min.toFixed(1)}
                                </td>
                                <td className="px-3 py-2.5">
                                  <SourceBadge source={rule.agreement_id ? "Accord" : rule.emsp_network_id || rule.emsp_name ? "eMSP" : "CPO"} />
                                </td>
                                <td className="px-3 py-2.5 text-sm text-foreground-muted truncate max-w-[100px]">
                                  {rule.remarks ?? "—"}
                                </td>
                                <td className="px-3 py-2.5 text-right">
                                  <ActionsDropdown
                                    onDetail={() => setDetailRule(rule)}
                                    onEdit={() => openEdit(rule)}
                                    onDuplicate={() => duplicateRule(rule)}
                                    onDelete={() => setConfirmDelete(rule)}
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    )}
                  </>
                )}
              </div>
            );
          })}

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <div className="flex items-center gap-3 text-xs text-foreground-muted">
              <span>récupéré le {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</span>
              <span className="flex items-center gap-4 ml-4">
                <span className="flex items-center gap-1"><StatusDot status="expired" /> expiré</span>
                <span className="flex items-center gap-1"><StatusDot status="active" /> actif</span>
                <span className="flex items-center gap-1"><StatusDot status="planned" /> planifié</span>
              </span>
            </div>
            <div className="flex items-center gap-4">
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground disabled:opacity-30 transition-colors">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs text-foreground-muted px-2">{safePage} / {totalPages}</span>
                  <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground disabled:opacity-30 transition-colors">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
              <span className="text-xs text-foreground-muted">
                montrer {Math.min(safePage * PAGE_SIZE, totalRules)} of {totalRules} enregistrements
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Detail Modal ── */}
      {detailRule && (
        <RuleDetailModal
          rule={detailRule}
          onClose={() => setDetailRule(null)}
          cpoNetworkMap={cpoNetworkMap}
          cpoContractMap={cpoContractMap}
          emspNetworkMap={emspNetworkMap}
          emspContractMap={emspContractMap}
        />
      )}

      {/* ── Create / Edit Modal ── */}
      {modalOpen && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40" onClick={closeModal} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-y-auto">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <h2 className="text-lg font-semibold text-foreground">
                  {editing ? "Modifier la règle de facturation" : "Ajouter une règle de facturation"}
                </h2>
                <div className="flex items-center gap-3">
                  <span className="px-3 py-1 text-xs font-semibold text-primary bg-primary/10 border border-primary/25 rounded">
                    Réseau
                  </span>
                  <button onClick={closeModal} className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="p-6">
                <div className="grid grid-cols-4 gap-6">
                  {/* Col 1: Données */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-foreground">Données de règle</h3>
                    <div>
                      <label className="block text-xs text-foreground-muted mb-1">Accord de roaming</label>
                      <select value={form.agreement_id} onChange={(e) => setForm((f) => ({ ...f, agreement_id: e.target.value }))} className={selClass}>
                        <option value="">Sélectionnez un accord...</option>
                        {(agreementsList ?? []).map((a) => <option key={a.id} value={a.id}>{a.management ?? a.id.slice(0, 8)} ({a.status})</option>)}
                      </select>
                    </div>
                    <h3 className="text-sm font-semibold text-foreground pt-2">Période de validité</h3>
                    <div>
                      <label className="block text-xs text-foreground-muted mb-1">Date de début <span className="text-red-400">*</span></label>
                      <input type="date" value={form.valid_from} onChange={(e) => setForm((f) => ({ ...f, valid_from: e.target.value }))} className={inpClass} />
                    </div>
                    <div>
                      <label className="block text-xs text-foreground-muted mb-1">Date de fin</label>
                      <input type="date" value={form.valid_to} onChange={(e) => setForm((f) => ({ ...f, valid_to: e.target.value }))} className={inpClass} />
                    </div>
                    <h3 className="text-sm font-semibold text-foreground pt-2">Frais</h3>
                    <div>
                      <label className="block text-xs text-foreground-muted mb-1">Frais d'opérateur <span className="text-red-400">*</span></label>
                      <div className="flex items-center gap-1">
                        <input type="number" step="0.01" min="0" value={form.start_fee} onChange={(e) => setForm((f) => ({ ...f, start_fee: Number(e.target.value) }))} className={cn(inpClass, "tabular-nums flex-1")} />
                        <span className="text-xs text-primary font-semibold shrink-0">{form.currency}</span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-foreground-muted mb-1">Frais de marge de l'opérateur (par kWh) <span className="text-red-400">*</span></label>
                      <div className="flex items-center gap-1">
                        <input type="number" step="0.01" min="0" value={form.idle_fee_per_min} onChange={(e) => setForm((f) => ({ ...f, idle_fee_per_min: Number(e.target.value) }))} className={cn(inpClass, "tabular-nums flex-1")} />
                        <span className="text-xs text-primary font-semibold shrink-0">{form.currency}</span>
                      </div>
                    </div>
                  </div>

                  {/* Col 2: CPO */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-foreground">CPO</h3>
                    <div>
                      <label className="block text-xs text-foreground-muted mb-1">Réseau CPO</label>
                      <select value={form.cpo_network_id} onChange={(e) => setForm((f) => ({ ...f, cpo_network_id: e.target.value }))} className={selClass}>
                        <option value="">Quelconque</option>
                        {(cpoNetworks ?? []).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-foreground-muted mb-1">Contrat CPO</label>
                      <select value={form.cpo_contract_id} onChange={(e) => setForm((f) => ({ ...f, cpo_contract_id: e.target.value }))} className={selClass}>
                        <option value="">Quelconque</option>
                        {(cpoContracts ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-foreground-muted mb-1">CPO</label>
                      <select value={form.cpo_name} onChange={(e) => setForm((f) => ({ ...f, cpo_name: e.target.value }))} className={selClass}>
                        <option value="">Quelconque</option>
                        {(cpoNetworks ?? []).map((n) => <option key={n.id} value={n.name}>{n.name}</option>)}
                        {(cpoContracts ?? []).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Col 3: eMSP */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-foreground">eMSP</h3>
                    <div>
                      <label className="block text-xs text-foreground-muted mb-1">Réseau eMSP</label>
                      <select value={form.emsp_network_id} onChange={(e) => setForm((f) => ({ ...f, emsp_network_id: e.target.value }))} className={selClass}>
                        <option value="">Quelconque</option>
                        {(emspNetworks ?? []).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-foreground-muted mb-1">Contrat eMSP</label>
                      <select value={form.emsp_contract_id} onChange={(e) => setForm((f) => ({ ...f, emsp_contract_id: e.target.value }))} className={selClass}>
                        <option value="">Quelconque</option>
                        {(emspContracts ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-foreground-muted mb-1">eMSP</label>
                      <select value={form.emsp_name} onChange={(e) => setForm((f) => ({ ...f, emsp_name: e.target.value }))} className={selClass}>
                        <option value="">Quelconque</option>
                        {(emspNetworks ?? []).map((n) => <option key={n.id} value={n.name}>{n.name}</option>)}
                        {(emspContracts ?? []).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Col 4: Pricing */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-foreground">Prix de départ</h3>
                    <div className="flex items-center gap-1">
                      <input type="number" step="0.0001" min="0" value={form.start_fee} onChange={(e) => setForm((f) => ({ ...f, start_fee: Number(e.target.value) }))} className={cn(inpClass, "tabular-nums flex-1")} />
                      <span className="text-xs text-primary font-semibold">{form.currency}</span>
                    </div>

                    <h3 className="text-sm font-semibold text-foreground pt-2">Prix/kWh</h3>
                    <div className="flex items-center gap-3 mb-1">
                      <label className="flex items-center gap-1 text-xs text-foreground-muted">
                        <input type="radio" checked readOnly className="accent-primary" /> Constant
                      </label>
                      <label className="flex items-center gap-1 text-xs text-foreground-muted">
                        <input type="radio" disabled className="accent-primary" /> Variable
                      </label>
                    </div>
                    <div className="flex items-center gap-1">
                      <input type="number" step="0.0001" min="0" value={form.price_per_kwh} onChange={(e) => setForm((f) => ({ ...f, price_per_kwh: Number(e.target.value) }))} className={cn(inpClass, "tabular-nums flex-1")} />
                      <span className="text-xs text-primary font-semibold">{form.currency}</span>
                    </div>

                    <h3 className="text-sm font-semibold text-foreground pt-2">Prix/minute</h3>
                    <div className="flex items-center gap-3 mb-1">
                      <label className="flex items-center gap-1 text-xs text-foreground-muted">
                        <input type="radio" checked readOnly className="accent-primary" /> Constant
                      </label>
                      <label className="flex items-center gap-1 text-xs text-foreground-muted">
                        <input type="radio" disabled className="accent-primary" /> Variable
                      </label>
                    </div>
                    <div className="flex items-center gap-1">
                      <input type="number" step="0.0001" min="0" value={form.price_per_min} onChange={(e) => setForm((f) => ({ ...f, price_per_min: Number(e.target.value) }))} className={cn(inpClass, "tabular-nums flex-1")} />
                      <span className="text-xs text-primary font-semibold">{form.currency}</span>
                    </div>
                  </div>
                </div>

                {/* Divers */}
                <div className="mt-6 pt-4 border-t border-border">
                  <h3 className="text-sm font-semibold text-foreground mb-3">Divers</h3>
                  <details className="group">
                    <summary className="text-sm text-foreground-muted cursor-pointer hover:text-foreground transition-colors flex items-center gap-1">
                      <ChevronRight className="w-4 h-4 group-open:rotate-90 transition-transform" />
                      Remarques
                    </summary>
                    <textarea value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} rows={2} placeholder="Notes..." className={cn(inpClass, "mt-2 ml-5 w-[calc(100%-1.25rem)] resize-none")} />
                  </details>
                </div>

                {/* Error */}
                {(createMutation.error || updateMutation.error) && (
                  <div className="mt-4 p-3 bg-red-500/10 border border-red-500/25 rounded-lg text-sm text-red-400">
                    {((createMutation.error || updateMutation.error) as Error)?.message}
                  </div>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
                  <p className="text-xs text-red-400">* cette information est requise</p>
                  <div className="flex gap-3">
                    <button type="button" onClick={closeModal} className="px-4 py-2 text-sm text-red-400 hover:text-red-300 transition-colors">
                      Annuler
                    </button>
                    <button type="submit" disabled={createMutation.isPending || updateMutation.isPending} className="px-5 py-2 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary/90 disabled:opacity-50 transition-colors">
                      {createMutation.isPending || updateMutation.isPending ? "..." : "Sauvegarder"}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </>
      )}

      {/* Confirm Delete */}
      <ConfirmDialog
        open={!!confirmDelete}
        onConfirm={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
        onCancel={() => setConfirmDelete(null)}
        title="Supprimer cette règle ?"
        description="Cette règle de facturation sera définitivement supprimée."
        confirmLabel="Supprimer"
        variant="danger"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
