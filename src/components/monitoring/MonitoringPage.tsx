import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Wifi,
  WifiOff,
  Zap,
  Cpu,
  AlertTriangle,
  Clock,
  Server,
  Wrench,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { formatDuration, formatRelativeTime } from "@/lib/utils";
import { useCpo } from "@/contexts/CpoContext";
import { KPICard } from "@/components/ui/KPICard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { KPISkeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHelp } from "@/components/ui/PageHelp";
import type { Station } from "@/types/station";
import { MaintenancePage } from "@/components/maintenance/MaintenancePage";

// ── Types ──────────────────────────────────────────────────

interface OcppTransaction {
  id: string;
  connector_id: number;
  meter_start: number | null;
  meter_stop: number | null;
  started_at: string;
  status: string;
  stations: { name: string; city: string | null } | null;
}

interface OcppChargepoint {
  id: string;
  identity: string;
  vendor: string | null;
  model: string | null;
  firmware_version: string | null;
  last_heartbeat_at: string | null;
  is_connected: boolean;
  created_at: string;
}

// ── Queries ────────────────────────────────────────────────

const REFETCH_INTERVAL = 15_000;

function useMonitoringStations(cpoId?: string | null) {
  return useQuery<Station[]>({
    queryKey: ["monitoring-stations", cpoId ?? "all"],
    queryFn: async () => {
      let query = supabase
        .from("stations_enriched")
        .select(
          "id, name, city, ocpp_status, is_online, max_power_kw, last_synced_at, status_since, hours_in_status, cpo_name"
        );
      if (cpoId) {
        query = query.eq("cpo_id", cpoId);
      }
      const { data, error } = await query.order("is_online", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Station[];
    },
    refetchInterval: REFETCH_INTERVAL,
  });
}

function useActiveTransactions() {
  return useQuery<OcppTransaction[]>({
    queryKey: ["active-transactions"],
    retry: false,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("ocpp_transactions")
          .select("*, stations(name, city)")
          .eq("status", "Active")
          .order("started_at", { ascending: false });
        if (error) {
          console.warn("[Monitoring] ocpp_transactions error:", error.code, error.message);
          return [];
        }
        return (data ?? []) as OcppTransaction[];
      } catch {
        return [];
      }
    },
    refetchInterval: REFETCH_INTERVAL,
  });
}

function useChargepoints() {
  return useQuery<OcppChargepoint[]>({
    queryKey: ["ocpp-chargepoints"],
    retry: false,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("ocpp_chargepoints")
          .select("*")
          .order("last_heartbeat_at", { ascending: false });
        if (error) {
          console.warn("[Monitoring] ocpp_chargepoints error:", error.code, error.message);
          return [];
        }
        return (data ?? []) as OcppChargepoint[];
      } catch {
        return [];
      }
    },
    refetchInterval: REFETCH_INTERVAL,
  });
}

// ── Helpers ────────────────────────────────────────────────

function heartbeatFresh(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const diffMs = Date.now() - new Date(dateStr).getTime();
  return diffMs < 5 * 60 * 1000; // 5 minutes
}

function computeEnergy(tx: OcppTransaction): string {
  if (tx.meter_stop != null && tx.meter_start != null) {
    return ((tx.meter_stop - tx.meter_start) / 1000).toFixed(1);
  }
  return "--";
}

// ── Page component ─────────────────────────────────────────

type MonitoringTab = "realtime" | "maintenance";

const MONITORING_TABS: { key: MonitoringTab; label: string; icon: typeof Activity }[] = [
  { key: "realtime", label: "Temps réel", icon: Activity },
  { key: "maintenance", label: "Maintenance & Tickets", icon: Wrench },
];

