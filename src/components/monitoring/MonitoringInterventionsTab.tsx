import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  X,
  Pencil,
  Loader2,
  ClipboardList,
  Calendar,
  Play,
  Square,
  Timer,
  RefreshCw,
  UserCheck,
  Archive,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useToast } from "@/contexts/ToastContext";
import { SlideOver } from "@/components/ui/SlideOver";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  useInterventions as useInterventionsHook,
  useAvailableTechnicians,
  useCreateIntervention,
  useUpdateIntervention,
  useDeleteIntervention,
  useStartWork,
  useStopWork,
  type Intervention,
} from "@/hooks/useInterventions";

// ── Types ──────────────────────────────────────────────────

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

const RECURRENCE_OPTIONS = [
  { value: "weekly", label: "Hebdomadaire" },
  { value: "monthly", label: "Mensuelle" },
  { value: "quarterly", label: "Trimestrielle" },
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
  assigned_to: "" as string,
  is_recurring: false,
  recurrence_interval: "" as string,
  next_occurrence: "" as string,
};

// ── LiveTimer ──────────────────────────────────────────────

function LiveTimer({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState("");
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    function update() {
      const start = new Date(startedAt).getTime();
      const now = Date.now();
      const diffSec = Math.max(0, Math.floor((now - start) / 1000));
      const h = Math.floor(diffSec / 3600);
      const m = Math.floor((diffSec % 3600) / 60);
      const s = diffSec % 60;
      if (h > 0) {
        setElapsed(`${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`);
      } else if (m > 0) {
        setElapsed(`${m}m ${String(s).padStart(2, "0")}s`);
      } else {
        setElapsed(`${s}s`);
      }
    }
    update();
    intervalRef.current = setInterval(update, 1000);
    return () => clearInterval(intervalRef.current);
  }, [startedAt]);

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-[10px] font-mono text-amber-400">
      <Timer className="w-3 h-3" />
      {elapsed}
    </span>
  );
}

// ── ReportModal ────────────────────────────────────────────

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
            {/* Show elapsed time if started */}
            {(intervention.started_work_at || intervention.started_at) && (
              <div className="flex items-center gap-2 text-xs text-foreground-muted">
                <Timer className="w-3.5 h-3.5" />
                <span>Temps ecoule :</span>
                <LiveTimer startedAt={intervention.started_work_at || intervention.started_at!} />
              </div>
            )}
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

// ── InterventionsTab ───────────────────────────────────────

