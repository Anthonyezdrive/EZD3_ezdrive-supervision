// ============================================================
// EZDrive — Smart Charging Page (GreenFlux-style)
// List → click name → Detail view (read-only) → click Editer → Edit view
// Data layer: Supabase tables (smart_charging_groups, smart_charging_schedules, smart_charging_group_evses)
// ============================================================

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useCpo } from "@/contexts/CpoContext";
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
  AlertCircle,
  Activity,
  ArrowUpDown,
  History,
  Bell,
  CheckCircle,
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
  remarks: string;
  defaultCapacityKw: number;
  capacityMethod: string;
  timezone: string;
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

interface ScheduleRow {
  id: string;
  group_id: string;
  day_of_week: string;
  start_hour: string;
  end_hour: string;
  capacity_kw: number;
}

// ── Constants ────────────────────────────────────────────────

const ALGORITHMS = [
  { value: "capacity_management_ac", label: "Capacity Management AC", description: "Cet algorithme est utilis\u00e9 pour \u00e9viter la surcharge d'un disjoncteur. Il est g\u00e9n\u00e9ralement appliqu\u00e9 \u00e0 un groupe de stations de charge qui sont toutes connect\u00e9es au m\u00eame disjoncteur." },
  { value: "capacity_management_dc", label: "Capacity Management DC", description: "Algorithme de gestion de capacit\u00e9 pour bornes DC rapides." },
  { value: "load_balancing", label: "Load Balancing", description: "R\u00e9partition \u00e9quilibr\u00e9e de la charge entre les bornes du groupe." },
];

const TIMEZONES = [
  { value: "America/Guadeloupe", label: "(UTC-04:00) Georgetown, La Paz, Manaus, San Juan" },
  { value: "America/Martinique", label: "(UTC-04:00) Georgetown, La Paz, Manaus, San Juan" },
  { value: "Indian/Reunion", label: "(UTC+04:00) Port Louis, Reunion" },
  { value: "Europe/Paris", label: "(UTC+01:00) Paris, Bruxelles" },
];

