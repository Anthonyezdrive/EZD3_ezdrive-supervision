import { useState, useMemo } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useCpo } from "@/contexts/CpoContext";
import { useToast } from "@/contexts/ToastContext";
import { PageHelp } from "@/components/ui/PageHelp";
import {
  Wallet,
  Zap,
  DollarSign,
  Search,
  Globe,
  Plus,
  X,
  Trash2,
  Loader2,
  AlertCircle,
  Link2,
  Copy,
  Calculator,
  History,
  Layers,
  Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TariffVisualBuilder } from "./TariffVisualBuilder";

// ============================================================
// Tariffs Management Page — Real DB schema
// ============================================================

// station_tariffs is a junction table linking stations → ocpi_tariffs
interface StationTariffRow {
  id: string;
  station_id: string;
  tariff_id: string | null; // FK to ocpi_tariffs.id
  priority: number;
  connector_type: string | null; // AC, DC, etc.
  valid_from: string | null;
  valid_to: string | null;
  source: string | null; // manual, gfx_inferred, etc.
  created_at: string;
  updated_at?: string;
  stations: { name: string; city: string | null } | null;
  ocpi_tariffs: {
    tariff_id: string; // OCPI tariff ID string (e.g. "STANDARD-AC")
    currency: string;
    elements: unknown;
  } | null;
}

interface OcpiTariff {
  id: string;
  tariff_id: string; // actual DB column name
  currency: string;
  type: string | null;
  elements: unknown;
  country_code: string | null;
  party_id: string | null;
  start_date_time: string | null;
  end_date_time: string | null;
  last_updated: string | null;
  created_at: string;
}

interface AssignFormData {
  station_id: string;
  tariff_id: string; // ocpi_tariffs.id
  connector_type: string;
  priority: number;
}

