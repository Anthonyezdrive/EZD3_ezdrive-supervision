// ============================================================
// EZDrive — Monitoring Page (GreenFlux-style)
// 3 tabs: Temps réel, Alertes, Maintenance & Tickets
// Alertes tab: list of alerts + "Add alert" wizard (Setup → Configuration → Sharing)
// ============================================================

import { useMemo, useState, type KeyboardEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  Bell,
  Plus,
  ArrowLeft,
  ArrowRight,
  Trash2,
  X,
  ToggleLeft,
  ToggleRight,
  Pencil,
  ChevronRight,
  Info,
  Loader2,
  History,
  ClipboardList,
  FileText,
  Search,
  Download,
  Calendar,
  ChevronDown,
  CheckCircle2,
  XCircle,
  Filter,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, formatDuration, formatRelativeTime } from "@/lib/utils";
import { downloadCSV, todayISO } from "@/lib/export";
import { useCpo } from "@/contexts/CpoContext";
import { KPICard } from "@/components/ui/KPICard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { KPISkeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PageHelp } from "@/components/ui/PageHelp";
import type { Station } from "@/types/station";
import { MaintenancePage } from "@/components/maintenance/MaintenancePage";
import { useToast } from "@/contexts/ToastContext";
import { SlideOver } from "@/components/ui/SlideOver";

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

interface AlertRule {
  id: string;
  alert_type: string;
  title: string;
  threshold_hours: number;
  notification_interval_hours: number;
  email_recipients: string[];
  is_active: boolean;
  charge_station_type: string;
  deploy_state: string;
  firmware_version: string | null;
  chargepoint_vendor: string | null;
  chargepoint_model: string | null;
  chargepoint_location_id: string | null;
  global_config: boolean;
  created_at: string;
  updated_at: string;
}

// ── Alert type definitions ──

const ALERT_TYPES = [
  { value: "fault_threshold", label: "Station en panne", description: "Alerte quand une borne est en statut Faulted depuis X heures" },
  { value: "offline_threshold", label: "Station hors ligne", description: "Alerte quand une borne est hors ligne depuis X heures" },
  { value: "unavailable_threshold", label: "Station indisponible", description: "Alerte quand une borne est indisponible depuis X heures" },
  { value: "heartbeat_missing", label: "Heartbeat manquant", description: "Alerte quand aucun heartbeat reçu depuis X heures" },
  { value: "session_stuck", label: "Session bloquée", description: "Alerte quand une session de charge dépasse X heures" },
  { value: "connector_error", label: "Erreur connecteur", description: "Alerte quand un connecteur remonte une erreur" },
  { value: "energy_threshold", label: "Seuil énergie", description: "Alerte quand la consommation dépasse un seuil kWh" },
];

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
        // 1) Try ocpp_transactions first
        const { data, error } = await supabase
          .from("ocpp_transactions")
          .select("*, stations(name, city)")
          .eq("status", "Active")
          .order("started_at", { ascending: false });
        if (error) {
          console.warn("[Monitoring] ocpp_transactions error:", error.code, error.message);
        }

        // 2) If ocpp_transactions returned data, use it
        if (data && data.length > 0) return data as OcppTransaction[];

        // 3) Fallback: query recent ocpi_cdrs (CDRs from GreenFlux/Road sync)
        console.info("[Monitoring] ocpp_transactions empty, falling back to ocpi_cdrs");
        const { data: cdrs, error: cdrError } = await supabase
          .from("ocpi_cdrs")
          .select("id, start_date_time, end_date_time, total_energy, total_cost, cdr_location, cdr_token, status")
          .order("start_date_time", { ascending: false })
          .limit(15);
        if (cdrError) {
          console.warn("[Monitoring] CDR fallback error:", cdrError.message);
          return [];
        }

        // Map CDR fields to OcppTransaction shape for the UI
        return (cdrs ?? []).map((cdr: Record<string, unknown>): OcppTransaction => {
          const location = cdr.cdr_location as Record<string, unknown> | null;
          const stationName = location?.name as string ?? "Borne CDR";
          const stationCity = (location?.city as string) ?? null;
          const totalEnergy = cdr.total_energy as number | null;
          return {
            id: cdr.id as string,
            connector_id: 1,
            meter_start: 0,
            meter_stop: totalEnergy != null ? Math.round(totalEnergy * 1000) : null, // Wh for computeEnergy
            started_at: cdr.start_date_time as string,
            status: "Active",
            stations: { name: stationName, city: stationCity },
          };
        });
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

function useAlertRules() {
  return useQuery<AlertRule[]>({
    queryKey: ["alert-rules"],
    retry: false,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("alert_config")
          .select("*")
          .order("created_at", { ascending: false });
        if (error) {
          console.warn("[Monitoring] alert_config error:", error.code, error.message);
          return [];
        }
        // Map the existing alert_config rows to AlertRule shape
        return (data ?? []).map((row: any) => ({
          id: row.id,
          alert_type: row.alert_type ?? "fault_threshold",
          title: row.title ?? "Alerte seuil de panne",
          threshold_hours: row.threshold_hours ?? 4,
          notification_interval_hours: row.notification_interval_hours ?? 1,
          email_recipients: row.email_recipients ?? [],
          is_active: row.is_active ?? false,
          charge_station_type: row.charge_station_type ?? "any",
          deploy_state: row.deploy_state ?? "any",
          firmware_version: row.firmware_version ?? null,
          chargepoint_vendor: row.chargepoint_vendor ?? null,
          chargepoint_model: row.chargepoint_model ?? null,
          chargepoint_location_id: row.chargepoint_location_id ?? null,
          global_config: row.global_config ?? false,
          created_at: row.created_at,
          updated_at: row.updated_at,
        }));
      } catch {
        return [];
      }
    },
  });
}