const DAYS_OF_WEEK = ["Normal", "Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

// ══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════

export function SmartChargingPage() {
  const [selectedGroup, setSelectedGroup] = useState<SmartChargingGroup | null>(null);
  const [editingGroup, setEditingGroup] = useState<SmartChargingGroup | null>(null);
  const queryClient = useQueryClient();

  const handleSaved = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["smart-charging-groups"] });
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
  const { selectedCpoId, cpoName } = useCpo();
  const queryClient = useQueryClient();
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

  // Fetch groups from smart_charging_groups table
  const { data: groups, isError, refetch } = useQuery({
    queryKey: ["smart-charging-groups", selectedCpoId],
    queryFn: async () => {
      let query = supabase
        .from("smart_charging_groups")
        .select("*, smart_charging_group_evses(count)")
        .eq("is_active", true)
        .order("name");
      if (selectedCpoId) {
        query = query.eq("cpo_id", selectedCpoId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((g: any) => ({
        id: g.id,
        name: g.name,
        algorithm: g.algorithm,
        structure: g.structure,
        evseCount: g.smart_charging_group_evses?.[0]?.count ?? 0,
        cpoName: g.cpo_name ?? "",
        cpoCode: g.cpo_id ?? "",
        territoryId: g.territory_id,
        remarks: g.remarks ?? "",
        defaultCapacityKw: g.default_capacity_kw ?? 0,
        capacityMethod: g.capacity_method ?? "default",
        timezone: g.timezone ?? "America/Guadeloupe",
      }));
    },
  });

  // Create group mutation
  const createGroup = useMutation({
    mutationFn: async (structure: string) => {
      const { data, error } = await supabase
        .from("smart_charging_groups")
        .insert({
          name: `Nouveau groupe ${structure}`,
          structure,
          algorithm: "capacity_management_ac",
          cpo_id: selectedCpoId || null,
          cpo_name: cpoName || null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["smart-charging-groups"] });
      // Open the new group in edit mode by selecting it first
      const newGroup: SmartChargingGroup = {
        id: data.id,
        name: data.name,
        algorithm: data.algorithm,
        structure: data.structure,
        evseCount: 0,
        cpoName: data.cpo_name ?? "",
        cpoCode: data.cpo_id ?? "",
        territoryId: data.territory_id ?? null,
        remarks: data.remarks ?? "",
        defaultCapacityKw: data.default_capacity_kw ?? 0,
        capacityMethod: data.capacity_method ?? "default",
        timezone: data.timezone ?? "America/Guadeloupe",
      };
      onSelect(newGroup);
    },
  });

  // Delete group mutation
  const deleteGroup = useMutation({
    mutationFn: async (groupId: string) => {
      const { error } = await supabase
        .from("smart_charging_groups")
        .delete()
        .eq("id", groupId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["smart-charging-groups"] });
    },
  });

  // Filter
  const filtered = useMemo(() => {
    let result = groups ?? [];
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
                onClick={() => {
                  setCreateDropdownOpen(false);
                  createGroup.mutate("Standalone");
                }}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-foreground hover:bg-surface-elevated transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Standalone
              </button>
              <button
                onClick={() => {
                  setCreateDropdownOpen(false);
                  createGroup.mutate("Multi-level");
                }}
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

      {isError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mx-6 mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-red-700">
            <AlertCircle className="h-5 w-5" />
            <span>Erreur lors du chargement des donn\u00e9es. Veuillez r\u00e9essayer.</span>
          </div>
          <button onClick={() => refetch()} className="text-red-700 hover:text-red-900 font-medium text-sm">
            R\u00e9essayer
          </button>
        </div>
      )}

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
              {!groups ? (
                <tr><td colSpan={6} className="py-12 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-foreground-muted" /></td></tr>
              ) : filtered.length === 0 ? (
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
                                      deleteGroup.mutate(group.id);
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
  const queryClient = useQueryClient();
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

  // Delete group mutation
  const deleteGroup = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("smart_charging_groups")
        .delete()
        .eq("id", group.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["smart-charging-groups"] });
      onBack();
    },
  });

  // Fetch EVSEs from smart_charging_group_evses
  const { data: evseRows } = useQuery<EvseRow[]>({
    queryKey: ["smart-charging-evses", group.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("smart_charging_group_evses")
        .select("*, ocpp_chargepoints(id, chargepoint_identity, station_id, is_connected, last_heartbeat_at)")
        .eq("group_id", group.id);
      if (error) return [];
      return (data ?? []).map((row: any) => ({
        id: row.ocpp_chargepoints?.id ?? row.chargepoint_id,
        identity: row.ocpp_chargepoints?.chargepoint_identity ?? "",
        stationIdentity: row.ocpp_chargepoints?.chargepoint_identity ?? "",
        status: row.ocpp_chargepoints?.is_connected ? "Available" : "Unknown",
        lastHeartbeat: row.ocpp_chargepoints?.last_heartbeat_at,
        isConnected: row.ocpp_chargepoints?.is_connected ?? false,
      }));
    },
  });

  // Fetch schedules from smart_charging_schedules
  const { data: schedules } = useQuery<ScheduleRow[]>({
    queryKey: ["smart-charging-schedules", group.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("smart_charging_schedules")
        .select("*")
        .eq("group_id", group.id)
        .order("day_of_week")
        .order("start_hour");
      if (error) throw error;
      return data ?? [];
    },
  });

  const chargingEvses = evseRows?.filter((e) => e.status === "Available" && e.isConnected).length ?? 0;
  const totalEvses = evseRows?.length ?? 0;
  const currentCapacity = group.defaultCapacityKw;
  const usagePercent = totalEvses > 0 ? Math.round((chargingEvses / totalEvses) * 100) : 0;

  // Find the algorithm label
  const algoLabel = ALGORITHMS.find((a) => a.value === group.algorithm)?.label ?? group.algorithm;

  // Find the timezone label
  const tzLabel = TIMEZONES.find((tz) => tz.value === group.timezone)?.label ?? group.timezone;

  // Capacity method display
  const capacityMethodLabel = group.capacityMethod === "file" ? "Fichier" : group.capacityMethod === "api" ? "API" : "Valeurs par d\u00e9faut";

  // Filter schedules for the selected day tab
  const filteredSchedules = useMemo(() => {
    if (!schedules) return [];
    if (capacityDayTab === "Normal") return schedules;
    return schedules.filter((s) => s.day_of_week === capacityDayTab);
  }, [schedules, capacityDayTab]);

  // Generate chart bars (24 hours) based on schedules
  const chartBars = useMemo(() => {
    const bars: { hour: number; value: number }[] = [];
    for (let h = 0; h < 24; h++) {
      // Find matching schedule for the current hour
      let value = currentCapacity;
      if (schedules && schedules.length > 0) {
        for (const s of schedules) {
          const startH = parseInt(s.start_hour?.split(":")[0] ?? "0", 10);
          const endH = parseInt(s.end_hour?.split(":")[0] ?? "24", 10);
          if (h >= startH && h < endH) {
            value = s.capacity_kw;
            break;
          }
        }
      }
      bars.push({ hour: h, value });
    }
    return bars;
  }, [schedules, currentCapacity]);

  const maxCapacity = Math.max(currentCapacity, ...chartBars.map((b) => b.value), 1);

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
                onClick={() => {
                  setEditDropdownOpen(false);
                  if (confirm(`Supprimer le groupe "${group.name}" ?`)) {
                    deleteGroup.mutate();
                  }
                }}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-surface-elevated transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Supprimer
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Two-column: D\u00e9tails + Param\u00e8tres */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: D\u00e9tails */}
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">D\u00e9tails</h2>
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
                {group.remarks || ""}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Param\u00e8tres */}
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-base font-semibold text-foreground">Param\u00e8tres</h2>
          </div>
          <div className="p-6 space-y-3">
            <div className="flex items-center justify-between py-1.5">
              <span className="text-sm text-foreground-muted">Algorithme</span>
              <span className="text-sm text-foreground">{algoLabel}</span>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-sm text-foreground-muted">M\u00e9thode de mise \u00e0 jour de capacit\u00e9</span>
              <span className="text-sm text-foreground">{capacityMethodLabel}</span>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-sm text-foreground-muted">Capacit\u00e9 par d\u00e9faut</span>
              <span className="text-sm text-foreground">{currentCapacity} A</span>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-sm text-foreground-muted">Maximum du c\u00e2ble de la station de charge</span>
              <span className="text-sm text-foreground">-</span>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-sm text-foreground-muted">Alimentation \u00e9lectrique maximum</span>
              <span className="text-sm text-foreground">-</span>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-sm text-foreground-muted">Fuseau horaire</span>
              <span className="text-sm text-foreground">{tzLabel}</span>
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
              L'\u00e9quilibrage de charge n'est pas actif
            </span>
            <span className="ml-auto text-sm text-primary font-medium cursor-pointer hover:text-primary/80 transition-colors">
              r\u00e9initialiser le zoom
            </span>
          </div>

          {/* Chart - capacity over 24h */}
          <div className="relative h-48 mb-2">
            {/* Y-axis labels */}
            <div className="absolute left-0 top-0 bottom-0 w-8 flex flex-col justify-between text-xs text-foreground-muted py-1">
              {Array.from({ length: 11 }, (_, i) => (
                <span key={i}>{Math.round(maxCapacity - (maxCapacity / 10) * i)}</span>
              ))}
            </div>
            {/* Bars */}
            <div className="ml-10 h-full flex items-end gap-px">
              {chartBars.map((bar) => (
                <div
                  key={bar.hour}
                  className="flex-1 flex flex-col justify-end"
                  title={`${bar.hour}:00 \u2014 ${bar.value}A`}
                >
                  <div
                    className={cn(
                      "w-full rounded-t-sm transition-all",
                      bar.hour <= currentHour
                        ? "bg-red-400/60"
                        : "bg-gray-300/30"
                    )}
                    style={{ height: `${maxCapacity > 0 ? (bar.value / maxCapacity) * 100 : 0}%` }}
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

      {/* Capacit\u00e9 disponible */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">Capacit\u00e9 disponible (A)</h2>
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
                <th className="text-left py-3 px-6 text-xs font-semibold text-foreground-muted uppercase">Heure de d\u00e9but</th>
                <th className="text-left py-3 px-6 text-xs font-semibold text-foreground-muted uppercase">Heure de fin</th>
                <th className="text-right py-3 px-6 text-xs font-semibold text-foreground-muted uppercase">Capacit\u00e9</th>
              </tr>
            </thead>
            <tbody>
              {filteredSchedules.length === 0 ? (
                <tr><td colSpan={4} className="py-8 text-center text-foreground-muted text-sm">Aucun planning configur\u00e9</td></tr>
              ) : filteredSchedules.map((slot, idx) => (
                <tr key={slot.id ?? idx} className="border-b border-border/50 hover:bg-surface-elevated/30 transition-colors">
                  <td className="px-6 py-3 text-foreground">{slot.day_of_week}</td>
                  <td className="px-6 py-3 text-foreground">{slot.start_hour}</td>
                  <td className="px-6 py-3 text-foreground">{slot.end_hour}</td>
                  <td className="px-6 py-3 text-right text-foreground">{slot.capacity_kw} (A)</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-border text-xs text-foreground-muted">
          <span>
            r\u00e9cup\u00e9r\u00e9 le {now.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" })} @ {now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
          <span>montrer {filteredSchedules.length} enregistrements</span>
        </div>
      </div>

      {/* ── Story 102: Real-time site consumption ── */}
      <RealTimeConsumption groupId={group.id} evseRows={evseRows ?? []} totalCapacity={currentCapacity} />

      {/* ── Story 103: EVSE priorities ── */}
      <EvsePriorities groupId={group.id} evseRows={evseRows ?? []} />

      {/* ── Story 104: Load balancing history ── */}
      <LoadBalancingHistory groupId={group.id} />

      {/* ── Story 105: Alert on capacity exceeded ── */}
      <CapacityAlert groupId={group.id} defaultCapacity={currentCapacity} />

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
                G\u00e9rer Les EVSE Li\u00e9s
              </button>
            </div>

            {/* EVSE table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">
                      <span className="inline-flex items-center gap-1">\u00c9tat de charge intelligente <ChevronDown className="w-3 h-3" /></span>
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
// Story 102: Real-time site consumption
// ══════════════════════════════════════════════════════════════

function RealTimeConsumption({
  groupId,
  evseRows,
  totalCapacity,
}: {
  groupId: string;
  evseRows: EvseRow[];
  totalCapacity: number;
}) {
  // Query active sessions / meter values for this group's EVSEs
  const { data: meterData } = useQuery({
    queryKey: ["smart-charging-meter-values", groupId],
    queryFn: async () => {
      const evseIds = evseRows.map((e) => e.id);
      if (evseIds.length === 0) return [];
      const { data } = await supabase
        .from("ocpp_meter_values")
        .select("chargepoint_id, measurand, value, timestamp")
        .in("chargepoint_id", evseIds)
        .eq("measurand", "Power.Active.Import")
        .order("timestamp", { ascending: false })
        .limit(evseIds.length);
      return data ?? [];
    },
    refetchInterval: 15000,
    enabled: evseRows.length > 0,
  });

  const perEvseConsumption = useMemo(() => {
    const map: Record<string, number> = {};
    for (const mv of meterData ?? []) {
      const cpId = (mv as any).chargepoint_id;
      if (!map[cpId]) {
        map[cpId] = parseFloat((mv as any).value ?? "0");
      }
    }
    return map;
  }, [meterData]);

  const totalKw = Object.values(perEvseConsumption).reduce((sum, v) => sum + v, 0);
  const usagePct = totalCapacity > 0 ? Math.min(100, Math.round((totalKw / totalCapacity) * 100)) : 0;

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-400" />
          <h2 className="text-base font-semibold text-foreground">Consommation en temps reel</h2>
        </div>
        <span className="text-xs text-foreground-muted">Rafraichissement: 15s</span>
      </div>
      <div className="p-6">
        {/* Total bar */}
        <div className="flex items-center gap-4 mb-4">
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-medium text-foreground">Total: {totalKw.toFixed(1)} kW / {totalCapacity} kW</span>
              <span className={cn("text-sm font-bold", usagePct > 90 ? "text-red-400" : usagePct > 70 ? "text-yellow-400" : "text-emerald-400")}>
                {usagePct}%
              </span>
            </div>
            <div className="h-3 bg-surface-elevated rounded-full overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all", usagePct > 90 ? "bg-red-400" : usagePct > 70 ? "bg-yellow-400" : "bg-emerald-400")}
                style={{ width: `${usagePct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Per-EVSE breakdown */}
        {evseRows.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {evseRows.map((evse) => {
              const kw = perEvseConsumption[evse.id] ?? 0;
              return (
                <div key={evse.id} className="bg-surface-elevated rounded-xl p-3">
                  <p className="text-xs font-mono text-foreground-muted truncate">{evse.identity}</p>
                  <p className="text-lg font-bold text-foreground mt-0.5">{kw.toFixed(1)} <span className="text-xs font-normal text-foreground-muted">kW</span></p>
                  <span className={cn(
                    "inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-semibold",
                    evse.isConnected ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
                  )}>
                    {evse.isConnected ? "En ligne" : "Hors ligne"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Story 103: EVSE priorities
// ══════════════════════════════════════════════════════════════

function EvsePriorities({ groupId, evseRows }: { groupId: string; evseRows: EvseRow[] }) {
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(true);

  const { data: priorities } = useQuery({
    queryKey: ["smart-charging-priorities", groupId],
    queryFn: async () => {
      const { data } = await supabase
        .from("smart_charging_group_evses")
        .select("chargepoint_id, priority")
        .eq("group_id", groupId);
      const map: Record<string, number> = {};
      for (const row of data ?? []) {
        map[(row as any).chargepoint_id] = (row as any).priority ?? 5;
      }
      return map;
    },
  });

  const updatePriority = useMutation({
    mutationFn: async ({ chargepointId, priority }: { chargepointId: string; priority: number }) => {
      const { error } = await supabase
        .from("smart_charging_group_evses")
        .update({ priority })
        .eq("group_id", groupId)
        .eq("chargepoint_id", chargepointId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["smart-charging-priorities", groupId] });
    },
  });

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-6 py-4"
      >
        <div className="flex items-center gap-2">
          <ArrowUpDown className="w-4 h-4 text-primary" />
          <h2 className="text-base font-semibold text-foreground">Priorites EVSE</h2>
        </div>
        {collapsed ? <ChevronDown className="w-5 h-5 text-foreground-muted" /> : <ChevronUp className="w-5 h-5 text-foreground-muted" />}
      </button>
      {!collapsed && (
        <div className="px-6 pb-6">
          <p className="text-xs text-foreground-muted mb-4">Priorite de 1 (basse) a 10 (haute). Les EVSE avec priorite elevee seront les derniers a etre reduits.</p>
          <div className="space-y-2">
            {evseRows.map((evse) => {
              const priority = priorities?.[evse.id] ?? 5;
              return (
                <div key={evse.id} className="flex items-center gap-3 bg-surface-elevated rounded-xl px-4 py-2.5">
                  <span className="text-sm font-mono text-foreground flex-1 truncate">{evse.identity}</span>
                  <span className={cn("text-xs font-semibold px-1.5 py-0.5 rounded",
                    evse.isConnected ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
                  )}>
                    {evse.isConnected ? "En ligne" : "Hors ligne"}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-foreground-muted">Priorite:</span>
                    <select
                      value={priority}
                      onChange={(e) => updatePriority.mutate({ chargepointId: evse.id, priority: parseInt(e.target.value) })}
                      className="bg-surface border border-border rounded-lg px-2 py-1 text-sm font-medium text-foreground focus:outline-none focus:border-primary/50 w-16"
                    >
                      {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}
            {evseRows.length === 0 && (
              <p className="text-sm text-foreground-muted text-center py-4">Aucun EVSE dans ce groupe</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Story 104: Load balancing history
// ══════════════════════════════════════════════════════════════

function LoadBalancingHistory({ groupId }: { groupId: string }) {
  const [collapsed, setCollapsed] = useState(true);

  const { data: events, isLoading } = useQuery({
    queryKey: ["smart-charging-history", groupId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("smart_charging_events")
        .select("id, created_at, event_type, chargepoint_identity, power_before_kw, power_after_kw, reason")
        .eq("group_id", groupId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) return [];
      return data ?? [];
    },
  });

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-6 py-4"
      >
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-primary" />
          <h2 className="text-base font-semibold text-foreground">Historique d'equilibrage de charge</h2>
          {(events ?? []).length > 0 && (
            <span className="px-2 py-0.5 bg-primary/10 text-primary text-xs font-medium rounded-full">{events!.length}</span>
          )}
        </div>
        {collapsed ? <ChevronDown className="w-5 h-5 text-foreground-muted" /> : <ChevronUp className="w-5 h-5 text-foreground-muted" />}
      </button>
      {!collapsed && (
        <div className="px-6 pb-6">
          {isLoading ? (
            <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-foreground-muted" /></div>
          ) : (events ?? []).length === 0 ? (
            <p className="text-sm text-foreground-muted text-center py-8">Aucun evenement de reduction de charge enregistre</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Date</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">EVSE</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Type</th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Avant</th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Apres</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Raison</th>
                  </tr>
                </thead>
                <tbody>
                  {(events ?? []).map((ev: any) => (
                    <tr key={ev.id} className="border-b border-border/50 hover:bg-surface-elevated/30 transition-colors">
                      <td className="px-3 py-2 text-foreground-muted text-xs whitespace-nowrap">
                        {new Date(ev.created_at).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="px-3 py-2 text-foreground font-mono text-xs">{ev.chargepoint_identity ?? "\u2014"}</td>
                      <td className="px-3 py-2">
                        <span className={cn("px-2 py-0.5 rounded text-xs font-medium",
                          ev.event_type === "curtailment" ? "bg-yellow-500/15 text-yellow-400" :
                          ev.event_type === "restore" ? "bg-emerald-500/15 text-emerald-400" :
                          "bg-foreground-muted/10 text-foreground-muted"
                        )}>
                          {ev.event_type === "curtailment" ? "Reduction" : ev.event_type === "restore" ? "Restauration" : ev.event_type}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-foreground">{ev.power_before_kw ?? "\u2014"} kW</td>
                      <td className="px-3 py-2 text-right text-foreground">{ev.power_after_kw ?? "\u2014"} kW</td>
                      <td className="px-3 py-2 text-foreground-muted text-xs">{ev.reason ?? "\u2014"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Story 105: Alert on capacity exceeded
// ══════════════════════════════════════════════════════════════

function CapacityAlert({ groupId, defaultCapacity }: { groupId: string; defaultCapacity: number }) {
  const queryClient = useQueryClient();

  const { data: alertConfig } = useQuery({
    queryKey: ["smart-charging-alert", groupId],
    queryFn: async () => {
      const { data } = await supabase
        .from("smart_charging_groups")
        .select("alert_on_exceeded, alert_threshold_kw")
        .eq("id", groupId)
        .maybeSingle();
      return {
        enabled: (data as any)?.alert_on_exceeded ?? false,
        threshold: (data as any)?.alert_threshold_kw ?? defaultCapacity,
      };
    },
  });

  const [enabled, setEnabled] = useState(false);
  const [threshold, setThreshold] = useState(String(defaultCapacity));
  const [saved, setSaved] = useState(false);

  // Sync
  useEffect(() => {
    if (alertConfig) {
      setEnabled(alertConfig.enabled);
      setThreshold(String(alertConfig.threshold));
    }
  }, [alertConfig]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("smart_charging_groups")
        .update({
          alert_on_exceeded: enabled,
          alert_threshold_kw: parseFloat(threshold) || defaultCapacity,
        })
        .eq("id", groupId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["smart-charging-alert", groupId] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  return (
    <div className="bg-surface border border-border rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-yellow-400" />
          <h2 className="text-base font-semibold text-foreground">Alerte de depassement de capacite</h2>
        </div>
        <button
          onClick={() => setEnabled(!enabled)}
          className={cn(
            "relative w-11 h-6 rounded-full transition-colors shrink-0",
            enabled ? "bg-primary" : "bg-surface-elevated border border-border"
          )}
        >
          <span className={cn(
            "absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform",
            enabled ? "translate-x-5.5" : "translate-x-0.5"
          )} />
        </button>
      </div>

      {enabled && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-foreground-muted mb-1.5">Seuil de capacite (kW)</label>
            <div className="relative w-48">
              <Zap className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
              <input
                type="number"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                className="w-full pl-9 pr-10 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-foreground-muted">kW</span>
            </div>
            <p className="text-xs text-foreground-muted mt-1.5">
              Une alerte sera envoyee si la consommation du groupe depasse {threshold} kW.
            </p>
          </div>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 disabled:opacity-50"
          >
            {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <CheckCircle className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            {saved ? "Sauvegarde !" : "Enregistrer"}
          </button>
        </div>
      )}

      {!enabled && (
        <p className="text-xs text-foreground-muted">Activez pour recevoir une alerte lorsque la consommation du groupe depasse un seuil.</p>
      )}
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
  const [remarks, setRemarks] = useState(group.remarks);

  // Form state — Algorithm
  const [algorithm, setAlgorithm] = useState(group.algorithm || "capacity_management_ac");
  const [capacityMethod, setCapacityMethod] = useState<"default" | "file" | "api">(
    (group.capacityMethod as "default" | "file" | "api") || "default"
  );
  const [defaultCapacity, setDefaultCapacity] = useState(String(group.defaultCapacityKw || "20"));
  const [configFile] = useState("dynamicCapacityDayOfWeekExample.xlsx");
  const [timezone, setTimezone] = useState(group.timezone || "America/Guadeloupe");

  // Fetch EVSEs for this group
  const { data: evseRows, isLoading: evseLoading, dataUpdatedAt: evseDataUpdatedAt } = useQuery<EvseRow[]>({
    queryKey: ["smart-charging-evses", group.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("smart_charging_group_evses")
        .select("*, ocpp_chargepoints(id, chargepoint_identity, station_id, is_connected, last_heartbeat_at)")
        .eq("group_id", group.id);
      if (error) return [];
      return (data ?? []).map((row: any) => ({
        id: row.ocpp_chargepoints?.id ?? row.chargepoint_id,
        identity: row.ocpp_chargepoints?.chargepoint_identity ?? "",
        stationIdentity: row.ocpp_chargepoints?.chargepoint_identity ?? "",
        status: row.ocpp_chargepoints?.is_connected ? "Available" : "Unknown",
        lastHeartbeat: row.ocpp_chargepoints?.last_heartbeat_at,
        isConnected: row.ocpp_chargepoints?.is_connected ?? false,
      }));
    },
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
    try {
      const { error } = await supabase
        .from("smart_charging_groups")
        .update({
          name: groupName,
          algorithm,
          capacity_method: capacityMethod,
          default_capacity_kw: parseFloat(defaultCapacity) || 0,
          timezone,
          remarks,
          cpo_id: groupCpo,
        })
        .eq("id", group.id);
      if (error) throw error;
      onSaved();
    } catch (err) {
      console.error("Save error:", err);
    } finally {
      setSaving(false);
    }
  }

  const TABS: { key: EditTab; label: string }[] = [
    { key: "details", label: "D\u00e9tails" },
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

      {/* -- Details Tab -- */}
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
                placeholder="Saisissez \u00e9ventuellement des remarques sur le Groupe de charge intelligente..."
                rows={6}
                className="w-full px-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50 resize-none"
              />
            </div>
          </div>
        </div>
      )}

      {/* -- Algorithm Tab -- */}
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
              <h3 className="text-base font-semibold text-foreground">M\u00e9thode de mise \u00e0 jour de capacit\u00e9</h3>
              <div className="flex items-center gap-6">
                {[
                  { key: "default" as const, label: "Toujours utiliser les valeurs par d\u00e9faut" },
                  { key: "file" as const, label: "Fichier bas\u00e9" },
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
                <label className="block text-sm text-foreground mb-1">Capacit\u00e9 par d\u00e9faut <span className="text-red-400">*</span></label>
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

      {/* -- EVSE Tab -- */}
      {activeTab === "evse" && (
        <EvseTab
          groupId={group.id}
          evses={filteredEvses}
          isLoading={evseLoading}
          filterId={evseFilterId}
          onFilterIdChange={setEvseFilterId}
          dataUpdatedAt={evseDataUpdatedAt}
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
  groupId,
  evses,
  isLoading,
  filterId,
  onFilterIdChange,
  dataUpdatedAt,
}: {
  groupId: string;
  evses: EvseRow[];
  isLoading: boolean;
  filterId: string;
  onFilterIdChange: (v: string) => void;
  dataUpdatedAt: number;
}) {
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [cpSearch, setCpSearch] = useState("");

  // Fetch available chargepoints for the "add EVSE" modal
  const { data: availableChargepoints, isLoading: cpLoading } = useQuery({
    queryKey: ["available-chargepoints-for-group", groupId, cpSearch],
    queryFn: async () => {
      let query = supabase
        .from("ocpp_chargepoints")
        .select("id, chargepoint_identity, station_id, is_connected")
        .order("chargepoint_identity")
        .limit(50);
      if (cpSearch) {
        query = query.ilike("chargepoint_identity", `%${cpSearch}%`);
      }
      const { data, error } = await query;
      if (error) return [];
      // Exclude already-added EVSEs
      const existingIds = new Set(evses.map((e) => e.id));
      return (data ?? []).filter((cp: any) => !existingIds.has(cp.id));
    },
    enabled: addModalOpen,
  });

  // Add EVSE to group mutation
  const addEvse = useMutation({
    mutationFn: async (chargepointId: string) => {
      const { error } = await supabase
        .from("smart_charging_group_evses")
        .insert({
          group_id: groupId,
          chargepoint_id: chargepointId,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["smart-charging-evses", groupId] });
    },
  });

  // Remove EVSE from group mutation
  const removeEvse = useMutation({
    mutationFn: async (chargepointId: string) => {
      const { error } = await supabase
        .from("smart_charging_group_evses")
        .delete()
        .eq("group_id", groupId)
        .eq("chargepoint_id", chargepointId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["smart-charging-evses", groupId] });
    },
  });

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
            <button
              onClick={() => setAddModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Ajouter Un EVSE Au Groupe
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">\u00c9tat</th>
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
                      <button
                        onClick={() => {
                          if (confirm(`Retirer l'EVSE "${evse.identity}" du groupe ?`)) {
                            removeEvse.mutate(evse.id);
                          }
                        }}
                        className="text-xs text-red-400 hover:text-red-300 transition-colors"
                      >
                        supprimer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-4 pt-3 border-t border-border text-xs text-foreground-muted">
            <span>
              r\u00e9cup\u00e9r\u00e9 le {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "\u2014"}
            </span>
            <span>montrer {evses.length} enregistrements</span>
          </div>
        </div>
      )}

      {/* Add EVSE Modal */}
      {addModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-surface border border-border rounded-2xl shadow-xl w-full max-w-lg mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="text-base font-semibold text-foreground">Ajouter un EVSE au groupe</h3>
              <button onClick={() => setAddModalOpen(false)} className="p-1 text-foreground-muted hover:text-foreground transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
                <input
                  type="text"
                  value={cpSearch}
                  onChange={(e) => setCpSearch(e.target.value)}
                  placeholder="Rechercher un chargepoint..."
                  className="w-full pl-10 pr-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50"
                />
              </div>
              <div className="max-h-64 overflow-y-auto space-y-1">
                {cpLoading ? (
                  <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-foreground-muted" /></div>
                ) : !availableChargepoints || availableChargepoints.length === 0 ? (
                  <p className="py-8 text-center text-foreground-muted text-sm">Aucun chargepoint disponible</p>
                ) : availableChargepoints.map((cp: any) => (
                  <div
                    key={cp.id}
                    className="flex items-center justify-between px-3 py-2 rounded-xl hover:bg-surface-elevated transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className={cn(
                        "w-2 h-2 rounded-full",
                        cp.is_connected ? "bg-emerald-400" : "bg-red-400"
                      )} />
                      <span className="text-sm text-foreground font-mono">{cp.chargepoint_identity}</span>
                    </div>
                    <button
                      onClick={() => addEvse.mutate(cp.id)}
                      disabled={addEvse.isPending}
                      className="px-3 py-1 bg-primary text-white rounded-lg text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                      Ajouter
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-end px-6 py-4 border-t border-border">
              <button
                onClick={() => setAddModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-foreground-muted hover:text-foreground transition-colors"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
