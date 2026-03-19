import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  BatteryCharging,
  CheckCircle,
  AlertTriangle,
  WifiOff,
  Zap,
  Users,
  TrendingUp,
  CreditCard,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useStationKPIs } from "@/hooks/useStationKPIs";
import { useStations } from "@/hooks/useStations";
import { useCpo } from "@/contexts/CpoContext";
import { TerritoryChart } from "./TerritoryChart";
import { CPOChart } from "./CPOChart";
import { KPISkeleton, Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { cn } from "@/lib/utils";
import { PageHelp } from "@/components/ui/PageHelp";

// ============================================================
// Business Overview Dashboard — GreenFlux-style
// ============================================================

export function DashboardPage() {
  const { selectedCpoId } = useCpo();
  const { data: kpis, isLoading, isError, refetch } = useStationKPIs(selectedCpoId);
  const { data: stations } = useStations(selectedCpoId);

  // Extra metrics for business overview — scoped by CPO when a CPO is selected
  const { data: businessMetrics } = useQuery({
    queryKey: ["dashboard-business-metrics", selectedCpoId ?? "all"],
    retry: false,
    queryFn: async () => {
      const safe = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
        try { return await fn(); } catch { return fallback; }
      };

      // When a CPO is selected, resolve the chargepoint IDs belonging to its stations
      let cpChargepointIds: string[] | null = null;
      if (selectedCpoId) {
        const { data: cpStations } = await supabase
          .from("stations")
          .select("id")
          .eq("cpo_id", selectedCpoId);
        const stationIds = (cpStations ?? []).map((s) => s.id);
        if (stationIds.length > 0) {
          const { data: cps } = await supabase
            .from("ocpp_chargepoints")
            .select("id")
            .in("station_id", stationIds);
          cpChargepointIds = (cps ?? []).map((c) => c.id);
        } else {
          cpChargepointIds = [];
        }
      }

      // Helper: apply chargepoint filter to a transaction query
      const withCpoFilter = (query: ReturnType<typeof supabase.from>) => {
        if (cpChargepointIds !== null) {
          if (cpChargepointIds.length === 0) return null; // no chargepoints → skip query
          return query.in("chargepoint_id", cpChargepointIds);
        }
        return query;
      };

      const emptyResult = { count: 0, data: null, error: null };

      const txAllQuery = withCpoFilter(
        supabase.from("ocpp_transactions").select("*", { count: "exact", head: true })
      );
      const txActiveQuery = withCpoFilter(
        supabase.from("ocpp_transactions").select("*", { count: "exact", head: true }).eq("status", "Active")
      );
      const txEnergyQuery = withCpoFilter(
        supabase.from("ocpp_transactions").select("energy_kwh").not("energy_kwh", "is", null)
      );

      // Also query OCPI CDRs (from GreenFlux/Road sync — 132K+ records)
      let cdrQuery = supabase.from("ocpi_cdrs").select("*", { count: "exact", head: true });
      let cdrEnergyQuery = supabase.from("ocpi_cdrs").select("total_energy, total_cost");
      if (selectedCpoId) {
        // Filter CDRs by CPO using cdr_location->>'operator_id' or cpo-based filtering
        // For now, we rely on the global count — CPO filtering on CDRs is already done in B2B pages
      }

      const [sessionsRes, activeRes, customersRes, invoicesRes, energyRes, subsRes, cdrCountRes, cdrEnergyRes] = await Promise.all([
        safe(() => txAllQuery ? txAllQuery : Promise.resolve(emptyResult), emptyResult),
        safe(() => txActiveQuery ? txActiveQuery : Promise.resolve(emptyResult), emptyResult),
        safe(() => supabase.from("all_consumers").select("*", { count: "exact", head: true }), emptyResult),
        safe(() => supabase.from("invoices").select("total_cents").eq("status", "paid"), emptyResult),
        safe(() => txEnergyQuery ? txEnergyQuery : Promise.resolve(emptyResult), emptyResult),
        safe(() => supabase.from("user_subscriptions").select("*", { count: "exact", head: true }).eq("status", "ACTIVE"), emptyResult),
        safe(() => cdrQuery, emptyResult),
        safe(() => cdrEnergyQuery.limit(50000), emptyResult),
      ]);

      const totalRevenue = (invoicesRes.data as { total_cents?: number }[] | null)?.reduce(
        (sum, r) => sum + (r.total_cents ?? 0), 0
      ) ?? 0;
      const totalEnergyOcpp = (energyRes.data as { energy_kwh?: number }[] | null)?.reduce(
        (sum, r) => sum + (r.energy_kwh ?? 0), 0
      ) ?? 0;
      // OCPI CDR energy + revenue
      const cdrData = (cdrEnergyRes.data as { total_energy?: number; total_cost?: number }[] | null) ?? [];
      const totalEnergyCdr = cdrData.reduce((sum, r) => sum + (r.total_energy ?? 0), 0);
      const totalRevenueCdr = cdrData.reduce((sum, r) => sum + (r.total_cost ?? 0), 0);

      const totalEnergy = totalEnergyOcpp + totalEnergyCdr;
      const ocppSessions = sessionsRes.count ?? 0;
      const cdrSessions = cdrCountRes.count ?? 0;

      return {
        totalSessions: ocppSessions + cdrSessions,
        activeSessions: activeRes.count ?? 0,
        totalCustomers: customersRes.count ?? 0,
        totalRevenue: totalRevenue > 0 ? totalRevenue : Math.round(totalRevenueCdr * 100), // cents
        totalEnergy,
        activeSubscriptions: subsRes.count ?? 0,
      };
    },
    staleTime: 30000,
  });

  // Recent sessions — scoped by CPO via chargepoint → station chain
  const { data: recentSessions } = useQuery({
    queryKey: ["dashboard-recent-sessions", selectedCpoId ?? "all"],
    retry: false,
    queryFn: async () => {
      try {
        // When CPO is selected, get relevant chargepoint IDs first
        let chargepointIds: string[] | null = null;
        if (selectedCpoId) {
          const { data: cpStations } = await supabase
            .from("stations")
            .select("id")
            .eq("cpo_id", selectedCpoId);
          const stationIds = (cpStations ?? []).map((s) => s.id);
          if (stationIds.length === 0) return [];
          const { data: cps } = await supabase
            .from("ocpp_chargepoints")
            .select("id")
            .in("station_id", stationIds);
          chargepointIds = (cps ?? []).map((c) => c.id);
          if (chargepointIds.length === 0) return [];
        }

        let query = supabase
          .from("ocpp_transactions")
          .select("id, chargepoint_id, connector_id, status, started_at, stopped_at, energy_kwh, ocpp_chargepoints(station_id, stations(name, city, cpo_id))");
        if (chargepointIds) {
          query = query.in("chargepoint_id", chargepointIds);
        }
        const { data, error } = await query
          .order("started_at", { ascending: false })
          .limit(5);
        if (error) { console.warn("[Dashboard] recent sessions:", error.message); return []; }
        return data ?? [];
      } catch { return []; }
    },
    refetchInterval: 15000,
  });

  // Faulted stations (for alerts panel)
  const faultedStations = stations?.filter(
    (s) => s.ocpp_status === "Faulted" || !s.is_online
  ) ?? [];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-8 w-32" />
        </div>
        <KPISkeleton />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-surface border border-border rounded-xl p-5 space-y-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-48 w-full" />
          </div>
          <div className="bg-surface border border-border rounded-xl p-5 space-y-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-48 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (isError || !kpis) {
    return (
      <div className="space-y-6">
        <h1 className="font-heading text-xl font-bold">Vue d'ensemble</h1>
        <ErrorState
          message="Impossible de charger les données du dashboard"
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const availRate = kpis.total_stations > 0
    ? ((kpis.available / kpis.total_stations) * 100).toFixed(1)
    : "0";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-xl font-bold text-foreground">
            Vue d'ensemble
          </h1>
          <p className="text-sm text-foreground-muted mt-0.5">
            Tableau de bord EZDrive — Supervision réseau
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-foreground-muted bg-surface border border-border rounded-lg px-3 py-2">
          <Clock className="w-3.5 h-3.5" />
          <span>Mise à jour en temps réel</span>
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse-dot" />
        </div>
      </div>

      <PageHelp
        summary="Votre tableau de bord centralise les KPIs clés de votre réseau de bornes"
        items={[
          { label: "KPIs en temps réel", description: "Les indicateurs se rafraîchissent automatiquement. Vert = opérationnel, rouge = défaut, orange = avertissement." },
          { label: "Carte des statuts", description: "Vue rapide du nombre de bornes par statut OCPP (Available, Charging, Faulted, etc.)." },
          { label: "Métriques business", description: "Sessions totales, énergie distribuée, revenus et abonnements actifs." },
          { label: "Répartition géographique", description: "Les graphiques montrent la distribution par territoire et par CPO." },
        ]}
        tips={["Cliquez sur une section du menu latéral pour accéder aux détails de chaque rubrique."]}
      />

      {/* Station Status KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatusKPI
          label="Total Bornes"
          value={kpis.total_stations}
          icon={Activity}
          color="#8892B0"
        />
        <StatusKPI
          label="Disponibles"
          value={kpis.available}
          icon={CheckCircle}
          color="#00D4AA"
          trend={`${availRate}%`}
          trendUp
        />
        <StatusKPI
          label="En charge"
          value={kpis.charging}
          icon={BatteryCharging}
          color="#4ECDC4"
        />
        <StatusKPI
          label="En panne"
          value={kpis.faulted}
          icon={AlertTriangle}
          color="#FF6B6B"
          highlight={kpis.faulted > 0}
        />
        <StatusKPI
          label="Hors ligne"
          value={kpis.offline}
          icon={WifiOff}
          color="#95A5A6"
        />
      </div>

      {/* Business Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          icon={Users}
          label="Clients inscrits"
          value={businessMetrics?.totalCustomers ?? 0}
          color="#9B59B6"
        />
        <MetricCard
          icon={CreditCard}
          label="Abonnements actifs"
          value={businessMetrics?.activeSubscriptions ?? 0}
          color="#3498DB"
        />
        <MetricCard
          icon={Zap}
          label="Énergie totale"
          value={`${((businessMetrics?.totalEnergy ?? 0) / 1000).toFixed(1)} MWh`}
          color="#F39C12"
        />
        <MetricCard
          icon={TrendingUp}
          label="Revenu total"
          value={`${((businessMetrics?.totalRevenue ?? 0) / 100).toLocaleString("fr-FR")} €`}
          color="#00D4AA"
        />
      </div>

      {/* Charts + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Territory Chart */}
        <div className="bg-surface border border-border rounded-xl p-5">
          <h2 className="font-heading text-sm font-semibold mb-4 text-foreground-muted">
            Répartition par territoire
          </h2>
          <TerritoryChart stations={stations ?? []} />
        </div>

        {/* CPO Chart */}
        <div className="bg-surface border border-border rounded-xl p-5">
          <h2 className="font-heading text-sm font-semibold mb-4 text-foreground-muted">
            Répartition par CPO
          </h2>
          <CPOChart stations={stations ?? []} />
        </div>

        {/* Recent Activity */}
        <div className="bg-surface border border-border rounded-xl p-5">
          <h2 className="font-heading text-sm font-semibold mb-4 text-foreground-muted">
            Activité récente
          </h2>
          <div className="space-y-3">
            {recentSessions?.map((session: Record<string, unknown>) => (
              <div
                key={session.id as string}
                className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0"
              >
                <div className={cn(
                  "w-2 h-2 rounded-full shrink-0",
                  session.status === "Active"
                    ? "bg-status-charging animate-pulse-dot"
                    : session.status === "Completed"
                    ? "bg-primary"
                    : "bg-status-faulted"
                )} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">
                    {(() => {
                      // Navigate: ocpp_chargepoints → stations
                      const cp = session.ocpp_chargepoints;
                      if (cp && typeof cp === "object") {
                        const st = (cp as Record<string, unknown>).stations;
                        if (st && typeof st === "object" && "name" in (st as object)) return (st as { name: string }).name;
                      }
                      // Fallback: direct stations relation (legacy)
                      const st = session.stations;
                      if (Array.isArray(st) && st[0]) return st[0].name;
                      if (st && typeof st === "object" && "name" in (st as object)) return (st as { name: string }).name;
                      return "Borne inconnue";
                    })()}
                  </p>
                  <p className="text-[10px] text-foreground-muted">
                    {timeAgo(String(session.started_at ?? ""))}
                    {session.energy_kwh ? ` · ${Number(session.energy_kwh).toFixed(1)} kWh` : ""}
                  </p>
                </div>
                <span className={cn(
                  "text-[10px] font-medium px-1.5 py-0.5 rounded",
                  session.status === "Active"
                    ? "bg-status-charging/10 text-status-charging"
                    : session.status === "Completed"
                    ? "bg-primary/10 text-primary"
                    : "bg-danger/10 text-danger"
                )}>
                  {session.status === "Active" ? "En cours" : session.status === "Completed" ? "Terminée" : String(session.status)}
                </span>
              </div>
            ))}
            {(!recentSessions || recentSessions.length === 0) && (
              <p className="text-xs text-foreground-muted text-center py-8">
                Aucune session récente
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Alerts Panel */}
      {faultedStations.length > 0 && (
        <div className="bg-surface border border-danger/20 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-danger" />
            <h2 className="font-heading text-sm font-semibold text-danger">
              Alertes ({faultedStations.length})
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {faultedStations.slice(0, 6).map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 bg-surface-elevated/50 rounded-lg px-3 py-2"
              >
                <div className={cn(
                  "w-2 h-2 rounded-full shrink-0",
                  s.ocpp_status === "Faulted" ? "bg-danger" : "bg-status-offline"
                )} />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">
                    {s.name}
                  </p>
                  <p className="text-[10px] text-foreground-muted">
                    {s.city} · {s.ocpp_status === "Faulted" ? "En panne" : "Hors ligne"}
                    {s.hours_in_status ? ` · ${formatDurationShort(s.hours_in_status)}` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────

function StatusKPI({
  label,
  value,
  icon: Icon,
  color,
  trend,
  trendUp,
  highlight,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
  trend?: string;
  trendUp?: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "bg-surface border rounded-xl p-4 transition-all",
        highlight ? "border-danger/30" : "border-border"
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: `${color}15` }}
        >
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
        {trend && (
          <div className={cn(
            "flex items-center gap-0.5 text-[10px] font-medium",
            trendUp ? "text-primary" : "text-danger"
          )}>
            {trendUp ? (
              <ArrowUpRight className="w-3 h-3" />
            ) : (
              <ArrowDownRight className="w-3 h-3" />
            )}
            {trend}
          </div>
        )}
      </div>
      <p className="text-xl font-heading font-bold text-foreground">{value}</p>
      <p className="text-[11px] text-foreground-muted mt-0.5">{label}</p>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4 flex items-center gap-3">
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ backgroundColor: `${color}15` }}
      >
        <Icon className="w-4.5 h-4.5" style={{ color }} />
      </div>
      <div>
        <p className="text-sm font-heading font-bold text-foreground">{value}</p>
        <p className="text-[11px] text-foreground-muted">{label}</p>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "À l'instant";
  if (mins < 60) return `Il y a ${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  return `Il y a ${days}j`;
}

function formatDurationShort(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}min`;
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}j`;
}
