import { useState, useMemo, useCallback, useEffect, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  BatteryCharging,
  CheckCircle,
  AlertTriangle,
  Wifi,
  WifiOff,
  Zap,
  Users,
  TrendingUp,
  CreditCard,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Calendar,
  Gauge,
  BarChart3,
  Trophy,
  ThumbsDown,
  MapPin,
  Printer,
  GitCompare,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { useNavigate } from "react-router-dom";
import type { LatLngBoundsExpression } from "leaflet";
import { supabase } from "@/lib/supabase";
import { ExportButton } from "@/components/shared/ExportButton";

// ── Lazy-loaded map (avoids ~200KB Leaflet on initial load) ──
const DashboardMap = lazy(() => import("./DashboardMap"));
import { useStationKPIs } from "@/hooks/useStationKPIs";
import { useStations } from "@/hooks/useStations";
import { useCpo } from "@/contexts/CpoContext";
import { TerritoryChart } from "./TerritoryChart";
import { CPOChart } from "./CPOChart";
import { KPISkeleton, Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { cn } from "@/lib/utils";
import { PageHelp } from "@/components/ui/PageHelp";
import { RefreshIndicator } from "@/components/shared/RefreshIndicator";
import type { Station } from "@/types/station";

// ============================================================
// Business Overview Dashboard — Enhanced CPO Overview
// ============================================================

type TimeFilter = "last_month" | "current_year" | "custom";

interface TimeRange {
  filter: TimeFilter;
  from: string;
  to: string;
}

function getDefaultTimeRange(): TimeRange {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  return {
    filter: "current_year",
    from: yearStart.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  };
}

function getTimeRangeForFilter(filter: TimeFilter, customFrom?: string, customTo?: string): TimeRange {
  const now = new Date();
  if (filter === "last_month") {
    const from = new Date(now);
    from.setDate(from.getDate() - 30);
    return { filter, from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
  }
  if (filter === "custom" && customFrom && customTo) {
    return { filter, from: customFrom, to: customTo };
  }
  // current_year
  const yearStart = new Date(now.getFullYear(), 0, 1);
  return { filter, from: yearStart.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
}

// ============================================================
// Main Component
// ============================================================

export function DashboardPage() {
  const navigate = useNavigate();
  const { selectedCpoId } = useCpo();
  const { data: kpis, isLoading, isError, refetch } = useStationKPIs(selectedCpoId);
  const { data: stations } = useStations(selectedCpoId);

  // ── Time filter state ─────────────────────────────────
  const [timeRange, setTimeRange] = useState<TimeRange>(getDefaultTimeRange);
  const [customFrom, setCustomFrom] = useState(timeRange.from);
  const [customTo, setCustomTo] = useState(timeRange.to);

  // ── Compare mode state ──────────────────────────────
  const [compareMode, setCompareMode] = useState(false);
  const [compareFrom, setCompareFrom] = useState("");
  const [compareTo, setCompareTo] = useState("");

  const handleFilterChange = (filter: TimeFilter) => {
    if (filter === "custom") {
      setTimeRange(getTimeRangeForFilter("custom", customFrom, customTo));
    } else {
      const range = getTimeRangeForFilter(filter);
      setTimeRange(range);
      setCustomFrom(range.from);
      setCustomTo(range.to);
    }
  };

  const handleCustomApply = () => {
    setTimeRange(getTimeRangeForFilter("custom", customFrom, customTo));
  };

  // ── Resolve CPO station names for CDR filtering ───────
  const { data: cpoStationNames } = useQuery({
    queryKey: ["cpo-station-names", selectedCpoId ?? "all"],
    queryFn: async () => {
      if (!selectedCpoId) return null;
      const { data } = await supabase.from("stations").select("name").eq("cpo_id", selectedCpoId);
      return (data ?? []).map((s) => s.name).filter(Boolean);
    },
    staleTime: 60000,
  });

  // ── Business Metrics (scoped by CPO + time range) ─────
  const { data: businessMetrics } = useQuery({
    queryKey: ["dashboard-business-metrics", selectedCpoId ?? "all", timeRange.from, timeRange.to],
    retry: false,
    queryFn: async () => {
      const safe = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
        try { return await fn(); } catch { return fallback; }
      };

      // Resolve chargepoint IDs for OCPP queries
      let cpChargepointIds: string[] | null = null;
      if (selectedCpoId) {
        const { data: cpStations } = await supabase.from("stations").select("id").eq("cpo_id", selectedCpoId);
        const stationIds = (cpStations ?? []).map((s) => s.id);
        if (stationIds.length > 0) {
          const { data: cps } = await supabase.from("ocpp_chargepoints").select("id").in("station_id", stationIds);
          cpChargepointIds = (cps ?? []).map((c) => c.id);
        } else {
          cpChargepointIds = [];
        }
      }

      const withCpoFilter = <T extends { in: (column: string, values: string[]) => T }>(query: T): T | null => {
        if (cpChargepointIds !== null) {
          if (cpChargepointIds.length === 0) return null;
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

      // CDR queries with time range filter
      const nameFilter = cpoStationNames?.slice(0, 50);
      let cdrQuery = supabase.from("ocpi_cdrs").select("*", { count: "exact", head: true })
        .gte("start_date_time", timeRange.from)
        .lte("start_date_time", timeRange.to + "T23:59:59");
      let cdrEnergyQuery = supabase.from("ocpi_cdrs").select("total_energy, total_cost")
        .gte("start_date_time", timeRange.from)
        .lte("start_date_time", timeRange.to + "T23:59:59");

      if (nameFilter && nameFilter.length > 0) {
        cdrQuery = cdrQuery.in("cdr_location->>name", nameFilter);
        cdrEnergyQuery = cdrEnergyQuery.in("cdr_location->>name", nameFilter);
      } else if (selectedCpoId) {
        cdrQuery = cdrQuery.eq("id", "00000000-0000-0000-0000-000000000000");
        cdrEnergyQuery = cdrEnergyQuery.eq("id", "00000000-0000-0000-0000-000000000000");
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
        totalRevenue: totalRevenue > 0 ? totalRevenue : Math.round(totalRevenueCdr * 100),
        totalEnergy,
        activeSubscriptions: subsRes.count ?? 0,
      };
    },
    staleTime: 30000,
  });

  // ── Compare period metrics (lightweight CDR count + energy + revenue) ─
  const { data: compareMetrics } = useQuery({
    queryKey: ["dashboard-compare-metrics", selectedCpoId ?? "all", compareFrom, compareTo],
    retry: false,
    enabled: compareMode && !!compareFrom && !!compareTo,
    queryFn: async () => {
      const nameFilter = cpoStationNames?.slice(0, 50);
      let query = supabase.from("ocpi_cdrs").select("total_energy, total_cost")
        .gte("start_date_time", compareFrom)
        .lte("start_date_time", compareTo + "T23:59:59");
      if (nameFilter && nameFilter.length > 0) {
        query = query.in("cdr_location->>name", nameFilter);
      } else if (selectedCpoId) {
        query = query.eq("id", "00000000-0000-0000-0000-000000000000");
      }
      const { data } = await query.limit(50000);
      const cdrs = (data ?? []) as Array<{ total_energy?: number; total_cost?: number }>;
      return {
        totalSessions: cdrs.length,
        totalEnergy: cdrs.reduce((s, c) => s + (c.total_energy ?? 0), 0),
        totalRevenue: Math.round(cdrs.reduce((s, c) => s + (c.total_cost ?? 0), 0) * 100),
      };
    },
    staleTime: 30000,
  });

  // ── CDR-based metrics (occupation, avg kWh, kWh by territory) ─
  const { data: cdrMetrics } = useQuery({
    queryKey: ["dashboard-cdr-metrics", selectedCpoId ?? "all", timeRange.from, timeRange.to],
    retry: false,
    queryFn: async () => {
      const nameFilter = cpoStationNames?.slice(0, 50);

      let query = supabase.from("ocpi_cdrs")
        .select("total_energy, total_time, total_cost, cdr_location, start_date_time, end_date_time")
        .gte("start_date_time", timeRange.from)
        .lte("start_date_time", timeRange.to + "T23:59:59");

      if (nameFilter && nameFilter.length > 0) {
        query = query.in("cdr_location->>name", nameFilter);
      } else if (selectedCpoId) {
        query = query.eq("id", "00000000-0000-0000-0000-000000000000");
      }

      const { data, error } = await query.limit(50000);
      if (error) { console.warn("[Dashboard] cdr metrics:", error.message); return null; }

      const cdrs = (data ?? []) as Array<{
        total_energy?: number;
        total_time?: number;
        total_cost?: number;
        cdr_location?: { name?: string; city?: string } | null;
        start_date_time?: string;
        end_date_time?: string;
      }>;

      const sessionCount = cdrs.length;
      const totalEnergy = cdrs.reduce((s, c) => s + (c.total_energy ?? 0), 0);
      const avgKwhPerSession = sessionCount > 0 ? totalEnergy / sessionCount : 0;

      // Total session duration in hours (from total_time in seconds or from timestamps)
      let totalSessionHours = 0;
      for (const c of cdrs) {
        if (c.total_time && c.total_time > 0) {
          totalSessionHours += c.total_time / 3600;
        } else if (c.start_date_time && c.end_date_time) {
          const diff = new Date(c.end_date_time).getTime() - new Date(c.start_date_time).getTime();
          if (diff > 0) totalSessionHours += diff / 3600000;
        }
      }

      // Occupation rate: total session hours / (EVSE count * total hours in period)
      const stationCount = stations?.length ?? 1;
      const periodMs = new Date(timeRange.to + "T23:59:59").getTime() - new Date(timeRange.from).getTime();
      const totalAvailableHours = stationCount * Math.max(periodMs / 3600000, 1);
      const occupationRate = totalAvailableHours > 0
        ? Math.min((totalSessionHours / totalAvailableHours) * 100, 100)
        : 0;

      // kWh by territory
      const kwhByTerritory: Record<string, number> = {};
      // Build a station name -> territory map from our stations data
      const stationTerritoryMap: Record<string, string> = {};
      for (const st of stations ?? []) {
        if (st.name && st.territory_name) {
          stationTerritoryMap[st.name] = st.territory_name;
        }
      }
      for (const c of cdrs) {
        const locationName = c.cdr_location?.name ?? "";
        const territory = stationTerritoryMap[locationName] ?? "Autre";
        kwhByTerritory[territory] = (kwhByTerritory[territory] ?? 0) + (c.total_energy ?? 0);
      }

      const kwhByTerritoryArray = Object.entries(kwhByTerritory)
        .map(([name, kwh]) => ({ name, kwh: Math.round(kwh) }))
        .sort((a, b) => b.kwh - a.kwh)
        .slice(0, 6);

      return { occupationRate, avgKwhPerSession, kwhByTerritoryArray, sessionCount };
    },
    staleTime: 30000,
    enabled: !!stations,
  });

  // ── Top/Flop 5 stations ──────────────────────────────
  const { data: topFlopData } = useQuery({
    queryKey: ["dashboard-top-flop", selectedCpoId ?? "all", timeRange.from, timeRange.to],
    retry: false,
    queryFn: async () => {
      const nameFilter = cpoStationNames?.slice(0, 50);

      let query = supabase.from("ocpi_cdrs")
        .select("total_energy, total_cost, total_time, cdr_location, start_date_time, end_date_time")
        .gte("start_date_time", timeRange.from)
        .lte("start_date_time", timeRange.to + "T23:59:59");

      if (nameFilter && nameFilter.length > 0) {
        query = query.in("cdr_location->>name", nameFilter);
      } else if (selectedCpoId) {
        query = query.eq("id", "00000000-0000-0000-0000-000000000000");
      }

      const { data, error } = await query.limit(50000);
      if (error) return null;

      const cdrs = (data ?? []) as Array<{
        total_energy?: number;
        total_cost?: number;
        total_time?: number;
        cdr_location?: { name?: string; city?: string } | null;
        start_date_time?: string;
        end_date_time?: string;
      }>;

      // Build station name -> territory map
      const stationTerritoryMap: Record<string, string> = {};
      for (const st of stations ?? []) {
        if (st.name && st.territory_name) stationTerritoryMap[st.name] = st.territory_name;
      }

      // Group by station name
      const grouped: Record<string, {
        name: string;
        territory: string;
        sessions: number;
        totalKwh: number;
        totalRevenue: number;
        totalSessionHours: number;
        lastSessionDate: string;
      }> = {};

      for (const c of cdrs) {
        const name = c.cdr_location?.name ?? "Inconnu";
        if (!grouped[name]) {
          grouped[name] = {
            name,
            territory: stationTerritoryMap[name] ?? "—",
            sessions: 0,
            totalKwh: 0,
            totalRevenue: 0,
            totalSessionHours: 0,
            lastSessionDate: "",
          };
        }
        const g = grouped[name];
        g.sessions++;
        g.totalKwh += c.total_energy ?? 0;
        g.totalRevenue += c.total_cost ?? 0;
        if (c.total_time) g.totalSessionHours += c.total_time / 3600;
        const dt = c.start_date_time ?? "";
        if (dt > g.lastSessionDate) g.lastSessionDate = dt;
      }

      const allStations = Object.values(grouped);

      // Compute occupation rate per station
      const periodMs = new Date(timeRange.to + "T23:59:59").getTime() - new Date(timeRange.from).getTime();
      const periodHours = Math.max(periodMs / 3600000, 1);

      const withOccupation = allStations.map((s) => ({
        ...s,
        occupationRate: Math.min((s.totalSessionHours / periodHours) * 100, 100),
      }));

      // Top 5: most sessions
      const top5 = [...withOccupation].sort((a, b) => b.sessions - a.sessions).slice(0, 5);

      // Flop 5: least sessions (exclude very new stations < 30 days in network)
      // We consider all stations from our stations list
      const stationNames = new Set((stations ?? []).map((s) => s.name));
      const allStationEntries = [...stationNames].map((name) => {
        if (grouped[name]) {
          return { ...grouped[name], occupationRate: Math.min(((grouped[name].totalSessionHours) / periodHours) * 100, 100) };
        }
        // Station with 0 sessions
        const st = (stations ?? []).find((s) => s.name === name);
        return {
          name,
          territory: st?.territory_name ?? "—",
          sessions: 0,
          totalKwh: 0,
          totalRevenue: 0,
          totalSessionHours: 0,
          lastSessionDate: "",
          occupationRate: 0,
        };
      });

      // Compute days offline using station data
      const stationOfflineMap: Record<string, number> = {};
      for (const st of stations ?? []) {
        if (!st.is_online && st.hours_in_status) {
          stationOfflineMap[st.name] = Math.round(st.hours_in_status / 24);
        }
      }

      const flop5 = [...allStationEntries]
        .sort((a, b) => a.sessions - b.sessions)
        .slice(0, 5)
        .map((s) => ({
          ...s,
          daysOffline: stationOfflineMap[s.name] ?? 0,
        }));

      return { top5, flop5 };
    },
    staleTime: 30000,
    enabled: !!stations,
  });

  // ── Monthly registrations ─────────────────────────────
  const { data: monthlyRegs } = useQuery({
    queryKey: ["dashboard-monthly-regs", selectedCpoId ?? "all"],
    retry: false,
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from("monthly_registrations").select("*").limit(12);
        if (error) return [];
        return (data ?? []).reverse() as Array<{ month: string; registrations: number }>;
      } catch { return []; }
    },
    staleTime: 60000,
  });

  // ── Recent sessions ───────────────────────────────────
  const { data: recentSessions } = useQuery({
    queryKey: ["dashboard-recent-sessions", selectedCpoId ?? "all"],
    retry: false,
    queryFn: async () => {
      try {
        let chargepointIds: string[] | null = null;
        if (selectedCpoId) {
          const { data: cpStations } = await supabase.from("stations").select("id").eq("cpo_id", selectedCpoId);
          const stationIds = (cpStations ?? []).map((s) => s.id);
          if (stationIds.length === 0) return [];
          const { data: cps } = await supabase.from("ocpp_chargepoints").select("id").in("station_id", stationIds);
          chargepointIds = (cps ?? []).map((c) => c.id);
          if (chargepointIds.length === 0) return [];
        }

        let query = supabase
          .from("ocpp_transactions")
          .select("id, chargepoint_id, connector_id, status, started_at, stopped_at, energy_kwh, ocpp_chargepoints(station_id, stations(name, city, cpo_id))");
        if (chargepointIds) {
          query = query.in("chargepoint_id", chargepointIds);
        }
        const { data, error } = await query.order("started_at", { ascending: false }).limit(5);
        if (error) { console.warn("[Dashboard] recent sessions:", error.message); }

        if (data && data.length > 0) return data;

        // Fallback to ocpi_cdrs
        const { data: cdrs, error: cdrError } = await supabase
          .from("ocpi_cdrs")
          .select("id, start_date_time, end_date_time, total_energy, total_cost, cdr_location, cdr_token, status")
          .order("start_date_time", { ascending: false })
          .limit(5);
        if (cdrError) { return []; }

        return (cdrs ?? []).map((cdr: Record<string, unknown>) => {
          const location = cdr.cdr_location as Record<string, unknown> | null;
          const stationName = location?.name as string ?? "Borne CDR";
          const stationCity = location?.city as string ?? "";
          return {
            id: cdr.id,
            status: "Completed" as const,
            started_at: cdr.start_date_time,
            energy_kwh: cdr.total_energy,
            ocpp_chargepoints: {
              stations: { name: stationName, city: stationCity },
            },
          };
        });
      } catch { return []; }
    },
    refetchInterval: 15000,
  });

  // ── Faulted stations ──────────────────────────────────
  const faultedStations = stations?.filter(
    (s) => s.ocpp_status === "Faulted" || !s.is_online
  ) ?? [];

  // ── Road connectivity stats ─────────────────────────────
  const connectivityStats = useMemo(() => {
    if (!stations) return { online: 0, offline: 0, total: 0 };
    const roadStations = stations.filter((s: any) => s.source === "road");
    const online = roadStations.filter((s: any) => s.connectivity_status === "Online").length;
    return { online, offline: roadStations.length - online, total: roadStations.length };
  }, [stations]);

  // ── Road activity (24h) ────────────────────────────────
  const { data: roadActivity } = useQuery({
    queryKey: ["road-activity-24h"],
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("ocpi_cdrs")
        .select("total_energy, total_cost")
        .eq("source", "road")
        .gte("start_date_time", since);
      if (error) throw error;
      const sessions = data?.length ?? 0;
      const totalKwh = data?.reduce((sum: number, c: any) => sum + (c.total_energy ?? 0), 0) ?? 0;
      return { sessions, totalKwh: Math.round(totalKwh * 10) / 10 };
    },
    staleTime: 300_000,
  });

  // ── Map data ──────────────────────────────────────────
  const mappableStations = useMemo(
    () => (stations ?? []).filter((s) => s.latitude != null && s.longitude != null),
    [stations]
  );
  const mapBounds: LatLngBoundsExpression | null = useMemo(
    () => mappableStations.length > 0
      ? (mappableStations.map((s) => [s.latitude!, s.longitude!]) as LatLngBoundsExpression)
      : null,
    [mappableStations]
  );

  // ── Export CSV data builder ─────────────────────────────
  const exportData = useMemo(() => {
    const rows: Record<string, unknown>[] = [];
    if (kpis) {
      rows.push({ type: "KPI", label: "Total Bornes", value: kpis.total_stations });
      rows.push({ type: "KPI", label: "Disponibles", value: kpis.available });
      rows.push({ type: "KPI", label: "En charge", value: kpis.charging });
      rows.push({ type: "KPI", label: "En panne", value: kpis.faulted });
      rows.push({ type: "KPI", label: "Hors ligne", value: kpis.offline });
    }
    if (businessMetrics) {
      rows.push({ type: "Business", label: "Sessions totales", value: businessMetrics.totalSessions });
      rows.push({ type: "Business", label: "Sessions actives", value: businessMetrics.activeSessions });
      rows.push({ type: "Business", label: "Clients inscrits", value: businessMetrics.totalCustomers });
      rows.push({ type: "Business", label: "Energie totale (kWh)", value: businessMetrics.totalEnergy });
      rows.push({ type: "Business", label: "Revenu total (cents)", value: businessMetrics.totalRevenue });
      rows.push({ type: "Business", label: "Abonnements actifs", value: businessMetrics.activeSubscriptions });
    }
    for (const s of topFlopData?.top5 ?? []) {
      rows.push({ type: "Top 5", label: s.name, value: `${s.sessions} sessions / ${Math.round(s.totalKwh)} kWh` });
    }
    return rows;
  }, [kpis, businessMetrics, topFlopData]);

  const exportColumns = [
    { key: "type", label: "Type" },
    { key: "label", label: "Indicateur" },
    { key: "value", label: "Valeur" },
  ];

  // ── Territory kWh chart colors ────────────────────────
  const TERRITORY_COLORS: Record<string, string> = {
    Guadeloupe: "#00D4AA",
    Martinique: "#4ECDC4",
    Guyane: "#F39C12",
    "Reunion": "#3498DB",
    "Réunion": "#3498DB",
    Autre: "#8892B0",
  };

  // ── Loading / Error ───────────────────────────────────
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
      <div className="flex items-center justify-between flex-wrap gap-3">
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
          { label: "Top / Flop stations", description: "Identifiez les bornes les plus actives et celles nécessitant une attention." },
        ]}
        tips={["Utilisez le filtre de période pour cibler vos analyses sur une plage de dates spécifique."]}
      />

      {/* ── Global Time Filter ──────────────────────────── */}
      <div className="bg-surface border border-border rounded-xl p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Calendar className="w-4 h-4 text-foreground-muted shrink-0" />
          <span className="text-xs font-medium text-foreground-muted shrink-0">Période :</span>

          <button
            onClick={() => handleFilterChange("last_month")}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
              timeRange.filter === "last_month"
                ? "bg-primary/15 text-primary border-primary/30"
                : "text-foreground-muted border-border hover:border-foreground-muted"
            )}
          >
            Mois dernier
          </button>
          <button
            onClick={() => handleFilterChange("current_year")}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
              timeRange.filter === "current_year"
                ? "bg-primary/15 text-primary border-primary/30"
                : "text-foreground-muted border-border hover:border-foreground-muted"
            )}
          >
            Année en cours
          </button>
          <button
            onClick={() => handleFilterChange("custom")}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
              timeRange.filter === "custom"
                ? "bg-primary/15 text-primary border-primary/30"
                : "text-foreground-muted border-border hover:border-foreground-muted"
            )}
          >
            Personnalisé
          </button>

          {timeRange.filter === "custom" && (
            <div className="flex items-center gap-2 ml-2">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="bg-surface-elevated border border-border rounded-lg px-2 py-1 text-xs text-foreground"
              />
              <span className="text-xs text-foreground-muted">au</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="bg-surface-elevated border border-border rounded-lg px-2 py-1 text-xs text-foreground"
              />
              <button
                onClick={handleCustomApply}
                className="px-3 py-1 rounded-lg text-xs font-medium bg-primary text-white hover:bg-primary/90 transition-all"
              >
                Appliquer
              </button>
            </div>
          )}

          {/* Compare toggle */}
          <button
            onClick={() => setCompareMode(!compareMode)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ml-2",
              compareMode
                ? "bg-purple-500/15 text-purple-400 border-purple-500/30"
                : "text-foreground-muted border-border hover:border-foreground-muted"
            )}
          >
            <GitCompare className="w-3.5 h-3.5" />
            Comparer
          </button>

          {/* PDF export */}
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-foreground-muted hover:border-foreground-muted hover:text-foreground transition-all"
          >
            <Printer className="w-3.5 h-3.5" />
            Exporter PDF
          </button>

          <span className="text-[10px] text-foreground-muted ml-auto">
            {new Date(timeRange.from).toLocaleDateString("fr-FR")} — {new Date(timeRange.to).toLocaleDateString("fr-FR")}
          </span>
        </div>

        {/* Compare period picker */}
        {compareMode && (
          <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border/50 flex-wrap">
            <GitCompare className="w-4 h-4 text-purple-400 shrink-0" />
            <span className="text-xs font-medium text-purple-400 shrink-0">Comparer avec :</span>
            <input
              type="date"
              value={compareFrom}
              onChange={(e) => setCompareFrom(e.target.value)}
              className="bg-surface-elevated border border-border rounded-lg px-2 py-1 text-xs text-foreground"
            />
            <span className="text-xs text-foreground-muted">au</span>
            <input
              type="date"
              value={compareTo}
              onChange={(e) => setCompareTo(e.target.value)}
              className="bg-surface-elevated border border-border rounded-lg px-2 py-1 text-xs text-foreground"
            />
            {compareMetrics && (
              <span className="text-[10px] text-purple-400 ml-auto">
                Période de comparaison : {compareMetrics.totalSessions} sessions
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Station Status KPIs ─────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatusKPI label="Total Bornes" value={kpis.total_stations} icon={Activity} color="#8892B0" />
        <StatusKPI label="Disponibles" value={kpis.available} icon={CheckCircle} color="#00D4AA" trend={`${availRate}%`} trendUp />
        <StatusKPI label="En charge" value={kpis.charging} icon={BatteryCharging} color="#4ECDC4" />
        <StatusKPI label="En panne" value={kpis.faulted} icon={AlertTriangle} color="#FF6B6B" highlight={kpis.faulted > 0} />
        <StatusKPI label="Hors ligne" value={kpis.offline} icon={WifiOff} color="#95A5A6" />
      </div>

      {/* ── Business Metrics ────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard icon={Users} label="Clients inscrits" value={businessMetrics?.totalCustomers ?? 0} color="#9B59B6" />
        <MetricCard icon={CreditCard} label="Abonnements actifs" value={businessMetrics?.activeSubscriptions ?? 0} color="#3498DB" />
        <MetricCard icon={Zap} label="Énergie totale" value={`${((businessMetrics?.totalEnergy ?? 0) / 1000).toFixed(1)} MWh`} color="#F39C12" compareValue={compareMode && compareMetrics ? compareMetrics.totalEnergy / 1000 : undefined} />
        <MetricCard icon={TrendingUp} label="Revenu total" value={`${((businessMetrics?.totalRevenue ?? 0) / 100).toLocaleString("fr-FR")} €`} color="#00D4AA" compareValue={compareMode && compareMetrics ? compareMetrics.totalRevenue / 100 : undefined} />
      </div>

      {/* ── Road Connectivity + Activity KPIs ──────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-surface border border-border rounded-xl p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: "#2ECC7115" }}>
              <Wifi className="w-4.5 h-4.5" style={{ color: "#2ECC71" }} />
            </div>
            <div>
              <p className="text-sm font-heading font-bold text-foreground">
                {connectivityStats.online}/{connectivityStats.total}
              </p>
              <p className="text-[11px] text-foreground-muted">Connectivité Road</p>
            </div>
          </div>
          <p className="text-[10px] text-foreground-muted">
            {connectivityStats.offline > 0 ? (
              <span className="text-warning">{connectivityStats.offline} hors ligne</span>
            ) : (
              <span className="text-status-available">Toutes connectées</span>
            )}
          </p>
        </div>
        <div className="bg-surface border border-border rounded-xl p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: "#F39C1215" }}>
              <Zap className="w-4.5 h-4.5" style={{ color: "#F39C12" }} />
            </div>
            <div>
              <p className="text-sm font-heading font-bold text-foreground">
                {roadActivity?.sessions ?? 0} <span className="text-[11px] font-normal text-foreground-muted">sessions</span>
              </p>
              <p className="text-[11px] text-foreground-muted">Activité Road (24h)</p>
            </div>
          </div>
          <p className="text-[10px] text-foreground-muted">
            {roadActivity?.totalKwh ?? 0} kWh distribués
          </p>
        </div>
      </div>

      {/* ── New KPIs: Occupation, Avg kWh, kWh by Territory ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Taux d'occupation */}
        <div className="bg-surface border border-border rounded-xl p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: "#E67E2215" }}>
              <Gauge className="w-4.5 h-4.5" style={{ color: "#E67E22" }} />
            </div>
            <div>
              <p className="text-lg font-heading font-bold text-foreground">
                {(cdrMetrics?.occupationRate ?? 0).toFixed(1)}%
              </p>
              <p className="text-[11px] text-foreground-muted">Taux d'occupation</p>
            </div>
          </div>
          <div className="w-full bg-border/30 rounded-full h-2">
            <div
              className="h-2 rounded-full transition-all"
              style={{
                width: `${Math.min(cdrMetrics?.occupationRate ?? 0, 100)}%`,
                backgroundColor: "#E67E22",
              }}
            />
          </div>
          <p className="text-[10px] text-foreground-muted mt-1.5">
            Temps de charge / temps total disponible
          </p>
        </div>

        {/* kWh moyen / session */}
        <div className="bg-surface border border-border rounded-xl p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: "#3498DB15" }}>
            <Zap className="w-4.5 h-4.5" style={{ color: "#3498DB" }} />
          </div>
          <div>
            <p className="text-lg font-heading font-bold text-foreground">
              {(cdrMetrics?.avgKwhPerSession ?? 0).toFixed(1)} kWh
            </p>
            <p className="text-[11px] text-foreground-muted">kWh moyen / session</p>
            <p className="text-[10px] text-foreground-muted">
              {cdrMetrics?.sessionCount ?? 0} sessions sur la période
            </p>
          </div>
        </div>

        {/* Volume kWh par territoire */}
        <div className="bg-surface border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="w-4 h-4 text-foreground-muted" />
            <p className="text-[11px] font-semibold text-foreground-muted">Volume kWh par territoire</p>
          </div>
          {cdrMetrics?.kwhByTerritoryArray && cdrMetrics.kwhByTerritoryArray.length > 0 ? (
            <ResponsiveContainer width="100%" height={100}>
              <BarChart data={cdrMetrics.kwhByTerritoryArray} margin={{ top: 5, right: 5, bottom: 0, left: -15 }}>
                <XAxis dataKey="name" tick={{ fill: "#8892B0", fontSize: 9 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#8892B0", fontSize: 9 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <RechartsTooltip
                  contentStyle={{ backgroundColor: "#111638", border: "1px solid #2A2F5A", borderRadius: "8px", color: "#F7F9FC", fontSize: "11px" }}
                  formatter={(value: number) => [`${value.toLocaleString("fr-FR")} kWh`, "Volume"]}
                />
                <Bar dataKey="kwh" radius={[4, 4, 0, 0]} maxBarSize={30}>
                  {cdrMetrics.kwhByTerritoryArray.map((entry) => (
                    <Cell key={entry.name} fill={TERRITORY_COLORS[entry.name] ?? "#8892B0"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-xs text-foreground-muted text-center py-6">Aucune donnée</p>
          )}
        </div>
      </div>

      {/* ── Interactive Map ──────────────────────────────── */}
      <div className="bg-surface border border-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <MapPin className="w-4 h-4 text-foreground-muted" />
          <h2 className="font-heading text-sm font-semibold text-foreground-muted">
            Carte des bornes — Statut OCPP en temps réel
          </h2>
          <span className="text-[10px] text-foreground-muted ml-auto">
            {mappableStations.length} bornes géolocalisées
          </span>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mb-3 flex-wrap">
          {[
            { label: "Disponible", color: "#00D4AA" },
            { label: "En charge", color: "#3498DB" },
            { label: "Suspendu", color: "#E67E22" },
            { label: "En panne", color: "#FF6B6B" },
            { label: "Hors ligne", color: "#95A5A6" },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
              <span className="text-[10px] text-foreground-muted">{item.label}</span>
            </div>
          ))}
        </div>

        <div className="rounded-lg overflow-hidden" style={{ height: 350 }}>
          {mappableStations.length > 0 ? (
            <Suspense fallback={
              <div className="flex items-center justify-center h-full bg-surface-elevated rounded-lg">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                  <p className="text-xs text-foreground-muted">Chargement carte…</p>
                </div>
              </div>
            }>
              <DashboardMap stations={mappableStations} bounds={mapBounds} />
            </Suspense>
          ) : (
            <div className="flex items-center justify-center h-full bg-surface-elevated rounded-lg">
              <p className="text-xs text-foreground-muted">Aucune borne géolocalisée</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Monthly Registrations ────────────────────────── */}
      {monthlyRegs && monthlyRegs.length > 0 && (
        <div className="bg-surface border border-border rounded-xl p-5">
          <h2 className="font-heading text-sm font-semibold mb-3 text-foreground-muted">
            Inscriptions conducteurs par mois
          </h2>
          <div className="flex items-end gap-1 h-20">
            {monthlyRegs.map((m, i) => {
              const max = Math.max(...monthlyRegs.map((r) => r.registrations), 1);
              const h = Math.max(4, (m.registrations / max) * 80);
              const monthLabel = new Date(m.month).toLocaleDateString("fr-FR", { month: "short" });
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[9px] text-foreground-muted tabular-nums">{m.registrations > 0 ? m.registrations : ""}</span>
                  <div className="w-full bg-primary/20 rounded-t" style={{ height: `${h}px` }}>
                    <div className="w-full bg-primary rounded-t transition-all" style={{ height: `${h}px` }} />
                  </div>
                  <span className="text-[8px] text-foreground-muted">{monthLabel}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Charts + Activity ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-surface border border-border rounded-xl p-5">
          <h2 className="font-heading text-sm font-semibold mb-4 text-foreground-muted">
            Répartition par territoire
          </h2>
          <TerritoryChart stations={stations ?? []} />
        </div>

        <div className="bg-surface border border-border rounded-xl p-5">
          <h2 className="font-heading text-sm font-semibold mb-4 text-foreground-muted">
            Répartition par CPO
          </h2>
          <CPOChart stations={stations ?? []} />
        </div>

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
                      const cp = session.ocpp_chargepoints;
                      if (cp && typeof cp === "object") {
                        const st = (cp as Record<string, unknown>).stations;
                        if (st && typeof st === "object" && "name" in (st as object)) return (st as { name: string }).name;
                      }
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

      {/* ── Top 5 / Flop 5 Stations ─────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top 5 */}
        <div className="bg-surface border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Trophy className="w-4 h-4 text-yellow-500" />
            <h2 className="font-heading text-sm font-semibold text-foreground-muted">
              Top 5 — Bornes les plus utilisées
            </h2>
          </div>
          {topFlopData?.top5 && topFlopData.top5.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left py-2 px-1 text-foreground-muted font-medium">#</th>
                    <th className="text-left py-2 px-1 text-foreground-muted font-medium">Station</th>
                    <th className="text-left py-2 px-1 text-foreground-muted font-medium">Territoire</th>
                    <th className="text-right py-2 px-1 text-foreground-muted font-medium">Sessions</th>
                    <th className="text-right py-2 px-1 text-foreground-muted font-medium">kWh</th>
                    <th className="text-right py-2 px-1 text-foreground-muted font-medium">Revenu</th>
                    <th className="text-right py-2 px-1 text-foreground-muted font-medium">Occup.</th>
                  </tr>
                </thead>
                <tbody>
                  {topFlopData.top5.map((s, i) => (
                    <tr key={s.name} className="border-b border-border/30 last:border-0">
                      <td className="py-2 px-1 text-foreground-muted">{i + 1}</td>
                      <td className="py-2 px-1 text-foreground font-medium max-w-[140px] truncate">{s.name}</td>
                      <td className="py-2 px-1 text-foreground-muted">{s.territory}</td>
                      <td className="py-2 px-1 text-right text-foreground tabular-nums">{s.sessions}</td>
                      <td className="py-2 px-1 text-right text-foreground tabular-nums">{Math.round(s.totalKwh).toLocaleString("fr-FR")}</td>
                      <td className="py-2 px-1 text-right text-foreground tabular-nums">{s.totalRevenue.toFixed(0)} &euro;</td>
                      <td className="py-2 px-1 text-right text-primary font-medium tabular-nums">{s.occupationRate.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-foreground-muted text-center py-8">Aucune donnée sur la période</p>
          )}
        </div>

        {/* Flop 5 */}
        <div className="bg-surface border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <ThumbsDown className="w-4 h-4 text-danger" />
            <h2 className="font-heading text-sm font-semibold text-foreground-muted">
              Flop 5 — Bornes les moins performantes
            </h2>
          </div>
          {topFlopData?.flop5 && topFlopData.flop5.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left py-2 px-1 text-foreground-muted font-medium">#</th>
                    <th className="text-left py-2 px-1 text-foreground-muted font-medium">Station</th>
                    <th className="text-left py-2 px-1 text-foreground-muted font-medium">Territoire</th>
                    <th className="text-right py-2 px-1 text-foreground-muted font-medium">Sessions</th>
                    <th className="text-right py-2 px-1 text-foreground-muted font-medium">kWh</th>
                    <th className="text-right py-2 px-1 text-foreground-muted font-medium">Jours offline</th>
                    <th className="text-right py-2 px-1 text-foreground-muted font-medium">Dern. session</th>
                  </tr>
                </thead>
                <tbody>
                  {topFlopData.flop5.map((s, i) => (
                    <tr
                      key={s.name}
                      className={cn(
                        "border-b border-border/30 last:border-0",
                        s.daysOffline > 7 && "bg-danger/5"
                      )}
                    >
                      <td className="py-2 px-1 text-foreground-muted">{i + 1}</td>
                      <td className={cn(
                        "py-2 px-1 font-medium max-w-[140px] truncate",
                        s.daysOffline > 7 ? "text-danger" : "text-foreground"
                      )}>
                        {s.name}
                      </td>
                      <td className="py-2 px-1 text-foreground-muted">{s.territory}</td>
                      <td className="py-2 px-1 text-right text-foreground tabular-nums">{s.sessions}</td>
                      <td className="py-2 px-1 text-right text-foreground tabular-nums">{Math.round(s.totalKwh).toLocaleString("fr-FR")}</td>
                      <td className={cn(
                        "py-2 px-1 text-right tabular-nums font-medium",
                        s.daysOffline > 7 ? "text-danger" : "text-foreground-muted"
                      )}>
                        {s.daysOffline > 0 ? `${s.daysOffline}j` : "—"}
                      </td>
                      <td className="py-2 px-1 text-right text-foreground-muted tabular-nums">
                        {s.lastSessionDate
                          ? new Date(s.lastSessionDate).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-foreground-muted text-center py-8">Aucune donnée sur la période</p>
          )}
        </div>
      </div>

      {/* ── Alerts Panel ─────────────────────────────────── */}
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
  compareValue,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  value: string | number;
  color: string;
  compareValue?: number | null;
}) {
  const pctChange = compareValue != null && compareValue > 0
    ? (((typeof value === "number" ? value : 0) - compareValue) / compareValue) * 100
    : null;

  return (
    <div className="bg-surface border border-border rounded-xl p-4 flex items-center gap-3">
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ backgroundColor: `${color}15` }}
      >
        <Icon className="w-4.5 h-4.5" style={{ color }} />
      </div>
      <div>
        <div className="flex items-center gap-2">
          <p className="text-sm font-heading font-bold text-foreground">{value}</p>
          {pctChange != null && (
            <span className={cn("text-[10px] font-semibold flex items-center gap-0.5", pctChange >= 0 ? "text-status-available" : "text-danger")}>
              {pctChange >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
              {Math.abs(pctChange).toFixed(0)}%
            </span>
          )}
        </div>
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
