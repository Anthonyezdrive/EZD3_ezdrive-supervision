import { useState, useMemo } from "react";
import { PageHelp } from "@/components/ui/PageHelp";
import {
  Activity,
  Zap,
  Clock,
  BatteryCharging,
  ChevronLeft,
  ChevronRight,
  Download,
  Search,
  FileText,
  X,
  AlertCircle,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useCpo } from "@/contexts/CpoContext";
import { Skeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { downloadCSV, todayISO } from "@/lib/export";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────

interface Transaction {
  id: string;
  transaction_id: number;
  chargepoint_id: string;
  connector_id: number;
  consumer_id: string | null;
  id_tag: string | null;
  status: "Active" | "Completed" | "Faulted" | "Timeout";
  started_at: string;
  stopped_at: string | null;
  meter_start: number;
  meter_stop: number | null;
  energy_kwh: number | null;
  stop_reason: string | null;
  ocpp_chargepoints: {
    identity: string;
    stations: { name: string; city: string | null; address: string | null } | null;
  } | null;
}

/** Safely extract station info from nested join */
function getStation(tx: Transaction): { name: string; city: string; address: string } {
  const s = tx.ocpp_chargepoints?.stations;
  return {
    name: s?.name ?? tx.ocpp_chargepoints?.identity ?? tx.chargepoint_id,
    city: s?.city ?? "",
    address: s?.address ?? "",
  };
}

interface OcpiCdr {
  id: string;
  cdr_id: string;
  start_date_time: string;
  end_date_time: string;
  total_energy: number;
  total_time: number; // hours
  total_cost: number;
  total_cost_incl_vat: number | null;
  total_vat: number | null;
  vat_rate: number | null;
  total_retail_cost: number | null;
  total_retail_cost_incl_vat: number | null;
  currency: string;
  source: string | null;
  gfx_cdr_id: string | null;
  customer_external_id: string | null;
  cdr_location: { name?: string; address?: string; city?: string } | null;
  cdr_token: { uid?: string; type?: string } | null;
  station_id: string | null;
  country_code: string;
  party_id: string;
}

type StatusFilter = "all" | "Active" | "Completed" | "Faulted" | "Timeout" | "Suspect" | "Deposé";

const PAGE_SIZE = 20;

// ── Status config ────────────────────────────────────────────

const STATUS_CONFIG: Record<
  Transaction["status"] | "Suspect" | "Deposé",
  {
    label: string;
    color: string;
    bgClass: string;
    textClass: string;
    borderClass: string;
    pulse?: boolean;
  }
> = {
  Active: {
    label: "Active",
    color: "#00D4AA",
    bgClass: "bg-[#00D4AA]/10",
    textClass: "text-[#00D4AA]",
    borderClass: "border-[#00D4AA]/30",
    pulse: true,
  },
  Completed: {
    label: "Terminée",
    color: "#4ECDC4",
    bgClass: "bg-[#4ECDC4]/10",
    textClass: "text-[#4ECDC4]",
    borderClass: "border-[#4ECDC4]/30",
  },
  Faulted: {
    label: "Erreur",
    color: "#FF6B6B",
    bgClass: "bg-[#FF6B6B]/10",
    textClass: "text-[#FF6B6B]",
    borderClass: "border-[#FF6B6B]/30",
  },
  Timeout: {
    label: "Timeout",
    color: "#FFA726",
    bgClass: "bg-[#FFA726]/10",
    textClass: "text-[#FFA726]",
    borderClass: "border-[#FFA726]/30",
  },
  Suspect: {
    label: "Suspecte",
    color: "#F39C12",
    bgClass: "bg-[#F39C12]/10",
    textClass: "text-[#F39C12]",
    borderClass: "border-[#F39C12]/30",
  },
  Deposé: {
    label: "Déposée",
    color: "#8892B0",
    bgClass: "bg-[#8892B0]/10",
    textClass: "text-[#8892B0]",
    borderClass: "border-[#8892B0]/30",
  },
};

const FILTER_TABS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "Toutes" },
  { key: "Active", label: "Actives" },
  { key: "Completed", label: "Terminées" },
  { key: "Faulted", label: "En erreur" },
  { key: "Suspect", label: "Suspectes" },
  { key: "Deposé", label: "Déposées" },
  { key: "Timeout", label: "Timeout" },
];

// ── Helpers ──────────────────────────────────────────────────