export function TariffsPage() {
  const queryClient = useQueryClient();
  const { selectedCpoId } = useCpo();
  const { success: toastSuccess, error: toastError } = useToast();
  const [activeTab, setActiveTab] = useState<"station" | "ocpi">("station");
  const [search, setSearch] = useState("");
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showCreateOcpiModal, setShowCreateOcpiModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StationTariffRow | null>(null);
  const [showSimulateModal, setShowSimulateModal] = useState(false);
  const [showBulkAssignModal, setShowBulkAssignModal] = useState(false);
  const [editingOcpiTariff, setEditingOcpiTariff] = useState<OcpiTariff | null>(null);
  const [deleteOcpiTarget, setDeleteOcpiTarget] = useState<OcpiTariff | null>(null);
  const [editingAssignment, setEditingAssignment] = useState<StationTariffRow | null>(null);

  // ── Resolve station IDs for selected CPO ──
  const { data: cpoStationIds } = useQuery({
    queryKey: ["tariffs-cpo-station-ids", selectedCpoId ?? "all"],
    enabled: !!selectedCpoId,
    queryFn: async () => {
      const { data: stns } = await supabase.from("stations").select("id").eq("cpo_id", selectedCpoId!);
      return (stns ?? []).map((s: { id: string }) => s.id);
    },
    staleTime: 60000,
  });

  // ── Station tariffs (junction) with joined station + tariff data ──
  const { data: stationTariffs, isLoading: stLoading, isError: stError, refetch: stRefetch, dataUpdatedAt: stDataUpdatedAt } = useQuery<StationTariffRow[]>({
    queryKey: ["station-tariffs", selectedCpoId ?? "all"],
    queryFn: async () => {
      if (selectedCpoId && cpoStationIds?.length === 0) return [];
      let query = supabase
        .from("station_tariffs")
        .select("*, stations(name, city), ocpi_tariffs(tariff_id, currency, elements)")
        .order("created_at", { ascending: false });
      if (selectedCpoId && cpoStationIds?.length) {
        query = query.in("station_id", cpoStationIds);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as StationTariffRow[];
    },
  });

  // ── Resolve distinct OCPI tariff IDs used by the selected CPO's stations ──
  const { data: cpoOcpiTariffIds } = useQuery({
    queryKey: ["tariffs-cpo-ocpi-ids", selectedCpoId ?? "all", cpoStationIds],
    enabled: !selectedCpoId || (cpoStationIds ?? []).length > 0,
    queryFn: async () => {
      if (!selectedCpoId) return null;
      if (!cpoStationIds?.length) return [];
      const { data } = await supabase
        .from("station_tariffs")
        .select("tariff_id")
        .in("station_id", cpoStationIds);
      const ids = [...new Set((data ?? []).map((r: { tariff_id: string }) => r.tariff_id).filter(Boolean))];
      return ids as string[];
    },
    staleTime: 60000,
  });

  // ── OCPI tariffs — filtered by CPO via station_tariffs linkage ──
  const { data: ocpiTariffs, isLoading: ocpiLoading, isError: ocpiError, refetch: ocpiRefetch } = useQuery<OcpiTariff[]>({
    queryKey: ["ocpi-tariffs", selectedCpoId ?? "all", cpoOcpiTariffIds],
    queryFn: async () => {
      let query = supabase
        .from("ocpi_tariffs")
        .select("*")
        .order("created_at", { ascending: false });
      if (selectedCpoId && cpoOcpiTariffIds) {
        if (cpoOcpiTariffIds.length === 0) return [];
        query = query.in("id", cpoOcpiTariffIds);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as OcpiTariff[];
    },
  });

  // ── Assign tariff to station mutation ──
  const assignMutation = useMutation({
    mutationFn: async (data: AssignFormData) => {
      const { error } = await supabase.from("station_tariffs").insert({
        station_id: data.station_id,
        tariff_id: data.tariff_id,
        connector_type: data.connector_type,
        priority: data.priority,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["station-tariffs"] });
      queryClient.invalidateQueries({ queryKey: ["tariffs-cpo-ocpi-ids"] });
      toastSuccess("Tarif assigné à la station avec succès");
      setShowAssignModal(false);
    },
    onError: (err: Error) => toastError(err.message),
  });

  // ── Delete assignment mutation ──
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("station_tariffs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["station-tariffs"] });
      queryClient.invalidateQueries({ queryKey: ["tariffs-cpo-ocpi-ids"] });
      toastSuccess("Affectation supprimée");
      setDeleteTarget(null);
    },
    onError: (err: Error) => toastError(err.message),
  });

  // ── Duplicate tariff mutation ──
  const duplicateMutation = useMutation({
    mutationFn: async (tariff: OcpiTariff) => {
      const { id, created_at, ...rest } = tariff;
      const newTariffId = tariff.tariff_id + "-COPY-" + Date.now().toString(36).slice(-4).toUpperCase();
      const { error } = await supabase.from("ocpi_tariffs").insert({ ...rest, tariff_id: newTariffId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ocpi-tariffs"] });
      toastSuccess("Tarif duplique avec succes");
    },
    onError: (err: Error) => toastError(err.message),
  });

  // ── Bulk assign tariff to territory ──
  const bulkAssignMutation = useMutation({
    mutationFn: async ({ tariffId, territoryCode }: { tariffId: string; territoryCode: string }) => {
      // Get all stations in territory
      const { data: stns } = await supabase.from("stations")
        .select("id")
        .eq("territory_code", territoryCode);
      if (!stns?.length) throw new Error("Aucune station dans ce territoire");
      const inserts = stns.map((s: { id: string }) => ({
        station_id: s.id,
        tariff_id: tariffId,
        connector_type: null,
        priority: 1,
        source: "bulk_assign",
      }));
      const { error } = await supabase.from("station_tariffs").insert(inserts);
      if (error) throw error;
      return inserts.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["station-tariffs"] });
      toastSuccess(`Tarif assigne a ${count} station(s)`);
      setShowBulkAssignModal(false);
    },
    onError: (err: Error) => toastError(err.message),
  });

  // ── Update OCPI tariff mutation ──
  const updateOcpiMutation = useMutation({
    mutationFn: async (data: { id: string; tariff_id: string; currency: string; type: string | null; elements: unknown }) => {
      const { error } = await supabase.from("ocpi_tariffs").update({
        tariff_id: data.tariff_id,
        currency: data.currency,
        type: data.type,
        elements: data.elements,
        last_updated: new Date().toISOString(),
      }).eq("id", data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ocpi-tariffs"] });
      queryClient.invalidateQueries({ queryKey: ["station-tariffs"] });
      toastSuccess("Tarif OCPI modifié avec succès");
      setEditingOcpiTariff(null);
    },
    onError: (err: Error) => toastError(err.message),
  });

  // ── Delete OCPI tariff mutation ──
  const deleteOcpiMutation = useMutation({
    mutationFn: async (id: string) => {
      // First remove orphan station_tariffs assignments
      const { error: unlinkError } = await supabase.from("station_tariffs").delete().eq("tariff_id", id);
      if (unlinkError) throw unlinkError;
      const { error } = await supabase.from("ocpi_tariffs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ocpi-tariffs"] });
      queryClient.invalidateQueries({ queryKey: ["station-tariffs"] });
      queryClient.invalidateQueries({ queryKey: ["tariffs-cpo-ocpi-ids"] });
      toastSuccess("Tarif OCPI supprimé avec succès");
      setDeleteOcpiTarget(null);
    },
    onError: (err: Error) => toastError(err.message),
  });

  // ── Update station tariff assignment mutation ──
  const updateAssignmentMutation = useMutation({
    mutationFn: async (data: { id: string; tariff_id: string; connector_type: string; priority: number; valid_from: string | null; valid_to: string | null }) => {
      const { error } = await supabase.from("station_tariffs").update({
        tariff_id: data.tariff_id,
        connector_type: data.connector_type,
        priority: data.priority,
        valid_from: data.valid_from || null,
        valid_to: data.valid_to || null,
        updated_at: new Date().toISOString(),
      }).eq("id", data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["station-tariffs"] });
      queryClient.invalidateQueries({ queryKey: ["tariffs-cpo-ocpi-ids"] });
      toastSuccess("Affectation modifiée avec succès");
      setEditingAssignment(null);
    },
    onError: (err: Error) => toastError(err.message),
  });

  // ── Filtered data ──
  const filteredStation = useMemo(() => {
    if (!stationTariffs) return [];
    if (!search) return stationTariffs;
    const q = search.toLowerCase();
    return stationTariffs.filter(
      (t) =>
        t.stations?.name?.toLowerCase().includes(q) ||
        t.stations?.city?.toLowerCase().includes(q) ||
        t.ocpi_tariffs?.tariff_id?.toLowerCase().includes(q) ||
        t.connector_type?.toLowerCase().includes(q) ||
        t.source?.toLowerCase().includes(q)
    );
  }, [stationTariffs, search]);

  const filteredOcpi = useMemo(() => {
    if (!ocpiTariffs) return [];
    if (!search) return ocpiTariffs;
    const q = search.toLowerCase();
    return ocpiTariffs.filter(
      (t) =>
        t.tariff_id?.toLowerCase().includes(q) ||
        t.currency?.toLowerCase().includes(q) ||
        t.type?.toLowerCase().includes(q)
    );
  }, [ocpiTariffs, search]);

  // ── Stats ──
  const avgPriceKwh = useMemo(() => {
    if (!stationTariffs?.length) return 0;
    const prices: number[] = [];
    for (const st of stationTariffs) {
      const comps = parseOcpiElements(st.ocpi_tariffs?.elements);
      const energy = comps.find((c) => c.type === "ENERGY");
      if (energy) prices.push(Number(energy.price));
    }
    if (!prices.length) return 0;
    return prices.reduce((a, b) => a + b, 0) / prices.length;
  }, [stationTariffs]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-xl font-bold text-foreground">Tarifs</h1>
          <p className="text-sm text-foreground-muted mt-1">
            Configuration des tarifs de recharge
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSimulateModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-surface border border-border rounded-xl text-sm text-foreground-muted hover:text-foreground hover:border-foreground-muted transition-colors"
          >
            <Calculator className="w-4 h-4" />
            Simuler
          </button>
          <button
            onClick={() => setShowBulkAssignModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-surface border border-border rounded-xl text-sm text-foreground-muted hover:text-foreground hover:border-foreground-muted transition-colors"
          >
            <Layers className="w-4 h-4" />
            Appliquer en masse
          </button>
          {activeTab === "station" ? (
            <button
              onClick={() => setShowAssignModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary text-background rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Assigner un tarif
            </button>
          ) : (
            <button
              onClick={() => setShowCreateOcpiModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary text-background rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Creer un tarif OCPI
            </button>
          )}
        </div>
      </div>

      <PageHelp
        summary="Configuration des grilles tarifaires appliquées aux sessions de charge"
        items={[
          { label: "Tarif OCPI", description: "Grille de prix au format OCPI définissant le coût par kWh, par minute, et/ou les frais fixes." },
          { label: "Affectation station", description: "Liaison entre un tarif OCPI et une station, avec type de connecteur et priorité." },
          { label: "Composantes", description: "ENERGY (par kWh), TIME (par minute), FLAT (frais fixe), PARKING_TIME (stationnement post-charge)." },
          { label: "Source", description: "'manual' = assigné manuellement, 'gfx_inferred' = déduit automatiquement par GreenFlux." },
        ]}
        tips={["Les modifications de tarifs ne s'appliquent qu'aux nouvelles sessions — les sessions en cours conservent le tarif initial."]}
      />

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={Link2} label="Affectations" value={stationTariffs?.length ?? 0} color="#8892B0" />
        <KpiCard icon={Globe} label="Tarifs OCPI" value={ocpiTariffs?.length ?? 0} color="#4ECDC4" />
        <KpiCard icon={Zap} label="Stations couvertes" value={new Set(stationTariffs?.map((t) => t.station_id) ?? []).size} color="#00D4AA" />
        <KpiCard icon={DollarSign} label="Prix moyen/kWh" value={`${avgPriceKwh.toFixed(3)} €`} color="#F39C12" />
      </div>

      {/* Search + Tabs */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
          <input
            type="text"
            placeholder="Rechercher tarif, station, ville..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-surface border border-border rounded-lg text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50"
          />
        </div>
        <div className="flex gap-1 bg-surface border border-border rounded-lg p-1">
          {([
            { key: "station" as const, label: "Affectations Stations", count: stationTariffs?.length ?? 0 },
            { key: "ocpi" as const, label: "Tarifs OCPI", count: ocpiTariffs?.length ?? 0 },
          ]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-2",
                activeTab === tab.key
                  ? "bg-primary/10 text-primary"
                  : "text-foreground-muted hover:text-foreground"
              )}
            >
              {tab.label}
              <span className={cn(
                "px-1.5 py-0.5 rounded-full text-[10px]",
                activeTab === tab.key ? "bg-primary/20" : "bg-surface-elevated"
              )}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Error banner */}
      {(activeTab === "station" ? stError : ocpiError) && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-red-700">
            <AlertCircle className="h-5 w-5" />
            <span>Erreur lors du chargement des données. Veuillez réessayer.</span>
          </div>
          <button onClick={() => (activeTab === "station" ? stRefetch : ocpiRefetch)()} className="text-red-700 hover:text-red-900 font-medium text-sm">
            Réessayer
          </button>
        </div>
      )}

      {/* Table */}
      {activeTab === "station" ? (
        <StationTariffsTable
          tariffs={filteredStation}
          isLoading={stLoading}
          onDelete={(t) => setDeleteTarget(t)}
          onEdit={(t) => setEditingAssignment(t)}
          dataUpdatedAt={stDataUpdatedAt}
        />
      ) : (
        <OcpiTariffsTable
          tariffs={filteredOcpi}
          isLoading={ocpiLoading}
          onDuplicate={(t) => duplicateMutation.mutate(t)}
          onEdit={(t) => setEditingOcpiTariff(t)}
          onDelete={(t) => setDeleteOcpiTarget(t)}
        />
      )}

      {/* Assign Modal */}
      {showAssignModal && (
        <AssignTariffModal
          onClose={() => setShowAssignModal(false)}
          onSubmit={(data) => assignMutation.mutate(data)}
          isLoading={assignMutation.isPending}
          error={(assignMutation.error as Error | null)?.message ?? null}
        />
      )}

      {/* Delete Confirmation */}
      {deleteTarget && (
        <DeleteConfirmModal
          tariff={deleteTarget}
          onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
          isLoading={deleteMutation.isPending}
        />
      )}

      {/* Create OCPI Tariff Modal */}
      {showCreateOcpiModal && (
        <CreateOcpiTariffModal
          onClose={() => setShowCreateOcpiModal(false)}
          onCreated={() => {
            setShowCreateOcpiModal(false);
            queryClient.invalidateQueries({ queryKey: ["ocpi-tariffs"] });
            toastSuccess("Tarif OCPI cree avec succes");
          }}
        />
      )}

      {/* Simulate Session Cost Modal */}
      {showSimulateModal && (
        <SimulateSessionCostModal
          onClose={() => setShowSimulateModal(false)}
          ocpiTariffs={ocpiTariffs ?? []}
        />
      )}

      {/* Bulk Assign Modal */}
      {showBulkAssignModal && (
        <BulkAssignModal
          onClose={() => setShowBulkAssignModal(false)}
          ocpiTariffs={ocpiTariffs ?? []}
          onSubmit={(tariffId, territoryCode) => bulkAssignMutation.mutate({ tariffId, territoryCode })}
          isLoading={bulkAssignMutation.isPending}
        />
      )}

      {/* Edit OCPI Tariff Modal */}
      {editingOcpiTariff && (
        <EditOcpiTariffModal
          tariff={editingOcpiTariff}
          onClose={() => setEditingOcpiTariff(null)}
          onSave={(data) => updateOcpiMutation.mutate(data)}
          isLoading={updateOcpiMutation.isPending}
          error={(updateOcpiMutation.error as Error | null)?.message ?? null}
        />
      )}

      {/* Delete OCPI Tariff Confirmation */}
      {deleteOcpiTarget && (
        <DeleteOcpiTariffConfirmModal
          tariff={deleteOcpiTarget}
          assignmentCount={(stationTariffs ?? []).filter((st) => st.tariff_id === deleteOcpiTarget.id).length}
          onConfirm={() => deleteOcpiMutation.mutate(deleteOcpiTarget.id)}
          onCancel={() => setDeleteOcpiTarget(null)}
          isLoading={deleteOcpiMutation.isPending}
        />
      )}

      {/* Edit Station Tariff Assignment Modal */}
      {editingAssignment && (
        <EditAssignmentModal
          assignment={editingAssignment}
          onClose={() => setEditingAssignment(null)}
          onSave={(data) => updateAssignmentMutation.mutate(data)}
          isLoading={updateAssignmentMutation.isPending}
          error={(updateAssignmentMutation.error as Error | null)?.message ?? null}
        />
      )}
    </div>
  );
}

// ── Station Tariffs Table (junction view) ─────────────────

function StationTariffsTable({
  tariffs,
  isLoading,
  onDelete,
  onEdit,
  dataUpdatedAt,
}: {
  tariffs: StationTariffRow[];
  isLoading: boolean;
  onDelete: (t: StationTariffRow) => void;
  onEdit: (t: StationTariffRow) => void;
  dataUpdatedAt: number;
}) {
  if (isLoading) {
    return (
      <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="h-10 animate-shimmer rounded" />
        ))}
      </div>
    );
  }

  if (!tariffs.length) {
    return (
      <div className="bg-surface border border-border rounded-xl py-16 text-center">
        <Wallet className="w-12 h-12 text-foreground-muted/20 mx-auto mb-3" />
        <p className="text-foreground-muted">Aucune affectation de tarif trouvée</p>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-3 text-xs font-medium text-foreground-muted">Station</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-foreground-muted">Ville</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-foreground-muted">Tarif OCPI</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-foreground-muted">Connecteur</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-foreground-muted">Composants prix</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-foreground-muted">Priorité</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-foreground-muted">Source</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-foreground-muted">Validité</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-foreground-muted">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tariffs.map((t) => {
              const components = parseOcpiElements(t.ocpi_tariffs?.elements);
              const validFrom = t.valid_from ? new Date(t.valid_from).toLocaleDateString("fr-FR") : null;
              const validTo = t.valid_to ? new Date(t.valid_to).toLocaleDateString("fr-FR") : null;
              const validityLabel = validFrom || validTo
                ? `${validFrom ?? "…"} → ${validTo ?? "∞"}`
                : "Permanent";

              return (
                <tr key={t.id} className="border-b border-border/50 hover:bg-surface-elevated/50 transition-colors">
                  <td className="px-4 py-3">
                    <span className="text-sm font-medium text-foreground">{t.stations?.name ?? "—"}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-foreground-muted">
                    {t.stations?.city ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs px-2 py-0.5 bg-primary/10 text-primary rounded">
                      {t.ocpi_tariffs?.tariff_id ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      "px-2 py-0.5 rounded text-xs font-medium",
                      t.connector_type === "DC" ? "bg-warning/10 text-warning" :
                      t.connector_type === "AC" ? "bg-status-available/10 text-status-available" :
                      "bg-surface-elevated text-foreground-muted"
                    )}>
                      {t.connector_type ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {components.map((c, i) => (
                        <span
                          key={i}
                          className={cn(
                            "px-2 py-0.5 rounded text-[10px] font-medium",
                            c.type === "ENERGY" ? "bg-primary/10 text-primary" :
                            c.type === "TIME" ? "bg-status-charging/10 text-status-charging" :
                            c.type === "FLAT" ? "bg-warning/10 text-warning" :
                            "bg-surface-elevated text-foreground-muted"
                          )}
                        >
                          {c.type}: {c.price}€
                        </span>
                      ))}
                      {components.length === 0 && (
                        <span className="text-xs text-foreground-muted">—</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-xs font-mono text-foreground-muted">{t.priority}</span>
                  </td>
                  <td className="px-4 py-3">
                    <SourceBadge source={t.source} />
                  </td>
                  <td className="px-4 py-3 text-xs text-foreground-muted whitespace-nowrap">
                    {validityLabel}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => onEdit(t)}
                        className="p-1.5 text-foreground-muted hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                        title="Modifier l'affectation"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onDelete(t)}
                        className="p-1.5 text-foreground-muted hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                        title="Supprimer l'affectation"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-border">
        <span className="text-xs text-foreground-muted">
          récupéré le {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
        </span>
        <span className="text-xs text-foreground-muted">
          {tariffs.length} affectation{tariffs.length > 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}

// ── Source Badge ──

function SourceBadge({ source }: { source: string | null }) {
  if (!source) return <span className="text-xs text-foreground-muted">—</span>;
  const colors: Record<string, string> = {
    manual: "bg-blue-500/10 text-blue-500",
    gfx_inferred: "bg-purple-500/10 text-purple-500",
  };
  const labels: Record<string, string> = {
    manual: "Manuel",
    gfx_inferred: "GreenFlux",
  };
  return (
    <span className={cn("px-2 py-0.5 rounded text-[10px] font-medium", colors[source] ?? "bg-surface-elevated text-foreground-muted")}>
      {labels[source] ?? source}
    </span>
  );
}

// ── OCPI Tariffs Table ────────────────────────────────────

function OcpiTariffsTable({
  tariffs,
  isLoading,
  onDuplicate,
  onEdit,
  onDelete,
}: {
  tariffs: OcpiTariff[];
  isLoading: boolean;
  onDuplicate?: (t: OcpiTariff) => void;
  onEdit?: (t: OcpiTariff) => void;
  onDelete?: (t: OcpiTariff) => void;
}) {
  if (isLoading) {
    return (
      <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-10 animate-shimmer rounded" />
        ))}
      </div>
    );
  }

  if (!tariffs.length) {
    return (
      <div className="bg-surface border border-border rounded-xl py-16 text-center">
        <Globe className="w-12 h-12 text-foreground-muted/20 mx-auto mb-3" />
        <p className="text-foreground-muted">Aucun tarif OCPI trouvé pour ce CPO</p>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-3 text-xs font-medium text-foreground-muted">ID Tarif</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-foreground-muted">Type</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-foreground-muted">Devise</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-foreground-muted">Composants</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-foreground-muted">Identifiant</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-foreground-muted">Derniere MaJ</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-foreground-muted">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tariffs.map((t) => {
              const components = parseOcpiElements(t.elements);
              return (
                <tr key={t.id} className="border-b border-border/50 hover:bg-surface-elevated/50 transition-colors">
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs px-2 py-0.5 bg-primary/10 text-primary rounded font-medium">
                      {t.tariff_id}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-surface-elevated rounded text-xs text-foreground-muted">
                      {t.type ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-surface-elevated rounded text-xs text-foreground-muted">
                      {t.currency}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {components.map((c, i) => (
                        <span
                          key={i}
                          className={cn(
                            "px-2 py-0.5 rounded text-[10px] font-medium",
                            c.type === "ENERGY" ? "bg-primary/10 text-primary" :
                            c.type === "TIME" ? "bg-status-charging/10 text-status-charging" :
                            c.type === "FLAT" ? "bg-warning/10 text-warning" :
                            "bg-surface-elevated text-foreground-muted"
                          )}
                        >
                          {c.type}: {c.price}€
                        </span>
                      ))}
                      {components.length === 0 && (
                        <span className="text-xs text-foreground-muted">—</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-foreground-muted font-mono">
                    {t.country_code}/{t.party_id}
                  </td>
                  <td className="px-4 py-3 text-xs text-foreground-muted">
                    {t.last_updated
                      ? new Date(t.last_updated).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
                      : new Date(t.created_at).toLocaleDateString("fr-FR")}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => onEdit?.(t)}
                        title="Modifier ce tarif"
                        className="p-1.5 text-foreground-muted hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onDuplicate?.(t)}
                        title="Dupliquer ce tarif"
                        className="p-1.5 text-foreground-muted hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onDelete?.(t)}
                        title="Supprimer ce tarif"
                        className="p-1.5 text-foreground-muted hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-border">
        <span className="text-xs text-foreground-muted">
          {tariffs.length} tarif{tariffs.length > 1 ? "s" : ""} OCPI
        </span>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────

function parseOcpiElements(elements: unknown): Array<{ type: string; price: string }> {
  try {
    if (!Array.isArray(elements)) return [];
    const result: Array<{ type: string; price: string }> = [];
    for (const el of elements) {
      const components = el?.price_components ?? [];
      for (const pc of components) {
        result.push({
          type: pc.type ?? "UNKNOWN",
          price: (pc.price ?? 0).toFixed(4),
        });
      }
    }
    return result;
  } catch {
    return [];
  }
}

function KpiCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  value: number | string;
  color: string;
}) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4 flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${color}15` }}>
        <Icon className="w-4.5 h-4.5" style={{ color }} />
      </div>
      <div>
        <p className="text-lg font-heading font-bold text-foreground">{value}</p>
        <p className="text-[11px] text-foreground-muted">{label}</p>
      </div>
    </div>
  );
}

// ── Assign Tariff Modal ──────────────────────────────────

function AssignTariffModal({
  onClose,
  onSubmit,
  isLoading,
  error,
}: {
  onClose: () => void;
  onSubmit: (data: AssignFormData) => void;
  isLoading: boolean;
  error: string | null;
}) {
  const { selectedCpoId } = useCpo();
  const [form, setForm] = useState<AssignFormData>({
    station_id: "",
    tariff_id: "",
    connector_type: "AC",
    priority: 0,
  });

  // Fetch stations for the select
  const { data: stations } = useQuery({
    queryKey: ["stations-list-assign", selectedCpoId ?? "all"],
    queryFn: async () => {
      let query = supabase.from("stations").select("id, name, city").order("name");
      if (selectedCpoId) query = query.eq("cpo_id", selectedCpoId);
      const { data } = await query;
      return data ?? [];
    },
  });

  // Fetch OCPI tariffs for the select
  const { data: availableTariffs } = useQuery({
    queryKey: ["ocpi-tariffs-select"],
    queryFn: async () => {
      const { data } = await supabase.from("ocpi_tariffs").select("id, tariff_id, currency").order("tariff_id");
      return data ?? [];
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.station_id || !form.tariff_id) return;
    onSubmit(form);
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-surface border border-border rounded-2xl w-full max-w-lg shadow-2xl">
          <div className="flex items-center justify-between p-5 border-b border-border">
            <h2 className="font-heading font-bold text-lg">
              Assigner un tarif à une station
            </h2>
            <button onClick={onClose} className="p-1.5 hover:bg-surface-elevated rounded-lg transition-colors">
              <X className="w-5 h-5 text-foreground-muted" />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <div>
              <label className="block text-xs text-foreground-muted mb-1.5">Station *</label>
              <select
                required
                value={form.station_id}
                onChange={(e) => setForm({ ...form, station_id: e.target.value })}
                className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm focus:outline-none focus:border-primary/50"
              >
                <option value="">— Sélectionner une station —</option>
                {(stations ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.city ? `— ${s.city}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-foreground-muted mb-1.5">Tarif OCPI *</label>
              <select
                required
                value={form.tariff_id}
                onChange={(e) => setForm({ ...form, tariff_id: e.target.value })}
                className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm focus:outline-none focus:border-primary/50"
              >
                <option value="">— Sélectionner un tarif —</option>
                {(availableTariffs ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.tariff_id} ({t.currency})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-foreground-muted mb-1.5">Type connecteur</label>
                <select
                  value={form.connector_type}
                  onChange={(e) => setForm({ ...form, connector_type: e.target.value })}
                  className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm focus:outline-none focus:border-primary/50"
                >
                  <option value="AC">AC</option>
                  <option value="DC">DC</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-foreground-muted mb-1.5">Priorité</label>
                <input
                  type="number"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
                  className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm focus:outline-none focus:border-primary/50"
                />
              </div>
            </div>
            {error && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
            )}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-xl text-sm text-foreground-muted hover:text-foreground transition-colors">
                Annuler
              </button>
              <button
                type="submit"
                disabled={isLoading || !form.station_id || !form.tariff_id}
                className="flex-1 py-2.5 bg-primary text-background rounded-xl text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                Assigner
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

// ── Delete Confirmation Modal ─────────────────────────────

function DeleteConfirmModal({
  tariff,
  onConfirm,
  onCancel,
  isLoading,
}: {
  tariff: StationTariffRow;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onCancel} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-surface border border-border rounded-2xl w-full max-w-sm shadow-2xl p-6">
          <h2 className="font-heading font-bold text-lg mb-2">Supprimer cette affectation ?</h2>
          <p className="text-sm text-foreground-muted mb-6">
            L'affectation du tarif <strong className="text-foreground">{tariff.ocpi_tariffs?.tariff_id ?? "—"}</strong> à la station <strong className="text-foreground">{tariff.stations?.name ?? "—"}</strong> sera supprimée. Le tarif OCPI lui-même ne sera pas supprimé.
          </p>
          <div className="flex gap-3">
            <button onClick={onCancel} className="flex-1 py-2.5 border border-border rounded-xl text-sm text-foreground-muted hover:text-foreground transition-colors">
              Annuler
            </button>
            <button
              onClick={onConfirm}
              disabled={isLoading}
              className="flex-1 py-2.5 bg-red-500 text-white rounded-xl text-sm font-semibold hover:bg-red-600 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
              Supprimer
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Create OCPI Tariff Modal ─────────────────────────────

function CreateOcpiTariffModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [tariffId, setTariffId] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [tariffType, setTariffType] = useState("REGULAR");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Visual builder state — starts with one default ENERGY element
  const [tariffValue, setTariffValue] = useState({
    elements: [
      {
        price_components: [
          { type: "ENERGY", price: 0.35, vat: 20, step_size: 1 },
        ],
      },
    ],
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!tariffId.trim()) { setError("L'identifiant du tarif est requis"); return; }

    const elements = tariffValue?.elements ?? [];
    const hasComponents = elements.some(
      (el: any) => el.price_components?.length > 0
    );
    if (!hasComponents) { setError("Au moins une composante tarifaire est requise"); return; }

    setSaving(true);
    setError(null);

    const { error: insertError } = await supabase.from("ocpi_tariffs").insert({
      tariff_id: tariffId.trim().toUpperCase(),
      currency: currency,
      type: tariffType,
      elements: elements,
      country_code: "FR",
      party_id: "EZD",
      last_updated: new Date().toISOString(),
    });

    setSaving(false);
    if (insertError) {
      if (insertError.code === "23505") setError("Un tarif avec cet identifiant existe déjà");
      else setError(insertError.message);
      return;
    }

    onCreated();
  }

  const inputClass = "w-full px-3 py-2.5 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50 transition-colors";

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed inset-x-4 top-[3%] bottom-[3%] md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[740px] bg-surface border border-border rounded-2xl z-50 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="font-heading font-bold text-lg">Créer un tarif OCPI</h2>
            <p className="text-xs text-foreground-muted mt-0.5">Grille tarifaire conforme OCPI 2.2.1 pour Gireve</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-elevated rounded-lg transition-colors">
            <X className="w-5 h-5 text-foreground-muted" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Identification */}
          <div>
            <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-3">Identification</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-foreground-muted mb-1.5">ID tarif *</label>
                <input
                  type="text"
                  value={tariffId}
                  onChange={(e) => setTariffId(e.target.value)}
                  placeholder="STANDARD-AC"
                  className={cn(inputClass, "font-mono uppercase")}
                />
              </div>
              <div>
                <label className="block text-xs text-foreground-muted mb-1.5">Devise</label>
                <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
                  <option value="EUR">EUR (€)</option>
                  <option value="USD">USD ($)</option>
                  <option value="GBP">GBP (£)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-foreground-muted mb-1.5">Type</label>
                <select value={tariffType} onChange={(e) => setTariffType(e.target.value)} className={inputClass}>
                  <option value="REGULAR">Régulier</option>
                  <option value="AD_HOC_PAYMENT">Paiement ad hoc</option>
                  <option value="PROFILE_GREEN">Profil vert</option>
                  <option value="PROFILE_CHEAP">Profil économique</option>
                </select>
              </div>
            </div>
          </div>

          {/* Visual Tariff Builder */}
          <TariffVisualBuilder
            value={tariffValue}
            onChange={setTariffValue}
            showJsonToggle={true}
          />

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <button onClick={onClose} className="px-4 py-2.5 text-sm font-medium text-foreground-muted hover:text-foreground transition-colors">
            Annuler
          </button>
          <button
            onClick={(e) => handleSubmit(e as any)}
            disabled={saving || !tariffId.trim()}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-background rounded-xl text-sm font-semibold hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Creer le tarif
          </button>
        </div>
      </div>
    </>
  );
}

// ── Simulate Session Cost Modal ────────────────────────

function SimulateSessionCostModal({
  onClose,
  ocpiTariffs,
}: {
  onClose: () => void;
  ocpiTariffs: OcpiTariff[];
}) {
  const [energy, setEnergy] = useState("20");
  const [duration, setDuration] = useState("60");
  const [parking, setParking] = useState("0");
  const [selectedTariffId, setSelectedTariffId] = useState(ocpiTariffs[0]?.id ?? "");
  const [result, setResult] = useState<number | null>(null);

  async function handleSimulate() {
    try {
      const { data, error } = await supabase.rpc("calculate_session_cost", {
        p_energy_kwh: parseFloat(energy) || 0,
        p_duration_minutes: parseFloat(duration) || 0,
        p_tariff_id: selectedTariffId,
      });
      if (!error && data != null) setResult(data);
      else {
        // Fallback: compute manually from tariff elements
        const tariff = ocpiTariffs.find((t) => t.id === selectedTariffId);
        const comps = parseOcpiElements(tariff?.elements);
        let total = 0;
        for (const c of comps) {
          if (c.type === "ENERGY") total += parseFloat(energy) * Number(c.price);
          if (c.type === "TIME") total += (parseFloat(duration) / 60) * Number(c.price);
          if (c.type === "FLAT") total += Number(c.price);
          if (c.type === "PARKING_TIME") total += (parseFloat(parking) / 60) * Number(c.price);
        }
        setResult(Math.round(total * 100) / 100);
      }
    } catch {
      setResult(null);
    }
  }

  const inputClass = "w-full px-3 py-2 bg-background border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <h2 className="text-lg font-heading font-bold text-foreground mb-4">Simuler le cout d'une session</h2>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-foreground-muted">Tarif</label>
            <select value={selectedTariffId} onChange={(e) => setSelectedTariffId(e.target.value)} className={inputClass}>
              {ocpiTariffs.map((t) => <option key={t.id} value={t.id}>{t.tariff_id} ({t.currency})</option>)}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-foreground-muted">Energie (kWh)</label>
              <input type="number" value={energy} onChange={(e) => setEnergy(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="text-xs text-foreground-muted">Duree (min)</label>
              <input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="text-xs text-foreground-muted">Parking (min)</label>
              <input type="number" value={parking} onChange={(e) => setParking(e.target.value)} className={inputClass} />
            </div>
          </div>
          <button onClick={handleSimulate} className="w-full px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors">
            Calculer
          </button>
          {result != null && (
            <div className="p-4 bg-primary/5 border border-primary/20 rounded-xl text-center">
              <p className="text-2xl font-heading font-bold text-primary">{result.toFixed(2)} EUR</p>
              <p className="text-xs text-foreground-muted mt-1">Cout estime de la session</p>
            </div>
          )}
        </div>
        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="px-4 py-2 text-sm text-foreground-muted hover:text-foreground transition-colors">Fermer</button>
        </div>
      </div>
    </div>
  );
}

// ── Bulk Assign Modal ──────────────────────────────────

function BulkAssignModal({
  onClose,
  ocpiTariffs,
  onSubmit,
  isLoading,
}: {
  onClose: () => void;
  ocpiTariffs: OcpiTariff[];
  onSubmit: (tariffId: string, territoryCode: string) => void;
  isLoading: boolean;
}) {
  const [selectedTariffId, setSelectedTariffId] = useState(ocpiTariffs[0]?.id ?? "");
  const [territoryCode, setTerritoryCode] = useState("");

  const inputClass = "w-full px-3 py-2 bg-background border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <h2 className="text-lg font-heading font-bold text-foreground mb-2">Appliquer un tarif en masse</h2>
        <p className="text-sm text-foreground-muted mb-4">Assigne un tarif a toutes les stations d'un territoire.</p>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-foreground-muted">Tarif OCPI</label>
            <select value={selectedTariffId} onChange={(e) => setSelectedTariffId(e.target.value)} className={inputClass}>
              {ocpiTariffs.map((t) => <option key={t.id} value={t.id}>{t.tariff_id}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-foreground-muted">Code territoire</label>
            <input type="text" placeholder="ex: MTQ, GLP, GUF..." value={territoryCode} onChange={(e) => setTerritoryCode(e.target.value)} className={inputClass} />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-foreground-muted hover:text-foreground transition-colors">Annuler</button>
          <button
            onClick={() => onSubmit(selectedTariffId, territoryCode)}
            disabled={isLoading || !selectedTariffId || !territoryCode.trim()}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40"
          >
            {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
            Appliquer
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Edit OCPI Tariff Modal ─────────────────────────────

function EditOcpiTariffModal({
  tariff,
  onClose,
  onSave,
  isLoading,
  error,
}: {
  tariff: OcpiTariff;
  onClose: () => void;
  onSave: (data: { id: string; tariff_id: string; currency: string; type: string | null; elements: unknown }) => void;
  isLoading: boolean;
  error: string | null;
}) {
  const [tariffId, setTariffId] = useState(tariff.tariff_id);
  const [currency, setCurrency] = useState(tariff.currency);
  const [tariffType, setTariffType] = useState(tariff.type ?? "REGULAR");
  const [tariffValue, setTariffValue] = useState({
    elements: Array.isArray(tariff.elements) ? tariff.elements : [{ price_components: [{ type: "ENERGY", price: 0.35, vat: 20, step_size: 1 }] }],
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!tariffId.trim()) return;
    onSave({
      id: tariff.id,
      tariff_id: tariffId.trim().toUpperCase(),
      currency,
      type: tariffType,
      elements: tariffValue.elements,
    });
  }

  const inputClass = "w-full px-3 py-2.5 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50 transition-colors";

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed inset-x-4 top-[3%] bottom-[3%] md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[740px] bg-surface border border-border rounded-2xl z-50 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="font-heading font-bold text-lg">Modifier le tarif OCPI</h2>
            <p className="text-xs text-foreground-muted mt-0.5">Modification de {tariff.tariff_id}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-elevated rounded-lg transition-colors">
            <X className="w-5 h-5 text-foreground-muted" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          <div>
            <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-3">Identification</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-foreground-muted mb-1.5">ID tarif *</label>
                <input
                  type="text"
                  value={tariffId}
                  onChange={(e) => setTariffId(e.target.value)}
                  placeholder="STANDARD-AC"
                  className={cn(inputClass, "font-mono uppercase")}
                />
              </div>
              <div>
                <label className="block text-xs text-foreground-muted mb-1.5">Devise</label>
                <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
                  <option value="EUR">EUR</option>
                  <option value="USD">USD</option>
                  <option value="GBP">GBP</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-foreground-muted mb-1.5">Type</label>
                <select value={tariffType} onChange={(e) => setTariffType(e.target.value)} className={inputClass}>
                  <option value="REGULAR">Régulier</option>
                  <option value="AD_HOC_PAYMENT">Paiement ad hoc</option>
                  <option value="PROFILE_GREEN">Profil vert</option>
                  <option value="PROFILE_CHEAP">Profil économique</option>
                </select>
              </div>
            </div>
          </div>

          <TariffVisualBuilder
            value={tariffValue}
            onChange={setTariffValue}
            showJsonToggle={true}
          />

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}
        </form>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <button onClick={onClose} className="px-4 py-2.5 text-sm font-medium text-foreground-muted hover:text-foreground transition-colors">
            Annuler
          </button>
          <button
            onClick={(e) => handleSubmit(e as any)}
            disabled={isLoading || !tariffId.trim()}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-background rounded-xl text-sm font-semibold hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
            Enregistrer
          </button>
        </div>
      </div>
    </>
  );
}

// ── Delete OCPI Tariff Confirmation Modal ──────────────

function DeleteOcpiTariffConfirmModal({
  tariff,
  assignmentCount,
  onConfirm,
  onCancel,
  isLoading,
}: {
  tariff: OcpiTariff;
  assignmentCount: number;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onCancel} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-surface border border-border rounded-2xl w-full max-w-sm shadow-2xl p-6">
          <h2 className="font-heading font-bold text-lg mb-2">Supprimer ce tarif OCPI ?</h2>
          <p className="text-sm text-foreground-muted mb-4">
            Le tarif <strong className="text-foreground">{tariff.tariff_id}</strong> sera définitivement supprimé.
          </p>
          {assignmentCount > 0 && (
            <div className="flex items-center gap-2 p-3 bg-warning/10 border border-warning/20 rounded-xl mb-4">
              <AlertCircle className="w-4 h-4 text-warning shrink-0" />
              <p className="text-xs text-warning">
                {assignmentCount} affectation{assignmentCount > 1 ? "s" : ""} station liée{assignmentCount > 1 ? "s" : ""} sera{assignmentCount > 1 ? "ont" : ""} également supprimée{assignmentCount > 1 ? "s" : ""}.
              </p>
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={onCancel} className="flex-1 py-2.5 border border-border rounded-xl text-sm text-foreground-muted hover:text-foreground transition-colors">
              Annuler
            </button>
            <button
              onClick={onConfirm}
              disabled={isLoading}
              className="flex-1 py-2.5 bg-red-500 text-white rounded-xl text-sm font-semibold hover:bg-red-600 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
              Supprimer
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Edit Station Tariff Assignment Modal ───────────────

function EditAssignmentModal({
  assignment,
  onClose,
  onSave,
  isLoading,
  error,
}: {
  assignment: StationTariffRow;
  onClose: () => void;
  onSave: (data: { id: string; tariff_id: string; connector_type: string; priority: number; valid_from: string | null; valid_to: string | null }) => void;
  isLoading: boolean;
  error: string | null;
}) {
  const [form, setForm] = useState({
    tariff_id: assignment.tariff_id ?? "",
    connector_type: assignment.connector_type ?? "AC",
    priority: assignment.priority,
    valid_from: assignment.valid_from ? assignment.valid_from.slice(0, 10) : "",
    valid_to: assignment.valid_to ? assignment.valid_to.slice(0, 10) : "",
  });

  // Fetch OCPI tariffs for dropdown
  const { data: availableTariffs } = useQuery({
    queryKey: ["ocpi-tariffs-select-edit"],
    queryFn: async () => {
      const { data } = await supabase.from("ocpi_tariffs").select("id, tariff_id, currency").order("tariff_id");
      return data ?? [];
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.tariff_id) return;
    onSave({
      id: assignment.id,
      tariff_id: form.tariff_id,
      connector_type: form.connector_type,
      priority: form.priority,
      valid_from: form.valid_from || null,
      valid_to: form.valid_to || null,
    });
  }

  const inputClass = "w-full px-3 py-2.5 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50 transition-colors";

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-surface border border-border rounded-2xl w-full max-w-lg shadow-2xl">
          <div className="flex items-center justify-between p-5 border-b border-border">
            <div>
              <h2 className="font-heading font-bold text-lg">Modifier l'affectation</h2>
              <p className="text-xs text-foreground-muted mt-0.5">Station : {assignment.stations?.name ?? "—"}</p>
            </div>
            <button onClick={onClose} className="p-1.5 hover:bg-surface-elevated rounded-lg transition-colors">
              <X className="w-5 h-5 text-foreground-muted" />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <div>
              <label className="block text-xs text-foreground-muted mb-1.5">Tarif OCPI *</label>
              <select
                required
                value={form.tariff_id}
                onChange={(e) => setForm({ ...form, tariff_id: e.target.value })}
                className={inputClass}
              >
                <option value="">-- Sélectionner un tarif --</option>
                {(availableTariffs ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.tariff_id} ({t.currency})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-foreground-muted mb-1.5">Type connecteur</label>
                <select
                  value={form.connector_type}
                  onChange={(e) => setForm({ ...form, connector_type: e.target.value })}
                  className={inputClass}
                >
                  <option value="AC">AC</option>
                  <option value="DC">DC</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-foreground-muted mb-1.5">Priorité</label>
                <input
                  type="number"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
                  className={inputClass}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-foreground-muted mb-1.5">Valide à partir du</label>
                <input
                  type="date"
                  value={form.valid_from}
                  onChange={(e) => setForm({ ...form, valid_from: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs text-foreground-muted mb-1.5">Valide jusqu'au</label>
                <input
                  type="date"
                  value={form.valid_to}
                  onChange={(e) => setForm({ ...form, valid_to: e.target.value })}
                  className={inputClass}
                />
              </div>
            </div>
            {error && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
            )}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-xl text-sm text-foreground-muted hover:text-foreground transition-colors">
                Annuler
              </button>
              <button
                type="submit"
                disabled={isLoading || !form.tariff_id}
                className="flex-1 py-2.5 bg-primary text-background rounded-xl text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                Enregistrer
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