export default function InterventionsTab() {
  const queryClient = useQueryClient();
  const { success: toastSuccess, error: toastError } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [techFilter, setTechFilter] = useState<string>("all");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Intervention | null>(null);
  const [form, setForm] = useState(EMPTY_INTERVENTION);
  const [showReport, setShowReport] = useState<Intervention | null>(null);
  const [archiveInterventionId, setArchiveInterventionId] = useState<string | null>(null);

  // Data queries
  const { data: interventions, isLoading } = useInterventionsHook();
  const { data: technicians } = useAvailableTechnicians();

  // Mutations from hook
  const createMutation = useCreateIntervention();
  const updateMutation = useUpdateIntervention();
  const startWorkMutation = useStartWork();
  const stopWorkMutation = useStopWork();
  const deleteMutation = useDeleteIntervention();

  // Toast handlers for mutations
  useEffect(() => {
    if (createMutation.isSuccess) {
      toastSuccess("Intervention planifiee", "L'intervention a ete ajoutee");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createMutation.isSuccess]);

  useEffect(() => {
    if (createMutation.isError) {
      toastError("Erreur", (createMutation.error as Error)?.message);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createMutation.isError]);

  useEffect(() => {
    if (updateMutation.isSuccess) {
      toastSuccess("Intervention mise a jour");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateMutation.isSuccess]);

  useEffect(() => {
    if (updateMutation.isError) {
      toastError("Erreur", (updateMutation.error as Error)?.message);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateMutation.isError]);

  useEffect(() => {
    if (startWorkMutation.isSuccess) {
      toastSuccess("Travail demarre", "Le chronometre est lance");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startWorkMutation.isSuccess]);

  useEffect(() => {
    if (startWorkMutation.isError) {
      toastError("Erreur", (startWorkMutation.error as Error)?.message);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startWorkMutation.isError]);

  useEffect(() => {
    if (stopWorkMutation.isSuccess) {
      toastSuccess("Intervention terminee", "Le rapport a ete enregistre");
      setShowReport(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopWorkMutation.isSuccess]);

  useEffect(() => {
    if (stopWorkMutation.isError) {
      toastError("Erreur", (stopWorkMutation.error as Error)?.message);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopWorkMutation.isError]);

  // Legacy update mutation for inline edit form (kept for backward compat)
  const legacyUpdateMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Partial<typeof EMPTY_INTERVENTION & { status: string }>) => {
      const patch: Record<string, unknown> = {};
      if (data.title !== undefined) patch.title = data.title;
      if (data.description !== undefined) patch.description = data.description || null;
      if (data.technician !== undefined) patch.technician = data.technician || null;
      if (data.priority !== undefined) patch.priority = data.priority;
      if (data.type !== undefined) patch.type = data.type;
      if (data.scheduled_at !== undefined) patch.scheduled_at = data.scheduled_at || null;
      if (data.assigned_to !== undefined) patch.assigned_to = data.assigned_to || null;
      if (data.is_recurring !== undefined) {
        patch.is_recurring = data.is_recurring;
        if (!data.is_recurring) {
          patch.recurrence_interval = null;
          patch.next_occurrence = null;
        }
      }
      if (data.recurrence_interval !== undefined) patch.recurrence_interval = data.recurrence_interval || null;
      if (data.next_occurrence !== undefined) patch.next_occurrence = data.next_occurrence || null;
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
      assigned_to: intervention.assigned_to ?? "",
      is_recurring: intervention.is_recurring ?? false,
      recurrence_interval: intervention.recurrence_interval ?? "",
      next_occurrence: intervention.next_occurrence ?? "",
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
      legacyUpdateMutation.mutate({ id: editing.id, ...form } as any);
    } else {
      createMutation.mutate({
        station_id: form.station_id || null,
        station_name: form.station_name || null,
        type: form.type,
        title: form.title,
        description: form.description || null,
        technician: form.technician || null,
        priority: form.priority,
        scheduled_at: form.scheduled_at || null,
        assigned_to: form.assigned_to || null,
        is_recurring: form.is_recurring,
        recurrence_interval: form.recurrence_interval || null,
        next_occurrence: form.next_occurrence || null,
      }, {
        onSuccess: () => closeModal(),
      });
    }
  }

  // Filtering: apply status + technician filter locally
  const filtered = useMemo(() => {
    let list = interventions ?? [];
    if (statusFilter !== "all") {
      list = list.filter((i) => i.status === statusFilter);
    }
    if (techFilter !== "all") {
      list = list.filter((i) =>
        i.assigned_to === techFilter || i.technician === techFilter
      );
    }
    return list;
  }, [interventions, statusFilter, techFilter]);

  const stats = useMemo(() => {
    const list = interventions ?? [];
    return {
      total: list.length,
      planned: list.filter((i) => i.status === "planned").length,
      inProgress: list.filter((i) => i.status === "in_progress").length,
      completed: list.filter((i) => i.status === "completed").length,
    };
  }, [interventions]);

  // Build unique technician list for filter (merge assigned_to profiles + technician text)
  const techFilterOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [];
    const seen = new Set<string>();

    // From profiles (assigned_to)
    if (technicians) {
      for (const t of technicians) {
        if (!seen.has(t.id)) {
          seen.add(t.id);
          options.push({ value: t.id, label: t.full_name || t.email || t.id });
        }
      }
    }

    // From technician text field
    const list = interventions ?? [];
    for (const i of list) {
      if (i.technician && !seen.has(i.technician)) {
        seen.add(i.technician);
        options.push({ value: i.technician, label: i.technician });
      }
    }

    return options.sort((a, b) => a.label.localeCompare(b.label));
  }, [technicians, interventions]);

  // Get technician display name from assigned_to UUID
  function getTechName(assignedTo: string | null): string | null {
    if (!assignedTo || !technicians) return null;
    const t = technicians.find((p) => p.id === assignedTo);
    return t ? (t.full_name || t.email || null) : null;
  }

  // Format completed duration
  function formatCompletedDuration(intervention: Intervention): string | null {
    if (intervention.duration_minutes) {
      const h = Math.floor(intervention.duration_minutes / 60);
      const m = intervention.duration_minutes % 60;
      return h > 0 ? `${h}h ${m}min` : `${m}min`;
    }
    // Calculate from started_at / completed_at
    const start = intervention.started_work_at || intervention.started_at;
    const end = intervention.completed_work_at || intervention.completed_at;
    if (start && end) {
      const diffMs = new Date(end).getTime() - new Date(start).getTime();
      const diffMin = Math.round(diffMs / 60000);
      if (diffMin < 60) return `${diffMin}min`;
      const h = Math.floor(diffMin / 60);
      const m = diffMin % 60;
      return m > 0 ? `${h}h ${m}min` : `${h}h`;
    }
    return null;
  }

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

      {/* Filters bar */}
      <div className="flex items-center gap-3 flex-wrap">
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

        {/* Technician filter */}
        <div className="flex items-center gap-1.5">
          <UserCheck className="w-3.5 h-3.5 text-foreground-muted" />
          <select
            value={techFilter}
            onChange={(e) => setTechFilter(e.target.value)}
            className="px-2.5 py-1.5 bg-surface border border-border rounded-xl text-xs text-foreground focus:outline-none focus:border-primary/50 transition-colors"
          >
            <option value="all">Tous les techniciens</option>
            {techFilterOptions.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
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
            const assignedName = getTechName(intervention.assigned_to);
            const completedDuration = intervention.status === "completed" ? formatCompletedDuration(intervention) : null;
            const timerStart = intervention.started_work_at || intervention.started_at;

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
                      {/* Recurring badge */}
                      {intervention.is_recurring && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-violet-500/10 border border-violet-500/20 text-violet-400 text-[10px] font-semibold rounded-lg">
                          <RefreshCw className="w-2.5 h-2.5" />
                          Recurrente
                        </span>
                      )}
                    </div>
                    {intervention.description && (
                      <p className="text-xs text-foreground-muted line-clamp-1 mb-1">{intervention.description}</p>
                    )}
                    <div className="flex items-center gap-3 text-[10px] text-foreground-muted flex-wrap">
                      {intervention.station_name && <span>Borne : {intervention.station_name}</span>}
                      {(assignedName || intervention.technician) && (
                        <span className="flex items-center gap-1">
                          <UserCheck className="w-2.5 h-2.5" />
                          {assignedName || intervention.technician}
                        </span>
                      )}
                      {intervention.scheduled_at && (
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(intervention.scheduled_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                      {/* Duration display for completed */}
                      {completedDuration && (
                        <span className="flex items-center gap-1 text-emerald-400">
                          <Timer className="w-2.5 h-2.5" />
                          {completedDuration}
                        </span>
                      )}
                      {/* Recurrence info */}
                      {intervention.is_recurring && intervention.recurrence_interval && (
                        <span className="text-violet-400">
                          {RECURRENCE_OPTIONS.find((r) => r.value === intervention.recurrence_interval)?.label ?? intervention.recurrence_interval}
                          {intervention.next_occurrence && ` — prochaine : ${new Date(intervention.next_occurrence).toLocaleDateString("fr-FR")}`}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Start work button */}
                    {intervention.status === "planned" && (
                      <button
                        onClick={() => startWorkMutation.mutate(intervention.id)}
                        disabled={startWorkMutation.isPending}
                        className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg hover:bg-amber-500/20 transition-colors whitespace-nowrap disabled:opacity-50"
                      >
                        <Play className="w-2.5 h-2.5" />
                        Demarrer
                      </button>
                    )}
                    {/* In progress: show timer + stop button */}
                    {intervention.status === "in_progress" && (
                      <>
                        {timerStart && <LiveTimer startedAt={timerStart} />}
                        <button
                          onClick={() => setShowReport(intervention)}
                          className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg hover:bg-emerald-500/20 transition-colors whitespace-nowrap"
                        >
                          <Square className="w-2.5 h-2.5" />
                          Terminer
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => openEdit(intervention)}
                      className="p-1.5 text-foreground-muted hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    {intervention.status !== "cancelled" && (
                      <button
                        onClick={() => setArchiveInterventionId(intervention.id)}
                        className="p-1.5 text-foreground-muted hover:text-amber-400 hover:bg-amber-500/10 rounded-lg transition-colors"
                        title="Archiver"
                      >
                        <Archive className="w-3.5 h-3.5" />
                      </button>
                    )}
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
              <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Technicien (texte)</label>
              <input value={form.technician} onChange={(e) => setForm((f) => ({ ...f, technician: e.target.value }))} placeholder="Jean Dupont" className={inputClass} />
            </div>
          </div>

          {/* Technician assignment dropdown */}
          <div>
            <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Technicien assigne</label>
            <select
              value={form.assigned_to}
              onChange={(e) => {
                const val = e.target.value;
                setForm((f) => ({ ...f, assigned_to: val }));
                // Auto-fill technician text if empty
                if (val && !form.technician) {
                  const profile = technicians?.find((t) => t.id === val);
                  if (profile) {
                    setForm((f) => ({ ...f, assigned_to: val, technician: profile.full_name || profile.email || "" }));
                  }
                }
              }}
              className={inputClass}
            >
              <option value="">-- Aucun --</option>
              {(technicians ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.full_name || t.email || t.id}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Date planifiee</label>
            <input type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm((f) => ({ ...f, scheduled_at: e.target.value }))} className={inputClass} />
          </div>

          {/* Recurring maintenance toggle */}
          <div className="space-y-3 p-3 bg-surface-elevated border border-border rounded-xl">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <div
                className={cn(
                  "relative w-9 h-5 rounded-full transition-colors",
                  form.is_recurring ? "bg-primary" : "bg-border"
                )}
                onClick={() => setForm((f) => ({ ...f, is_recurring: !f.is_recurring }))}
              >
                <div
                  className={cn(
                    "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform",
                    form.is_recurring ? "translate-x-[18px]" : "translate-x-0.5"
                  )}
                />
              </div>
              <span className="text-xs font-semibold text-foreground">Intervention recurrente</span>
              <RefreshCw className={cn("w-3.5 h-3.5 transition-colors", form.is_recurring ? "text-primary" : "text-foreground-muted")} />
            </label>
            {form.is_recurring && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-xs text-foreground-muted mb-1.5">Frequence</label>
                  <select
                    value={form.recurrence_interval}
                    onChange={(e) => setForm((f) => ({ ...f, recurrence_interval: e.target.value }))}
                    className={inputClass}
                  >
                    <option value="">-- Choisir --</option>
                    {RECURRENCE_OPTIONS.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-foreground-muted mb-1.5">Prochaine occurrence</label>
                  <input
                    type="date"
                    value={form.next_occurrence}
                    onChange={(e) => setForm((f) => ({ ...f, next_occurrence: e.target.value }))}
                    className={inputClass}
                  />
                </div>
              </div>
            )}
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
          {(createMutation.error || legacyUpdateMutation.error) && (
            <div className="p-3 bg-red-500/10 border border-red-500/25 rounded-lg text-sm text-red-400">
              {((createMutation.error || legacyUpdateMutation.error) as Error)?.message}
            </div>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={closeModal} className="px-4 py-2 text-sm text-foreground-muted hover:text-foreground border border-border rounded-xl transition-colors">Annuler</button>
            <button type="submit" disabled={createMutation.isPending || legacyUpdateMutation.isPending} className="px-5 py-2 bg-primary text-background text-sm font-semibold rounded-xl hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {createMutation.isPending || legacyUpdateMutation.isPending ? "..." : editing ? "Enregistrer" : "Planifier"}
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
            stopWorkMutation.mutate({
              id: showReport.id,
              report,
              parts_used: parts,
              duration_minutes: duration,
            });
          }}
          isLoading={stopWorkMutation.isPending}
        />
      )}

      {/* Archive Confirm Dialog */}
      <ConfirmDialog
        open={!!archiveInterventionId}
        title="Archiver cette intervention ?"
        description="L'intervention sera marquée comme archivée et ne sera plus visible dans la liste active."
        confirmLabel="Archiver"
        loadingLabel="Archivage..."
        variant="warning"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (archiveInterventionId) {
            deleteMutation.mutate(archiveInterventionId, {
              onSuccess: () => {
                toastSuccess("Intervention archivée");
                setArchiveInterventionId(null);
              },
              onError: (err: Error) => {
                toastError("Erreur", err.message);
                setArchiveInterventionId(null);
              },
            });
          }
        }}
        onCancel={() => setArchiveInterventionId(null)}
      />
    </div>
  );
}