function useAlertHistory() {
  return useQuery({
    queryKey: ["alert-history"],
    retry: false,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("alert_history")
          .select("*, stations(name, city)")
          .order("sent_at", { ascending: false })
          .limit(50);
        if (error) return [];
        return data ?? [];
      } catch {
        return [];
      }
    },
  });
}

// ── Helpers ────────────────────────────────────────────────

function heartbeatFresh(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const diffMs = Date.now() - new Date(dateStr).getTime();
  return diffMs < 5 * 60 * 1000;
}

function computeEnergy(tx: OcppTransaction): string {
  if (tx.meter_stop != null && tx.meter_start != null) {
    return ((tx.meter_stop - tx.meter_start) / 1000).toFixed(1);
  }
  return "--";
}

// ══════════════════════════════════════════════════════════════
// ADD ALERT WIZARD (GFX-style 3-step: Setup → Configuration → Sharing)
// ══════════════════════════════════════════════════════════════

type WizardStep = "setup" | "configuration" | "sharing";
const WIZARD_STEPS: { key: WizardStep; label: string }[] = [
  { key: "setup", label: "Paramétrage" },
  { key: "configuration", label: "Configuration" },
  { key: "sharing", label: "Partage" },
];

function AddAlertWizard({
  onBack,
  onSaved,
  editingRule,
}: {
  onBack: () => void;
  onSaved: () => void;
  editingRule?: AlertRule | null;
}) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<WizardStep>("setup");
  const [saving, setSaving] = useState(false);

  // Setup fields
  const [alertType, setAlertType] = useState(editingRule?.alert_type ?? "");
  const [title, setTitle] = useState(editingRule?.title ?? "");
  const [notifInterval, setNotifInterval] = useState(
    String(editingRule?.notification_interval_hours ?? 1)
  );

  // Configuration fields
  const [threshold, setThreshold] = useState(
    String(editingRule?.threshold_hours ?? 1000)
  );
  const [globalConfig, setGlobalConfig] = useState(editingRule?.global_config ?? false);
  const [stationType, setStationType] = useState(editingRule?.charge_station_type ?? "any");
  const [deployState, setDeployState] = useState(editingRule?.deploy_state ?? "any");
  const [firmwareVersion, setFirmwareVersion] = useState(editingRule?.firmware_version ?? "");
  const [cpVendor, setCpVendor] = useState(editingRule?.chargepoint_vendor ?? "");
  const [cpModel, setCpModel] = useState(editingRule?.chargepoint_model ?? "");
  const [cpLocationId, setCpLocationId] = useState(editingRule?.chargepoint_location_id ?? "");

  // Sharing fields
  const [emailRecipients, setEmailRecipients] = useState<string[]>(
    editingRule?.email_recipients ?? []
  );
  const [emailInput, setEmailInput] = useState("");

  const currentStepIndex = WIZARD_STEPS.findIndex((s) => s.key === step);

  const canContinue = () => {
    if (step === "setup") return alertType !== "" && title.trim() !== "";
    if (step === "configuration") return threshold.trim() !== "";
    if (step === "sharing") return emailRecipients.length > 0;
    return true;
  };

  const handleContinue = () => {
    if (step === "setup") setStep("configuration");
    else if (step === "configuration") setStep("sharing");
    else handleSave();
  };

  const handleBack = () => {
    if (step === "configuration") setStep("setup");
    else if (step === "sharing") setStep("configuration");
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        alert_type: alertType,
        title: title.trim(),
        threshold_hours: parseFloat(threshold) || 4,
        notification_interval_hours: parseFloat(notifInterval) || 1,
        email_recipients: emailRecipients,
        is_active: editingRule?.is_active ?? true,
        charge_station_type: stationType,
        deploy_state: deployState,
        firmware_version: firmwareVersion || null,
        chargepoint_vendor: cpVendor || null,
        chargepoint_model: cpModel || null,
        chargepoint_location_id: cpLocationId || null,
        global_config: globalConfig,
      };

      if (editingRule) {
        const { error } = await supabase
          .from("alert_config")
          .update(payload)
          .eq("id", editingRule.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("alert_config").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alert-rules"] });
      onSaved();
    },
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveMutation.mutateAsync();
    } catch (err) {
      console.error("Error saving alert:", err);
    } finally {
      setSaving(false);
    }
  };

  const addEmail = (email: string) => {
    const trimmed = email.trim().toLowerCase();
    if (trimmed && trimmed.includes("@") && !emailRecipients.includes(trimmed)) {
      setEmailRecipients([...emailRecipients, trimmed]);
    }
    setEmailInput("");
  };

  const handleEmailKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addEmail(emailInput);
    }
  };

  const removeEmail = (email: string) => {
    setEmailRecipients(emailRecipients.filter((e) => e !== email));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-xl border border-border text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="font-heading text-xl font-bold">
            {editingRule ? "Modifier l'alerte" : "Ajouter une alerte"}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {currentStepIndex > 0 && (
            <button
              onClick={handleBack}
              className="flex items-center gap-1.5 px-4 py-2.5 border border-border rounded-xl text-sm font-medium text-foreground hover:bg-surface-elevated transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Retour
            </button>
          )}
          <button
            onClick={step === "sharing" ? handleSave : handleContinue}
            disabled={!canContinue() || saving}
            className={cn(
              "flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors",
              canContinue() && !saving
                ? "bg-primary text-white hover:bg-primary/90"
                : "bg-primary/40 text-white/60 cursor-not-allowed"
            )}
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : step === "sharing" ? (
              "Enregistrer"
            ) : (
              <>
                Continuer
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>

      {/* Step tabs */}
      <div className="flex items-center gap-0 border-b border-border">
        {WIZARD_STEPS.map((ws, idx) => {
          const isCurrent = ws.key === step;
          const isPast = idx < currentStepIndex;
          return (
            <button
              key={ws.key}
              onClick={() => {
                if (isPast) setStep(ws.key);
              }}
              className={cn(
                "flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors relative",
                isCurrent
                  ? "text-primary"
                  : isPast
                  ? "text-foreground hover:text-primary cursor-pointer"
                  : "text-foreground-muted cursor-default"
              )}
            >
              {ws.label}
              {idx < WIZARD_STEPS.length - 1 && (
                <ChevronRight className="w-3.5 h-3.5 text-foreground-muted ml-2" />
              )}
              {isCurrent && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
              )}
            </button>
          );
        })}
      </div>

      {/* Step content */}
      <div className="max-w-2xl">
        {step === "setup" && (
          <div className="space-y-6">
            {/* Alert Type */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Type d'alerte <span className="text-red-500">*</span>
              </label>
              <select
                value={alertType}
                onChange={(e) => setAlertType(e.target.value)}
                className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50"
              >
                <option value="">Sélectionner</option>
                {ALERT_TYPES.map((at) => (
                  <option key={at.value} value={at.value}>
                    {at.label}
                  </option>
                ))}
              </select>
              {alertType && (
                <p className="mt-1.5 text-xs text-foreground-muted">
                  {ALERT_TYPES.find((a) => a.value === alertType)?.description}
                </p>
              )}
            </div>

            {/* Title */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Titre <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Nom de l'alerte"
                className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50"
              />
            </div>

            {/* Notification interval */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Intervalle de notification
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={notifInterval}
                  onChange={(e) => setNotifInterval(e.target.value)}
                  min="1"
                  className="w-24 px-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50"
                />
                <span className="px-3 py-2 bg-primary/10 text-primary text-sm font-medium rounded-lg">
                  heures
                </span>
              </div>
              <p className="mt-1.5 text-xs text-foreground-muted">
                Les alertes déclenchées recevront une notification à cet intervalle
              </p>
            </div>
          </div>
        )}

        {step === "configuration" && (
          <div className="space-y-8">
            {/* Configuration section */}
            <div>
              <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">
                Configuration
              </h2>

              {/* Threshold */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Seuil
                </label>
                <input
                  type="number"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  className="w-32 px-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50"
                />
              </div>

              {/* Global configuration toggle */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setGlobalConfig(!globalConfig)}
                  className="text-foreground-muted hover:text-foreground transition-colors"
                >
                  {globalConfig ? (
                    <ToggleRight className="w-10 h-6 text-primary" />
                  ) : (
                    <ToggleLeft className="w-10 h-6" />
                  )}
                </button>
                <span className="text-sm text-foreground">Configuration globale</span>
                <Info className="w-4 h-4 text-foreground-muted" />
              </div>
            </div>

            {/* Filters section */}
            <div>
              <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">
                Filtres
              </h2>

              {/* Charge Station Type */}
              <div className="mb-5">
                <label className="block text-sm font-medium text-foreground mb-2">
                  Type de borne
                </label>
                <div className="flex items-center gap-4">
                  {["any", "business", "home", "public"].map((val) => (
                    <label key={val} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="stationType"
                        value={val}
                        checked={stationType === val}
                        onChange={(e) => setStationType(e.target.value)}
                        className="w-4 h-4 text-primary border-border focus:ring-primary"
                      />
                      <span className="text-sm text-foreground capitalize">
                        {val === "any" ? "Tous" : val === "business" ? "Entreprise" : val === "home" ? "Domicile" : "Public"}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Deploy state */}
              <div className="mb-5">
                <label className="block text-sm font-medium text-foreground mb-2">
                  État de déploiement
                </label>
                <div className="flex items-center gap-4">
                  {["any", "production", "stock", "deprecated"].map((val) => (
                    <label key={val} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="deployState"
                        value={val}
                        checked={deployState === val}
                        onChange={(e) => setDeployState(e.target.value)}
                        className="w-4 h-4 text-primary border-border focus:ring-primary"
                      />
                      <span className="text-sm text-foreground capitalize">
                        {val === "any" ? "Tous" : val === "production" ? "Production" : val === "stock" ? "Stock" : "Obsolète"}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Firmware Version + Chargepoint vendor (2 columns) */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Version firmware
                  </label>
                  <input
                    type="text"
                    value={firmwareVersion}
                    onChange={(e) => setFirmwareVersion(e.target.value)}
                    className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Fabricant
                  </label>
                  <input
                    type="text"
                    value={cpVendor}
                    onChange={(e) => setCpVendor(e.target.value)}
                    className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50"
                  />
                </div>
              </div>

              {/* Chargepoint model + Chargepoint location ID (2 columns) */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Modèle
                  </label>
                  <input
                    type="text"
                    value={cpModel}
                    onChange={(e) => setCpModel(e.target.value)}
                    className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    ID de localisation
                  </label>
                  <input
                    type="text"
                    value={cpLocationId}
                    onChange={(e) => setCpLocationId(e.target.value)}
                    className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {step === "sharing" && (
          <div className="space-y-6">
            {/* Email recipients */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Destinataires e-mail <span className="text-red-500">*</span>
              </label>
              <div className="flex flex-wrap items-center gap-1.5 px-3 py-2.5 bg-surface border border-border rounded-xl min-h-[44px] focus-within:border-primary/50">
                {emailRecipients.map((email) => (
                  <span
                    key={email}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-surface-elevated rounded-lg text-sm text-foreground"
                  >
                    {email}
                    <button
                      onClick={() => removeEmail(email)}
                      className="text-foreground-muted hover:text-foreground transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))}
                <input
                  type="email"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  onKeyDown={handleEmailKeyDown}
                  onBlur={() => {
                    if (emailInput.trim()) addEmail(emailInput);
                  }}
                  placeholder={emailRecipients.length === 0 ? "email@example.com" : ""}
                  className="flex-1 min-w-[200px] px-1 py-0.5 bg-transparent text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none"
                />
              </div>
              <p className="mt-1.5 text-xs text-foreground-muted">
                Saisissez une adresse e-mail, puis appuyez sur virgule ou Entrée pour valider
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ALERT LIST VIEW
// ══════════════════════════════════════════════════════════════

function AlertsTab() {
  const queryClient = useQueryClient();
  const { data: alertRules, isLoading } = useAlertRules();
  const { data: alertHistory } = useAlertHistory();
  const [showWizard, setShowWizard] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
  const [confirmDeleteAlert, setConfirmDeleteAlert] = useState<string | null>(null);

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("alert_config")
        .update({ is_active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alert-rules"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("alert_config").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alert-rules"] });
    },
  });

  if (showWizard || editingRule) {
    return (
      <AddAlertWizard
        onBack={() => {
          setShowWizard(false);
          setEditingRule(null);
        }}
        onSaved={() => {
          setShowWizard(false);
          setEditingRule(null);
        }}
        editingRule={editingRule}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-base font-semibold text-foreground">
            Alertes configurées
          </h2>
          <p className="text-xs text-foreground-muted mt-0.5">
            Gérez vos règles d'alertes et notifications
          </p>
        </div>
        <button
          onClick={() => setShowWizard(true)}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Ajouter une alerte
        </button>
      </div>

      {/* Alert rules table */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-3 px-4 text-xs font-semibold text-foreground-muted uppercase">
                  Statut
                </th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-foreground-muted uppercase">
                  Titre
                </th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-foreground-muted uppercase">
                  Type
                </th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-foreground-muted uppercase">
                  Seuil
                </th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-foreground-muted uppercase">
                  Intervalle
                </th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-foreground-muted uppercase">
                  Destinataires
                </th>
                <th className="text-right py-3 px-4 text-xs font-semibold text-foreground-muted uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto text-foreground-muted" />
                  </td>
                </tr>
              ) : !alertRules || alertRules.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <Bell className="w-8 h-8 text-foreground-muted/40" />
                      <p className="text-sm text-foreground-muted">
                        Aucune alerte configurée
                      </p>
                      <button
                        onClick={() => setShowWizard(true)}
                        className="mt-2 text-sm text-primary hover:text-primary/80 font-medium"
                      >
                        Créer votre première alerte
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                alertRules.map((rule) => (
                  <tr
                    key={rule.id}
                    className="border-b border-border/50 hover:bg-surface-elevated/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <button
                        onClick={() =>
                          toggleMutation.mutate({ id: rule.id, is_active: !rule.is_active })
                        }
                        className="transition-colors"
                      >
                        {rule.is_active ? (
                          <ToggleRight className="w-8 h-5 text-primary" />
                        ) : (
                          <ToggleLeft className="w-8 h-5 text-foreground-muted" />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {rule.title}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 bg-primary/10 text-primary text-xs font-medium rounded-lg">
                        {ALERT_TYPES.find((a) => a.value === rule.alert_type)?.label ?? rule.alert_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-foreground-muted">
                      {rule.threshold_hours}h
                    </td>
                    <td className="px-4 py-3 text-foreground-muted">
                      {rule.notification_interval_hours}h
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {rule.email_recipients.slice(0, 2).map((email) => (
                          <span
                            key={email}
                            className="px-2 py-0.5 bg-surface-elevated rounded text-xs text-foreground-muted truncate max-w-[140px]"
                          >
                            {email}
                          </span>
                        ))}
                        {rule.email_recipients.length > 2 && (
                          <span className="px-1.5 py-0.5 text-xs text-foreground-muted">
                            +{rule.email_recipients.length - 2}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setEditingRule(rule)}
                          className="p-1.5 text-foreground-muted hover:text-foreground rounded-lg hover:bg-surface-elevated transition-colors"
                          title="Modifier"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setConfirmDeleteAlert(rule.id)}
                          className="p-1.5 text-foreground-muted hover:text-red-500 rounded-lg hover:bg-surface-elevated transition-colors"
                          title="Supprimer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Alert history */}
      {alertHistory && alertHistory.length > 0 && (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <Clock className="w-4 h-4 text-foreground-muted" />
            <h2 className="font-heading text-sm font-semibold">
              Historique des alertes envoyées
            </h2>
            <span className="ml-auto text-xs text-foreground-muted">
              {alertHistory.length} dernières
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-foreground-muted border-b border-border">
                  <th className="text-left font-medium px-4 py-2.5">Borne</th>
                  <th className="text-left font-medium px-4 py-2.5">Type</th>
                  <th className="text-left font-medium px-4 py-2.5">Heures en panne</th>
                  <th className="text-left font-medium px-4 py-2.5">Envoyé le</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {alertHistory.map((entry: any) => (
                  <tr
                    key={entry.id}
                    className="hover:bg-surface-elevated/50 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-foreground">
                      {entry.stations?.name ?? entry.station_id?.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 bg-red-500/10 text-red-500 text-xs font-medium rounded-lg">
                        {entry.alert_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-foreground-muted">
                      {entry.hours_in_fault != null
                        ? `${Number(entry.hours_in_fault).toFixed(1)}h`
                        : "--"}
                    </td>
                    <td className="px-4 py-3 text-foreground-muted text-xs">
                      {formatRelativeTime(entry.sent_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Confirm delete dialog */}
      <ConfirmDialog
        open={confirmDeleteAlert !== null}
        title="Supprimer cette alerte ?"
        description="Cette action est irréversible. L'alerte et sa configuration seront définitivement supprimées."
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (confirmDeleteAlert) {
            deleteMutation.mutate(confirmDeleteAlert, {
              onSuccess: () => setConfirmDeleteAlert(null),
            });
          }
        }}
        onCancel={() => setConfirmDeleteAlert(null)}
      />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ALERT HISTORY TAB (Story 3)
// ══════════════════════════════════════════════════════════════

function AlertHistoryTab() {
  const { data: history, isLoading } = useAlertHistory();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [stationSearch, setStationSearch] = useState("");

  const filtered = useMemo(() => {
    if (!history) return [];
    return (history as any[]).filter((entry) => {
      if (statusFilter !== "all" && entry.alert_type !== statusFilter) return false;
      if (stationSearch) {
        const q = stationSearch.toLowerCase();
        const name = entry.stations?.name?.toLowerCase() ?? "";
        const id = entry.station_id?.toLowerCase() ?? "";
        if (!name.includes(q) && !id.includes(q)) return false;
      }
      if (dateFrom) {
        const entryDate = new Date(entry.sent_at).toISOString().slice(0, 10);
        if (entryDate < dateFrom) return false;
      }
      if (dateTo) {
        const entryDate = new Date(entry.sent_at).toISOString().slice(0, 10);
        if (entryDate > dateTo) return false;
      }
      return true;
    });
  }, [history, statusFilter, stationSearch, dateFrom, dateTo]);

  const alertTypes = useMemo(() => {
    if (!history) return [];
    const types = new Set((history as any[]).map((h) => h.alert_type).filter(Boolean));
    return Array.from(types);
  }, [history]);

  function handleExportCSV() {
    const rows = filtered.map((entry: any) => ({
      Borne: entry.stations?.name ?? entry.station_id,
      Type: entry.alert_type,
      "Heures en panne": entry.hours_in_fault != null ? Number(entry.hours_in_fault).toFixed(1) : "",
      "Envoyé le": entry.sent_at ? new Date(entry.sent_at).toLocaleString("fr-FR") : "",
    }));
    downloadCSV(rows, `ezdrive-alertes-historique-${todayISO()}.csv`);
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px] max-w-xs">
          <label className="block text-xs text-foreground-muted mb-1">Rechercher borne</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
            <input
              type="text"
              placeholder="Nom ou ID..."
              value={stationSearch}
              onChange={(e) => setStationSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50 transition-colors"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs text-foreground-muted mb-1">Type d'alerte</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors"
          >
            <option value="all">Tous les types</option>
            {alertTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-foreground-muted mb-1">Du</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors"
          />
        </div>
        <div>
          <label className="block text-xs text-foreground-muted mb-1">Au</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors"
          />
        </div>
        <button
          onClick={handleExportCSV}
          disabled={filtered.length === 0}
          className="flex items-center gap-2 px-3 py-2 bg-surface border border-border rounded-xl text-sm text-foreground-muted hover:text-foreground hover:border-foreground-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download className="w-4 h-4" />
          CSV
        </button>
      </div>

      {/* Stats */}
      <div className="flex gap-4 text-xs text-foreground-muted">
        <span>{filtered.length} alerte{filtered.length !== 1 ? "s" : ""}</span>
        {dateFrom && <span>depuis {dateFrom}</span>}
        {dateTo && <span>jusqu'au {dateTo}</span>}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-12 bg-surface border border-border rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 bg-surface border border-border rounded-2xl">
          <History className="w-8 h-8 text-foreground-muted/40 mb-2" />
          <p className="text-foreground-muted">Aucune alerte dans l'historique</p>
          <p className="text-xs text-foreground-muted/60 mt-1">Ajustez vos filtres ou attendez que des alertes soient envoyées.</p>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-foreground-muted border-b border-border bg-surface-elevated">
                  <th className="text-left font-medium px-4 py-3">Borne</th>
                  <th className="text-left font-medium px-4 py-3">Type</th>
                  <th className="text-left font-medium px-4 py-3">Heures en panne</th>
                  <th className="text-left font-medium px-4 py-3">Envoyé le</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((entry: any) => (
                  <tr key={entry.id} className="hover:bg-surface-elevated/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-foreground">
                      {entry.stations?.name ?? entry.station_id?.slice(0, 8) ?? "--"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 bg-red-500/10 text-red-400 text-xs font-medium rounded-lg">
                        {entry.alert_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-foreground-muted tabular-nums">
                      {entry.hours_in_fault != null ? `${Number(entry.hours_in_fault).toFixed(1)}h` : "--"}
                    </td>
                    <td className="px-4 py-3 text-foreground-muted text-xs">
                      {entry.sent_at
                        ? new Date(entry.sent_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
                        : "--"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// INTERVENTIONS TAB (Stories 28-30)
// ══════════════════════════════════════════════════════════════

interface Intervention {
  id: string;
  station_id: string | null;
  station_name: string | null;
  type: string;
  title: string;
  description: string | null;
  technician: string | null;
  status: "planned" | "in_progress" | "completed" | "cancelled";
  priority: "low" | "medium" | "high" | "critical";
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  report: string | null;
  parts_used: string | null;
  duration_minutes: number | null;
  created_at: string;
}

const INTERVENTION_STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; border: string; dot: string }> = {
  planned:     { label: "Planifié",  bg: "bg-blue-500/10",    text: "text-blue-400",    border: "border-blue-500/25",    dot: "#60A5FA" },
  in_progress: { label: "En cours",  bg: "bg-amber-500/10",   text: "text-amber-400",   border: "border-amber-500/25",   dot: "#FBBF24" },
  completed:   { label: "Terminé",   bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/25", dot: "#34D399" },
  cancelled:   { label: "Annulé",    bg: "bg-foreground-muted/10", text: "text-foreground-muted", border: "border-border", dot: "#6B7280" },
};

const INTERVENTION_TYPES = [
  { value: "preventive", label: "Préventive" },
  { value: "corrective", label: "Corrective" },
  { value: "installation", label: "Installation" },
  { value: "inspection", label: "Inspection" },
  { value: "firmware", label: "Mise à jour firmware" },
  { value: "other", label: "Autre" },
];

const EMPTY_INTERVENTION = {
  station_id: "",
  station_name: "",
  type: "corrective",
  title: "",
  description: "",
  technician: "",
  priority: "medium" as Intervention["priority"],
  scheduled_at: "",
  report: "",
  parts_used: "",
  duration_minutes: null as number | null,
};

function useInterventions() {
  return useQuery<Intervention[]>({
    queryKey: ["interventions"],
    retry: false,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("interventions")
          .select("*")
          .order("created_at", { ascending: false });
        if (error) {
          console.warn("[Interventions] error:", error.message);
          return [];
        }
        return (data ?? []) as Intervention[];
      } catch {
        return [];
      }
    },
  });
}

function InterventionsTab() {
  const queryClient = useQueryClient();
  const { success: toastSuccess, error: toastError } = useToast();
  const { data: interventions, isLoading } = useInterventions();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Intervention | null>(null);
  const [form, setForm] = useState(EMPTY_INTERVENTION);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showReport, setShowReport] = useState<Intervention | null>(null);

  // CRUD mutations
  const createMutation = useMutation({
    mutationFn: async (data: typeof EMPTY_INTERVENTION) => {
      const { error } = await supabase.from("interventions").insert({
        station_id: data.station_id || null,
        station_name: data.station_name || null,
        type: data.type,
        title: data.title,
        description: data.description || null,
        technician: data.technician || null,
        priority: data.priority,
        scheduled_at: data.scheduled_at || null,
        status: "planned",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["interventions"] });
      closeModal();
      toastSuccess("Intervention planifiee", "L'intervention a ete ajoutee");
    },
    onError: (err: Error) => toastError("Erreur", err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Partial<typeof EMPTY_INTERVENTION & { status: string }>) => {
      const patch: Record<string, unknown> = {};
      if (data.title !== undefined) patch.title = data.title;
      if (data.description !== undefined) patch.description = data.description || null;
      if (data.technician !== undefined) patch.technician = data.technician || null;
      if (data.priority !== undefined) patch.priority = data.priority;
      if (data.type !== undefined) patch.type = data.type;
      if (data.scheduled_at !== undefined) patch.scheduled_at = data.scheduled_at || null;
      if ((data as any).status !== undefined) {
        patch.status = (data as any).status;
        if ((data as any).status === "in_progress") patch.started_at = new Date().toISOString();
        if ((data as any).status === "completed") patch.completed_at = new Date().toISOString();
      }
      if (data.report !== undefined) patch.report = data.report || null;
      if (data.parts_used !== undefined) patch.parts_used = data.parts_used || null;
      if (data.duration_minutes !== undefined) patch.duration_minutes = data.duration_minutes;
      const { error } = await supabase.from("interventions").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["interventions"] });
      closeModal();
      setShowReport(null);
      toastSuccess("Intervention mise a jour");
    },
    onError: (err: Error) => toastError("Erreur", err.message),
  });

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_INTERVENTION);
    setShowModal(true);
  }

  function openEdit(intervention: Intervention) {
    setEditing(intervention);
    setForm({
      station_id: intervention.station_id ?? "",
      station_name: intervention.station_name ?? "",
      type: intervention.type,
      title: intervention.title,
      description: intervention.description ?? "",
      technician: intervention.technician ?? "",
      priority: intervention.priority,
      scheduled_at: intervention.scheduled_at?.slice(0, 16) ?? "",
      report: intervention.report ?? "",
      parts_used: intervention.parts_used ?? "",
      duration_minutes: intervention.duration_minutes,
    });
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditing(null);
    setForm(EMPTY_INTERVENTION);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editing) {
      updateMutation.mutate({ id: editing.id, ...form });
    } else {
      createMutation.mutate(form);
    }
  }

  const filtered = useMemo(() => {
    const list = interventions ?? [];
    if (statusFilter === "all") return list;
    return list.filter((i) => i.status === statusFilter);
  }, [interventions, statusFilter]);

  const stats = useMemo(() => {
    const list = interventions ?? [];
    return {
      total: list.length,
      planned: list.filter((i) => i.status === "planned").length,
      inProgress: list.filter((i) => i.status === "in_progress").length,
      completed: list.filter((i) => i.status === "completed").length,
    };
  }, [interventions]);

  const inputClass = "w-full px-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50 transition-colors";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex gap-4 text-xs text-foreground-muted">
          <span>{stats.total} total</span>
          <span className="text-blue-400">{stats.planned} planifie(s)</span>
          <span className="text-amber-400">{stats.inProgress} en cours</span>
          <span className="text-emerald-400">{stats.completed} termine(s)</span>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary text-background rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nouvelle intervention
        </button>
      </div>

      {/* Status filter */}
      <div className="flex items-center gap-1 bg-surface border border-border rounded-xl p-1 w-fit">
        {[
          { key: "all", label: "Tous" },
          { key: "planned", label: "Planifies" },
          { key: "in_progress", label: "En cours" },
          { key: "completed", label: "Termines" },
          { key: "cancelled", label: "Annules" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              statusFilter === tab.key
                ? "bg-primary/15 text-primary"
                : "text-foreground-muted hover:text-foreground hover:bg-surface-elevated"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-surface border border-border rounded-xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 bg-surface border border-border rounded-2xl">
          <ClipboardList className="w-8 h-8 text-foreground-muted/40 mb-2" />
          <p className="text-foreground-muted">Aucune intervention</p>
          <button onClick={openCreate} className="mt-2 text-xs text-primary hover:underline">+ Planifier une intervention</button>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((intervention) => {
            const statusCfg = INTERVENTION_STATUS_CONFIG[intervention.status] ?? INTERVENTION_STATUS_CONFIG.planned;
            return (
              <div key={intervention.id} className="bg-surface border border-border rounded-xl p-4 hover:border-primary/20 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="font-medium text-foreground text-sm">{intervention.title}</h3>
                      <span className={cn("inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[10px] font-semibold", statusCfg.bg, statusCfg.text, statusCfg.border)}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusCfg.dot }} />
                        {statusCfg.label}
                      </span>
                      <span className="px-1.5 py-0.5 bg-surface-elevated text-foreground-muted text-[10px] font-semibold rounded">
                        {INTERVENTION_TYPES.find((t) => t.value === intervention.type)?.label ?? intervention.type}
                      </span>
                    </div>
                    {intervention.description && (
                      <p className="text-xs text-foreground-muted line-clamp-1 mb-1">{intervention.description}</p>
                    )}
                    <div className="flex items-center gap-3 text-[10px] text-foreground-muted flex-wrap">
                      {intervention.station_name && <span>Borne : {intervention.station_name}</span>}
                      {intervention.technician && <span>Tech : {intervention.technician}</span>}
                      {intervention.scheduled_at && (
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(intervention.scheduled_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                      {intervention.duration_minutes && <span>{intervention.duration_minutes} min</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {intervention.status === "planned" && (
                      <button
                        onClick={() => updateMutation.mutate({ id: intervention.id, status: "in_progress" } as any)}
                        className="px-2 py-1 text-[10px] font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg hover:bg-amber-500/20 transition-colors whitespace-nowrap"
                      >
                        Demarrer
                      </button>
                    )}
                    {intervention.status === "in_progress" && (
                      <button
                        onClick={() => setShowReport(intervention)}
                        className="px-2 py-1 text-[10px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg hover:bg-emerald-500/20 transition-colors whitespace-nowrap"
                      >
                        Rapport
                      </button>
                    )}
                    <button
                      onClick={() => openEdit(intervention)}
                      className="p-1.5 text-foreground-muted hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit SlideOver */}
      <SlideOver open={showModal} onClose={closeModal} title={editing ? "Modifier l'intervention" : "Nouvelle intervention"}>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Titre *</label>
            <input required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Remplacement connecteur" className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Description</label>
            <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} className={cn(inputClass, "resize-none")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Type</label>
              <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} className={inputClass}>
                {INTERVENTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Priorite</label>
              <select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as any }))} className={inputClass}>
                <option value="low">Basse</option>
                <option value="medium">Moyenne</option>
                <option value="high">Haute</option>
                <option value="critical">Critique</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Borne (nom)</label>
              <input value={form.station_name} onChange={(e) => setForm((f) => ({ ...f, station_name: e.target.value }))} placeholder="EZD-001" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Technicien</label>
              <input value={form.technician} onChange={(e) => setForm((f) => ({ ...f, technician: e.target.value }))} placeholder="Jean Dupont" className={inputClass} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Date planifiee</label>
            <input type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm((f) => ({ ...f, scheduled_at: e.target.value }))} className={inputClass} />
          </div>
          {editing && (
            <>
              <div>
                <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Rapport</label>
                <textarea value={form.report} onChange={(e) => setForm((f) => ({ ...f, report: e.target.value }))} rows={3} placeholder="Rapport de l'intervention..." className={cn(inputClass, "resize-none")} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Pieces utilisees</label>
                  <input value={form.parts_used} onChange={(e) => setForm((f) => ({ ...f, parts_used: e.target.value }))} placeholder="Connecteur Type 2, cable" className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Duree (min)</label>
                  <input type="number" min={0} value={form.duration_minutes ?? ""} onChange={(e) => setForm((f) => ({ ...f, duration_minutes: e.target.value ? Number(e.target.value) : null }))} className={inputClass} />
                </div>
              </div>
            </>
          )}
          {(createMutation.error || updateMutation.error) && (
            <div className="p-3 bg-red-500/10 border border-red-500/25 rounded-lg text-sm text-red-400">
              {((createMutation.error || updateMutation.error) as Error)?.message}
            </div>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={closeModal} className="px-4 py-2 text-sm text-foreground-muted hover:text-foreground border border-border rounded-xl transition-colors">Annuler</button>
            <button type="submit" disabled={createMutation.isPending || updateMutation.isPending} className="px-5 py-2 bg-primary text-background text-sm font-semibold rounded-xl hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {createMutation.isPending || updateMutation.isPending ? "..." : editing ? "Enregistrer" : "Planifier"}
            </button>
          </div>
        </form>
      </SlideOver>

      {/* Report completion modal */}
      {showReport && (
        <ReportModal
          intervention={showReport}
          onClose={() => setShowReport(null)}
          onSubmit={(report, parts, duration) => {
            updateMutation.mutate({
              id: showReport.id,
              status: "completed",
              report,
              parts_used: parts,
              duration_minutes: duration,
            } as any);
          }}
          isLoading={updateMutation.isPending}
        />
      )}
    </div>
  );
}

function ReportModal({ intervention, onClose, onSubmit, isLoading }: {
  intervention: Intervention;
  onClose: () => void;
  onSubmit: (report: string, parts: string, duration: number | null) => void;
  isLoading: boolean;
}) {
  const [report, setReport] = useState(intervention.report ?? "");
  const [parts, setParts] = useState(intervention.parts_used ?? "");
  const [duration, setDuration] = useState<string>(intervention.duration_minutes?.toString() ?? "");

  const inputClass = "w-full px-3 py-2.5 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50 transition-colors";

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-surface border border-border rounded-2xl w-full max-w-lg shadow-2xl">
          <div className="flex items-center justify-between p-5 border-b border-border">
            <h2 className="font-heading font-bold text-lg">Rapport d'intervention</h2>
            <button onClick={onClose} className="p-1.5 hover:bg-surface-elevated rounded-lg transition-colors">
              <X className="w-5 h-5 text-foreground-muted" />
            </button>
          </div>
          <div className="p-5 space-y-4">
            <div className="bg-surface-elevated border border-border rounded-xl p-3">
              <p className="text-sm font-medium text-foreground">{intervention.title}</p>
              <p className="text-xs text-foreground-muted mt-0.5">{intervention.station_name ?? "Sans borne"} - {intervention.technician ?? "Non assigne"}</p>
            </div>
            <div>
              <label className="block text-xs text-foreground-muted mb-1.5">Rapport *</label>
              <textarea value={report} onChange={(e) => setReport(e.target.value)} rows={4} placeholder="Decrivez les travaux effectues..." className={cn(inputClass, "resize-none")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-foreground-muted mb-1.5">Pieces utilisees</label>
                <input value={parts} onChange={(e) => setParts(e.target.value)} placeholder="Connecteur, cable..." className={inputClass} />
              </div>
              <div>
                <label className="block text-xs text-foreground-muted mb-1.5">Duree (minutes)</label>
                <input type="number" min={0} value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="60" className={inputClass} />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-xl text-sm text-foreground-muted hover:text-foreground transition-colors">Annuler</button>
              <button
                onClick={() => onSubmit(report, parts, duration ? Number(duration) : null)}
                disabled={isLoading || !report.trim()}
                className="flex-1 py-2.5 bg-primary text-background rounded-xl text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                Terminer l'intervention
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ══════════════════════════════════════════════════════════════
// MAIN MONITORING PAGE
// ══════════════════════════════════════════════════════════════

type MonitoringTab = "realtime" | "alerts" | "history" | "maintenance" | "interventions";

const MONITORING_TABS: { key: MonitoringTab; label: string; icon: typeof Activity }[] = [
  { key: "realtime", label: "Temps réel", icon: Activity },
  { key: "alerts", label: "Alertes", icon: Bell },
  { key: "history", label: "Historique", icon: History },
  { key: "maintenance", label: "Maintenance", icon: Wrench },
  { key: "interventions", label: "Interventions", icon: ClipboardList },
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

  // ── Alerts tab ──
  if (activeTab === "alerts") {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-xl font-bold">Monitoring</h1>
          <p className="text-sm text-foreground-muted mt-1">
            Surveillance en temps réel du réseau
          </p>
        </div>
        {tabBar}
        <AlertsTab />
      </div>
    );
  }

  // ── History tab (Story 3) ──
  if (activeTab === "history") {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-xl font-bold">Monitoring</h1>
          <p className="text-sm text-foreground-muted mt-1">
            Historique des alertes envoyées avec filtres
          </p>
        </div>
        {tabBar}
        <AlertHistoryTab />
      </div>
    );
  }

  // ── Maintenance tab ──
  if (activeTab === "maintenance") {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-xl font-bold">Monitoring</h1>
          <p className="text-sm text-foreground-muted mt-1">
            Surveillance en temps réel du réseau
          </p>
        </div>
        {tabBar}
        <MaintenancePage />
      </div>
    );
  }

  // ── Interventions tab (Stories 28-30) ──
  if (activeTab === "interventions") {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-xl font-bold">Monitoring</h1>
          <p className="text-sm text-foreground-muted mt-1">
            Gestion des interventions techniques et rapports
          </p>
        </div>
        {tabBar}
        <InterventionsTab />
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
            Surveillance en temps réel du réseau
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
            Surveillance en temps réel du réseau
          </p>
        </div>
        {tabBar}
        <ErrorState
          message="Impossible de charger les données de monitoring"
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
          Surveillance en temps réel du réseau
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
          label="Chargepoints connectés"
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
                    <th className="text-left font-medium px-4 py-2.5">Connecteur</th>
                    <th className="text-left font-medium px-4 py-2.5">Début</th>
                    <th className="text-right font-medium px-4 py-2.5">Énergie</th>
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
            <p className="text-sm">Aucun chargepoint connecté</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-foreground-muted border-b border-border">
                  <th className="text-left font-medium px-4 py-2.5">Identity</th>
                  <th className="text-left font-medium px-4 py-2.5">Modèle</th>
                  <th className="text-left font-medium px-4 py-2.5">Firmware</th>
                  <th className="text-left font-medium px-4 py-2.5">Dernier heartbeat</th>
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