function formatSessionDuration(
  startedAt: string,
  stoppedAt: string | null
): string {
  if (!stoppedAt) {
    const now = new Date();
    const start = new Date(startedAt);
    const diffMs = now.getTime() - start.getTime();
    const totalMin = Math.floor(diffMs / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h === 0) return `${m}m`;
    return `${h}h ${m}m`;
  }
  const start = new Date(startedAt);
  const stop = new Date(stoppedAt);
  const diffMs = stop.getTime() - start.getTime();
  const totalMin = Math.floor(diffMs / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatEnergy(kwh: number | null): string {
  if (kwh === null || kwh === undefined) return "—";
  return `${kwh.toFixed(1)} kWh`;
}

// ── SessionDetailDrawer ───────────────────────────────────────

function SessionDetailDrawer({
  session,
  onClose,
}: {
  session: Transaction;
  onClose: () => void;
}) {
  const config =
    STATUS_CONFIG[session.status as keyof typeof STATUS_CONFIG] ??
    STATUS_CONFIG["Completed"];

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-surface border-l border-border z-50 overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-heading font-bold text-lg">
            Transaction #{session.transaction_id}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-surface-elevated rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-foreground-muted" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Status */}
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold ${config.bgClass} ${config.textClass} ${config.borderClass}`}
            >
              {config.pulse ? (
                <span className="relative flex h-1.5 w-1.5">
                  <span
                    className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                    style={{ backgroundColor: config.color }}
                  />
                  <span
                    className="relative inline-flex rounded-full h-1.5 w-1.5"
                    style={{ backgroundColor: config.color }}
                  />
                </span>
              ) : (
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: config.color }}
                />
              )}
              {config.label}
            </span>
          </div>

          {/* Station */}
          <div className="bg-surface-elevated border border-border rounded-xl p-4 space-y-1">
            <p className="text-xs text-foreground-muted">Station</p>
            <p className="text-sm font-semibold text-foreground">
              {getStation(session).name}
            </p>
            <p className="text-xs text-foreground-muted">
              {getStation(session).address
                ? `${getStation(session).address}, `
                : ""}
              {getStation(session).city}
            </p>
          </div>

          {/* Details grid */}
          <div className="grid grid-cols-2 gap-3">
            <DetailField label="ID Transaction" value={`#${session.transaction_id}`} mono />
            <DetailField label="Connecteur" value={String(session.connector_id)} />
            <DetailField label="ChargePoint ID" value={session.chargepoint_id} mono />
            <DetailField label="Tag RFID" value={session.id_tag ?? "—"} mono />
            <DetailField label="Début" value={formatDateTime(session.started_at)} />
            <DetailField
              label="Fin"
              value={session.stopped_at ? formatDateTime(session.stopped_at) : "En cours..."}
            />
            <DetailField
              label="Durée"
              value={formatSessionDuration(session.started_at, session.stopped_at)}
            />
            <DetailField
              label="Énergie"
              value={formatEnergy(session.energy_kwh)}
            />
            <DetailField
              label="Compteur départ"
              value={`${session.meter_start} Wh`}
            />
            <DetailField
              label="Compteur fin"
              value={session.meter_stop !== null ? `${session.meter_stop} Wh` : "—"}
            />
          </div>

          {/* Stop reason */}
          {session.stop_reason && (
            <div className="bg-surface-elevated border border-border rounded-xl p-4">
              <p className="text-xs text-foreground-muted mb-1">Raison d'arrêt</p>
              <p className="text-sm text-foreground font-mono">
                {session.stop_reason}
              </p>
            </div>
          )}

          {/* Consumer ID */}
          {session.consumer_id && (
            <div className="bg-surface-elevated border border-border rounded-xl p-4">
              <p className="text-xs text-foreground-muted mb-1">Consumer ID</p>
              <p className="text-sm text-foreground font-mono">
                {session.consumer_id}
              </p>
            </div>
          )}

          {/* Technical ID */}
          <div className="pt-4 border-t border-border">
            <p className="text-xs text-foreground-muted">
              UUID:{" "}
              <span className="font-mono text-foreground/60">{session.id}</span>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

function DetailField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="bg-surface-elevated border border-border rounded-xl px-3 py-2.5">
      <p className="text-[10px] text-foreground-muted mb-0.5">{label}</p>
      <p className={`text-sm text-foreground ${mono ? "font-mono" : "font-medium"}`}>
        {value}
      </p>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────

export function SessionsPage() {
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedSession, setSelectedSession] = useState<Transaction | null>(null);
  const [activeView, setActiveView] = useState<"ocpp" | "cdr">("ocpp");
  const { selectedCpoId } = useCpo();

  // ── Resolve station IDs and chargepoint IDs for selected CPO ──
  const { data: cpoFilterIds, isError: _isCpoFilterError } = useQuery({
    queryKey: ["cpo-filter-ids", selectedCpoId ?? "all"],
    enabled: !!selectedCpoId,
    queryFn: async () => {
      const { data: stns } = await supabase.from("stations").select("id").eq("cpo_id", selectedCpoId!);
      const stationIds = (stns ?? []).map((s: { id: string }) => s.id);
      if (stationIds.length === 0) return { stationIds: [], chargepointIds: [] };
      const { data: cps } = await supabase.from("ocpp_chargepoints").select("id").in("station_id", stationIds);
      return { stationIds, chargepointIds: (cps ?? []).map((c: { id: string }) => c.id) };
    },
    staleTime: 60000,
  });

  // ── Main sessions query (server-side paginated) ──
  const {
    data: sessionsData,
    isLoading,
    isError,
    refetch,
    dataUpdatedAt: _dataUpdatedAt,
  } = useQuery({
    queryKey: ["sessions", page, statusFilter, dateFrom, dateTo, searchQuery, selectedCpoId ?? "all"],
    retry: false,
    queryFn: async () => {
      try {
        if (selectedCpoId && cpoFilterIds?.chargepointIds.length === 0) {
          return { data: [] as Transaction[], total: 0 };
        }

        let query = supabase
          .from("ocpp_transactions")
          .select("*, ocpp_chargepoints(identity, stations(name, city, address))", { count: "exact" })
          .order("started_at", { ascending: false })
          .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

        if (selectedCpoId && cpoFilterIds?.chargepointIds.length) {
          query = query.in("chargepoint_id", cpoFilterIds.chargepointIds);
        }

        if (statusFilter === "Suspect") {
          query = query.eq("status", "Completed").or("energy_kwh.is.null,energy_kwh.eq.0");
        } else if (statusFilter === "Deposé") {
          query = query.not("stop_reason", "is", null).eq("status", "Completed");
        } else if (statusFilter !== "all") {
          query = query.eq("status", statusFilter);
        }

        if (dateFrom) query = query.gte("started_at", dateFrom);
        if (dateTo) query = query.lte("started_at", dateTo + "T23:59:59");

        if (searchQuery.trim()) {
          query = query.or(`transaction_id.ilike.%${searchQuery.trim()}%,chargepoint_id.ilike.%${searchQuery.trim()}%`);
        }

        const { data, error, count } = await query;
        if (error) { console.warn("[Sessions] main query:", error.message); return { data: [] as Transaction[], total: 0 }; }
        return { data: (data ?? []) as Transaction[], total: count ?? 0 };
      } catch { return { data: [] as Transaction[], total: 0 }; }
    },
  });

  // ── Aggregate: total sessions ──
  const { data: totalCount, isError: _isTotalCountError } = useQuery({
    queryKey: ["sessions-total", selectedCpoId ?? "all"],
    retry: false,
    queryFn: async () => {
      try {
        if (selectedCpoId && cpoFilterIds?.chargepointIds.length === 0) return 0;
        let query = supabase
          .from("ocpp_transactions")
          .select("*", { count: "exact", head: true });
        if (selectedCpoId && cpoFilterIds?.chargepointIds.length) {
          query = query.in("chargepoint_id", cpoFilterIds.chargepointIds);
        }
        const { count, error } = await query;
        if (error) return 0;
        return count ?? 0;
      } catch { return 0; }
    },
  });

  // ── Aggregate: active sessions ──
  const { data: activeCount, isError: _isActiveCountError } = useQuery({
    queryKey: ["sessions-active", selectedCpoId ?? "all"],
    retry: false,
    queryFn: async () => {
      try {
        if (selectedCpoId && cpoFilterIds?.chargepointIds.length === 0) return 0;
        let query = supabase
          .from("ocpp_transactions")
          .select("*", { count: "exact", head: true })
          .eq("status", "Active");
        if (selectedCpoId && cpoFilterIds?.chargepointIds.length) {
          query = query.in("chargepoint_id", cpoFilterIds.chargepointIds);
        }
        const { count, error } = await query;
        if (error) return 0;
        return count ?? 0;
      } catch { return 0; }
    },
  });

  // ── Aggregate: total energy ──
  const { data: totalEnergy, isError: _isTotalEnergyError } = useQuery({
    queryKey: ["sessions-energy", selectedCpoId ?? "all"],
    retry: false,
    queryFn: async () => {
      try {
        if (selectedCpoId && cpoFilterIds?.chargepointIds.length === 0) return 0;
        let query = supabase
          .from("ocpp_transactions")
          .select("energy_kwh")
          .not("energy_kwh", "is", null);
        if (selectedCpoId && cpoFilterIds?.chargepointIds.length) {
          query = query.in("chargepoint_id", cpoFilterIds.chargepointIds);
        }
        const { data, error } = await query;
        if (error) return 0;
        return data?.reduce((sum: number, r: { energy_kwh: number | null }) => sum + (r.energy_kwh ?? 0), 0) ?? 0;
      } catch { return 0; }
    },
  });

  // ── Aggregate: average duration ──
  const { data: avgDuration, isError: _isAvgDurationError } = useQuery({
    queryKey: ["sessions-avg-duration", selectedCpoId ?? "all"],
    retry: false,
    queryFn: async () => {
      try {
        if (selectedCpoId && cpoFilterIds?.chargepointIds.length === 0) return 0;
        let query = supabase
          .from("ocpp_transactions")
          .select("started_at, stopped_at")
          .not("stopped_at", "is", null)
          .limit(1000);
        if (selectedCpoId && cpoFilterIds?.chargepointIds.length) {
          query = query.in("chargepoint_id", cpoFilterIds.chargepointIds);
        }
        const { data, error } = await query;
        if (error || !data || data.length === 0) return 0;
        const totalMinutes = data.reduce((sum: number, r: { started_at: string; stopped_at: string | null }) => {
          const start = new Date(r.started_at).getTime();
          const stop = new Date(r.stopped_at!).getTime();
          return sum + (stop - start) / 60000;
        }, 0);
        return Math.round(totalMinutes / data.length);
      } catch { return 0; }
    },
  });

  // ── CDR OCPI query ──
  const {
    data: cdrData,
    isLoading: cdrLoading,
    isError: _isCdrError,
    refetch: cdrRefetch,
  } = useQuery({
    queryKey: ["ocpi-cdrs", page, dateFrom, dateTo, selectedCpoId ?? "all"],
    enabled: activeView === "cdr",
    retry: false,
    queryFn: async () => {
      try {
        if (selectedCpoId && cpoFilterIds?.stationIds.length === 0) {
          return { data: [] as OcpiCdr[], total: 0 };
        }
        let query = supabase
          .from("ocpi_cdrs")
          .select("*", { count: "exact" })
          .order("start_date_time", { ascending: false })
          .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
        if (selectedCpoId && cpoFilterIds?.stationIds.length) {
          query = query.in("station_id", cpoFilterIds.stationIds);
        }
        if (dateFrom) query = query.gte("start_date_time", dateFrom);
        if (dateTo) query = query.lte("start_date_time", dateTo + "T23:59:59");
        const { data, error, count } = await query;
        if (error) { console.warn("[CDR] query:", error.message); return { data: [] as OcpiCdr[], total: 0 }; }
        return { data: (data ?? []) as OcpiCdr[], total: count ?? 0 };
      } catch { return { data: [] as OcpiCdr[], total: 0 }; }
    },
  });

  // ── Client-side search filter on displayed page ──
  const filteredSessions = useMemo(() => {
    if (!sessionsData?.data) return [];
    if (!searchQuery.trim()) return sessionsData.data;
    const q = searchQuery.toLowerCase();
    return sessionsData.data.filter(
      (t) => {
        const stn = getStation(t);
        return (
          String(t.transaction_id).includes(q) ||
          t.chargepoint_id.toLowerCase().includes(q) ||
          stn.name.toLowerCase().includes(q) ||
          stn.city.toLowerCase().includes(q) ||
          (t.id_tag?.toLowerCase().includes(q) ?? false)
        );
      }
    );
  }, [sessionsData?.data, searchQuery]);

  const totalPages = Math.max(
    1,
    Math.ceil((sessionsData?.total ?? 0) / PAGE_SIZE)
  );

  function handleFilterChange(filter: StatusFilter) {
    setStatusFilter(filter);
    setPage(0);
  }

  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    try {
      setExporting(true);

      let query = supabase
        .from("ocpp_transactions")
        .select("*, ocpp_chargepoints(identity, stations(name, city, address))")
        .order("started_at", { ascending: false });

      if (selectedCpoId && cpoFilterIds?.chargepointIds.length) {
        query = query.in("chargepoint_id", cpoFilterIds.chargepointIds);
      }

      if (statusFilter === "Suspect") {
        query = query.eq("status", "Completed").or("energy_kwh.is.null,energy_kwh.eq.0");
      } else if (statusFilter === "Deposé") {
        query = query.not("stop_reason", "is", null).eq("status", "Completed");
      } else if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      if (dateFrom) query = query.gte("started_at", dateFrom);
      if (dateTo) query = query.lte("started_at", dateTo + "T23:59:59");

      if (searchQuery.trim()) {
        query = query.or(`transaction_id.ilike.%${searchQuery.trim()}%,chargepoint_id.ilike.%${searchQuery.trim()}%`);
      }

      const { data } = await query;
      if (!data?.length) return;

      const rows = (data as Transaction[]).map((t) => ({
        "ID Transaction": t.transaction_id,
        Borne: getStation(t).name,
        Ville: getStation(t).city,
        Connecteur: t.connector_id,
        "Tag RFID": t.id_tag ?? "",
        Début: t.started_at,
        Fin: t.stopped_at ?? "",
        Durée: formatSessionDuration(t.started_at, t.stopped_at),
        "Énergie (kWh)": t.energy_kwh ?? "",
        Statut: t.status,
        "Raison arrêt": t.stop_reason ?? "",
      }));
      downloadCSV(rows, `ezdrive-sessions-cdr-${todayISO()}.csv`);
    } catch (err) {
      console.error("[Export] error:", err);
    } finally {
      setExporting(false);
    }
  }

  async function handleCdrExport() {
    try {
      setExporting(true);

      let query = supabase
        .from("ocpi_cdrs")
        .select("*")
        .order("start_date_time", { ascending: false });

      if (selectedCpoId && cpoFilterIds?.stationIds.length) {
        query = query.in("station_id", cpoFilterIds.stationIds);
      }

      if (dateFrom) query = query.gte("start_date_time", dateFrom);
      if (dateTo) query = query.lte("start_date_time", dateTo + "T23:59:59");

      const { data } = await query;
      if (!data?.length) return;

      const rows = (data as OcpiCdr[]).map((c) => ({
        "CDR ID": c.cdr_id,
        "GFX CDR ID": c.gfx_cdr_id ?? "",
        Source: c.source ?? "",
        Station: (c.cdr_location as any)?.name ?? "",
        Ville: (c.cdr_location as any)?.city ?? "",
        "Token UID": (c.cdr_token as any)?.uid ?? "",
        Début: c.start_date_time,
        Fin: c.end_date_time,
        "Énergie (kWh)": c.total_energy,
        "Durée (h)": c.total_time,
        "Coût HT (€)": c.total_cost,
        "TVA (€)": c.total_vat ?? "",
        "Taux TVA (%)": c.vat_rate ?? "",
        "Coût TTC (€)": c.total_cost_incl_vat ?? "",
        "Retail HT (€)": c.total_retail_cost ?? "",
        "Retail TTC (€)": c.total_retail_cost_incl_vat ?? "",
        Devise: c.currency,
        "Client ext. ID": c.customer_external_id ?? "",
      }));
      downloadCSV(rows, `ezdrive-cdrs-${todayISO()}.csv`);
    } catch (err) {
      console.error("[CDR Export] error:", err);
    } finally {
      setExporting(false);
    }
  }

  function formatAvgDuration(minutes: number): string {
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  // ── Pagination helpers ──
  function getPaginationRange(): (number | "...")[] {
    const pages: (number | "...")[] = [];
    const total = totalPages;

    if (total <= 7) {
      for (let i = 0; i < total; i++) pages.push(i);
      return pages;
    }

    pages.push(0);
    if (page > 2) pages.push("...");

    const start = Math.max(1, page - 1);
    const end = Math.min(total - 2, page + 1);
    for (let i = start; i <= end; i++) pages.push(i);

    if (page < total - 3) pages.push("...");
    pages.push(total - 1);

    return pages;
  }

  // ── KPI loading state ──
  const kpiLoading =
    totalCount === undefined ||
    activeCount === undefined ||
    totalEnergy === undefined ||
    avgDuration === undefined;

  // ── Header th class ──
  const thClass =
    "px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase tracking-wider whitespace-nowrap";

  // suppress unused warning
  void cdrRefetch;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-xl font-bold text-foreground">
            Sessions CDR
          </h1>
          <p className="text-sm text-foreground-muted mt-0.5">
            Historique des sessions de charge
          </p>
        </div>
        <button
          onClick={activeView === "cdr" ? handleCdrExport : handleExport}
          disabled={exporting || (activeView === "cdr" ? !cdrData?.data?.length : !filteredSessions.length)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-border rounded-xl text-xs text-foreground-muted hover:text-foreground hover:border-foreground-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download className="w-3.5 h-3.5" />
          {exporting ? "Export..." : "Export CSV"}
        </button>
      </div>

      <PageHelp
        summary="Historique complet des sessions de charge avec détails énergétiques et financiers"
        items={[
          { label: "Session", description: "Une session = une charge complète, du branchement au débranchement du véhicule." },
          { label: "Énergie (kWh)", description: "Quantité d'électricité consommée pendant la session, mesurée par le compteur de la borne." },
          { label: "Statut", description: "Active (en cours), Completed (terminée), Faulted (erreur), Timeout (dépassement)." },
          { label: "Filtres & export", description: "Filtrez par période, borne ou statut. Exportez en CSV pour la comptabilité." },
        ]}
        tips={["Les sessions 'Active' depuis plus de 24h sont généralement des anomalies à investiguer."]}
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

      {/* View tabs */}
      <div className="flex gap-1 bg-surface border border-border rounded-xl p-1 w-fit">
        <button
          onClick={() => { setActiveView("ocpp"); setPage(0); }}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeView === "ocpp"
              ? "bg-primary/15 text-primary"
              : "text-foreground-muted hover:text-foreground"
          }`}
        >
          Sessions OCPP
        </button>
        <button
          onClick={() => { setActiveView("cdr"); setPage(0); }}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeView === "cdr"
              ? "bg-primary/15 text-primary"
              : "text-foreground-muted hover:text-foreground"
          }`}
        >
          CDR Financiers
        </button>
      </div>

      {activeView === "ocpp" && (
        <>
          {/* KPI Row */}
          {kpiLoading ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-surface border border-border rounded-2xl p-5 space-y-3"
                >
                  <div className="flex items-center gap-3">
                    <Skeleton className="w-12 h-12 rounded-xl" />
                    <div className="space-y-1.5">
                      <Skeleton className="h-6 w-16" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Total sessions */}
              <div className="bg-surface border border-border rounded-2xl p-5 flex items-center gap-4 transition-all hover:border-opacity-80">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: "#8892B015" }}
                >
                  <FileText className="w-6 h-6" style={{ color: "#8892B0" }} />
                </div>
                <div>
                  <p className="text-2xl font-heading font-bold text-foreground">
                    {(totalCount ?? 0).toLocaleString("fr-FR")}
                  </p>
                  <p className="text-xs text-foreground-muted mt-0.5">
                    Total sessions
                  </p>
                </div>
              </div>

              {/* Active sessions */}
              <div className="bg-surface border border-[#00D4AA]/30 rounded-2xl p-5 flex items-center gap-4 transition-all hover:border-opacity-80">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: "#00D4AA15" }}
                >
                  <Activity className="w-6 h-6" style={{ color: "#00D4AA" }} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-2xl font-heading font-bold text-foreground">
                      {activeCount ?? 0}
                    </p>
                    {(activeCount ?? 0) > 0 && (
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00D4AA] opacity-75" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#00D4AA]" />
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-foreground-muted mt-0.5">
                    Sessions actives
                  </p>
                </div>
              </div>

              {/* Total energy */}
              <div className="bg-surface border border-[#4ECDC4]/30 rounded-2xl p-5 flex items-center gap-4 transition-all hover:border-opacity-80">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: "#4ECDC415" }}
                >
                  <Zap className="w-6 h-6" style={{ color: "#4ECDC4" }} />
                </div>
                <div>
                  <p className="text-2xl font-heading font-bold text-foreground">
                    {totalEnergy !== undefined
                      ? totalEnergy >= 1000
                        ? `${(totalEnergy / 1000).toFixed(1)} MWh`
                        : `${totalEnergy.toFixed(0)} kWh`
                      : "—"}
                  </p>
                  <p className="text-xs text-foreground-muted mt-0.5">
                    Énergie totale
                  </p>
                </div>
              </div>

              {/* Average duration */}
              <div className="bg-surface border border-border rounded-2xl p-5 flex items-center gap-4 transition-all hover:border-opacity-80">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: "#FFA72615" }}
                >
                  <Clock className="w-6 h-6" style={{ color: "#FFA726" }} />
                </div>
                <div>
                  <p className="text-2xl font-heading font-bold text-foreground">
                    {avgDuration !== undefined
                      ? formatAvgDuration(avgDuration)
                      : "—"}
                  </p>
                  <p className="text-xs text-foreground-muted mt-0.5">
                    Durée moyenne
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Filter tabs + Search + Date range */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              {/* Status filter tabs */}
              <div className="flex flex-wrap items-center gap-1 bg-surface border border-border rounded-xl p-1">
                {FILTER_TABS.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => handleFilterChange(tab.key)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      statusFilter === tab.key
                        ? "bg-primary/15 text-primary border border-primary/30"
                        : "text-foreground-muted hover:text-foreground"
                    }`}
                  >
                    {tab.label}
                    {tab.key === "Active" && (activeCount ?? 0) > 0 && (
                      <span className="ml-1.5 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-[#00D4AA]/15 text-[#00D4AA] text-[10px] font-bold">
                        {activeCount}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Search */}
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground-muted" />
                <input
                  type="text"
                  placeholder="Rechercher ID, borne, tag..."
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setPage(0); }}
                  className="w-full pl-9 pr-3 py-2 bg-surface border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>
            </div>

            {/* Date range filter */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-foreground-muted whitespace-nowrap">Période :</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(0); }}
                className="px-2.5 py-1.5 bg-surface border border-border rounded-xl text-xs text-foreground focus:outline-none focus:border-primary/50 transition-colors"
              />
              <span className="text-xs text-foreground-muted">→</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(0); }}
                className="px-2.5 py-1.5 bg-surface border border-border rounded-xl text-xs text-foreground focus:outline-none focus:border-primary/50 transition-colors"
              />
              {(dateFrom || dateTo) && (
                <button
                  onClick={() => { setDateFrom(""); setDateTo(""); setPage(0); }}
                  className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors"
                  aria-label="Effacer les dates"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Data Table */}
          {isLoading ? (
            <TableSkeleton rows={10} />
          ) : isError ? (
            <ErrorState
              message="Impossible de charger les sessions"
              onRetry={() => refetch()}
            />
          ) : filteredSessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 bg-surface border border-border rounded-2xl">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                <BatteryCharging className="w-6 h-6 text-primary" />
              </div>
              <p className="text-foreground font-medium">Aucune session trouvée</p>
              <p className="text-sm text-foreground-muted mt-1">
                {statusFilter !== "all"
                  ? "Aucune session avec ce filtre. Essayez un autre statut."
                  : "Aucune session de charge enregistrée."}
              </p>
            </div>
          ) : (
            <div className="bg-surface border border-border rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-border">
                    <tr>
                      <th className={thClass}>ID Transaction</th>
                      <th className={thClass}>Borne</th>
                      <th className={thClass}>Connecteur</th>
                      <th className={thClass}>Tag RFID</th>
                      <th className={thClass}>Début</th>
                      <th className={thClass}>Fin</th>
                      <th className={thClass}>Durée</th>
                      <th className={thClass}>Énergie</th>
                      <th className={thClass}>Raison</th>
                      <th className={thClass}>Statut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredSessions.map((tx) => {
                      const config = STATUS_CONFIG[tx.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG["Completed"];
                      return (
                        <tr
                          key={tx.id}
                          onClick={() => setSelectedSession(tx)}
                          className="hover:bg-surface-elevated/50 transition-colors cursor-pointer"
                        >
                          {/* Transaction ID */}
                          <td className="px-4 py-3">
                            <span className="text-sm font-mono font-medium text-foreground">
                              #{tx.transaction_id}
                            </span>
                          </td>

                          {/* Station */}
                          <td className="px-4 py-3">
                            <div>
                              <p className="text-sm font-medium text-foreground">
                                {getStation(tx).name}
                              </p>
                              <p className="text-xs text-foreground-muted">
                                {getStation(tx).city}
                              </p>
                            </div>
                          </td>

                          {/* Connector */}
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-surface-elevated text-xs font-semibold text-foreground-muted border border-border">
                              {tx.connector_id}
                            </span>
                          </td>

                          {/* RFID Tag */}
                          <td className="px-4 py-3">
                            {tx.id_tag ? (
                              <span className="text-xs font-mono px-2 py-1 rounded-md bg-surface-elevated border border-border text-foreground-muted">
                                {tx.id_tag}
                              </span>
                            ) : (
                              <span className="text-xs text-foreground-muted/50">
                                —
                              </span>
                            )}
                          </td>

                          {/* Start */}
                          <td className="px-4 py-3 text-sm text-foreground-muted whitespace-nowrap">
                            {formatDateTime(tx.started_at)}
                          </td>

                          {/* End */}
                          <td className="px-4 py-3 text-sm text-foreground-muted whitespace-nowrap">
                            {tx.stopped_at ? (
                              formatDateTime(tx.stopped_at)
                            ) : (
                              <span className="text-[#00D4AA] text-xs font-medium">
                                En cours...
                              </span>
                            )}
                          </td>

                          {/* Duration */}
                          <td className="px-4 py-3">
                            <span
                              className={`text-sm font-medium ${
                                tx.status === "Active"
                                  ? "text-[#00D4AA]"
                                  : "text-foreground"
                              }`}
                            >
                              {formatSessionDuration(tx.started_at, tx.stopped_at)}
                            </span>
                          </td>

                          {/* Energy */}
                          <td className="px-4 py-3">
                            <span
                              className={`text-sm font-semibold ${
                                tx.energy_kwh !== null
                                  ? "text-[#00D4AA]"
                                  : "text-foreground-muted/50"
                              }`}
                            >
                              {formatEnergy(tx.energy_kwh)}
                            </span>
                          </td>

                          {/* Stop reason */}
                          <td className="px-4 py-3 text-xs text-foreground-muted font-mono">
                            {tx.stop_reason
                              ? tx.stop_reason.length > 15
                                ? tx.stop_reason.slice(0, 15) + "…"
                                : tx.stop_reason
                              : "—"}
                          </td>

                          {/* Status badge */}
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold ${config.bgClass} ${config.textClass} ${config.borderClass}`}
                            >
                              {config.pulse ? (
                                <span className="relative flex h-1.5 w-1.5">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: config.color }} />
                                  <span
                                    className="relative inline-flex rounded-full h-1.5 w-1.5"
                                    style={{ backgroundColor: config.color }}
                                  />
                                </span>
                              ) : (
                                <span
                                  className="w-1.5 h-1.5 rounded-full"
                                  style={{ backgroundColor: config.color }}
                                />
                              )}
                              {config.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination footer */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                  <span className="text-xs text-foreground-muted">
                    {page * PAGE_SIZE + 1}–
                    {Math.min((page + 1) * PAGE_SIZE, sessionsData?.total ?? 0)} sur{" "}
                    {(sessionsData?.total ?? 0).toLocaleString("fr-FR")} sessions
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      aria-label="Page précédente"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>

                    {getPaginationRange().map((p, i) =>
                      p === "..." ? (
                        <span
                          key={`ellipsis-${i}`}
                          className="px-1.5 text-xs text-foreground-muted"
                        >
                          ...
                        </span>
                      ) : (
                        <button
                          key={p}
                          onClick={() => setPage(p as number)}
                          className={`min-w-[2rem] h-8 px-2 rounded-lg text-xs font-medium transition-colors ${
                            page === p
                              ? "bg-primary/15 text-primary border border-primary/30"
                              : "text-foreground-muted hover:text-foreground hover:bg-surface-elevated"
                          }`}
                        >
                          {(p as number) + 1}
                        </button>
                      )
                    )}

                    <button
                      onClick={() =>
                        setPage((p) => Math.min(totalPages - 1, p + 1))
                      }
                      disabled={page >= totalPages - 1}
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
        </>
      )}

      {/* CDR OCPI View */}
      {activeView === "cdr" && (
        <div className="space-y-4">
          {/* Date filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-foreground-muted whitespace-nowrap">Période :</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(0); }}
              className="px-2.5 py-1.5 bg-surface border border-border rounded-xl text-xs text-foreground focus:outline-none focus:border-primary/50"
            />
            <span className="text-xs text-foreground-muted">→</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(0); }}
              className="px-2.5 py-1.5 bg-surface border border-border rounded-xl text-xs text-foreground focus:outline-none focus:border-primary/50"
            />
            {(dateFrom || dateTo) && (
              <button
                onClick={() => { setDateFrom(""); setDateTo(""); setPage(0); }}
                className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* CDR Table */}
          {cdrLoading ? (
            <TableSkeleton rows={10} />
          ) : !cdrData?.data?.length ? (
            <div className="flex flex-col items-center justify-center h-48 bg-surface border border-border rounded-2xl">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                <FileText className="w-6 h-6 text-primary" />
              </div>
              <p className="text-foreground font-medium">Aucun CDR trouvé</p>
              <p className="text-sm text-foreground-muted mt-1">
                {dateFrom || dateTo ? "Aucun CDR sur cette période." : "Aucune donnée CDR disponible."}
              </p>
            </div>
          ) : (
            <div className="bg-surface border border-border rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-border">
                    <tr>
                      <th className={thClass}>CDR ID</th>
                      <th className={thClass}>Source</th>
                      <th className={thClass}>Station</th>
                      <th className={thClass}>Token</th>
                      <th className={thClass}>Début</th>
                      <th className={thClass}>Fin</th>
                      <th className={thClass}>Énergie</th>
                      <th className={thClass}>Durée</th>
                      <th className={cn(thClass, "text-right")}>Coût HT</th>
                      <th className={cn(thClass, "text-right")}>TVA</th>
                      <th className={cn(thClass, "text-right")}>Coût TTC</th>
                      <th className={cn(thClass, "text-right")}>Retail TTC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {(cdrData?.data ?? []).map((cdr) => {
                      const loc = cdr.cdr_location as { name?: string; city?: string } | null;
                      const token = cdr.cdr_token as { uid?: string } | null;
                      const sourceColor = cdr.source === "gfx" ? "#4ECDC4" : cdr.source === "road" ? "#F39C12" : "#8892B0";
                      return (
                        <tr key={cdr.id} className="hover:bg-surface-elevated/50 transition-colors">
                          <td className="px-4 py-3">
                            <span className="text-xs font-mono text-foreground">{cdr.cdr_id.slice(0, 12)}…</span>
                            {cdr.gfx_cdr_id && <p className="text-[10px] text-foreground-muted font-mono">{cdr.gfx_cdr_id.slice(0, 10)}…</p>}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold"
                              style={{ backgroundColor: `${sourceColor}15`, color: sourceColor }}
                            >
                              {cdr.source?.toUpperCase() ?? "OCPI"}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-sm font-medium text-foreground truncate max-w-[140px]">{loc?.name ?? "—"}</p>
                            {loc?.city && <p className="text-xs text-foreground-muted">{loc.city}</p>}
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs font-mono text-foreground-muted">{token?.uid ?? "—"}</span>
                          </td>
                          <td className="px-4 py-3 text-xs text-foreground-muted whitespace-nowrap">
                            {formatDateTime(cdr.start_date_time)}
                          </td>
                          <td className="px-4 py-3 text-xs text-foreground-muted whitespace-nowrap">
                            {formatDateTime(cdr.end_date_time)}
                          </td>
                          <td className="px-4 py-3 text-sm font-semibold text-primary tabular-nums">
                            {cdr.total_energy.toFixed(2)} kWh
                          </td>
                          <td className="px-4 py-3 text-sm text-foreground-muted tabular-nums">
                            {cdr.total_time < 1
                              ? `${Math.round(cdr.total_time * 60)}m`
                              : `${cdr.total_time.toFixed(1)}h`}
                          </td>
                          <td className="px-4 py-3 text-sm text-right tabular-nums font-medium text-foreground">
                            {cdr.total_cost.toFixed(2)} {cdr.currency}
                          </td>
                          <td className="px-4 py-3 text-sm text-right tabular-nums text-foreground-muted">
                            {cdr.total_vat != null ? `${cdr.total_vat.toFixed(2)} ${cdr.currency}` : "—"}
                          </td>
                          <td className="px-4 py-3 text-sm text-right tabular-nums font-semibold text-foreground">
                            {cdr.total_cost_incl_vat != null ? `${cdr.total_cost_incl_vat.toFixed(2)} ${cdr.currency}` : "—"}
                          </td>
                          <td className="px-4 py-3 text-sm text-right tabular-nums text-foreground-muted">
                            {cdr.total_retail_cost_incl_vat != null ? `${cdr.total_retail_cost_incl_vat.toFixed(2)} ${cdr.currency}` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* CDR Pagination */}
              {(cdrData?.total ?? 0) > PAGE_SIZE && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                  <span className="text-xs text-foreground-muted">
                    {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, cdrData?.total ?? 0)} sur {(cdrData?.total ?? 0).toLocaleString("fr-FR")} CDRs
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated disabled:opacity-30 transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setPage((p) => Math.min(Math.ceil((cdrData?.total ?? 0) / PAGE_SIZE) - 1, p + 1))}
                      disabled={page >= Math.ceil((cdrData?.total ?? 0) / PAGE_SIZE) - 1}
                      className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated disabled:opacity-30 transition-colors"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Session detail drawer */}
      {selectedSession && (
        <SessionDetailDrawer
          session={selectedSession}
          onClose={() => setSelectedSession(null)}
        />
      )}
    </div>
  );
}
