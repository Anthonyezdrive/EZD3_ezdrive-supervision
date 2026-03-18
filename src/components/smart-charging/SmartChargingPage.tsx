// ============================================================
// EZDrive — Smart Charging Page (GreenFlux-style)
// List → click name → Detail view (read-only) → click Editer → Edit view
// ============================================================

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useCpo } from "@/contexts/CpoContext";
import { useTerritories } from "@/hooks/useTerritories";
import { useStations } from "@/hooks/useStations";
import {
  BatteryCharging,
  Zap,
  ChevronDown,
  ChevronUp,
  Plus,
  Search,
  MoreVertical,
  ArrowLeft,
  Save,
  X,
  Loader2,
  Columns,
  Globe,
  ExternalLink,
  Trash2,
  FileSpreadsheet,
  Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────

interface SmartChargingGroup {
  id: string;
  name: string;
  algorithm: string;
  structure: string;
  evseCount: number;
  cpoName: string;
  cpoCode: string;
  territoryId: string | null;
}

type EditTab = "details" | "algorithm" | "evse";

interface EvseRow {
  id: string;
  identity: string;
  stationIdentity: string;
  status: string;
  lastHeartbeat: string | null;
  isConnected: boolean;
}

// ── Constants ────────────────────────────────────────────────

const ALGORITHMS = [
  { value: "capacity_management_ac", label: "Capacity Management AC", description: "Cet algorithme est utilisé pour éviter la surcharge d'un disjoncteur. Il est généralement appliqué à un groupe de stations de charge qui sont toutes connectées au même disjoncteur." },
  { value: "capacity_management_dc", label: "Capacity Management DC", description: "Algorithme de gestion de capacité pour bornes DC rapides." },
  { value: "load_balancing", label: "Load Balancing", description: "Répartition équilibrée de la charge entre les bornes du groupe." },
];

const TIMEZONES = [
  { value: "America/Guadeloupe", label: "(UTC-04:00) Georgetown, La Paz, Manaus, San Juan" },
  { value: "America/Martinique", label: "(UTC-04:00) Georgetown, La Paz, Manaus, San Juan" },
  { value: "Indian/Reunion", label: "(UTC+04:00) Port Louis, Reunion" },
  { value: "Europe/Paris", label: "(UTC+01:00) Paris, Bruxelles" },
];

const DAYS_OF_WEEK = ["Normal", "Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

// Sample capacity schedule (would come from config file in production)
const CAPACITY_SCHEDULE = [
  { day: "Wednesday", start: "00:00:00", end: "11:00:00", capacity: 20 },
  { day: "Wednesday", start: "11:00:00", end: "15:00:00", capacity: 0 },
  { day: "Wednesday", start: "18:00:00", end: "23:59:00", capacity: 20 },
  { day: "Thursday", start: "00:00:00", end: "11:00:00", capacity: 20 },
  { day: "Thursday", start: "11:00:00", end: "15:00:00", capacity: 0 },
  { day: "Thursday", start: "18:00:00", end: "23:59:00", capacity: 20 },
  { day: "Friday", start: "00:00:00", end: "11:00:00", capacity: 20 },
  { day: "Friday", start: "11:00:00", end: "15:00:00", capacity: 0 },
  { day: "Friday", start: "18:00:00", end: "23:59:00", capacity: 20 },
];

// ══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════

export function SmartChargingPage() {
  const [selectedGroup, setSelectedGroup] = useState<SmartChargingGroup | null>(null);
  const [editingGroup, setEditingGroup] = useState<SmartChargingGroup | null>(null);
  const queryClient = useQueryClient();

  const handleSaved = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["smart-charging"] });
    setEditingGroup(null);
    // Go back to detail view after save
    if (editingGroup) setSelectedGroup(editingGroup);
  }, [queryClient, editingGroup]);

  // Level 3: Edit view
  if (editingGroup) {
    return (
      <GroupEditView
        group={editingGroup}
        onBack={() => {
          setEditingGroup(null);
          setSelectedGroup(editingGroup);
        }}
        onSaved={handleSaved}
      />
    );
  }

  // Level 2: Detail view (read-only)
  if (selectedGroup) {
    return (
      <GroupDetailView
        group={selectedGroup}
        onBack={() => setSelectedGroup(null)}
        onEdit={() => setEditingGroup(selectedGroup)}
      />
    );
  }

  // Level 1: Group list
  return <GroupListView onSelect={setSelectedGroup} />;
}

// ══════════════════════════════════════════════════════════════
// GROUP LIST VIEW
// ══════════════════════════════════════════════════════════════