export function MonitoringPage() {
  const [activeTab, setActiveTab] = useState<MonitoringTab>("realtime");
  const { selectedCpoId } = useCpo();
  const {
    data: stations,
    isLoading: stationsLoading,
    isError: stationsError,
    refetch: refetchStations,
  } = useMonitoringStations(selectedCpoId);

  const {
    data: activeSessions,
    isLoading: sessionsLoading,
  } = useActiveTransactions();

  const {
    data: chargepoints,
    isLoading: chargepointsLoading,
  } = useChargepoints();

  const isLoading = stationsLoading || sessionsLoading || chargepointsLoading;

  // KPI computations
  const kpis = useMemo(() => {
    if (!stations) return null;
    const online = stations.filter((s) => s.is_online).length;
    const offline = stations.filter((s) => !s.is_online).length;
    const faulted = stations.filter(
      (s) => s.ocpp_status === "Faulted" || s.ocpp_status === "Unavailable"
    ).length;
    return {
      online,
      offline,
      sessions: activeSessions?.length ?? 0,
      connectedCPs: chargepoints?.filter((cp) => cp.is_connected).length ?? 0,
      alerts: faulted,
    };
  }, [stations, activeSessions, chargepoints]);

  // Stations with alerts: faulted or offline, sorted by duration desc
  const alertStations = useMemo(() => {
    if (!stations) return [];
    return stations
      .filter(
        (s) =>
          !s.is_online ||
          s.ocpp_status === "Faulted" ||
          s.ocpp_status === "Unavailable"
      )
      .sort((a, b) => (b.hours_in_status ?? 0) - (a.hours_in_status ?? 0));
  }, [stations]);

  // ── Tab bar (shared across all states) ──
  const tabBar = (
    <div className="flex gap-1 border-b border-border">
      {MONITORING_TABS.map((tab) => {
        const isActive = activeTab === tab.key;
        const Icon = tab.icon;
        return (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors relative",
              isActive ? "text-primary" : "text-foreground-muted hover:text-foreground"
            )}
          >
            <Icon className="w-4 h-4" />
            {tab.label}
            {isActive && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />}
          </button>
        );
      })}
    </div>
  );

  // ── Maintenance tab ──
  if (activeTab === "maintenance") {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-xl font-bold">Monitoring</h1>
          <p className="text-sm text-foreground-muted mt-1">
            Surveillance en temps r&eacute;el du r&eacute;seau
          </p>
        </div>
        {tabBar}
        <MaintenancePage />
      </div>
    );
  }

  // ── Loading state ──
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-xl font-bold">Monitoring</h1>
          <p className="text-sm text-foreground-muted mt-1">
            Surveillance en temps r&eacute;el du r&eacute;seau
          </p>
        </div>
        {tabBar}
        <KPISkeleton />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <TableSkeleton rows={5} />
          <TableSkeleton rows={5} />
        </div>
        <TableSkeleton rows={6} />
      </div>
    );
  }

  // ── Error state ──
  if (stationsError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-xl font-bold">Monitoring</h1>
          <p className="text-sm text-foreground-muted mt-1">
            Surveillance en temps r&eacute;el du r&eacute;seau
          </p>
        </div>
        {tabBar}
        <ErrorState
          message="Impossible de charger les donn&eacute;es de monitoring"
          onRetry={() => refetchStations()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div>
        <h1 className="font-heading text-xl font-bold">Monitoring</h1>
        <p className="text-sm text-foreground-muted mt-1">
          Surveillance en temps r&eacute;el du r&eacute;seau
        </p>
      </div>

      {tabBar}

      <PageHelp
        summary="Surveillance en temps réel des connexions et heartbeats OCPP de vos bornes"
        items={[
          { label: "Heartbeat", description: "Signal envoyé régulièrement par la borne pour confirmer qu'elle est connectée. Absence = borne déconnectée." },
          { label: "Connectivité", description: "Online (connecté au serveur OCPP), Offline (pas de signal depuis plus de 15 min)." },
          { label: "Dernière communication", description: "Date/heure du dernier message OCPP reçu de la borne." },
          { label: "Alertes", description: "Les bornes sans heartbeat depuis plus de 30 minutes sont signalées en rouge." },
        ]}
        tips={["Une borne offline n'est pas forcément en panne — vérifiez d'abord la connexion internet du site."]}
      />

      {/* ── Health overview KPIs ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <KPICard
          label="Bornes en ligne"
          value={kpis?.online ?? 0}
          icon={Wifi}
          color="#00D4AA"
          borderColor="border-status-available/30"
        />
        <KPICard
          label="Bornes hors ligne"
          value={kpis?.offline ?? 0}
          icon={WifiOff}
          color="#FF6B6B"
          borderColor="border-status-faulted/30"
        />
        <KPICard
          label="Sessions actives"
          value={kpis?.sessions ?? 0}
          icon={Zap}
          color="#4ECDC4"
          borderColor="border-status-charging/30"
        />
        <KPICard
          label="Chargepoints connect&eacute;s"
          value={kpis?.connectedCPs ?? 0}
          icon={Cpu}
          color="#3498DB"
          borderColor="border-[#3498DB]/30"
        />
        <div className="relative">
          {(kpis?.alerts ?? 0) > 0 && (
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-status-faulted rounded-full animate-pulse z-10" />
          )}
          <KPICard
            label="Alertes actives"
            value={kpis?.alerts ?? 0}
            icon={AlertTriangle}
            color="#FF6B6B"
            borderColor="border-status-faulted/30"
          />
        </div>
      </div>

      {/* ── Two-column layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Bornes en alerte */}
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-status-faulted" />
            <h2 className="font-heading text-sm font-semibold">
              Bornes en alerte
            </h2>
            <span className="ml-auto text-xs text-foreground-muted">
              {alertStations.length} borne{alertStations.length > 1 ? "s" : ""}
            </span>
          </div>

          {alertStations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-foreground-muted">
              <Activity className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">Aucune alerte active</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-foreground-muted border-b border-border">
                    <th className="text-left font-medium px-4 py-2.5">Borne</th>
                    <th className="text-left font-medium px-4 py-2.5">Ville</th>
                    <th className="text-left font-medium px-4 py-2.5">Statut</th>
                    <th className="text-left font-medium px-4 py-2.5">Depuis</th>
                    <th className="text-left font-medium px-4 py-2.5">CPO</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {alertStations.slice(0, 15).map((station) => (
                    <tr
                      key={station.id}
                      className="hover:bg-surface-elevated/50 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-foreground truncate max-w-[180px]">
                        {station.name}
                      </td>
                      <td className="px-4 py-3 text-foreground-muted">
                        {station.city ?? "--"}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={station.ocpp_status} />
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "text-xs font-medium",
                            station.hours_in_status >= 24
                              ? "text-danger"
                              : station.hours_in_status >= 6
                              ? "text-warning"
                              : "text-foreground-muted"
                          )}
                        >
                          {formatDuration(station.hours_in_status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-foreground-muted text-xs">
                        {station.cpo_name ?? "--"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right: Sessions en cours */}
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <Zap className="w-4 h-4 text-status-charging" />
            <h2 className="font-heading text-sm font-semibold">
              Sessions en cours
            </h2>
            <span className="ml-auto text-xs text-foreground-muted">
              {activeSessions?.length ?? 0} session
              {(activeSessions?.length ?? 0) > 1 ? "s" : ""}
            </span>
          </div>

          {!activeSessions || activeSessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-foreground-muted">
              <Zap className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">Aucune session active</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-foreground-muted border-b border-border">
                    <th className="text-left font-medium px-4 py-2.5">Borne</th>
                    <th className="text-left font-medium px-4 py-2.5">
                      Connecteur
                    </th>
                    <th className="text-left font-medium px-4 py-2.5">
                      D&eacute;but
                    </th>
                    <th className="text-right font-medium px-4 py-2.5">
                      &Eacute;nergie
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {activeSessions.slice(0, 15).map((tx) => (
                    <tr
                      key={tx.id}
                      className="hover:bg-surface-elevated/50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground truncate max-w-[160px]">
                          {tx.stations?.name ?? "--"}
                        </p>
                        <p className="text-xs text-foreground-muted">
                          {tx.stations?.city ?? ""}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-foreground-muted">
                        #{tx.connector_id}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-xs text-foreground-muted">
                          <Clock className="w-3 h-3" />
                          {formatRelativeTime(tx.started_at)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-status-charging font-semibold">
                          {computeEnergy(tx)} kWh
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Chargepoints OCPP ── */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <Server className="w-4 h-4 text-foreground-muted" />
          <h2 className="font-heading text-sm font-semibold">
            Chargepoints OCPP
          </h2>
          <span className="ml-auto text-xs text-foreground-muted">
            {chargepoints?.length ?? 0} chargepoint
            {(chargepoints?.length ?? 0) > 1 ? "s" : ""}
          </span>
        </div>

        {!chargepoints || chargepoints.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-foreground-muted">
            <Cpu className="w-8 h-8 mb-2 opacity-40" />
            <p className="text-sm">Aucun chargepoint connect&eacute;</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-foreground-muted border-b border-border">
                  <th className="text-left font-medium px-4 py-2.5">Identity</th>
                  <th className="text-left font-medium px-4 py-2.5">
                    Mod&egrave;le
                  </th>
                  <th className="text-left font-medium px-4 py-2.5">
                    Firmware
                  </th>
                  <th className="text-left font-medium px-4 py-2.5">
                    Dernier heartbeat
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {chargepoints.map((cp) => (
                  <tr
                    key={cp.id}
                    className="hover:bg-surface-elevated/50 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-foreground font-mono text-xs">
                      {cp.identity}
                    </td>
                    <td className="px-4 py-3 text-foreground-muted">
                      {cp.vendor ? `${cp.vendor} ${cp.model ?? ""}`.trim() : cp.model ?? "--"}
                    </td>
                    <td className="px-4 py-3">
                      {cp.firmware_version ? (
                        <span className="inline-flex items-center rounded-md bg-surface-elevated px-2 py-0.5 text-xs font-mono text-foreground-muted">
                          {cp.firmware_version}
                        </span>
                      ) : (
                        <span className="text-foreground-muted text-xs">--</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {cp.last_heartbeat_at ? (
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <span
                            className={cn(
                              "w-2 h-2 rounded-full",
                              heartbeatFresh(cp.last_heartbeat_at)
                                ? "bg-status-available"
                                : "bg-status-faulted"
                            )}
                          />
                          <span
                            className={cn(
                              heartbeatFresh(cp.last_heartbeat_at)
                                ? "text-foreground"
                                : "text-foreground-muted"
                            )}
                          >
                            {formatRelativeTime(cp.last_heartbeat_at)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-foreground-muted text-xs">--</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
