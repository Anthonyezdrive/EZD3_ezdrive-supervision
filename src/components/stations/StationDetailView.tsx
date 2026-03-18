// ============================================================
// EZDrive — Station Detail View (GreenFlux-style)
// Full page with 6 tabs: Details, Diagnostic, Facturation,
// Configuration, Autorisation, Planification d'etat
// ============================================================

import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Radio,
  Pencil,
  Plug,
  MapPin,
  Zap,
  Cpu,
  Server,
  Shield,
  Clock,
  RotateCcw,
  Trash2,
  Loader2,
  Terminal,
  AlertTriangle,
  ChevronDown,
  Wrench,
  Settings,
  CalendarClock,
  Search,
  Info,
  Users,
  CreditCard,
  Plus,
  X,
  Save,
  Download,
  Upload,
  QrCode,
  ListChecks,
  FileText,
  NotebookPen,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { cn, formatRelativeTime } from "@/lib/utils";
import { useStationStatusHistory } from "@/hooks/useStationStatusHistory";
import { OCPP_STATUS_CONFIG } from "@/lib/constants";
import { supabase } from "@/lib/supabase";
import { apiPost, apiDelete } from "@/lib/api";
import type { Station, OCPPStatus } from "@/types/station";

type DetailTab = "details" | "diagnostic" | "billing" | "configuration" | "authorization" | "scheduling";

interface Props {
  station: Station;
  onBack: () => void;
  onEdit?: (station: Station) => void;
  onDeleted?: () => void;
}

// -- Parse connectors -----------------------------------------

function parseConnectors(station: Station): Array<{
  id: string;
  type: string;
  status: string;
  max_power_kw: number;
  evse_uid?: string;
  format?: string;
}> {
  if (!station.connectors) return [];
  if (Array.isArray(station.connectors)) return station.connectors as any;
  if (typeof station.connectors === "string") {
    try { return JSON.parse(station.connectors); } catch { return []; }
  }
  return [];
}

// -- Tags for station -----------------------------------------

