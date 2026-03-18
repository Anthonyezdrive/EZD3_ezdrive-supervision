// ============================================================
// EZDrive — Roaming Agreements Page (GFX-style)
// List → Detail → Edit  (3-level navigation)
// ============================================================

import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/contexts/ToastContext";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

// ── Types ─────────────────────────────────────────────────────

interface Agreement {
  id: string;
  status: "active" | "expired" | "planned";
  management: string | null;
  cpo_network_id: string | null;
  cpo_contract_id: string | null;
  emsp_network_id: string | null;
  emsp_contract_id: string | null;
  connection_method: string | null;
  valid_from: string | null;
  valid_to: string | null;
  professional_contact: string | null;
  technical_contact: string | null;
  remarks: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

interface NetworkRef { id: string; name: string }
interface ContractRef { id: string; name: string }

const EMPTY_AGREEMENT = {
  status: "active" as Agreement["status"],
  management: "",
  cpo_network_id: "",
  cpo_contract_id: "",
  emsp_network_id: "",
  emsp_contract_id: "",
  connection_method: "",
  valid_from: "",
  valid_to: "",
  professional_contact: "",
  technical_contact: "",
  remarks: "",
  updated_by: "",
};

type SortKey = "status" | "management" | "connection_method" | "valid_from" | "valid_to" | "created_at";
type SortDir = "asc" | "desc";
type FilterTab = "all" | "active" | "expired";

const PAGE_SIZE = 25;

// ── Helpers ───────────────────────────────────────────────────

function ValidityBadge({ status }: { status: string }) {
  if (status === "active") return <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">Valid</span>;
  if (status === "expired") return <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold bg-red-500/15 text-red-400 border border-red-500/25">Expiré</span>;
  return <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/25">Planifié</span>;
}

function TypeBadge({ type }: { type: "internal" | "external" }) {
  if (type === "internal") return <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/25">Internal</span>;
  return <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-500/15 text-purple-400 border border-purple-500/25">External</span>;
}

const formatDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "2-digit", year: "numeric" }) : "Indéfini";

const formatDateFull = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }) + " @ " + new Date(d).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—";

// ── Main Page ─────────────────────────────────────────────────