function GroupListView({ onSelect }: { onSelect: (group: SmartChargingGroup) => void }) {
  const { selectedCpoId } = useCpo();
  const { data: territories } = useTerritories();
  const { data: stations } = useStations(selectedCpoId);
  const [filterName, setFilterName] = useState("");
  const [filterCpo, setFilterCpo] = useState("");
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [createDropdownOpen, setCreateDropdownOpen] = useState(false);
  const [rowMenuOpen, setRowMenuOpen] = useState<string | null>(null);
  const createRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (createRef.current && !createRef.current.contains(e.target as Node)) {
        setCreateDropdownOpen(false);
      }
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setRowMenuOpen(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Fetch chargepoints to count EVSEs per territory
  const { data: chargepoints } = useQuery({
    queryKey: ["smart-charging-chargepoints-all", selectedCpoId ?? "all"],
    retry: false,
    queryFn: async () => {
      try {
        let query = supabase
          .from("ocpp_chargepoints")
          .select("id, station_id, connector_count, is_connected");
        if (selectedCpoId && stations?.length) {
          query = query.in("station_id", stations.map((s) => s.id));
        }
        const { data, error } = await query;
        if (error) return [];
        return data ?? [];
      } catch { return []; }
    },
    enabled: !selectedCpoId || (stations?.length ?? 0) > 0,
  });

  // Build groups from territories
  const groups = useMemo((): SmartChargingGroup[] => {
    if (!territories || !stations) return [];

    const territoryMap = new Map<string, { stations: typeof stations; cpoName: string; cpoCode: string }>();

    for (const s of stations) {
      const tKey = s.territory_id ?? "unknown";
      if (!territoryMap.has(tKey)) {
        territoryMap.set(tKey, {
          stations: [],
          cpoName: s.cpo_name ?? "ezdrive",
          cpoCode: s.cpo_code ?? "ezdrive",
        });
      }
      territoryMap.get(tKey)!.stations.push(s);
    }

    const result: SmartChargingGroup[] = [];

    for (const t of territories) {
      const entry = territoryMap.get(t.id);
      const stationIds = entry?.stations.map((s) => s.id) ?? [];
      const evseCount = chargepoints
        ?.filter((cp: any) => stationIds.includes(cp.station_id))
        .reduce((sum: number, cp: any) => sum + (cp.connector_count ?? 0), 0) ?? 0;

      result.push({
        id: t.id,
        name: t.name,
        algorithm: "Capacity Management AC",
        structure: "Standalone",
        evseCount,
        cpoName: entry?.cpoName ?? "ezdrive",
        cpoCode: entry?.cpoCode ?? "ezdrive",
        territoryId: t.id,
      });
    }

    return result;
  }, [territories, stations, chargepoints]);

  // Filter
  const filtered = useMemo(() => {
    let result = groups;
    if (filterName) {
      const q = filterName.toLowerCase();
      result = result.filter((g) => g.name.toLowerCase().includes(q));
    }
    if (filterCpo) {
      const q = filterCpo.toLowerCase();
      result = result.filter((g) => g.cpoName.toLowerCase().includes(q) || g.cpoCode.toLowerCase().includes(q));
    }
    return result;
  }, [groups, filterName, filterCpo]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-xl font-bold text-foreground">Smart Charging</h1>
        <div className="relative" ref={createRef}>
          <button
            onClick={() => setCreateDropdownOpen(!createDropdownOpen)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            Create new
            <ChevronDown className="w-3.5 h-3.5 ml-1" />
          </button>
          {createDropdownOpen && (
            <div className="absolute right-0 top-full mt-1 w-48 bg-surface border border-border rounded-xl shadow-lg z-50 py-1">
              <button
                onClick={() => setCreateDropdownOpen(false)}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-foreground hover:bg-surface-elevated transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Standalone
              </button>
              <button
                onClick={() => setCreateDropdownOpen(false)}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-foreground hover:bg-surface-elevated transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Multi-level
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tab */}
      <div className="flex gap-1">
        <button className="px-4 py-2 bg-surface border border-border rounded-lg text-sm font-medium text-foreground">
          All
        </button>
      </div>

      {/* Column controls */}
      <div className="flex items-center justify-end gap-2">
        <button className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-sm text-foreground-muted hover:text-foreground transition-colors">
          <Columns className="w-3.5 h-3.5" />
          Columns
        </button>
        <button className="p-1.5 border border-border rounded-lg text-foreground-muted hover:text-foreground transition-colors">
          <MoreVertical className="w-4 h-4" />
        </button>
      </div>

      {/* Table */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="w-10 px-3 py-3"><input type="checkbox" className="rounded border-border" disabled /></th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-foreground-muted uppercase">
                  <span className="inline-flex items-center gap-1">NAME <ChevronDown className="w-3 h-3" /></span>
                </th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-foreground-muted uppercase">Algorithm</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-foreground-muted uppercase">Structure</th>
                <th className="text-center py-3 px-4 text-xs font-semibold text-foreground-muted uppercase">EVSEs</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-foreground-muted uppercase">
                  <span className="inline-flex items-center gap-1">CPO <ChevronDown className="w-3 h-3" /></span>
                </th>
              </tr>
              {/* Filter row */}
              <tr className="border-b border-border bg-surface-elevated/30">
                <td className="px-3 py-1.5"></td>
                <td className="px-4 py-1.5">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-foreground-muted" />
                    <input type="text" value={filterName} onChange={(e) => setFilterName(e.target.value)} placeholder="Search"
                      className="w-full pl-7 pr-2 py-1 bg-surface border border-border rounded-lg text-xs text-foreground placeholder:text-foreground-muted/40 focus:outline-none focus:border-primary/50" />
                  </div>
                </td>
                <td className="px-4 py-1.5">
                  <select className="w-full px-2 py-1 bg-surface border border-border rounded-lg text-xs text-foreground-muted">
                    <option>Select</option>
                    <option>Capacity Management AC</option>
                    <option>Capacity Management DC</option>
                  </select>
                </td>
                <td className="px-4 py-1.5">
                  <ChevronDown className="w-3 h-3 text-foreground-muted" />
                </td>
                <td className="px-4 py-1.5"></td>
                <td className="px-4 py-1.5">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-foreground-muted" />
                    <input type="text" value={filterCpo} onChange={(e) => setFilterCpo(e.target.value)} placeholder="Search"
                      className="w-full pl-7 pr-2 py-1 bg-surface border border-border rounded-lg text-xs text-foreground placeholder:text-foreground-muted/40 focus:outline-none focus:border-primary/50" />
                  </div>
                </td>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={6} className="py-12 text-center text-foreground-muted text-sm">Aucun groupe de charge intelligente</td></tr>
              ) : filtered.map((group) => (
                <tr
                  key={group.id}
                  className="border-b border-border/50 hover:bg-surface-elevated/30 transition-colors"
                  onMouseEnter={() => setHoveredRow(group.id)}
                  onMouseLeave={() => { setHoveredRow(null); if (rowMenuOpen === group.id) setRowMenuOpen(null); }}
                >
                  <td className="px-3 py-3"><input type="checkbox" className="rounded border-border" disabled /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onSelect(group)}
                        className="text-primary font-medium hover:underline"
                      >
                        {group.name}
                      </button>
                      {hoveredRow === group.id && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => onSelect(group)}
                            className="px-2 py-0.5 bg-surface-elevated border border-border rounded text-xs text-foreground-muted hover:text-foreground transition-colors"
                          >
                            Edit
                          </button>
                          <div className="relative" ref={rowMenuOpen === group.id ? menuRef : undefined}>
                            <button
                              onClick={() => setRowMenuOpen(rowMenuOpen === group.id ? null : group.id)}
                              className="p-0.5 text-foreground-muted hover:text-foreground transition-colors"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                            {rowMenuOpen === group.id && (
                              <div className="absolute left-0 top-full mt-1 w-44 bg-surface border border-border rounded-xl shadow-lg z-50 py-1">
                                <button
                                  onClick={() => {
                                    setRowMenuOpen(null);
                                    // Open in new tab - navigate to same page state
                                    window.open(`/smart-charging?group=${group.id}`, "_blank");
                                  }}
                                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-surface-elevated transition-colors"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                  Open in new tab
                                </button>
                                <button
                                  onClick={() => {
                                    setRowMenuOpen(null);
                                    if (confirm(`Supprimer le groupe "${group.name}" ?`)) {
                                      // Delete is a placeholder — future: delete from smart_charging_groups table
                                    }
                                  }}
                                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-surface-elevated transition-colors"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  Delete
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-foreground">{group.algorithm}</td>
                  <td className="px-4 py-3 text-foreground">{group.structure}</td>
                  <td className="px-4 py-3 text-center text-foreground">{group.evseCount}</td>
                  <td className="px-4 py-3 text-foreground">{group.cpoCode}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// GROUP DETAIL VIEW (Read-only, GFX-style)
// ══════════════════════════════════════════════════════════════

function GroupDetailView({
  group,
  onBack,
  onEdit,
}: {
  group: SmartChargingGroup;
  onBack: () => void;
  onEdit: () => void;
}) {
  const [editDropdownOpen, setEditDropdownOpen] = useState(false);
  const [capacityDayTab, setCapacityDayTab] = useState("Normal");
  const [evseCollapsed, setEvseCollapsed] = useState(false);
  const editRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (editRef.current && !editRef.current.contains(e.target as Node)) {
        setEditDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Fetch EVSEs
  const { data: stations } = useStations();
  const territoryStations = useMemo(() => {
    if (!stations || !group.territoryId) return [];
    return stations.filter((s) => s.territory_id === group.territoryId);
  }, [stations, group.territoryId]);

  const { data: evseRows } = useQuery<EvseRow[]>({
    queryKey: ["smart-charging-detail-evses", group.territoryId],
    queryFn: async () => {
      if (territoryStations.length === 0) return [];
      const stationIds = territoryStations.map((s) => s.id);
      const { data, error } = await supabase
        .from("ocpp_chargepoints")
        .select("id, chargepoint_identity, station_id, is_connected, last_heartbeat_at")
        .in("station_id", stationIds)
        .order("last_heartbeat_at", { ascending: false });
      if (error) return [];
      return (data ?? []).map((cp: any) => ({
        id: cp.id,
        identity: `FR-GFX-${cp.chargepoint_identity}-1`,
        stationIdentity: cp.chargepoint_identity ?? "",
        status: cp.is_connected ? "Available" : "Unknown",
        lastHeartbeat: cp.last_heartbeat_at,
        isConnected: cp.is_connected ?? false,
      }));
    },
    enabled: territoryStations.length > 0,
  });

  const chargingEvses = evseRows?.filter((e) => e.status === "Available" && e.isConnected).length ?? 0;
  const totalEvses = evseRows?.length ?? 0;
  const currentCapacity = 20;
  const usagePercent = totalEvses > 0 ? Math.round((chargingEvses / totalEvses) * 100) : 0;

  // Generate chart bars (24 hours)
  const chartBars = useMemo(() => {
    const bars: { hour: number; value: number }[] = [];
    for (let h = 0; h < 24; h++) {
      // Simple simulation based on schedule
      const inPeak = h >= 11 && h < 15;
      bars.push({ hour: h, value: inPeak ? 0 : currentCapacity });
    }
    return bars;
  }, []);

  const now = new Date();
  const currentHour = now.getHours();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-xl border border-border hover:bg-surface-elevated transition-colors">
            <ArrowLeft className="w-4 h-4 text-foreground-muted" />
          </button>
          <BatteryCharging className="w-5 h-5 text-primary" />
          <div>
            <h1 className="font-heading text-xl font-bold text-foreground">{group.name}</h1>
            <p className="text-xs text-foreground-muted uppercase tracking-wide">Groupe de charge intelligente</p>
          </div>
        </div>
        <div className="relative" ref={editRef}>
          <div className="flex items-center">
            <button
              onClick={onEdit}
              className="px-5 py-2.5 bg-primary text-white rounded-l-xl text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              Editer
            </button>
            <button
              onClick={() => setEditDropdownOpen(!editDropdownOpen)}
              className="px-2.5 py-2.5 bg-primary text-white rounded-r-xl border-l border-white/20 hover:bg-primary/90 transition-colors"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
          {editDropdownOpen && (
            <div className="absolute right-0 top-full mt-1 w-48 bg-surface border border-border rounded-xl shadow-lg z-50 py-1">
              <button
                onClick={() => { setEditDropdownOpen(false); onEdit(); }}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-surface-elevated transition-colors"
              >
                Editer
              </button>
              <button
                onClick={() => setEditDropdownOpen(false)}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-surface-elevated transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Supprimer
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Two-column: Détails + Paramètres */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Détails */}
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">Détails</h2>
            {totalEvses > 0 && (
              <span className="px-3 py-1 bg-primary/10 text-primary text-xs font-medium rounded-full">
                {chargingEvses} of {totalEvses} EVSEs charging | {currentCapacity},00A | {usagePercent}%
              </span>
            )}
          </div>
          <div className="p-6 space-y-4">
            <div className="flex items-start">
              <span className="text-sm text-foreground-muted w-32 shrink-0">CPO</span>
              <span className="text-sm text-foreground">{group.cpoCode}</span>
            </div>
            <div>
              <span className="text-sm text-foreground-muted">Remarques</span>
              <div className="mt-2 w-full min-h-[120px] px-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground-muted/50">
                {/* Read-only remarks placeholder */}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Paramètres */}
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-base font-semibold text-foreground">Paramètres</h2>
          </div>
          <div className="p-6 space-y-3">
            <div className="flex items-center justify-between py-1.5">
              <span className="text-sm text-foreground-muted">Algorithme</span>
              <span className="text-sm text-foreground">Capacity Management AC</span>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-sm text-foreground-muted">Méthode de mise à jour de capacité</span>
              <span className="text-sm text-foreground">Fichier</span>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-sm text-foreground-muted">Capacité par défaut</span>
              <span className="text-sm text-foreground">{currentCapacity} A</span>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-sm text-foreground-muted">Maximum du câble de la station de charge</span>
              <span className="text-sm text-foreground">-</span>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-sm text-foreground-muted">Alimentation électrique maximum</span>
              <span className="text-sm text-foreground">-</span>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-sm text-foreground-muted">Fuseau horaire</span>
              <span className="text-sm text-foreground">(UTC-04:00) Georgetown, La Paz, Manaus, San Juan</span>
            </div>

            {/* Config file card */}
            <div className="mt-4 flex items-center gap-3 p-3 bg-surface-elevated rounded-xl border border-border">
              <FileSpreadsheet className="w-8 h-8 text-foreground-muted shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground font-medium truncate">dynamicCapacityDayOfWeekE...</p>
                <p className="text-xs text-foreground-muted">Fichier de configuration</p>
              </div>
              <button className="p-1.5 text-foreground-muted hover:text-foreground transition-colors">
                <Copy className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Historique des attributions */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">Historique des attributions</h2>
          <button className="text-sm text-primary font-medium hover:text-primary/80 transition-colors">
            Export
          </button>
        </div>
        <div className="p-6">
          {/* Date selector */}
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-full text-sm font-medium">
              {now.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" })}
              <ChevronDown className="w-3.5 h-3.5" />
            </div>
            <button className="text-sm text-primary font-medium hover:text-primary/80 transition-colors">
              aujourd'hui
            </button>
            <span className="text-sm text-foreground-muted italic">
              L'équilibrage de charge n'est pas actif
            </span>
            <span className="ml-auto text-sm text-primary font-medium cursor-pointer hover:text-primary/80 transition-colors">
              réinitialiser le zoom
            </span>
          </div>

          {/* Chart - capacity over 24h */}
          <div className="relative h-48 mb-2">
            {/* Y-axis labels */}
            <div className="absolute left-0 top-0 bottom-0 w-8 flex flex-col justify-between text-xs text-foreground-muted py-1">
              <span>20</span>
              <span>18</span>
              <span>16</span>
              <span>14</span>
              <span>12</span>
              <span>10</span>
              <span>8</span>
              <span>6</span>
              <span>4</span>
              <span>2</span>
              <span>0</span>
            </div>
            {/* Bars */}
            <div className="ml-10 h-full flex items-end gap-px">
              {chartBars.map((bar) => (
                <div
                  key={bar.hour}
                  className="flex-1 flex flex-col justify-end"
                  title={`${bar.hour}:00 — ${bar.value}A`}
                >
                  <div
                    className={cn(
                      "w-full rounded-t-sm transition-all",
                      bar.hour <= currentHour
                        ? "bg-red-400/60"
                        : "bg-gray-300/30"
                    )}
                    style={{ height: `${(bar.value / 20) * 100}%` }}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* X-axis labels */}
          <div className="ml-10 flex justify-between text-xs text-foreground-muted">
            {Array.from({ length: 13 }, (_, i) => (
              <span key={i}>{String(i * 2).padStart(2, "0")}:00</span>
            ))}
          </div>
          <p className="text-center text-xs text-foreground-muted mt-2">Historique de charge</p>
        </div>
      </div>

      {/* Capacité disponible */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">Capacité disponible (A)</h2>
        </div>
        <div className="px-6 pt-4">
          {/* Day tabs */}
          <div className="flex gap-6 border-b border-border">
            {DAYS_OF_WEEK.map((day) => (
              <button
                key={day}
                onClick={() => setCapacityDayTab(day)}
                className={cn(
                  "pb-2.5 text-sm font-medium transition-colors relative",
                  capacityDayTab === day ? "text-primary" : "text-foreground-muted hover:text-foreground"
                )}
              >
                {day}
                {capacityDayTab === day && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />}
              </button>
            ))}
          </div>
        </div>

        {/* Schedule table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-3 px-6 text-xs font-semibold text-foreground-muted uppercase">Jour de la semaine</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-foreground-muted uppercase">Heure de début</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-foreground-muted uppercase">Heure de fin</th>
                <th className="text-right py-3 px-6 text-xs font-semibold text-foreground-muted uppercase">Capacité</th>
              </tr>
            </thead>
            <tbody>
              {CAPACITY_SCHEDULE.map((slot, idx) => (
                <tr key={idx} className="border-b border-border/50 hover:bg-surface-elevated/30 transition-colors">
                  <td className="px-6 py-3 text-foreground">{slot.day}</td>
                  <td className="px-6 py-3 text-foreground">{slot.start}</td>
                  <td className="px-6 py-3 text-foreground">{slot.end}</td>
                  <td className="px-6 py-3 text-right text-foreground">{slot.capacity} (A)</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-border text-xs text-foreground-muted">
          <span>
            récupéré le {now.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" })} @ {now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
          <span>montrer {CAPACITY_SCHEDULE.length} enregistrements</span>
        </div>
      </div>

      {/* EVSE section (collapsible) */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        <button
          onClick={() => setEvseCollapsed(!evseCollapsed)}
          className="w-full flex items-center justify-between px-6 py-4"
        >
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            <h2 className="text-base font-semibold text-foreground">EVSE ({totalEvses})</h2>
          </div>
          {evseCollapsed ? (
            <ChevronDown className="w-5 h-5 text-foreground-muted" />
          ) : (
            <ChevronUp className="w-5 h-5 text-foreground-muted" />
          )}
        </button>

        {!evseCollapsed && (
          <div className="px-6 pb-6">
            {/* Sub-tab + manage button */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex gap-6 border-b border-border">
                <button className="pb-2.5 text-sm font-medium text-primary relative">
                  Normal
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
                </button>
              </div>
              <button className="px-4 py-2 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors">
                Gérer Les EVSE Liés
              </button>
            </div>

            {/* EVSE table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">
                      <span className="inline-flex items-center gap-1">État de charge intelligente <ChevronDown className="w-3 h-3" /></span>
                    </th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">
                      <span className="inline-flex items-center gap-1">Identifiant EVSE <ChevronDown className="w-3 h-3" /></span>
                    </th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">
                      <span className="inline-flex items-center gap-1">Identifiant de la station de charge <ChevronDown className="w-3 h-3" /></span>
                    </th>
                  </tr>
                  {/* Filter row */}
                  <tr className="border-b border-border bg-surface-elevated/30">
                    <td className="px-3 py-1.5">
                      <select className="w-full px-2 py-1 bg-surface border border-border rounded-lg text-xs text-foreground-muted">
                        <option>All</option>
                        <option>En ligne</option>
                        <option>Hors Ligne</option>
                      </select>
                    </td>
                    <td className="px-3 py-1.5">
                      <input type="text" placeholder="Recherche..." className="w-full px-2 py-1 bg-surface border border-border rounded-lg text-xs text-foreground placeholder:text-foreground-muted/40 focus:outline-none focus:border-primary/50" />
                    </td>
                    <td className="px-3 py-1.5">
                      <input type="text" placeholder="Recherche..." className="w-full px-2 py-1 bg-surface border border-border rounded-lg text-xs text-foreground placeholder:text-foreground-muted/40 focus:outline-none focus:border-primary/50" />
                    </td>
                  </tr>
                </thead>
                <tbody>
                  {!evseRows || evseRows.length === 0 ? (
                    <tr><td colSpan={3} className="py-8 text-center text-foreground-muted text-sm">Aucun EVSE dans ce groupe</td></tr>
                  ) : evseRows.map((evse) => (
                    <tr key={evse.id} className="border-b border-border/50 hover:bg-surface-elevated/30 transition-colors">
                      <td className="px-3 py-2.5">
                        <span className={cn(
                          "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold",
                          evse.isConnected ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
                        )}>
                          {evse.isConnected ? "En Ligne" : "Hors Ligne"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-foreground font-mono text-xs">{evse.identity}</td>
                      <td className="px-3 py-2.5 text-foreground">{evse.stationIdentity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// GROUP EDIT VIEW (Full-page, 3 tabs)
// ══════════════════════════════════════════════════════════════

function GroupEditView({
  group,
  onBack,
  onSaved,
}: {
  group: SmartChargingGroup;
  onBack: () => void;
  onSaved: () => void;
}) {
  const [activeTab, setActiveTab] = useState<EditTab>("details");
  const [saving, setSaving] = useState(false);

  // Form state — Details
  const [groupName, setGroupName] = useState(group.name);
  const [groupCpo, setGroupCpo] = useState(group.cpoCode);
  const [remarks, setRemarks] = useState("");

  // Form state — Algorithm
  const [algorithm, setAlgorithm] = useState("capacity_management_ac");
  const [capacityMethod, setCapacityMethod] = useState<"default" | "file" | "api">("file");
  const [defaultCapacity, setDefaultCapacity] = useState("20");
  const [configFile] = useState("dynamicCapacityDayOfWeekExample.xlsx");
  const [timezone, setTimezone] = useState("America/Guadeloupe");

  // Fetch EVSEs for this group's territory
  const { data: stations } = useStations();
  const territoryStations = useMemo(() => {
    if (!stations || !group.territoryId) return [];
    return stations.filter((s) => s.territory_id === group.territoryId);
  }, [stations, group.territoryId]);

  const { data: evseRows, isLoading: evseLoading } = useQuery<EvseRow[]>({
    queryKey: ["smart-charging-evses", group.territoryId],
    queryFn: async () => {
      if (territoryStations.length === 0) return [];
      const stationIds = territoryStations.map((s) => s.id);
      const { data, error } = await supabase
        .from("ocpp_chargepoints")
        .select("id, chargepoint_identity, station_id, is_connected, last_heartbeat_at")
        .in("station_id", stationIds)
        .order("last_heartbeat_at", { ascending: false });
      if (error) return [];
      return (data ?? []).map((cp: any) => ({
        id: cp.id,
        identity: `FR-GFX-${cp.chargepoint_identity}-1`,
        stationIdentity: cp.chargepoint_identity ?? "",
        status: cp.is_connected ? "Available" : "Unknown",
        lastHeartbeat: cp.last_heartbeat_at,
        isConnected: cp.is_connected ?? false,
      }));
    },
    enabled: territoryStations.length > 0,
  });

  const [evseFilterId, setEvseFilterId] = useState("");

  const filteredEvses = useMemo(() => {
    if (!evseRows) return [];
    if (!evseFilterId) return evseRows;
    const q = evseFilterId.toLowerCase();
    return evseRows.filter((e) => e.stationIdentity.toLowerCase().includes(q));
  }, [evseRows, evseFilterId]);

  const selectedAlgo = ALGORITHMS.find((a) => a.value === algorithm) ?? ALGORITHMS[0];

  async function handleSave() {
    setSaving(true);
    await new Promise((r) => setTimeout(r, 500));
    setSaving(false);
    onSaved();
  }

  const TABS: { key: EditTab; label: string }[] = [
    { key: "details", label: "Détails" },
    { key: "algorithm", label: "Algorithme" },
    { key: "evse", label: "EVSE" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="p-2 rounded-xl border border-border hover:bg-surface-elevated transition-colors">
          <ArrowLeft className="w-4 h-4 text-foreground-muted" />
        </button>
        <div className="flex items-center gap-3">
          <BatteryCharging className="w-5 h-5 text-primary" />
          <div>
            <h1 className="font-heading text-xl font-bold text-foreground">{group.name}</h1>
            <p className="text-xs text-foreground-muted uppercase tracking-wide">Editer Groupe De Charge Intelligente</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-6 border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "pb-2.5 text-sm font-medium transition-colors relative",
              activeTab === tab.key ? "text-primary" : "text-foreground-muted hover:text-foreground"
            )}
          >
            {tab.label}
            {activeTab === tab.key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />}
          </button>
        ))}
      </div>

      {/* ── Details Tab ── */}
      {activeTab === "details" && (
        <div className="bg-surface border border-border rounded-2xl">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-border">
            <div className="p-6 space-y-5">
              <h3 className="text-base font-semibold text-foreground">1. Details</h3>
              <div>
                <label className="block text-sm text-foreground mb-1">Nom <span className="text-red-400">*</span></label>
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  className="w-full px-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50"
                />
              </div>
              <div>
                <label className="block text-sm text-foreground mb-1">CPO <span className="text-red-400">*</span></label>
                <input
                  type="text"
                  value={groupCpo}
                  onChange={(e) => setGroupCpo(e.target.value)}
                  className="w-full px-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50"
                />
              </div>
            </div>
            <div className="p-6 space-y-5">
              <h3 className="text-base font-semibold text-foreground">2. Remarques</h3>
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Saisissez éventuellement des remarques sur le Groupe de charge intelligente..."
                rows={6}
                className="w-full px-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50 resize-none"
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Algorithm Tab ── */}
      {activeTab === "algorithm" && (
        <div className="bg-surface border border-border rounded-2xl">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-border">
            <div className="p-6 space-y-5">
              <h3 className="text-base font-semibold text-foreground">Algorithme actif</h3>
              <div>
                <label className="block text-sm text-foreground mb-1">Algorithme <span className="text-red-400">*</span></label>
                <select
                  value={algorithm}
                  onChange={(e) => setAlgorithm(e.target.value)}
                  className="w-full px-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50"
                >
                  {ALGORITHMS.map((a) => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </select>
              </div>
              <div className="p-3 bg-blue-500/5 border-l-2 border-blue-500 rounded-r-xl">
                <p className="text-sm text-foreground">{selectedAlgo.description}</p>
              </div>
            </div>
            <div className="p-6 space-y-5">
              <h3 className="text-base font-semibold text-foreground">Méthode de mise à jour de capacité</h3>
              <div className="flex items-center gap-6">
                {[
                  { key: "default" as const, label: "Toujours utiliser les valeurs par défaut" },
                  { key: "file" as const, label: "Fichier basé" },
                  { key: "api" as const, label: "API" },
                ].map((opt) => (
                  <label key={opt.key} className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                    <input
                      type="radio"
                      name="capacityMethod"
                      checked={capacityMethod === opt.key}
                      onChange={() => setCapacityMethod(opt.key)}
                      className="text-primary focus:ring-primary"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
              <div>
                <label className="block text-sm text-foreground mb-1">Capacité par défaut <span className="text-red-400">*</span></label>
                <div className="relative">
                  <Zap className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
                  <input
                    type="number"
                    value={defaultCapacity}
                    onChange={(e) => setDefaultCapacity(e.target.value)}
                    className="w-full pl-9 pr-10 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-foreground-muted font-medium">A</span>
                </div>
              </div>
              {capacityMethod === "file" && (
                <div>
                  <label className="block text-sm text-foreground mb-1">Fichier de configuration <span className="text-red-400">*</span></label>
                  <div className="flex gap-2">
                    <div className="flex-1 flex items-center gap-2 px-3 py-2.5 bg-surface border border-border rounded-xl">
                      <Globe className="w-4 h-4 text-foreground-muted shrink-0" />
                      <span className="text-sm text-foreground truncate">{configFile}</span>
                    </div>
                    <button className="px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors shrink-0">
                      Browse
                    </button>
                  </div>
                  <p className="text-xs text-foreground-muted mt-1">.csv, .xls (Excel) et .xlsx (Excel) pris en charge</p>
                </div>
              )}
              <div>
                <label className="block text-sm text-foreground mb-1">Fuseau horaire <span className="text-red-400">*</span></label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
                  <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="w-full pl-9 pr-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50 appearance-none"
                  >
                    {TIMEZONES.map((tz) => (
                      <option key={tz.value} value={tz.value}>{tz.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted pointer-events-none" />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── EVSE Tab ── */}
      {activeTab === "evse" && (
        <EvseTab
          evses={filteredEvses}
          isLoading={evseLoading}
          filterId={evseFilterId}
          onFilterIdChange={setEvseFilterId}
        />
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-4 border-t border-border">
        <p className="text-xs text-red-400">* cette information est requise</p>
        <div className="flex gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-red-400 hover:text-red-300 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-6 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Sauvegarder
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// EVSE TAB (used in Edit view)
// ══════════════════════════════════════════════════════════════

function EvseTab({
  evses,
  isLoading,
  filterId,
  onFilterIdChange,
}: {
  evses: EvseRow[];
  isLoading: boolean;
  filterId: string;
  onFilterIdChange: (v: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="bg-surface border border-border rounded-2xl">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-6 py-4"
      >
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">EVSE</h3>
        </div>
        <ChevronDown className={cn("w-5 h-5 text-foreground-muted transition-transform", collapsed && "-rotate-90")} />
      </button>

      {!collapsed && (
        <div className="px-6 pb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex gap-6 border-b border-border">
              <button className="pb-2.5 text-sm font-medium text-primary relative">
                Normal
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
              </button>
            </div>
            <button className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors">
              <Plus className="w-3.5 h-3.5" />
              Ajouter Un EVSE Au Groupe
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">État</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Identifiant EVSE</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Station ID</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Dernier PDU</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Action</th>
                </tr>
                <tr className="border-b border-border bg-surface-elevated/30">
                  <td className="px-3 py-1.5"><span className="text-xs text-foreground-muted">All</span></td>
                  <td className="px-3 py-1.5"></td>
                  <td className="px-3 py-1.5">
                    <input type="text" value={filterId} onChange={(e) => onFilterIdChange(e.target.value)} placeholder="Recherche..."
                      className="w-full px-2 py-1 bg-surface border border-border rounded-lg text-xs text-foreground placeholder:text-foreground-muted/40 focus:outline-none focus:border-primary/50" />
                  </td>
                  <td className="px-3 py-1.5"></td>
                  <td className="px-3 py-1.5"></td>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={5} className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-foreground-muted" /></td></tr>
                ) : evses.length === 0 ? (
                  <tr><td colSpan={5} className="py-8 text-center text-foreground-muted text-sm">Aucun EVSE dans ce groupe</td></tr>
                ) : evses.map((evse) => (
                  <tr key={evse.id} className="border-b border-border/50 hover:bg-surface-elevated/30 transition-colors">
                    <td className="px-3 py-2.5">
                      <span className={cn(
                        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold",
                        evse.isConnected ? "bg-emerald-500/15 text-emerald-400" :
                        "bg-red-500/15 text-red-400"
                      )}>
                        {evse.isConnected ? "En Ligne" : "Hors Ligne"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-foreground font-mono text-xs">{evse.identity}</td>
                    <td className="px-3 py-2.5 text-foreground">{evse.stationIdentity}</td>
                    <td className="px-3 py-2.5 text-foreground">
                      {evse.lastHeartbeat
                        ? new Date(evse.lastHeartbeat).toLocaleString("fr-FR", {
                            day: "2-digit", month: "2-digit", year: "numeric",
                            hour: "2-digit", minute: "2-digit", second: "2-digit",
                          })
                        : "\u2014"}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button className="text-xs text-red-400 hover:text-red-300 transition-colors">supprimer</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-4 pt-3 border-t border-border text-xs text-foreground-muted">
            <span>
              récupéré le {new Date().toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
            <span>montrer {evses.length} enregistrements</span>
          </div>
        </div>
      )}
    </div>
  );
}