function StationTags({ station }: { station: Station }) {
  const tags: { label: string; color: string }[] = [];

  if (station.charger_type === "Business") tags.push({ label: "Chargeur D'entreprise", color: "bg-blue-500/15 text-blue-400 border-blue-500/25" });
  else if (station.charger_type === "Public") tags.push({ label: "Public", color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25" });
  else if (station.charger_type === "Home") tags.push({ label: "Domicile", color: "bg-purple-500/15 text-purple-400 border-purple-500/25" });

  tags.push({ label: "Prive", color: "bg-amber-500/15 text-amber-400 border-amber-500/25" });

  const isActive = station.ocpp_status !== "Unavailable" && station.ocpp_status !== "Faulted" && station.ocpp_status !== "Unknown";
  tags.push({ label: isActive ? "Active" : "Inactive", color: isActive ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25" : "bg-red-500/15 text-red-400 border-red-500/25" });

  tags.push({
    label: station.connectivity_status === "Online" ? "En Ligne" : "Hors Ligne",
    color: station.connectivity_status === "Online" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25" : "bg-red-500/15 text-red-400 border-red-500/25",
  });

  if (station.deploy_state) tags.push({ label: station.deploy_state, color: "bg-gray-500/15 text-gray-400 border-gray-500/25" });
  if (station.charging_speed) tags.push({ label: station.charging_speed, color: "bg-cyan-500/15 text-cyan-400 border-cyan-500/25" });

  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <span key={t.label} className={cn("inline-flex items-center rounded-lg border px-2 py-0.5 text-[11px] font-medium", t.color)}>
          {t.label}
        </span>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// MAIN DETAIL VIEW
// ══════════════════════════════════════════════════════════════

export function StationDetailView({ station, onBack, onEdit, onDeleted }: Props) {
  const [activeTab, setActiveTab] = useState<DetailTab>("details");
  const [cmdLoading, setCmdLoading] = useState<string | null>(null);
  const [cmdResult, setCmdResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  async function handleDelete() {
    setDeleteLoading(true);
    try {
      await apiDelete(`admin-stations/${station.id}`);
      onDeleted?.();
    } catch (err) {
      setCmdResult({ ok: false, msg: err instanceof Error ? err.message : "Erreur" });
    } finally {
      setDeleteLoading(false);
      setShowDeleteConfirm(false);
    }
  }

  async function sendCommand(command: string, payload?: Record<string, unknown>) {
    setCmdLoading(command);
    setCmdResult(null);
    try {
      const res = await apiPost("ocpp/command", {
        command,
        chargepoint_id: (station as any).ocpp_identity ?? station.gfx_id,
        ...(payload ? { payload } : {}),
      });
      setCmdResult({ ok: true, msg: `Commande envoyee - ID: ${(res as any)?.command_id ?? "OK"}` });
    } catch (err) {
      setCmdResult({ ok: false, msg: err instanceof Error ? err.message : "Erreur" });
    } finally {
      setCmdLoading(null);
    }
  }

  const subtitle = [station.name, station.postal_code, station.city, "FRA"].filter(Boolean).join(", ");

  const TABS: { key: DetailTab; label: string }[] = [
    { key: "details", label: "Details" },
    { key: "diagnostic", label: "Diagnostic" },
    { key: "billing", label: "Facturation" },
    { key: "configuration", label: "Configuration" },
    { key: "authorization", label: "Autorisation" },
    { key: "scheduling", label: "Planification d'etat" },
  ];

  // Dropdown state
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownOpen]);

  // Dropdown menu items (GreenFlux-style)
  const dropdownItems: { label: string; icon: typeof Radio; action: () => void; separator?: boolean; danger?: boolean }[] = [
    { label: "Editer une station de charge", icon: Pencil, action: () => { setDropdownOpen(false); onEdit?.(station); } },
    { label: "Ajouter une station de charge", icon: Plus, action: () => { setDropdownOpen(false); /* handled at list level */ } },
    { label: "Supprimer la station de charge", icon: Trash2, action: () => { setDropdownOpen(false); setShowDeleteConfirm(true); }, danger: true },
    { label: "Reinitialiser", icon: RotateCcw, action: () => { setDropdownOpen(false); sendCommand("Reset", { type: "Soft" }); }, separator: true },
    { label: "Update Maintenance & Notes", icon: NotebookPen, action: () => { setDropdownOpen(false); /* future */ } },
    { label: "Vider le cache", icon: Trash2, action: () => { setDropdownOpen(false); sendCommand("ClearCache"); }, separator: true },
    { label: "Mise a jour du micrologiciel", icon: Upload, action: () => { setDropdownOpen(false); sendCommand("UpdateFirmware"); } },
    { label: "Obtenir un diagnostic", icon: Wrench, action: () => { setDropdownOpen(false); sendCommand("GetDiagnostics"); } },
    { label: "Liste locale", icon: ListChecks, action: () => { setDropdownOpen(false); sendCommand("GetLocalListVersion"); }, separator: true },
    { label: "Ajouter tous les EVSE a un groupe de charge intelligente", icon: Zap, action: () => { setDropdownOpen(false); /* future */ }, separator: true },
    { label: "Telecharger les autocollants code QR (PDF)", icon: QrCode, action: () => { setDropdownOpen(false); /* future */ } },
    { label: "Telecharger les donnees du code QR (CSV)", icon: Download, action: () => { setDropdownOpen(false); /* future */ } },
    { label: "Exporter des CDR", icon: FileText, action: () => { setDropdownOpen(false); /* future - export CDRs */ }, separator: true },
  ];

  // Tab-specific main button label
  const mainButtonLabel = activeTab === "diagnostic" ? "Obtenir Un Diagnostic" : "Reinitialiser";
  const mainButtonAction = activeTab === "diagnostic"
    ? () => sendCommand("GetDiagnostics")
    : () => sendCommand("Reset", { type: "Soft" });
  const mainButtonIcon = activeTab === "diagnostic" ? Wrench : RotateCcw;
  const MainIcon = mainButtonIcon;

  return (
    <div className="space-y-6">
      {/* Delete confirmation banner */}
      {showDeleteConfirm && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center justify-between">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-400">Desactiver cette borne ?</p>
              <p className="text-xs text-foreground-muted mt-0.5">La borne sera marquee comme indisponible. Action reversible.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowDeleteConfirm(false)} className="px-3 py-1.5 border border-border rounded-lg text-xs text-foreground-muted hover:text-foreground transition-colors">
              Annuler
            </button>
            <button onClick={handleDelete} disabled={deleteLoading} className="px-3 py-1.5 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-xs font-semibold hover:bg-red-500/30 transition-colors disabled:opacity-50 flex items-center gap-1.5">
              {deleteLoading && <Loader2 className="w-3 h-3 animate-spin" />}
              Confirmer
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 rounded-xl border border-border hover:bg-surface-elevated transition-colors" title="Retour">
            <ArrowLeft className="w-4 h-4 text-foreground-muted" />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Radio className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="font-heading text-xl font-bold text-foreground">{station.gfx_id ?? station.name}</h1>
              <p className="text-sm text-foreground-muted">{subtitle}</p>
            </div>
          </div>
        </div>

        {/* Reinitialiser button + dropdown */}
        <div className="relative" ref={dropdownRef}>
          <div className="flex">
            <button
              onClick={mainButtonAction}
              disabled={!!cmdLoading}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-primary text-white rounded-l-xl text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {cmdLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MainIcon className="w-3.5 h-3.5" />}
              {mainButtonLabel}
            </button>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center px-2 py-2.5 bg-primary text-white rounded-r-xl border-l border-white/20 hover:bg-primary/90 transition-colors"
            >
              <ChevronDown className={cn("w-4 h-4 transition-transform", dropdownOpen && "rotate-180")} />
            </button>
          </div>

          {/* Dropdown menu */}
          {dropdownOpen && (
            <div className="absolute right-0 top-full mt-1 w-[420px] bg-surface border border-border rounded-xl shadow-xl z-50 py-1 max-h-[500px] overflow-y-auto">
              {dropdownItems.map((item, idx) => (
                <div key={idx}>
                  {item.separator && idx > 0 && <div className="h-px bg-border my-1" />}
                  <button
                    onClick={item.action}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors",
                      item.danger
                        ? "text-red-400 hover:bg-red-500/10"
                        : "text-foreground hover:bg-surface-elevated"
                    )}
                  >
                    <item.icon className="w-4 h-4 shrink-0 text-foreground-muted" />
                    {item.label}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Command result */}
      {cmdResult && (
        <p className={cn("text-xs px-3 py-2 rounded-lg", cmdResult.ok ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400")}>
          {cmdResult.msg}
        </p>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium transition-colors relative whitespace-nowrap",
              activeTab === tab.key ? "text-primary" : "text-foreground-muted hover:text-foreground"
            )}
          >
            {tab.label}
            {activeTab === tab.key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "details" && (
        <DetailsTab
          station={station}
          onEdit={onEdit}
          onDelete={() => setShowDeleteConfirm(true)}
          onCommand={sendCommand}
          cmdLoading={cmdLoading}
        />
      )}
      {activeTab === "diagnostic" && <DiagnosticTab station={station} />}
      {activeTab === "billing" && <BillingTab station={station} />}
      {activeTab === "configuration" && <ConfigurationTab station={station} onCommand={sendCommand} cmdLoading={cmdLoading} />}
      {activeTab === "authorization" && <AuthorizationTab station={station} />}
      {activeTab === "scheduling" && <SchedulingTab station={station} />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// DIAGNOSTIC TAB
// ══════════════════════════════════════════════════════════════

type DiagSubTab = "notifications" | "meter_values" | "requests";

interface StatusNotification {
  id: string;
  station_id: string;
  previous_status: string | null;
  new_status: string;
  changed_at: string;
  connector_id?: number;
}

interface MeterValueRow {
  id: string;
  transaction_id: string;
  timestamp: string;
  energy_wh: number | null;
  power_w: number | null;
  current_a: number | null;
  voltage_v: number | null;
  soc_percent: number | null;
  sampled_values: unknown;
}

interface CommandRow {
  id: string;
  command: string;
  payload: unknown;
  status: string;
  created_at: string;
  responded_at: string | null;
  response: unknown;
}

function DiagnosticTab({ station }: { station: Station }) {
  const [subTab, setSubTab] = useState<DiagSubTab>("notifications");
  const [timeRange, setTimeRange] = useState("24h");
  const [collapsed, setCollapsed] = useState(false);

  const timeFilter = useMemo(() => {
    const now = new Date();
    if (timeRange === "24h") return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    if (timeRange === "7d") return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    if (timeRange === "30d") return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  }, [timeRange]);

  // Notifications = status changes from station_status_log
  const { data: notifications, isLoading: loadingNotifs } = useQuery<StatusNotification[]>({
    queryKey: ["station-diag-notifs", station.id, timeFilter],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("station_status_log")
        .select("*")
        .eq("station_id", station.id)
        .gte("changed_at", timeFilter)
        .order("changed_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as StatusNotification[];
    },
  });

  // Meter values from ocpp_meter_values via chargepoint identity
  const chargepointId = (station as any).ocpp_identity ?? station.gfx_id;
  const { data: meterValues, isLoading: loadingMV } = useQuery<MeterValueRow[]>({
    queryKey: ["station-diag-mv", chargepointId, timeFilter],
    queryFn: async () => {
      if (!chargepointId) return [];
      // Get transactions for this chargepoint first
      const { data: txData } = await supabase
        .from("ocpp_transactions")
        .select("id")
        .eq("chargepoint_id", chargepointId)
        .gte("started_at", timeFilter)
        .limit(20);
      if (!txData || txData.length === 0) return [];
      const txIds = txData.map((t: any) => t.id);
      const { data, error } = await supabase
        .from("ocpp_meter_values")
        .select("*")
        .in("transaction_id", txIds)
        .order("timestamp", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as MeterValueRow[];
    },
    enabled: !!chargepointId,
  });

  // Commands (requests) from ocpp_command_queue
  const { data: commands, isLoading: loadingCmds } = useQuery<CommandRow[]>({
    queryKey: ["station-diag-cmds", chargepointId, timeFilter],
    queryFn: async () => {
      if (!chargepointId) return [];
      const { data, error } = await supabase
        .from("ocpp_command_queue")
        .select("*")
        .eq("chargepoint_id", chargepointId)
        .gte("created_at", timeFilter)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as CommandRow[];
    },
    enabled: !!chargepointId,
  });

  const DIAG_SUB_TABS: { key: DiagSubTab; label: string }[] = [
    { key: "notifications", label: "Notifications" },
    { key: "meter_values", label: "Valeurs Du Compteur" },
    { key: "requests", label: "Demandes" },
  ];

  function formatDT(iso: string) {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  }

  function getMessageType(_entry: StatusNotification): string {
    return "Status updated";
  }

  function getSubType(entry: StatusNotification): string {
    if (entry.previous_status === null) return "Started";
    if (entry.new_status === "Available" && entry.previous_status === "Charging") return "Stopped";
    if (entry.new_status === "Charging" && entry.previous_status === "Preparing") return "Started";
    if (entry.new_status === "Preparing") return "Authorize";
    return "";
  }

  function statusLabel(status: string): { label: string; color: string } {
    const config = OCPP_STATUS_CONFIG[status as OCPPStatus];
    if (config) return { label: config.label, color: config.color };
    return { label: status, color: "#8892B0" };
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
  }

  return (
    <div className="bg-surface border border-border rounded-2xl">
      {/* Collapsible header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-6 py-4"
      >
        <h3 className="text-lg font-semibold text-foreground">Diagnostic</h3>
        <ChevronDown className={cn("w-5 h-5 text-foreground-muted transition-transform", collapsed && "-rotate-90")} />
      </button>

      {!collapsed && (
        <div className="px-6 pb-6">
          {/* Sub tabs */}
          <div className="flex gap-6 border-b border-border mb-4">
            {DIAG_SUB_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setSubTab(t.key)}
                className={cn(
                  "pb-2.5 text-sm font-medium transition-colors relative",
                  subTab === t.key ? "text-primary" : "text-foreground-muted hover:text-foreground"
                )}
              >
                {t.label}
                {subTab === t.key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />}
              </button>
            ))}
          </div>

          {/* ── Notifications sub-tab ── */}
          {subTab === "notifications" && (
            <div>
              {/* Filters row */}
              <div className="flex items-center gap-3 mb-4">
                <select
                  value={timeRange}
                  onChange={(e) => setTimeRange(e.target.value)}
                  className="px-3 py-1.5 bg-surface-elevated border border-border rounded-lg text-sm text-foreground"
                >
                  <option value="24h">Dernieres 24 heures</option>
                  <option value="7d">7 derniers jours</option>
                  <option value="30d">30 derniers jours</option>
                </select>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Date de l'evenement</th>
                      <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Type de message</th>
                      <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Type</th>
                      <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Sous-type</th>
                      <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Connecteur</th>
                      <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Charge utile</th>
                      <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Etat</th>
                      <th className="text-right py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingNotifs ? (
                      <tr><td colSpan={8} className="py-8 text-center text-foreground-muted"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
                    ) : !notifications || notifications.length === 0 ? (
                      <tr><td colSpan={8} className="py-8 text-center text-foreground-muted text-sm">Aucune notification</td></tr>
                    ) : notifications.map((n) => {
                      const st = statusLabel(n.new_status);
                      const subType = getSubType(n);
                      // Determine if it's a Charge Session or Status updated
                      const isChargeSession = subType === "Started" || subType === "Stopped" || subType === "Authorize";
                      const msgType = isChargeSession ? "Charge Session" : getMessageType(n);
                      return (
                        <tr key={n.id} className="border-b border-border/50 hover:bg-surface-elevated/50">
                          <td className="py-2.5 px-3 text-foreground">{formatDT(n.changed_at)}</td>
                          <td className="py-2.5 px-3">
                            <span className="text-primary font-medium">Notification</span>
                          </td>
                          <td className="py-2.5 px-3 text-foreground">{msgType}</td>
                          <td className="py-2.5 px-3 text-foreground">{subType}</td>
                          <td className="py-2.5 px-3 text-foreground">{n.connector_id ?? "1"}</td>
                          <td className="py-2.5 px-3">
                            <button className="text-xs text-primary hover:underline">Afficher la charge utile</button>
                          </td>
                          <td className="py-2.5 px-3">
                            {n.new_status && (
                              <span
                                className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold"
                                style={{ backgroundColor: `${st.color}20`, color: st.color }}
                              >
                                {st.label}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <button
                              onClick={() => copyToClipboard(JSON.stringify(n))}
                              className="text-xs text-foreground-muted hover:text-foreground"
                            >
                              Copier
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
                <span className="text-xs text-foreground-muted">
                  recupere le {new Date().toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="text-xs text-foreground-muted">
                  montrer {notifications?.length ?? 0} enregistrements
                </span>
              </div>
            </div>
          )}

          {/* ── Meter Values sub-tab ── */}
          {subTab === "meter_values" && (
            <div>
              <div className="flex items-center gap-3 mb-4">
                <select
                  value={timeRange}
                  onChange={(e) => setTimeRange(e.target.value)}
                  className="px-3 py-1.5 bg-surface-elevated border border-border rounded-lg text-sm text-foreground"
                >
                  <option value="24h">Dernieres 24 heures</option>
                  <option value="7d">7 derniers jours</option>
                  <option value="30d">30 derniers jours</option>
                </select>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Horodatage</th>
                      <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Transaction</th>
                      <th className="text-right py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Energie (Wh)</th>
                      <th className="text-right py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Puissance (W)</th>
                      <th className="text-right py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Courant (A)</th>
                      <th className="text-right py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Tension (V)</th>
                      <th className="text-right py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">SoC (%)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingMV ? (
                      <tr><td colSpan={7} className="py-8 text-center text-foreground-muted"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
                    ) : !meterValues || meterValues.length === 0 ? (
                      <tr><td colSpan={7} className="py-8 text-center text-foreground-muted text-sm">Aucune valeur de compteur</td></tr>
                    ) : meterValues.map((mv) => (
                      <tr key={mv.id} className="border-b border-border/50 hover:bg-surface-elevated/50">
                        <td className="py-2.5 px-3 text-foreground">{formatDT(mv.timestamp)}</td>
                        <td className="py-2.5 px-3 text-foreground font-mono text-xs">{mv.transaction_id?.slice(0, 12)}...</td>
                        <td className="py-2.5 px-3 text-right text-foreground">{mv.energy_wh?.toLocaleString("fr-FR") ?? "\u2014"}</td>
                        <td className="py-2.5 px-3 text-right text-foreground">{mv.power_w?.toLocaleString("fr-FR") ?? "\u2014"}</td>
                        <td className="py-2.5 px-3 text-right text-foreground">{mv.current_a?.toFixed(1) ?? "\u2014"}</td>
                        <td className="py-2.5 px-3 text-right text-foreground">{mv.voltage_v?.toFixed(0) ?? "\u2014"}</td>
                        <td className="py-2.5 px-3 text-right text-foreground">{mv.soc_percent != null ? `${mv.soc_percent}%` : "\u2014"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-end mt-4 pt-3 border-t border-border">
                <span className="text-xs text-foreground-muted">montrer {meterValues?.length ?? 0} enregistrements</span>
              </div>
            </div>
          )}

          {/* ── Requests sub-tab ── */}
          {subTab === "requests" && (
            <div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Date</th>
                      <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Commande</th>
                      <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Statut</th>
                      <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Charge utile</th>
                      <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Reponse</th>
                      <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Repondu le</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingCmds ? (
                      <tr><td colSpan={6} className="py-8 text-center text-foreground-muted"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
                    ) : !commands || commands.length === 0 ? (
                      <tr><td colSpan={6} className="py-8 text-center text-foreground-muted text-sm">Aucune demande</td></tr>
                    ) : commands.map((cmd) => (
                      <tr key={cmd.id} className="border-b border-border/50 hover:bg-surface-elevated/50">
                        <td className="py-2.5 px-3 text-foreground">{formatDT(cmd.created_at)}</td>
                        <td className="py-2.5 px-3 text-foreground font-medium">{cmd.command}</td>
                        <td className="py-2.5 px-3">
                          <span className={cn(
                            "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold",
                            cmd.status === "accepted" ? "bg-emerald-500/15 text-emerald-400" :
                            cmd.status === "rejected" ? "bg-red-500/15 text-red-400" :
                            cmd.status === "sent" ? "bg-blue-500/15 text-blue-400" :
                            "bg-amber-500/15 text-amber-400"
                          )}>
                            {cmd.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <button
                            onClick={() => copyToClipboard(JSON.stringify(cmd.payload))}
                            className="text-xs text-primary hover:underline"
                          >
                            Afficher
                          </button>
                        </td>
                        <td className="py-2.5 px-3">
                          {cmd.response ? (
                            <button
                              onClick={() => copyToClipboard(JSON.stringify(cmd.response))}
                              className="text-xs text-primary hover:underline"
                            >
                              Afficher
                            </button>
                          ) : (
                            <span className="text-xs text-foreground-muted">\u2014</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-foreground">
                          {cmd.responded_at ? formatDT(cmd.responded_at) : "\u2014"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-end mt-4 pt-3 border-t border-border">
                <span className="text-xs text-foreground-muted">montrer {commands?.length ?? 0} enregistrements</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// BILLING TAB (Facturation)
// ══════════════════════════════════════════════════════════════

type BillingSubTab = "all" | "success" | "retryable" | "suspect" | "filed";

interface CdrRow {
  id: string;
  gfx_cdr_id: string | null;
  source: string;
  start_date_time: string | null;
  end_date_time: string | null;
  total_energy: number | null;
  total_time: number | null;
  total_cost: number | null;
  total_retail_cost: number | null;
  total_retail_cost_incl_vat: number | null;
  created_at: string;
  status: string | null;
}

function BillingTab({ station }: { station: Station }) {
  const [subTab, setSubTab] = useState<BillingSubTab>("all");
  const [timeRange, setTimeRange] = useState("7d");
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsed, setCollapsed] = useState(false);

  const timeFilter = useMemo(() => {
    const now = new Date();
    if (timeRange === "7d") return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    if (timeRange === "30d") return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    if (timeRange === "90d") return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
    return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  }, [timeRange]);

  const { data: cdrs, isLoading } = useQuery<CdrRow[]>({
    queryKey: ["station-billing-cdrs", station.id, timeFilter],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ocpi_cdrs")
        .select("id, gfx_cdr_id, source, start_date_time, end_date_time, total_energy, total_time, total_cost, total_retail_cost, total_retail_cost_incl_vat, created_at, status")
        .eq("station_id", station.id)
        .gte("created_at", timeFilter)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as CdrRow[];
    },
  });

  // Filter CDRs by sub-tab
  const filteredCdrs = useMemo(() => {
    if (!cdrs) return [];
    let result = cdrs;
    if (subTab === "success") result = result.filter((c) => c.status === "COMPLETED" || c.status === "calculated" || !c.status);
    else if (subTab === "retryable") result = result.filter((c) => c.status === "PENDING" || c.status === "retryable");
    else if (subTab === "suspect") result = result.filter((c) => c.status === "suspect" || c.status === "INVALID");
    else if (subTab === "filed") result = result.filter((c) => c.status === "filed" || c.status === "ARCHIVED");

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((c) => c.gfx_cdr_id?.toLowerCase().includes(q) || c.id.toLowerCase().includes(q));
    }
    return result;
  }, [cdrs, subTab, searchQuery]);

  function formatDT(iso: string | null) {
    if (!iso) return "\u2014";
    return new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  }

  function formatEnergy(kwh: number | null) {
    if (kwh == null) return "\u2014";
    return `${kwh.toLocaleString("fr-FR", { minimumFractionDigits: 4 })} kWh`;
  }

  function formatDuration(minutes: number | null) {
    if (minutes == null) return "\u2014";
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  const BILLING_SUB_TABS: { key: BillingSubTab; label: string }[] = [
    { key: "all", label: "Tout" },
    { key: "success", label: "Reussi" },
    { key: "retryable", label: "Reessayable" },
    { key: "suspect", label: "Suspect" },
    { key: "filed", label: "Depose" },
  ];

  return (
    <div className="bg-surface border border-border rounded-2xl">
      {/* Collapsible header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-6 py-4"
      >
        <h3 className="text-lg font-semibold text-foreground">Transactions</h3>
        <ChevronDown className={cn("w-5 h-5 text-foreground-muted transition-transform", collapsed && "-rotate-90")} />
      </button>

      {!collapsed && (
        <div className="px-6 pb-6">
          {/* Sub tabs */}
          <div className="flex gap-6 border-b border-border mb-4">
            {BILLING_SUB_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setSubTab(t.key)}
                className={cn(
                  "pb-2.5 text-sm font-medium transition-colors relative",
                  subTab === t.key ? "text-primary" : "text-foreground-muted hover:text-foreground"
                )}
              >
                {t.label}
                {subTab === t.key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />}
              </button>
            ))}
          </div>

          {/* Filters row */}
          <div className="flex items-center gap-3 mb-4">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Recherche..."
                className="pl-8 pr-3 py-1.5 bg-surface-elevated border border-border rounded-lg text-sm text-foreground placeholder:text-foreground-muted/50 w-56"
              />
            </div>
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
              className="px-3 py-1.5 bg-surface-elevated border border-border rounded-lg text-sm text-foreground"
            >
              <option value="7d">7 derniers jours</option>
              <option value="30d">30 derniers jours</option>
              <option value="90d">90 derniers jours</option>
            </select>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Identifiant CDR</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Statut de la facturation</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Analyse du statut</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Date de creation</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Date de debut</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Date de fin</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Volume</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Duree</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={8} className="py-8 text-center text-foreground-muted"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
                ) : filteredCdrs.length === 0 ? (
                  <tr><td colSpan={8} className="py-8 text-center text-foreground-muted text-sm">Aucune transaction</td></tr>
                ) : filteredCdrs.map((cdr) => (
                  <tr key={cdr.id} className="border-b border-border/50 hover:bg-surface-elevated/50">
                    <td className="py-2.5 px-3 text-foreground font-mono text-xs">{cdr.gfx_cdr_id ?? cdr.id.slice(0, 32)}</td>
                    <td className="py-2.5 px-3">
                      <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold bg-blue-500/15 text-blue-400">
                        Calcule
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-foreground">OK</td>
                    <td className="py-2.5 px-3 text-foreground">{formatDT(cdr.created_at)}</td>
                    <td className="py-2.5 px-3 text-foreground">{formatDT(cdr.start_date_time)}</td>
                    <td className="py-2.5 px-3 text-foreground">{formatDT(cdr.end_date_time)}</td>
                    <td className="py-2.5 px-3 text-right text-foreground">{formatEnergy(cdr.total_energy)}</td>
                    <td className="py-2.5 px-3 text-right text-foreground">{formatDuration(cdr.total_time)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end mt-4 pt-3 border-t border-border">
            <span className="text-xs text-foreground-muted">
              montrer {filteredCdrs.length} enregistrements
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// CONFIGURATION TAB
// ══════════════════════════════════════════════════════════════

interface ConfigEntry {
  key: string;
  value: string;
  readonly: boolean;
  modified?: string;
}

function ConfigurationTab({
  station,
  onCommand,
  cmdLoading,
}: {
  station: Station;
  onCommand: (cmd: string, payload?: Record<string, unknown>) => void;
  cmdLoading: string | null;
}) {
  const [searchQuery, setSearchQuery] = useState("");

  const chargepointId = (station as any).ocpp_identity ?? station.gfx_id;

  // Fetch configuration from ocpp_chargepoints table
  const { data: configEntries, isLoading } = useQuery<ConfigEntry[]>({
    queryKey: ["station-config", chargepointId],
    queryFn: async () => {
      if (!chargepointId) return [];
      const { data, error } = await supabase
        .from("ocpp_chargepoints")
        .select("configuration, updated_at")
        .eq("identity", chargepointId)
        .single();
      if (error) return [];
      if (!data?.configuration) return [];

      // Parse JSONB config into flat list
      const config = data.configuration as Record<string, unknown>;
      const entries: ConfigEntry[] = [];
      if (Array.isArray(config)) {
        // OCPP 1.6 GetConfiguration response format: [{key, value, readonly}]
        for (const item of config) {
          const obj = item as any;
          entries.push({
            key: obj.key ?? obj.name ?? "",
            value: String(obj.value ?? ""),
            readonly: obj.readonly ?? false,
            modified: data.updated_at,
          });
        }
      } else if (typeof config === "object") {
        // Flat key-value format
        for (const [k, v] of Object.entries(config)) {
          entries.push({
            key: k,
            value: String(v ?? ""),
            readonly: false,
            modified: data.updated_at,
          });
        }
      }
      entries.sort((a, b) => a.key.localeCompare(b.key));
      return entries;
    },
    enabled: !!chargepointId,
  });

  const filtered = useMemo(() => {
    if (!configEntries) return [];
    if (!searchQuery) return configEntries;
    const q = searchQuery.toLowerCase();
    return configEntries.filter((e) =>
      e.key.toLowerCase().includes(q) || e.value.toLowerCase().includes(q)
    );
  }, [configEntries, searchQuery]);

  function formatModified(iso?: string) {
    if (!iso) return "\u2014";
    return new Date(iso).toLocaleString("fr-FR", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  }

  return (
    <div className="space-y-4">
      {/* Search + Get Variables */}
      <div className="flex items-center justify-between">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search"
            className="pl-10 pr-4 py-2 bg-surface border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 w-72"
          />
        </div>
        <button
          onClick={() => onCommand("GetConfiguration")}
          disabled={!!cmdLoading}
          className="flex items-center gap-1.5 px-4 py-2 border border-border rounded-xl text-sm font-medium text-foreground hover:bg-surface-elevated transition-colors disabled:opacity-50"
        >
          {cmdLoading === "GetConfiguration" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Settings className="w-3.5 h-3.5" />}
          Get variables
        </button>
      </div>

      {/* Configuration table */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-3 px-5 text-xs font-semibold text-foreground-muted uppercase">Variable</th>
              <th className="text-left py-3 px-5 text-xs font-semibold text-foreground-muted uppercase">Value</th>
              <th className="text-left py-3 px-5 text-xs font-semibold text-foreground-muted uppercase">Modified</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={3} className="py-8 text-center text-foreground-muted"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-8 text-center text-foreground-muted text-sm">
                  {configEntries?.length === 0
                    ? "Aucune configuration disponible. Cliquez \"Get variables\" pour recuperer la configuration."
                    : "Aucun resultat pour cette recherche."}
                </td>
              </tr>
            ) : filtered.map((entry, idx) => (
              <tr key={entry.key} className={cn("hover:bg-surface-elevated/50", idx < filtered.length - 1 && "border-b border-border/50")}>
                <td className="py-3 px-5 text-foreground font-medium">{entry.key}</td>
                <td className="py-3 px-5">
                  <span className="inline-flex items-center bg-surface-elevated border border-border rounded-lg px-3 py-1 text-sm text-foreground min-w-[200px]">
                    {entry.value || "\u00A0"}
                  </span>
                </td>
                <td className="py-3 px-5 text-foreground-muted">{formatModified(entry.modified)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// AUTHORIZATION TAB (Autorisation)
// ══════════════════════════════════════════════════════════════

interface AuthToken {
  id: string;
  uid: string;
  type: string;
  contract_id: string | null;
  visual_number: string | null;
  valid: boolean;
  whitelist: string | null;
  auth_method: string | null;
  last_updated: string | null;
}

function AuthorizationTab({ station }: { station: Station }) {
  const [clientsExpanded, setClientsExpanded] = useState(true);
  const [tokensExpanded, setTokensExpanded] = useState(false);

  // Fetch tokens that have been used at this station (via transactions)
  const chargepointId = (station as any).ocpp_identity ?? station.gfx_id;

  const { data: authorizedTokens, isLoading } = useQuery<AuthToken[]>({
    queryKey: ["station-auth-tokens", station.id, chargepointId],
    queryFn: async () => {
      if (!chargepointId) return [];
      // Get unique id_tags used at this station from transactions
      const { data: txData } = await supabase
        .from("ocpp_transactions")
        .select("id_tag")
        .eq("chargepoint_id", chargepointId)
        .not("id_tag", "is", null)
        .limit(100);

      if (!txData || txData.length === 0) return [];
      const uniqueTags = [...new Set(txData.map((t: any) => t.id_tag).filter(Boolean))];
      if (uniqueTags.length === 0) return [];

      const { data, error } = await supabase
        .from("ocpi_tokens")
        .select("id, uid, type, contract_id, visual_number, valid, whitelist, auth_method, last_updated")
        .in("uid", uniqueTags)
        .limit(50);

      if (error) return [];
      return (data ?? []) as AuthToken[];
    },
    enabled: !!chargepointId,
  });

  return (
    <div className="space-y-4">
      {/* Info banners */}
      <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-start gap-2">
        <Info className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
        <p className="text-sm text-foreground">
          Seuls les clients et les tokens de charge indiques ci-dessous sont autorises a charger sur ce chargeur.
        </p>
      </div>

      <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
        <p className="text-sm text-foreground">
          <strong>Important</strong> : le site de cette station de charge a ete configure comme prive, ce qui signifie que l'on a configure des clients et/ou des tokens dans la section Autorisation. Tous les clients ou tokens de ce site peuvent se recharger a cette station. Vous pouvez egalement ajouter ci-dessous des clients et/ou des tokens specifiques.
        </p>
      </div>

      {/* Clients & Tokens section */}
      <div className="bg-surface border border-border rounded-2xl">
        <div className="flex items-center gap-2 px-6 py-4 border-b border-border">
          <Users className="w-4 h-4 text-primary" />
          <h3 className="text-base font-semibold text-foreground">Clients autorises & Tokens de charge</h3>
        </div>

        {/* Clients section */}
        <div className="border-b border-border">
          <button
            onClick={() => setClientsExpanded(!clientsExpanded)}
            className="w-full flex items-center gap-2 px-6 py-3 bg-blue-500/5 hover:bg-blue-500/10 transition-colors"
          >
            <ChevronDown className={cn("w-4 h-4 text-foreground-muted transition-transform", !clientsExpanded && "-rotate-90")} />
            <span className="text-sm font-semibold text-primary">Clients</span>
          </button>

          {clientsExpanded && (
            <div className="px-6 py-4">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm text-foreground-muted">non clients ensemble</span>
                <button className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors">
                  <Plus className="w-3.5 h-3.5" />
                  Ajouter Clients
                  <ChevronDown className="w-3.5 h-3.5 ml-1" />
                </button>
              </div>
              <div className="flex flex-col items-center justify-center py-10 text-foreground-muted">
                <p className="text-sm">Ajoutez des clients specifiques pour limiter le nombre de personnes pouvant charger sur ce chargeur.</p>
                <p className="text-sm mt-1">
                  <strong>Remarque</strong> : lorsqu'inoccupe, quiconque sera autorise a charger ici.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Tokens section */}
        <div>
          <button
            onClick={() => setTokensExpanded(!tokensExpanded)}
            className="w-full flex items-center gap-2 px-6 py-3 bg-blue-500/5 hover:bg-blue-500/10 transition-colors"
          >
            <ChevronDown className={cn("w-4 h-4 text-foreground-muted transition-transform", !tokensExpanded && "-rotate-90")} />
            <span className="text-sm font-semibold text-primary">Tokens De Charge</span>
          </button>

          {tokensExpanded && (
            <div className="px-6 py-4">
              {isLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-foreground-muted" /></div>
              ) : !authorizedTokens || authorizedTokens.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-foreground-muted">
                  <CreditCard className="w-8 h-8 mb-2" />
                  <p className="text-sm">Aucun token de charge associe.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">UID</th>
                        <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Type</th>
                        <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Contrat</th>
                        <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Numero visuel</th>
                        <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Whitelist</th>
                        <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Valide</th>
                      </tr>
                    </thead>
                    <tbody>
                      {authorizedTokens.map((token) => (
                        <tr key={token.id} className="border-b border-border/50 hover:bg-surface-elevated/50">
                          <td className="py-2.5 px-3 text-foreground font-mono text-xs">{token.uid}</td>
                          <td className="py-2.5 px-3 text-foreground">{token.type}</td>
                          <td className="py-2.5 px-3 text-foreground">{token.contract_id ?? "\u2014"}</td>
                          <td className="py-2.5 px-3 text-foreground">{token.visual_number ?? "\u2014"}</td>
                          <td className="py-2.5 px-3 text-foreground">{token.whitelist ?? "\u2014"}</td>
                          <td className="py-2.5 px-3">
                            <span className={cn(
                              "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold",
                              token.valid ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
                            )}>
                              {token.valid ? "Oui" : "Non"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="text-xs text-foreground-muted">
        recupere le {new Date().toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// SCHEDULING TAB (Planification d'etat)
// ══════════════════════════════════════════════════════════════

interface ScheduleEntry {
  id: string;
  purpose: string;
  kind: string;
  recurrency_kind: string | null;
  valid_from: string | null;
  valid_to: string | null;
  schedule: unknown;
  is_active: boolean;
}

function SchedulingTab({ station }: { station: Station }) {
  const chargepointId = (station as any).ocpp_identity ?? station.gfx_id;

  const { data: schedules, isLoading } = useQuery<ScheduleEntry[]>({
    queryKey: ["station-schedules", chargepointId],
    queryFn: async () => {
      if (!chargepointId) return [];
      const { data, error } = await supabase
        .from("charging_profiles")
        .select("id, purpose, kind, recurrency_kind, valid_from, valid_to, schedule, is_active")
        .eq("chargepoint_id", chargepointId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) return [];
      return (data ?? []) as ScheduleEntry[];
    },
    enabled: !!chargepointId,
  });

  return (
    <div className="space-y-4">
      {/* Info banners */}
      <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-start gap-2">
        <Info className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
        <p className="text-sm text-foreground">
          Les programmes sont definis en fonction du fuseau horaire local de the site de charge.
        </p>
      </div>

      <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-start gap-2">
        <Info className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
        <p className="text-sm text-foreground">
          Chaque fois que cette station de charge est programmee pour etre &laquo; Hors service &raquo;, la station de charge sera rendue indisponible. Ce modele peut etre modifie en changeant le CPO du site de charge.
        </p>
      </div>

      {/* Scheduled changes */}
      <div className="bg-surface border border-border rounded-2xl">
        <div className="flex items-center gap-2 px-6 py-4 border-b border-border">
          <Clock className="w-4 h-4 text-foreground-muted" />
          <h3 className="text-base font-semibold text-foreground">Changements d'etat programmes</h3>
        </div>

        <div className="px-6 py-6">
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-foreground-muted" /></div>
          ) : !schedules || schedules.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-foreground-muted">
              <CalendarClock className="w-10 h-10 mb-3 text-foreground-muted/50" />
              <p className="text-sm italic">
                Les changements d'etat programmes peuvent etre utilises pour definir des intervalles de date/heure specifiques auxquels l'etat d'une station de charge doit etre defini sur un etat OCPI specifique.
              </p>
              <p className="text-sm mt-3 text-foreground-muted/60">
                Cliquez <button className="text-primary underline hover:no-underline">ici</button> pour programmer un etat
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {schedules.map((s) => (
                <div key={s.id} className="flex items-center justify-between bg-surface-elevated border border-border rounded-xl px-4 py-3">
                  <div className="flex items-center gap-3">
                    <CalendarClock className="w-4 h-4 text-primary shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {s.purpose} ({s.kind})
                        {s.recurrency_kind && <span className="text-foreground-muted"> — {s.recurrency_kind}</span>}
                      </p>
                      <p className="text-xs text-foreground-muted">
                        {s.valid_from ? new Date(s.valid_from).toLocaleDateString("fr-FR") : "\u2014"}{" "}
                        {"\u2192"}{" "}
                        {s.valid_to ? new Date(s.valid_to).toLocaleDateString("fr-FR") : "illimite"}
                      </p>
                    </div>
                  </div>
                  <span className={cn(
                    "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold",
                    s.is_active ? "bg-emerald-500/15 text-emerald-400" : "bg-gray-500/15 text-gray-400"
                  )}>
                    {s.is_active ? "Actif" : "Inactif"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-red-400">* cette information est requise</p>
        <div className="flex gap-3">
          <button className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-red-400 hover:text-red-300 transition-colors">
            <X className="w-3.5 h-3.5" />
            Annuler
          </button>
          <button className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors">
            <Save className="w-3.5 h-3.5" />
            Sauvegarder
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// DETAILS TAB (GreenFlux-style)
// ══════════════════════════════════════════════════════════════

function DetailsTab({
  station,
  onEdit,
  onDelete,
  onCommand,
  cmdLoading,
}: {
  station: Station;
  onEdit?: (station: Station) => void;
  onDelete?: () => void;
  onCommand: (cmd: string, payload?: Record<string, unknown>) => void;
  cmdLoading: string | null;
}) {
  const { data: history } = useStationStatusHistory(station.id);
  const connectors = parseConnectors(station);

  // Group connectors by EVSE
  const evses = (() => {
    if (connectors.length === 0) return [];
    const map = new Map<string, typeof connectors>();
    connectors.forEach((c, i) => {
      const evseKey = (c as any).evse_uid ?? `EVSE #${i + 1}`;
      const arr = map.get(evseKey) ?? [];
      arr.push(c);
      map.set(evseKey, arr);
    });
    return Array.from(map.entries());
  })();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
      {/* LEFT COLUMN: Station details */}
      <div className="space-y-6">
        {/* Main station info */}
        <div className="bg-surface border border-border rounded-2xl">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">Details de la station de charge</h3>
            <StationTags station={station} />
          </div>
          <div className="px-6 py-5">
            <div className="grid grid-cols-2 gap-x-8 gap-y-4">
              <div className="space-y-3">
                <DetailField label="Afficher Nom" value={station.name} />
                <DetailField label="CPO" value={station.cpo_name ?? "\u2014"} />
                <DetailField label="Contrat CPO" value={"\u2014"} />
                <DetailField label="Date d'installation" value={"\u2014"} />
                <DetailField label="Protocole COM" value={station.protocol_version ?? "\u2014"} />
                <DetailField label="Fonctionnalites" value={station.remote_manageable ? "Gerable a distance" : "\u2014"} />
                <DetailField label="Numero de serie" value={station.gfx_id ?? "\u2014"} />
                <DetailField label="Identifiant de connexion au reseau" value={(station as any).ocpp_identity ?? "\u2014"} />
                <DetailField label="Fabricant" value={station.charge_point_vendor ?? "\u2014"} />
                <DetailField label="Modele" value={station.charge_point_model ?? "\u2014"} />
              </div>
              <div className="space-y-3">
                <DetailField label="IMSI" value={"\u2014"} />
                <DetailField label="Paiement sans contact" value="desactive" />
                <DetailField label="Arret de la session en cas d'inactivite" value="desactive" />
                <DetailField label="Mode veille" value="par defaut" />
                <DetailField label="Tarifs a l'heure d'utilisation" value="inactif" />
                <DetailField label="Tarification dynamique basee sur le temps" value="inactif" />
                <DetailField label="Hubject Plug & Charge" value={station.iso_15118_enabled ? "actif" : "inactif"} />
                <DetailField label="Afficher le cout final" value="desactive" />
                <DetailField label="Afficher le cout en temps reel" value="desactive" />
                <DetailField label="Afficher le tarif utilisateur" value="desactive" />
              </div>
            </div>
          </div>

          {/* Info cards */}
          <div className="px-6 pb-5">
            <div className="grid grid-cols-3 gap-3">
              <InfoCard icon={Cpu} title={station.firmware_version ?? "\u2014"} subtitle="controleur / micrologiciel" />
              <InfoCard icon={Server} title={"\u2014"} subtitle="ICCID" />
              <InfoCard icon={Zap} title="A0" subtitle="tarifs par defaut" />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <InfoCard icon={Shield} title="OCPP Security: Level 0" subtitle="Security Profile" />
              <InfoCard icon={Radio} title={station.gfx_id ?? station.name} subtitle="Identifiant" />
            </div>
          </div>

          {/* Remarques */}
          <div className="px-6 pb-5 border-t border-border pt-4 space-y-3">
            <DetailField label="Instructions pour aller vers le site" value="\u2014" />
            <DetailField label="Remarques" value="\u2014" />
            <DetailField label="Informations d'entretien" value="\u2014" />
          </div>

          {/* Footer timestamps */}
          <div className="px-6 py-3 border-t border-border flex items-center justify-between text-xs text-foreground-muted">
            <span>Dernier PDU: {station.last_synced_at ? new Date(station.last_synced_at).toLocaleString("fr-FR") : "\u2014"}</span>
            <span>Derniere mise a jour: {station.created_at ? new Date(station.created_at).toLocaleString("fr-FR") : "\u2014"}</span>
          </div>
        </div>

        {/* Site details */}
        <div className="bg-surface border border-border rounded-2xl">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">Details du site</h3>
            <div className="flex gap-2">
              <span className="inline-flex items-center rounded-lg border px-2 py-0.5 text-[11px] font-medium bg-emerald-500/15 text-emerald-400 border-emerald-500/25">
                Deploye
              </span>
            </div>
          </div>
          <div className="px-6 py-5 grid grid-cols-2 gap-8">
            <div className="space-y-3">
              <DetailField label="CPO" value={station.cpo_name ?? "\u2014"} />
              <DetailField label="Contrat CPO" value={"\u2014"} />
              <DetailField label="Nom" value={station.name} />
              <DetailField label="Adresse" value={station.address ?? "\u2014"} />
              <DetailField label="Code postal / Ville" value={[station.postal_code, station.city].filter(Boolean).join(" - ") || "\u2014"} />
              <DetailField label="Pays" value="FRA" />
              <DetailField label="Type de site" value="\u2014" />
            </div>
            <div>
              {station.latitude && station.longitude ? (
                <div className="w-full h-48 bg-surface-elevated border border-border rounded-xl flex items-center justify-center">
                  <div className="text-center">
                    <MapPin className="w-8 h-8 text-primary mx-auto mb-2" />
                    <p className="text-xs text-foreground-muted">{station.latitude?.toFixed(4)}, {station.longitude?.toFixed(4)}</p>
                  </div>
                </div>
              ) : (
                <div className="w-full h-48 bg-surface-elevated border border-border rounded-xl flex items-center justify-center">
                  <p className="text-xs text-foreground-muted">Coordonnees non disponibles</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Remote commands */}
        <div className="bg-surface border border-border rounded-2xl">
          <div className="flex items-center gap-2 px-6 py-4 border-b border-border">
            <Terminal className="w-4 h-4 text-foreground-muted" />
            <h3 className="text-sm font-semibold text-foreground">Telecommande</h3>
          </div>
          <div className="px-6 py-4 flex gap-3">
            <button
              onClick={() => onCommand("Reset", { type: "Soft" })}
              disabled={!!cmdLoading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30 text-xs font-semibold hover:bg-amber-500/25 transition-colors disabled:opacity-40"
            >
              {cmdLoading === "Reset" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              Redemarrer (Soft)
            </button>
            <button
              onClick={() => onCommand("Reset", { type: "Hard" })}
              disabled={!!cmdLoading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-500/15 text-red-400 border border-red-500/30 text-xs font-semibold hover:bg-red-500/25 transition-colors disabled:opacity-40"
            >
              {cmdLoading === "Reset" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              Redemarrer (Hard)
            </button>
            <button
              onClick={() => onCommand("ClearCache")}
              disabled={!!cmdLoading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gray-500/15 text-gray-400 border border-gray-500/30 text-xs font-semibold hover:bg-gray-500/25 transition-colors disabled:opacity-40"
            >
              {cmdLoading === "ClearCache" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Vider cache
            </button>
          </div>
        </div>

        {/* Status History */}
        {history && history.length > 0 && (
          <div className="bg-surface border border-border rounded-2xl">
            <div className="flex items-center gap-2 px-6 py-4 border-b border-border">
              <Clock className="w-4 h-4 text-foreground-muted" />
              <h3 className="text-sm font-semibold text-foreground">Historique des statuts</h3>
            </div>
            <div className="px-6 py-4 space-y-2">
              {history.slice(0, 15).map((entry) => (
                <div key={entry.id} className="flex items-center gap-3 text-sm">
                  <div className="w-24 text-xs text-foreground-muted shrink-0">
                    {formatRelativeTime(entry.changed_at)}
                  </div>
                  {entry.previous_status && (
                    <>
                      <span className="text-xs" style={{ color: OCPP_STATUS_CONFIG[entry.previous_status as OCPPStatus]?.color ?? "#8892B0" }}>
                        {OCPP_STATUS_CONFIG[entry.previous_status as OCPPStatus]?.label ?? entry.previous_status}
                      </span>
                      <span className="text-foreground-muted">{"\u2192"}</span>
                    </>
                  )}
                  <span className="text-xs font-medium" style={{ color: OCPP_STATUS_CONFIG[entry.new_status as OCPPStatus]?.color ?? "#8892B0" }}>
                    {OCPP_STATUS_CONFIG[entry.new_status as OCPPStatus]?.label ?? entry.new_status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* RIGHT COLUMN: EVSEs */}
      <div className="space-y-4">
        {evses.length > 0 ? evses.map(([evseKey, evseConnectors], evseIdx) => (
          <div key={evseKey} className="bg-surface border border-border rounded-2xl">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">EVSE #{evseIdx + 1}</h3>
              <StatusBadge status={evseConnectors[0]?.status as OCPPStatus ?? "Unknown"} />
            </div>

            <div className="px-5 py-4 space-y-4">
              <button className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors">
                <Zap className="w-4 h-4" />
                Debut De La Transaction
                <ChevronDown className="w-3.5 h-3.5 ml-1" />
              </button>

              <div className="space-y-2.5">
                <DetailField label="Identifiant" value={`FR-GFX-E${station.gfx_id ?? station.name}-${evseIdx + 1}`} />
                <DetailField label="Groupe de charge intelligente" value="\u2014" />
                <DetailField label="Capacites" value={station.remote_manageable ? "Remote Start/Stop Capable, RFID Reader" : "\u2014"} />
                <DetailField label="URL du code QR" value="\u2014" />
                <DetailField label="Code QR scanne pour la derniere fois" value="never" />
                <DetailField label="Nombre de scans de code QR" value="0x" />
              </div>
            </div>

            <div className="border-t border-border">
              <div className="px-5 py-3">
                <h4 className="text-xs font-semibold text-foreground-muted mb-3">Connecteurs</h4>
                {evseConnectors.map((c, cIdx) => (
                  <div key={cIdx} className="flex items-center justify-between bg-surface-elevated border border-border rounded-xl px-4 py-3 mb-2">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center",
                        c.status === "Available" ? "bg-emerald-500/20" :
                        c.status === "Charging" ? "bg-cyan-500/20" :
                        "bg-gray-500/20"
                      )}>
                        <Plug className={cn(
                          "w-4 h-4",
                          c.status === "Available" ? "text-emerald-400" :
                          c.status === "Charging" ? "text-cyan-400" :
                          "text-gray-400"
                        )} />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          #{evseIdx + 1}:{cIdx + 1} {c.type}
                        </p>
                        <p className="text-xs text-foreground-muted">
                          tarifs A0 / capacite {c.max_power_kw > 0 ? `${c.max_power_kw} kW` : "\u2014"}
                        </p>
                      </div>
                    </div>
                    <button className="px-3 py-1 text-xs font-medium text-foreground-muted border border-border rounded-lg hover:text-foreground hover:border-foreground-muted/50 transition-colors flex items-center gap-1">
                      Deverrouiller <ChevronDown className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )) : (
          <div className="bg-surface border border-border rounded-2xl p-6 text-center">
            <Plug className="w-8 h-8 text-foreground-muted mx-auto mb-2" />
            <p className="text-sm text-foreground-muted">Aucun EVSE / connecteur</p>
          </div>
        )}

        {/* Actions card */}
        <div className="bg-surface border border-border rounded-2xl p-4 space-y-2">
          {onEdit && (
            <button
              onClick={() => onEdit(station)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-border rounded-xl text-sm text-foreground-muted hover:text-foreground hover:border-foreground-muted/50 transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
              Modifier la borne
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => onDelete?.()}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-red-500/25 rounded-xl text-sm text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Desactiver la borne
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Detail Field ─────────────────────────────────────────────

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-foreground-muted">{label}</p>
      <p className="text-sm text-foreground">{value}</p>
    </div>
  );
}

// ── Info Card ────────────────────────────────────────────────

function InfoCard({ icon: Icon, title, subtitle }: { icon: typeof Radio; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3 bg-surface-elevated border border-border rounded-xl px-4 py-3">
      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="w-4.5 h-4.5 text-primary" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground truncate">{title}</p>
        <p className="text-[11px] text-foreground-muted">{subtitle}</p>
      </div>
    </div>
  );
}