export function AgreementsPage() {
  const queryClient = useQueryClient();
  const { success: toastSuccess, error: toastError } = useToast();

  // Navigation state
  const [selectedAgreement, setSelectedAgreement] = useState<Agreement | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Agreement | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Agreement | null>(null);
  const [form, setForm] = useState(EMPTY_AGREEMENT);

  // List state
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [sortKey, setSortKey] = useState<SortKey>("valid_from");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);

  // Per-column filters
  const [colFilters, setColFilters] = useState<Record<string, string>>({
    status: "",
    management: "",
    cpo_network: "",
    emsp_network: "",
    cpo_contract: "",
    emsp_contract: "",
    connection_method: "",
    valid_from: "",
    valid_to: "",
    professional_contact: "",
  });

  // ── Related data for dropdowns ──
  const { data: cpoNetworks } = useQuery<NetworkRef[]>({
    queryKey: ["cpo-networks"],
    retry: false,
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from("cpo_networks").select("id, name").order("name");
        if (error) return [];
        return (data ?? []) as NetworkRef[];
      } catch { return []; }
    },
  });

  const { data: cpoContracts } = useQuery<ContractRef[]>({
    queryKey: ["cpo-contracts"],
    retry: false,
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from("cpo_contracts").select("id, name").order("name");
        if (error) return [];
        return (data ?? []) as ContractRef[];
      } catch { return []; }
    },
  });

  const { data: emspNetworks } = useQuery<NetworkRef[]>({
    queryKey: ["emsp-networks"],
    retry: false,
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from("emsp_networks").select("id, name").order("name");
        if (error) return [];
        return (data ?? []) as NetworkRef[];
      } catch { return []; }
    },
  });

  const { data: emspContracts } = useQuery<ContractRef[]>({
    queryKey: ["emsp-contracts"],
    retry: false,
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from("emsp_contracts").select("id, name").order("name");
        if (error) return [];
        return (data ?? []) as ContractRef[];
      } catch { return []; }
    },
  });

  // Lookup maps
  const cpoNetworkMap = useMemo(() => {
    const m = new Map<string, string>();
    (cpoNetworks ?? []).forEach((n) => m.set(n.id, n.name));
    return m;
  }, [cpoNetworks]);

  const cpoContractMap = useMemo(() => {
    const m = new Map<string, string>();
    (cpoContracts ?? []).forEach((c) => m.set(c.id, c.name));
    return m;
  }, [cpoContracts]);

  const emspNetworkMap = useMemo(() => {
    const m = new Map<string, string>();
    (emspNetworks ?? []).forEach((n) => m.set(n.id, n.name));
    return m;
  }, [emspNetworks]);

  const emspContractMap = useMemo(() => {
    const m = new Map<string, string>();
    (emspContracts ?? []).forEach((c) => m.set(c.id, c.name));
    return m;
  }, [emspContracts]);

  // ── Data fetching ──
  const { data: agreements, isLoading } = useQuery<Agreement[]>({
    queryKey: ["roaming-agreements"],
    retry: false,
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from("roaming_agreements").select("*").order("created_at", { ascending: false });
        if (error) return [];
        return (data ?? []) as Agreement[];
      } catch { return []; }
    },
  });

  // ── Mutations ──
  const createMutation = useMutation({
    mutationFn: async (data: typeof EMPTY_AGREEMENT) => {
      const { error } = await supabase.from("roaming_agreements").insert({
        status: data.status,
        management: data.management || null,
        cpo_network_id: data.cpo_network_id || null,
        cpo_contract_id: data.cpo_contract_id || null,
        emsp_network_id: data.emsp_network_id || null,
        emsp_contract_id: data.emsp_contract_id || null,
        connection_method: data.connection_method || null,
        valid_from: data.valid_from || null,
        valid_to: data.valid_to || null,
        professional_contact: data.professional_contact || null,
        technical_contact: data.technical_contact || null,
        remarks: data.remarks || null,
        updated_by: data.updated_by || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roaming-agreements"] });
      closeModal();
      toastSuccess("Accord créé", "L'accord de roaming a été ajouté");
    },
    onError: (err: Error) => toastError("Erreur", err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Partial<typeof EMPTY_AGREEMENT>) => {
      const { error } = await supabase.from("roaming_agreements").update({
        status: data.status,
        management: data.management || null,
        cpo_network_id: data.cpo_network_id || null,
        cpo_contract_id: data.cpo_contract_id || null,
        emsp_network_id: data.emsp_network_id || null,
        emsp_contract_id: data.emsp_contract_id || null,
        connection_method: data.connection_method || null,
        valid_from: data.valid_from || null,
        valid_to: data.valid_to || null,
        professional_contact: data.professional_contact || null,
        technical_contact: data.technical_contact || null,
        remarks: data.remarks || null,
        updated_by: data.updated_by || null,
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roaming-agreements"] });
      closeModal();
      toastSuccess("Accord modifié", "Les modifications ont été enregistrées");
      // Refresh detail if viewing
      if (selectedAgreement) {
        const updated = agreements?.find((a) => a.id === selectedAgreement.id);
        if (updated) setSelectedAgreement(updated);
      }
    },
    onError: (err: Error) => toastError("Erreur", err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("roaming_agreements").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roaming-agreements"] });
      setConfirmDelete(null);
      setSelectedAgreement(null);
      toastSuccess("Accord supprimé", "L'accord a été supprimé");
    },
    onError: (err: Error) => toastError("Erreur", err.message),
  });

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_AGREEMENT);
    setModalOpen(true);
  }

  function openEdit(agreement: Agreement) {
    setEditing(agreement);
    setForm({
      status: agreement.status,
      management: agreement.management ?? "",
      cpo_network_id: agreement.cpo_network_id ?? "",
      cpo_contract_id: agreement.cpo_contract_id ?? "",
      emsp_network_id: agreement.emsp_network_id ?? "",
      emsp_contract_id: agreement.emsp_contract_id ?? "",
      connection_method: agreement.connection_method ?? "",
      valid_from: agreement.valid_from ? agreement.valid_from.slice(0, 10) : "",
      valid_to: agreement.valid_to ? agreement.valid_to.slice(0, 10) : "",
      professional_contact: agreement.professional_contact ?? "",
      technical_contact: agreement.technical_contact ?? "",
      remarks: agreement.remarks ?? "",
      updated_by: agreement.updated_by ?? "",
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditing(null);
    setForm(EMPTY_AGREEMENT);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editing) {
      updateMutation.mutate({ id: editing.id, ...form });
    } else {
      createMutation.mutate(form);
    }
  }

  // ── Sorting ──
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
    let list = agreements ?? [];

    // Tab filter
    if (filterTab === "active") list = list.filter((a) => a.status === "active");
    else if (filterTab === "expired") list = list.filter((a) => a.status === "expired");

    // Column filters
    if (colFilters.management) {
      const q = colFilters.management.toLowerCase();
      list = list.filter((a) => a.management?.toLowerCase().includes(q));
    }
    if (colFilters.cpo_network) {
      const q = colFilters.cpo_network.toLowerCase();
      list = list.filter((a) => a.cpo_network_id && cpoNetworkMap.get(a.cpo_network_id)?.toLowerCase().includes(q));
    }
    if (colFilters.emsp_network) {
      const q = colFilters.emsp_network.toLowerCase();
      list = list.filter((a) => a.emsp_network_id && emspNetworkMap.get(a.emsp_network_id)?.toLowerCase().includes(q));
    }
    if (colFilters.cpo_contract) {
      const q = colFilters.cpo_contract.toLowerCase();
      list = list.filter((a) => a.cpo_contract_id && cpoContractMap.get(a.cpo_contract_id)?.toLowerCase().includes(q));
    }
    if (colFilters.emsp_contract) {
      const q = colFilters.emsp_contract.toLowerCase();
      list = list.filter((a) => a.emsp_contract_id && emspContractMap.get(a.emsp_contract_id)?.toLowerCase().includes(q));
    }
    if (colFilters.connection_method) {
      const q = colFilters.connection_method.toLowerCase();
      list = list.filter((a) => a.connection_method?.toLowerCase().includes(q));
    }
    if (colFilters.professional_contact) {
      const q = colFilters.professional_contact.toLowerCase();
      list = list.filter((a) => a.professional_contact?.toLowerCase().includes(q));
    }

    // Sort
    return [...list].sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1; if (bv == null) return -1;
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), "fr");
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [agreements, filterTab, colFilters, sortKey, sortDir, cpoNetworkMap, emspNetworkMap, cpoContractMap, emspContractMap]);

  const totalPages = Math.max(1, Math.ceil(processed.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const paginated = processed.slice(start, start + PAGE_SIZE);

  const tabCounts = useMemo(() => {
    const list = agreements ?? [];
    return {
      all: list.length,
      active: list.filter((a) => a.status === "active").length,
      expired: list.filter((a) => a.status === "expired").length,
    };
  }, [agreements]);

  const thClass = "px-3 py-2.5 text-left text-[11px] font-semibold text-foreground-muted uppercase tracking-wider select-none whitespace-nowrap";
  const thSortable = cn(thClass, "cursor-pointer hover:text-foreground transition-colors");
  const filterInputClass = "w-full px-2 py-1.5 bg-surface-elevated border border-border rounded text-xs text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50 transition-colors";

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (col !== sortKey) return <span className="inline-flex ml-0.5 opacity-30"><ChevronUp className="w-3 h-3" /></span>;
    return sortDir === "asc" ? <ChevronUp className="w-3 h-3 inline ml-0.5 text-primary" /> : <ChevronDown className="w-3 h-3 inline ml-0.5 text-primary" />;
  };

  // ════════════════════════════════════════════════════════════
  // DETAIL VIEW
  // ════════════════════════════════════════════════════════════
  if (selectedAgreement) {
    const a = selectedAgreement;
    const cpoName = a.cpo_network_id ? cpoNetworkMap.get(a.cpo_network_id) ?? "CPO Network" : "CPO Network";
    const emspName = a.emsp_network_id ? emspNetworkMap.get(a.emsp_network_id) ?? "eMSP Network" : "eMSP Network";

    // Get linked reimbursement rules for this agreement
    return (
      <div className="space-y-6">
        {/* Back + Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <button
              onClick={() => setSelectedAgreement(null)}
              className="mt-1 p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="font-heading text-xl font-bold text-foreground">
                Accord entre {cpoName} et {emspName}
              </h1>
              <p className="text-sm text-foreground-muted mt-0.5 uppercase tracking-wide">ACCORD</p>
            </div>
          </div>
          {/* Éditer split button */}
          <div className="flex items-center">
            <button
              onClick={() => openEdit(a)}
              className="px-5 py-2.5 bg-primary text-white text-sm font-semibold rounded-l-xl hover:bg-primary/90 transition-colors"
            >
              Éditer
            </button>
            <button
              onClick={() => setConfirmDelete(a)}
              className="px-2.5 py-2.5 bg-primary text-white rounded-r-xl border-l border-white/20 hover:bg-primary/90 transition-colors"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border">
          <button className="px-4 py-2.5 text-sm font-medium text-primary relative">
            Détails
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
          </button>
          <button className="px-4 py-2.5 text-sm font-medium text-foreground-muted hover:text-foreground transition-colors">
            Règles de facturation en gros
          </button>
        </div>

        {/* Detail Content */}
        <div className="bg-surface border border-border rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-foreground mb-6">Détails</h2>

          <div className="grid grid-cols-2 gap-x-12 gap-y-4">
            {/* Left column */}
            <div className="space-y-4">
              <DetailRow label="Réseau CPO">
                <span className="text-primary">{cpoName}</span>
                <TypeBadge type="internal" />
              </DetailRow>
              <DetailRow label="Réseau eMSP">
                <span className="text-primary">{emspName}</span>
                <TypeBadge type="external" />
              </DetailRow>
              <DetailRow label="Nom de contact professionnel">
                {a.professional_contact ?? "—"}
              </DetailRow>
              <DetailRow label="Adresse email professionnelle">—</DetailRow>
              <DetailRow label="Numéro de téléphone professionnel">—</DetailRow>
              <DetailRow label="Nom du contact technique">
                {a.technical_contact ?? "—"}
              </DetailRow>
              <DetailRow label="Adresse mail du contact technique">—</DetailRow>
              <DetailRow label="Numéro de téléphone du contact technique">—</DetailRow>
              <DetailRow label="Remarques">
                {a.remarks ?? "—"}
              </DetailRow>
            </div>

            {/* Right column */}
            <div className="space-y-4">
              <DetailRow label="Valide à partir de">{formatDate(a.valid_from)}</DetailRow>
              <DetailRow label="Valable jusqu'au">{formatDate(a.valid_to)}</DetailRow>
              <DetailRow label="Gestion des accords">{a.management ?? "—"}</DetailRow>
              <DetailRow label="Méthode de connexion">{a.connection_method ?? "—"}</DetailRow>
              <DetailRow label="Dernière mise à jour">
                {formatDateFull(a.updated_at)}
                {a.updated_by && <span className="text-primary ml-1">({a.updated_by})</span>}
              </DetailRow>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════
  // LIST VIEW
  // ════════════════════════════════════════════════════════════
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-xl font-bold text-foreground">
          Accords CPO ({tabCounts.all})
        </h1>
        {/* Add new split button */}
        <div className="flex items-center">
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white text-sm font-semibold rounded-l-xl hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Ajouter Nouveau
          </button>
          <button className="px-2.5 py-2.5 bg-primary text-white rounded-r-xl border-l border-white/20 hover:bg-primary/90 transition-colors">
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {([
          { key: "all" as FilterTab, label: "Tout" },
          { key: "active" as FilterTab, label: "Valide" },
          { key: "expired" as FilterTab, label: "Expiré" },
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

      {/* Table */}
      {isLoading ? (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="divide-y divide-border">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="px-4 py-3.5 flex items-center gap-6">
                <Skeleton className="h-5 w-14 rounded" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        </div>
      ) : processed.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 bg-surface border border-border rounded-2xl">
          <p className="text-foreground font-medium">Aucun accord trouvé</p>
          <p className="text-sm text-foreground-muted mt-1">Créez votre premier accord de roaming.</p>
          <button onClick={openCreate} className="mt-3 flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary/90 transition-colors">
            <Plus className="w-4 h-4" /> Ajouter
          </button>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                {/* Column headers */}
                <tr className="border-b border-border">
                  <th className={thSortable} onClick={() => handleSort("status")}>
                    Validité <SortIcon col="status" />
                  </th>
                  <th className={thSortable} onClick={() => handleSort("management")}>
                    Gestion des accords <SortIcon col="management" />
                  </th>
                  <th className={thClass}>Réseau CPO</th>
                  <th className={thClass}>Réseau eMSP</th>
                  <th className={thClass}>Contrat CPO</th>
                  <th className={thClass}>Contrat eMSP</th>
                  <th className={thSortable} onClick={() => handleSort("connection_method")}>
                    Méthode de connexion <SortIcon col="connection_method" />
                  </th>
                  <th className={thSortable} onClick={() => handleSort("valid_from")}>
                    Valide à partir de <SortIcon col="valid_from" />
                  </th>
                  <th className={thSortable} onClick={() => handleSort("valid_to")}>
                    Valable jusqu&apos;au <SortIcon col="valid_to" />
                  </th>
                  <th className={thClass}>Pro. Contact</th>
                  <th className={cn(thClass, "w-16")}></th>
                </tr>
                {/* Column filter inputs */}
                <tr className="border-b border-border bg-surface-elevated/30">
                  <td className="px-3 py-2">
                    <select
                      value={colFilters.status}
                      onChange={(e) => { setColFilters((f) => ({ ...f, status: e.target.value })); setPage(1); }}
                      className={filterInputClass}
                    >
                      <option value="">Tout...</option>
                      <option value="active">Valid</option>
                      <option value="expired">Expiré</option>
                      <option value="planned">Planifié</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input placeholder="Recherche..." value={colFilters.management} onChange={(e) => { setColFilters((f) => ({ ...f, management: e.target.value })); setPage(1); }} className={filterInputClass} />
                  </td>
                  <td className="px-3 py-2">
                    <input placeholder="Recherche..." value={colFilters.cpo_network} onChange={(e) => { setColFilters((f) => ({ ...f, cpo_network: e.target.value })); setPage(1); }} className={filterInputClass} />
                  </td>
                  <td className="px-3 py-2">
                    <input placeholder="Recherche..." value={colFilters.emsp_network} onChange={(e) => { setColFilters((f) => ({ ...f, emsp_network: e.target.value })); setPage(1); }} className={filterInputClass} />
                  </td>
                  <td className="px-3 py-2">
                    <input placeholder="Recherche..." value={colFilters.cpo_contract} onChange={(e) => { setColFilters((f) => ({ ...f, cpo_contract: e.target.value })); setPage(1); }} className={filterInputClass} />
                  </td>
                  <td className="px-3 py-2">
                    <input placeholder="Recherche..." value={colFilters.emsp_contract} onChange={(e) => { setColFilters((f) => ({ ...f, emsp_contract: e.target.value })); setPage(1); }} className={filterInputClass} />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={colFilters.connection_method}
                      onChange={(e) => { setColFilters((f) => ({ ...f, connection_method: e.target.value })); setPage(1); }}
                      className={filterInputClass}
                    >
                      <option value="">Tout...</option>
                      {[...new Set((agreements ?? []).map((a) => a.connection_method).filter(Boolean))].map((m) => (
                        <option key={m} value={m!}>{m}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input placeholder="Recherche..." value={colFilters.valid_from} onChange={(e) => { setColFilters((f) => ({ ...f, valid_from: e.target.value })); setPage(1); }} className={filterInputClass} />
                  </td>
                  <td className="px-3 py-2">
                    <input placeholder="Recherche..." value={colFilters.valid_to} onChange={(e) => { setColFilters((f) => ({ ...f, valid_to: e.target.value })); setPage(1); }} className={filterInputClass} />
                  </td>
                  <td className="px-3 py-2">
                    <input placeholder="Recherche..." value={colFilters.professional_contact} onChange={(e) => { setColFilters((f) => ({ ...f, professional_contact: e.target.value })); setPage(1); }} className={filterInputClass} />
                  </td>
                  <td className="px-3 py-2"></td>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paginated.map((agreement) => (
                  <tr
                    key={agreement.id}
                    className="hover:bg-surface-elevated/50 transition-colors cursor-pointer"
                    onClick={() => setSelectedAgreement(agreement)}
                  >
                    <td className="px-3 py-3">
                      <ValidityBadge status={agreement.status} />
                    </td>
                    <td className="px-3 py-3 text-sm text-foreground truncate max-w-[160px]">
                      {agreement.management ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-sm text-foreground-muted truncate max-w-[180px]">
                      {agreement.cpo_network_id ? cpoNetworkMap.get(agreement.cpo_network_id) ?? "—" : "—"}
                    </td>
                    <td className="px-3 py-3 text-sm text-foreground-muted truncate max-w-[180px]">
                      {agreement.emsp_network_id ? emspNetworkMap.get(agreement.emsp_network_id) ?? "—" : "—"}
                    </td>
                    <td className="px-3 py-3 text-sm text-foreground-muted truncate max-w-[140px]">
                      {agreement.cpo_contract_id ? cpoContractMap.get(agreement.cpo_contract_id) ?? "—" : "—"}
                    </td>
                    <td className="px-3 py-3 text-sm text-foreground-muted truncate max-w-[140px]">
                      {agreement.emsp_contract_id ? emspContractMap.get(agreement.emsp_contract_id) ?? "—" : "—"}
                    </td>
                    <td className="px-3 py-3 text-sm text-foreground-muted">
                      {agreement.connection_method ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-sm text-foreground-muted whitespace-nowrap">
                      {formatDate(agreement.valid_from)}
                    </td>
                    <td className="px-3 py-3 text-sm text-foreground-muted whitespace-nowrap">
                      {formatDate(agreement.valid_to)}
                    </td>
                    <td className="px-3 py-3 text-sm text-foreground-muted truncate max-w-[120px]">
                      {agreement.professional_contact ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => openEdit(agreement)}
                        className="px-3 py-1 text-xs font-medium text-primary border border-primary/30 rounded-lg hover:bg-primary/10 transition-colors"
                      >
                        Editer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <span className="text-xs text-foreground-muted">
              récupéré le {new Date().toLocaleDateString("fr-FR")} @ {new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
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
                montrer {processed.length} enregistrements
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Create / Edit Modal ── */}
      {modalOpen && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40" onClick={closeModal} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
              {/* Modal header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <h2 className="text-lg font-semibold text-foreground">
                  {editing ? "Modifier l'accord" : "Ajouter un accord"}
                </h2>
                <button onClick={closeModal} className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6">
                <div className="grid grid-cols-4 gap-6">
                  {/* Col 1: Données de l'accord */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-foreground mb-2">Données de l'accord</h3>
                    <div>
                      <label className="block text-xs text-foreground-muted mb-1">Statut <span className="text-red-400">*</span></label>
                      <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as Agreement["status"] }))} className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm focus:outline-none focus:border-primary/50">
                        <option value="active">Actif</option>
                        <option value="expired">Expiré</option>
                        <option value="planned">Planifié</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-foreground-muted mb-1">Gestion des accords</label>
                      <input value={form.management} onChange={(e) => setForm((f) => ({ ...f, management: e.target.value }))} placeholder="Bilatéral, Hub..." className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50" />
                    </div>
                    <h3 className="text-sm font-semibold text-foreground pt-3">Période de validité</h3>
                    <div>
                      <label className="block text-xs text-foreground-muted mb-1">Date de début <span className="text-red-400">*</span></label>
                      <input type="date" value={form.valid_from} onChange={(e) => setForm((f) => ({ ...f, valid_from: e.target.value }))} className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm focus:outline-none focus:border-primary/50" />
                    </div>
                    <div>
                      <label className="block text-xs text-foreground-muted mb-1">Date de fin</label>
                      <input type="date" value={form.valid_to} onChange={(e) => setForm((f) => ({ ...f, valid_to: e.target.value }))} className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm focus:outline-none focus:border-primary/50" />
                    </div>
                  </div>

                  {/* Col 2: CPO */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-foreground mb-2">CPO</h3>
                    <div>
                      <label className="block text-xs text-foreground-muted mb-1">Réseau CPO</label>
                      <select value={form.cpo_network_id} onChange={(e) => setForm((f) => ({ ...f, cpo_network_id: e.target.value }))} className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm focus:outline-none focus:border-primary/50">
                        <option value="">Quelconque</option>
                        {(cpoNetworks ?? []).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-foreground-muted mb-1">Contrat CPO</label>
                      <select value={form.cpo_contract_id} onChange={(e) => setForm((f) => ({ ...f, cpo_contract_id: e.target.value }))} className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm focus:outline-none focus:border-primary/50">
                        <option value="">Quelconque</option>
                        {(cpoContracts ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Col 3: eMSP */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-foreground mb-2">eMSP</h3>
                    <div>
                      <label className="block text-xs text-foreground-muted mb-1">Réseau eMSP</label>
                      <select value={form.emsp_network_id} onChange={(e) => setForm((f) => ({ ...f, emsp_network_id: e.target.value }))} className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm focus:outline-none focus:border-primary/50">
                        <option value="">Quelconque</option>
                        {(emspNetworks ?? []).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-foreground-muted mb-1">Contrat eMSP</label>
                      <select value={form.emsp_contract_id} onChange={(e) => setForm((f) => ({ ...f, emsp_contract_id: e.target.value }))} className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm focus:outline-none focus:border-primary/50">
                        <option value="">Quelconque</option>
                        {(emspContracts ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Col 4: Connexion & Contact */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-foreground mb-2">Connexion</h3>
                    <div>
                      <label className="block text-xs text-foreground-muted mb-1">Méthode de connexion</label>
                      <input value={form.connection_method} onChange={(e) => setForm((f) => ({ ...f, connection_method: e.target.value }))} placeholder="Peer-to-Peer, OCPI..." className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50" />
                    </div>
                    <div>
                      <label className="block text-xs text-foreground-muted mb-1">Contact professionnel</label>
                      <input value={form.professional_contact} onChange={(e) => setForm((f) => ({ ...f, professional_contact: e.target.value }))} placeholder="Nom ou email" className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50" />
                    </div>
                    <div>
                      <label className="block text-xs text-foreground-muted mb-1">Contact technique</label>
                      <input value={form.technical_contact} onChange={(e) => setForm((f) => ({ ...f, technical_contact: e.target.value }))} placeholder="Nom ou email" className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50" />
                    </div>
                  </div>
                </div>

                {/* Divers */}
                <div className="mt-6 pt-4 border-t border-border">
                  <h3 className="text-sm font-semibold text-foreground mb-3">Divers</h3>
                  <div>
                    <label className="block text-xs text-foreground-muted mb-1">Remarques</label>
                    <textarea value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} rows={2} placeholder="Notes..." className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50 resize-none" />
                  </div>
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
        title="Supprimer cet accord ?"
        description="Cet accord de roaming sera définitivement supprimé."
        confirmLabel="Supprimer"
        variant="danger"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}

// ── Detail Row ────────────────────────────────────────────────

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-border/50">
      <span className="text-sm text-foreground-muted shrink-0">{label}</span>
      <span className="text-sm text-foreground text-right">{children}</span>
    </div>
  );
}
