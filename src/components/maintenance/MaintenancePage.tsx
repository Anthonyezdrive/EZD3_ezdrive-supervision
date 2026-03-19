// ============================================================
// EZDrive — Maintenance Page
// Faulted stations + Ticket management (acknowledge / resolve)
// ============================================================

import { useState, useMemo } from "react";
import {
  AlertTriangle,
  Plus,
  CheckCircle2,
  XCircle,
  Clock,
  Wrench,
  User,
  ChevronDown,
  Loader2,
  X,
  Calendar,
  CalendarPlus,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMaintenanceStations } from "@/hooks/useMaintenanceStations";
import { useCPOs } from "@/hooks/useCPOs";
import { useTerritories } from "@/hooks/useTerritories";
import { useCpo } from "@/contexts/CpoContext";
import { FilterBar } from "@/components/ui/FilterBar";
import { MaintenanceTable } from "./MaintenanceTable";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { DEFAULT_FILTERS, type StationFilters } from "@/types/filters";
import { PageHelp } from "@/components/ui/PageHelp";
import { KPICard } from "@/components/ui/KPICard";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/contexts/ToastContext";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

// ── Types ─────────────────────────────────────────────────────

export interface MaintenanceTicket {
  id: string;
  station_id: string;
  station_name: string | null;
  title: string;
  description: string | null;
  status: "open" | "acknowledged" | "in_progress" | "resolved" | "closed";
  priority: "low" | "medium" | "high" | "critical";
  assigned_to: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

const EMPTY_TICKET_FORM = {
  station_id: "",
  station_name: "",
  title: "",
  description: "",
  priority: "medium" as MaintenanceTicket["priority"],
  assigned_to: "",
};

// ── Status badge ─────────────────────────────────────────────

function TicketStatusBadge({ status }: { status: MaintenanceTicket["status"] }) {
  const config: Record<string, { bg: string; text: string; border: string; dot: string; label: string }> = {
    open:         { bg: "bg-red-500/10",     text: "text-red-400",     border: "border-red-500/25",     dot: "#F87171", label: "Ouvert" },
    acknowledged: { bg: "bg-amber-500/10",   text: "text-amber-400",   border: "border-amber-500/25",   dot: "#FBBF24", label: "Acquitté" },
    in_progress:  { bg: "bg-blue-500/10",    text: "text-blue-400",    border: "border-blue-500/25",    dot: "#60A5FA", label: "En cours" },
    resolved:     { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/25", dot: "#34D399", label: "Résolu" },
    closed:       { bg: "bg-foreground-muted/10", text: "text-foreground-muted", border: "border-border", dot: "#6B7280", label: "Fermé" },
  };
  const c = config[status] ?? config.open;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold", c.bg, c.text, c.border)}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: c.dot }} />
      {c.label}
    </span>
  );
}

// ── Priority badge ────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: MaintenanceTicket["priority"] }) {
  const config: Record<string, { color: string; label: string }> = {
    low:      { color: "#34D399", label: "Basse" },
    medium:   { color: "#FBBF24", label: "Moyenne" },
    high:     { color: "#F97316", label: "Haute" },
    critical: { color: "#EF4444", label: "Critique" },
  };
  const c = config[priority] ?? config.medium;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold" style={{ backgroundColor: `${c.color}15`, color: c.color }}>
      {c.label}
    </span>
  );
}

// ── Main Page ─────────────────────────────────────────────────

export function MaintenancePage() {
  const queryClient = useQueryClient();
  const { success: toastSuccess, error: toastError } = useToast();
  const { selectedCpoId } = useCpo();
  const { data: stations, isLoading, isError, refetch } = useMaintenanceStations(selectedCpoId);
  const { data: cpos } = useCPOs();
  const { data: territories } = useTerritories();
  const [filters, setFilters] = useState<StationFilters>(DEFAULT_FILTERS);
  const [activeTab, setActiveTab] = useState<"faults" | "tickets" | "scheduled">("faults");

  // ── Ticket states ──
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [ticketForm, setTicketForm] = useState(EMPTY_TICKET_FORM);
  const [editingTicket, setEditingTicket] = useState<MaintenanceTicket | null>(null);
  const [confirmClose, setConfirmClose] = useState<MaintenanceTicket | null>(null);
  const [resolveTarget, setResolveTarget] = useState<MaintenanceTicket | null>(null);
  const [resolveNote, setResolveNote] = useState("");
  const [ticketFilter, setTicketFilter] = useState<"all" | "open" | "acknowledged" | "in_progress" | "resolved" | "closed">("all");

  // ── Fault data ──
  const filtered = useMemo(() => {
    if (!stations) return [];
    return stations.filter((s) => {
      if (filters.cpo && s.cpo_code !== filters.cpo) return false;
      if (filters.territory && s.territory_code !== filters.territory) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        return (
          s.name.toLowerCase().includes(q) ||
          s.gfx_id.toLowerCase().includes(q) ||
          (s.address?.toLowerCase().includes(q) ?? false) ||
          (s.city?.toLowerCase().includes(q) ?? false)
        );
      }
      return true;
    });
  }, [stations, filters]);

  const criticalCount = filtered.filter((s) => s.hours_in_fault >= 24).length;

  // ── Tickets query ──
  const { data: tickets, isLoading: ticketsLoading } = useQuery<MaintenanceTicket[]>({
    queryKey: ["maintenance-tickets"],
    retry: false,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("maintenance_tickets")
          .select("*")
          .order("created_at", { ascending: false });
        if (error) { console.warn("[MaintenancePage] tickets:", error.message); return []; }
        return (data ?? []) as MaintenanceTicket[];
      } catch { return []; }
    },
  });

  // ── Ticket KPIs ──
  const ticketStats = useMemo(() => {
    const list = tickets ?? [];
    return {
      total: list.length,
      open: list.filter((t) => t.status === "open").length,
      inProgress: list.filter((t) => t.status === "in_progress" || t.status === "acknowledged").length,
      resolved: list.filter((t) => t.status === "resolved" || t.status === "closed").length,
    };
  }, [tickets]);

  // ── Filtered tickets ──
  const filteredTickets = useMemo(() => {
    const list = tickets ?? [];
    if (ticketFilter === "all") return list;
    return list.filter((t) => t.status === ticketFilter);
  }, [tickets, ticketFilter]);

  // ── Mutations ──
  const createMutation = useMutation({
    mutationFn: async (data: typeof EMPTY_TICKET_FORM) => {
      const { data: result, error } = await supabase.from("maintenance_tickets").insert({
        station_id: data.station_id,
        station_name: data.station_name || null,
        title: data.title,
        description: data.description || null,
        priority: data.priority,
        assigned_to: data.assigned_to || null,
        status: "open",
      }).select().single();
      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-tickets"] });
      setShowCreateModal(false);
      setTicketForm(EMPTY_TICKET_FORM);
      toastSuccess("Ticket créé", "Le ticket de maintenance a été ouvert");
    },
    onError: (err: Error) => toastError("Erreur", err.message),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status, resolution_note }: { id: string; status: MaintenanceTicket["status"]; resolution_note?: string }) => {
      const patch: Record<string, unknown> = { status };
      if (resolution_note !== undefined) patch.resolution_note = resolution_note;
      if (status === "resolved" || status === "closed") patch.resolved_at = new Date().toISOString();
      const { error } = await supabase.from("maintenance_tickets").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-tickets"] });
      setResolveTarget(null);
      setResolveNote("");
      setConfirmClose(null);
      toastSuccess("Ticket mis à jour");
    },
    onError: (err: Error) => toastError("Erreur", err.message),
  });

  const updateAssignMutation = useMutation({
    mutationFn: async ({ id, assigned_to }: { id: string; assigned_to: string }) => {
      const { error } = await supabase.from("maintenance_tickets")
        .update({ assigned_to: assigned_to || null, status: "in_progress" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-tickets"] });
      setEditingTicket(null);
      toastSuccess("Ticket assigné", "Le ticket est maintenant en cours");
    },
    onError: (err: Error) => toastError("Erreur", err.message),
  });

  // ── Scheduled maintenance query ──
  const { data: scheduledTasks, isLoading: scheduledLoading } = useQuery<{
    id: string;
    station_id: string | null;
    station_name: string | null;
    title: string;
    description: string | null;
    scheduled_date: string;
    technician: string | null;
    status: string;
    recurrence: string | null;
    created_at: string;
  }[]>({
    queryKey: ["scheduled-maintenance"],
    retry: false,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("scheduled_maintenance")
          .select("*")
          .order("scheduled_date", { ascending: true });
        if (error) { console.warn("[MaintenancePage] scheduled:", error.message); return []; }
        return data ?? [];
      } catch { return []; }
    },
  });

  // ── Schedule maintenance modal ──
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    station_name: "",
    title: "",
    description: "",
    scheduled_date: "",
    technician: "",
    recurrence: "none",
  });

  const scheduleMutation = useMutation({
    mutationFn: async (data: typeof scheduleForm) => {
      const { error } = await supabase.from("scheduled_maintenance").insert({
        station_name: data.station_name || null,
        title: data.title,
        description: data.description || null,
        scheduled_date: data.scheduled_date || null,
        technician: data.technician || null,
        recurrence: data.recurrence === "none" ? null : data.recurrence,
        status: "planned",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduled-maintenance"] });
      setShowScheduleModal(false);
      setScheduleForm({ station_name: "", title: "", description: "", scheduled_date: "", technician: "", recurrence: "none" });
      toastSuccess("Maintenance planifiee", "La tache de maintenance a ete ajoutee au planning");
    },
    onError: (err: Error) => toastError("Erreur", err.message),
  });

  // ── Quick create from station ──
  function openCreateForStation(stationId: string, stationName: string) {
    setTicketForm({
      ...EMPTY_TICKET_FORM,
      station_id: stationId,
      station_name: stationName,
      title: `Panne — ${stationName}`,
      priority: "high",
    });
    setShowCreateModal(true);
  }

  const TICKET_FILTER_TABS = [
    { key: "all" as const,         label: "Tous" },
    { key: "open" as const,        label: "Ouverts" },
    { key: "acknowledged" as const, label: "Acquittés" },
    { key: "in_progress" as const, label: "En cours" },
    { key: "resolved" as const,    label: "Résolus" },
    { key: "closed" as const,      label: "Fermés" },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="font-heading text-xl font-bold">Maintenance</h1>
          {criticalCount > 0 && (
            <span className="inline-flex items-center gap-1 bg-status-faulted/15 text-status-faulted border border-status-faulted/30 rounded-lg px-2.5 py-1 text-xs font-semibold">
              <AlertTriangle className="w-3.5 h-3.5" />
              {criticalCount} critique{criticalCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isLoading && !isError && activeTab === "faults" && (
            <span className="text-sm text-foreground-muted">
              {filtered.length} borne{filtered.length > 1 ? "s" : ""} en défaut
            </span>
          )}
          <button
            onClick={() => {
              setTicketForm(EMPTY_TICKET_FORM);
              setShowCreateModal(true);
            }}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nouveau ticket
          </button>
        </div>
      </div>

      <PageHelp
        summary="Suivi des interventions de maintenance et des pannes sur vos bornes"
        items={[
          { label: "Tickets", description: "Chaque panne génère un ticket avec la date, la borne concernée et le type d'erreur." },
          { label: "Priorité", description: "Critique = borne hors service, Haute = fonctionnement dégradé, Moyenne = maintenance préventive, Basse = préventif." },
          { label: "Statut ticket", description: "Ouvert → Acquitté → En cours (technicien assigné) → Résolu → Fermé." },
          { label: "Historique", description: "Consultez l'historique complet des interventions par borne ou par période." },
        ]}
        tips={["Exportez les tickets pour les transmettre à votre prestataire de maintenance."]}
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-surface border border-border rounded-xl p-1 w-fit">
        <button
          onClick={() => setActiveTab("faults")}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-colors",
            activeTab === "faults" ? "bg-primary/15 text-primary" : "text-foreground-muted hover:text-foreground hover:bg-surface-elevated"
          )}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          Bornes en défaut ({filtered.length})
        </button>
        <button
          onClick={() => setActiveTab("tickets")}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-colors",
            activeTab === "tickets" ? "bg-primary/15 text-primary" : "text-foreground-muted hover:text-foreground hover:bg-surface-elevated"
          )}
        >
          <Wrench className="w-3.5 h-3.5" />
          Tickets ({tickets?.length ?? 0})
          {ticketStats.open > 0 && (
            <span className="ml-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center font-bold">
              {ticketStats.open > 9 ? "9+" : ticketStats.open}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("scheduled")}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-colors",
            activeTab === "scheduled" ? "bg-primary/15 text-primary" : "text-foreground-muted hover:text-foreground hover:bg-surface-elevated"
          )}
        >
          <Calendar className="w-3.5 h-3.5" />
          Planning ({scheduledTasks?.length ?? 0})
        </button>
      </div>

      {/* ── FAULTS TAB ── */}
      {activeTab === "faults" && (
        <>
          <FilterBar
            filters={filters}
            onFiltersChange={setFilters}
            cpos={cpos ?? []}
            territories={territories ?? []}
            showStatusFilter={false}
          />

          {isLoading ? (
            <TableSkeleton rows={6} />
          ) : isError ? (
            <ErrorState
              message="Impossible de charger les données de maintenance"
              onRetry={() => refetch()}
            />
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 bg-surface border border-border rounded-2xl">
              <div className="w-12 h-12 rounded-xl bg-status-available/15 flex items-center justify-center mb-3">
                <AlertTriangle className="w-6 h-6 text-status-available" />
              </div>
              <p className="text-foreground font-medium">Aucune borne en défaut</p>
              <p className="text-sm text-foreground-muted mt-1">
                Toutes les bornes fonctionnent normalement.
              </p>
            </div>
          ) : (
            <MaintenanceTable stations={filtered} onCreateTicket={openCreateForStation} />
          )}
        </>
      )}

      {/* ── TICKETS TAB ── */}
      {activeTab === "tickets" && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard label="Total tickets" value={ticketStats.total} icon={Wrench} color="#8892B0" />
            <KPICard label="Ouverts" value={ticketStats.open} icon={AlertTriangle} color="#EF4444" />
            <KPICard label="En cours" value={ticketStats.inProgress} icon={Clock} color="#FBBF24" />
            <KPICard label="Résolus" value={ticketStats.resolved} icon={CheckCircle2} color="#34D399" />
          </div>

          {/* Filter tabs */}
          <div className="flex items-center gap-1 bg-surface border border-border rounded-xl p-1 w-fit">
            {TICKET_FILTER_TABS.map((tab) => {
              const count = tab.key === "all" ? (tickets?.length ?? 0) : (tickets ?? []).filter((t) => t.status === tab.key).length;
              return (
                <button
                  key={tab.key}
                  onClick={() => setTicketFilter(tab.key)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                    ticketFilter === tab.key
                      ? "bg-primary/15 text-primary"
                      : "text-foreground-muted hover:text-foreground hover:bg-surface-elevated"
                  )}
                >
                  {tab.label} <span className="opacity-60">{count}</span>
                </button>
              );
            })}
          </div>

          {/* Tickets list */}
          {ticketsLoading ? (
            <TableSkeleton rows={4} />
          ) : filteredTickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 bg-surface border border-border rounded-2xl">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                <Wrench className="w-6 h-6 text-primary" />
              </div>
              <p className="text-foreground font-medium">Aucun ticket</p>
              <p className="text-sm text-foreground-muted mt-1">
                Créez un ticket pour suivre une intervention.
              </p>
              <button
                onClick={() => { setTicketForm(EMPTY_TICKET_FORM); setShowCreateModal(true); }}
                className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary/90 transition-colors"
              >
                <Plus className="w-4 h-4" /> Créer un ticket
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredTickets.map((ticket) => (
                <TicketCard
                  key={ticket.id}
                  ticket={ticket}
                  onAcknowledge={() => updateStatusMutation.mutate({ id: ticket.id, status: "acknowledged" })}
                  onInProgress={() => setEditingTicket(ticket)}
                  onResolve={() => { setResolveTarget(ticket); setResolveNote(""); }}
                  onClose={() => setConfirmClose(ticket)}
                  isUpdating={updateStatusMutation.isPending}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── SCHEDULED TAB ── */}
      {activeTab === "scheduled" && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-foreground-muted">
              {scheduledTasks?.length ?? 0} maintenance(s) planifiee(s)
            </p>
            <button
              onClick={() => setShowScheduleModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              <CalendarPlus className="w-4 h-4" />
              Planifier maintenance
            </button>
          </div>

          {scheduledLoading ? (
            <TableSkeleton rows={3} />
          ) : (scheduledTasks ?? []).length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 bg-surface border border-border rounded-2xl">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                <Calendar className="w-6 h-6 text-primary" />
              </div>
              <p className="text-foreground font-medium">Aucune maintenance planifiee</p>
              <p className="text-sm text-foreground-muted mt-1">
                Planifiez vos maintenances preventives pour anticiper les pannes.
              </p>
              <button
                onClick={() => setShowScheduleModal(true)}
                className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary/90 transition-colors"
              >
                <CalendarPlus className="w-4 h-4" /> Planifier
              </button>
            </div>
          ) : (
            <div className="bg-surface border border-border rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-foreground-muted border-b border-border bg-surface-elevated">
                      <th className="text-left font-medium px-4 py-3">Titre</th>
                      <th className="text-left font-medium px-4 py-3">Borne</th>
                      <th className="text-left font-medium px-4 py-3">Technicien</th>
                      <th className="text-left font-medium px-4 py-3">Date planifiee</th>
                      <th className="text-left font-medium px-4 py-3">Recurrence</th>
                      <th className="text-left font-medium px-4 py-3">Statut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {(scheduledTasks ?? []).map((task) => (
                      <tr key={task.id} className="hover:bg-surface-elevated/50 transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-medium text-foreground">{task.title}</p>
                          {task.description && <p className="text-xs text-foreground-muted line-clamp-1">{task.description}</p>}
                        </td>
                        <td className="px-4 py-3 text-foreground-muted text-xs">{task.station_name ?? "--"}</td>
                        <td className="px-4 py-3 text-foreground-muted text-xs">{task.technician ?? "--"}</td>
                        <td className="px-4 py-3 text-foreground-muted text-xs">
                          {task.scheduled_date
                            ? new Date(task.scheduled_date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
                            : "--"}
                        </td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 bg-surface-elevated text-foreground-muted text-[10px] font-semibold rounded">
                            {task.recurrence ?? "Ponctuel"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn(
                            "inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[10px] font-semibold",
                            task.status === "planned" ? "bg-blue-500/10 text-blue-400 border-blue-500/25" :
                            task.status === "completed" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25" :
                            "bg-foreground-muted/10 text-foreground-muted border-border"
                          )}>
                            {task.status === "planned" ? "Planifie" : task.status === "completed" ? "Termine" : task.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Schedule Maintenance Modal ── */}
      {showScheduleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-surface border border-border rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="font-semibold text-foreground">Planifier une maintenance</h2>
              <button onClick={() => setShowScheduleModal(false)} className="text-foreground-muted hover:text-foreground transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!scheduleForm.title.trim()) return;
                scheduleMutation.mutate(scheduleForm);
              }}
              className="p-6 space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Titre *</label>
                <input
                  required
                  value={scheduleForm.title}
                  onChange={(e) => setScheduleForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Maintenance preventive trimestrielle"
                  className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Description</label>
                <textarea
                  value={scheduleForm.description}
                  onChange={(e) => setScheduleForm((f) => ({ ...f, description: e.target.value }))}
                  rows={2}
                  className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50 transition-colors resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Borne</label>
                  <input
                    value={scheduleForm.station_name}
                    onChange={(e) => setScheduleForm((f) => ({ ...f, station_name: e.target.value }))}
                    placeholder="EZD-001"
                    className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Technicien</label>
                  <input
                    value={scheduleForm.technician}
                    onChange={(e) => setScheduleForm((f) => ({ ...f, technician: e.target.value }))}
                    placeholder="Jean Dupont"
                    className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50 transition-colors"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Date et heure *</label>
                  <input
                    type="datetime-local"
                    required
                    value={scheduleForm.scheduled_date}
                    onChange={(e) => setScheduleForm((f) => ({ ...f, scheduled_date: e.target.value }))}
                    className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Recurrence</label>
                  <select
                    value={scheduleForm.recurrence}
                    onChange={(e) => setScheduleForm((f) => ({ ...f, recurrence: e.target.value }))}
                    className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors"
                  >
                    <option value="none">Ponctuel</option>
                    <option value="weekly">Hebdomadaire</option>
                    <option value="monthly">Mensuel</option>
                    <option value="quarterly">Trimestriel</option>
                    <option value="yearly">Annuel</option>
                  </select>
                </div>
              </div>
              {scheduleMutation.error && (
                <div className="p-3 bg-red-500/10 border border-red-500/25 rounded-lg text-sm text-red-400">
                  {(scheduleMutation.error as Error)?.message}
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowScheduleModal(false)} className="flex-1 py-2.5 border border-border rounded-xl text-sm text-foreground-muted hover:text-foreground transition-colors">
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={scheduleMutation.isPending || !scheduleForm.title.trim()}
                  className="flex-1 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                  {scheduleMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  Planifier
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Create Ticket Modal ── */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-surface border border-border rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="font-semibold text-foreground">Nouveau ticket de maintenance</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-foreground-muted hover:text-foreground transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createMutation.mutate(ticketForm);
              }}
              className="p-6 space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Titre du ticket *</label>
                <input
                  required
                  value={ticketForm.title}
                  onChange={(e) => setTicketForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Ex: Borne hors service — Connecteur 1 défaillant"
                  className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Borne concernée</label>
                <input
                  value={ticketForm.station_name}
                  onChange={(e) => setTicketForm((f) => ({ ...f, station_name: e.target.value }))}
                  placeholder="Nom de la borne (optionnel si ID connu)"
                  className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50"
                />
              </div>
              {!ticketForm.station_id && (
                <div>
                  <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Station ID (UUID)</label>
                  <StationIdSelector
                    value={ticketForm.station_id}
                    onChange={(id, name) => setTicketForm((f) => ({ ...f, station_id: id, station_name: name }))}
                    faultedStations={(stations ?? []).map((s) => ({ id: s.id, name: s.name }))}
                  />
                </div>
              )}
              {ticketForm.station_id && (
                <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 border border-primary/25 rounded-lg text-xs text-primary">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  Borne liée : {ticketForm.station_name || ticketForm.station_id.slice(0, 8)}
                  <button
                    type="button"
                    onClick={() => setTicketForm((f) => ({ ...f, station_id: "", station_name: "" }))}
                    className="ml-auto text-primary/60 hover:text-primary"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Priorité *</label>
                  <select
                    value={ticketForm.priority}
                    onChange={(e) => setTicketForm((f) => ({ ...f, priority: e.target.value as MaintenanceTicket["priority"] }))}
                    className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary/50"
                  >
                    <option value="low">Basse</option>
                    <option value="medium">Moyenne</option>
                    <option value="high">Haute</option>
                    <option value="critical">Critique</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Assigné à</label>
                  <input
                    value={ticketForm.assigned_to}
                    onChange={(e) => setTicketForm((f) => ({ ...f, assigned_to: e.target.value }))}
                    placeholder="Technicien responsable"
                    className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Description</label>
                <textarea
                  value={ticketForm.description}
                  onChange={(e) => setTicketForm((f) => ({ ...f, description: e.target.value }))}
                  rows={3}
                  placeholder="Détail de la panne, symptômes observés..."
                  className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50 resize-none"
                />
              </div>
              {createMutation.error && (
                <div className="p-3 bg-red-500/10 border border-red-500/25 rounded-lg text-sm text-red-400">
                  {(createMutation.error as Error).message}
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowCreateModal(false)} className="px-4 py-2 text-sm text-foreground-muted hover:text-foreground border border-border rounded-xl transition-colors">
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || !ticketForm.title}
                  className="flex items-center gap-2 px-5 py-2 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  Créer le ticket
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Assign / In Progress Modal ── */}
      {editingTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-surface border border-border rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="font-semibold text-foreground">Assigner le ticket</h2>
              <button onClick={() => setEditingTicket(null)} className="text-foreground-muted hover:text-foreground transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-foreground-muted">{editingTicket.title}</p>
              <div>
                <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Technicien assigné</label>
                <input
                  autoFocus
                  defaultValue={editingTicket.assigned_to ?? ""}
                  id="assign-input"
                  placeholder="Nom du technicien"
                  className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setEditingTicket(null)} className="px-4 py-2 text-sm text-foreground-muted hover:text-foreground border border-border rounded-xl transition-colors">
                  Annuler
                </button>
                <button
                  onClick={() => {
                    const val = (document.getElementById("assign-input") as HTMLInputElement)?.value ?? "";
                    updateAssignMutation.mutate({ id: editingTicket.id, assigned_to: val });
                  }}
                  disabled={updateAssignMutation.isPending}
                  className="flex items-center gap-2 px-5 py-2 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {updateAssignMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  Assigner
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Resolve Modal ── */}
      {resolveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-surface border border-border rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="font-semibold text-foreground">Résoudre le ticket</h2>
              <button onClick={() => setResolveTarget(null)} className="text-foreground-muted hover:text-foreground transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-foreground-muted">{resolveTarget.title}</p>
              <div>
                <label className="block text-xs font-semibold text-foreground-muted mb-1.5">Note de résolution</label>
                <textarea
                  value={resolveNote}
                  onChange={(e) => setResolveNote(e.target.value)}
                  rows={3}
                  placeholder="Décrivez la résolution..."
                  className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50 resize-none"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setResolveTarget(null)} className="px-4 py-2 text-sm text-foreground-muted hover:text-foreground border border-border rounded-xl transition-colors">
                  Annuler
                </button>
                <button
                  onClick={() => updateStatusMutation.mutate({ id: resolveTarget.id, status: "resolved", resolution_note: resolveNote })}
                  disabled={updateStatusMutation.isPending}
                  className="flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                >
                  {updateStatusMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  Marquer résolu
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm Close ── */}
      <ConfirmDialog
        open={!!confirmClose}
        onCancel={() => setConfirmClose(null)}
        onConfirm={() => confirmClose && updateStatusMutation.mutate({ id: confirmClose.id, status: "closed" })}
        title="Fermer ce ticket ?"
        description="Le ticket sera marqué comme fermé. Cette action peut être annulée en le réouvrant."
        confirmLabel="Fermer le ticket"
        variant="danger"
        loading={updateStatusMutation.isPending}
      />
    </div>
  );
}

// ── Station ID Selector (from faulted list) ───────────────────

function StationIdSelector({
  value,
  onChange,
  faultedStations,
}: {
  value: string;
  onChange: (id: string, name: string) => void;
  faultedStations: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors"
      >
        <span className={value ? "text-foreground" : "text-foreground-muted/50"}>
          {value ? faultedStations.find((s) => s.id === value)?.name ?? value.slice(0, 8) : "Sélectionner une borne en défaut..."}
        </span>
        <ChevronDown className="w-4 h-4 text-foreground-muted" />
      </button>
      {open && (
        <div className="absolute z-30 top-full mt-1 w-full bg-surface-elevated border border-border rounded-xl shadow-xl max-h-48 overflow-y-auto">
          {faultedStations.length === 0 ? (
            <div className="px-3 py-4 text-xs text-foreground-muted text-center">Aucune borne en défaut détectée</div>
          ) : (
            faultedStations.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => { onChange(s.id, s.name); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-primary/10 transition-colors"
              >
                {s.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Ticket Card ───────────────────────────────────────────────

function TicketCard({
  ticket,
  onAcknowledge,
  onInProgress,
  onResolve,
  onClose,
  isUpdating,
}: {
  ticket: MaintenanceTicket;
  onAcknowledge: () => void;
  onInProgress: () => void;
  onResolve: () => void;
  onClose: () => void;
  isUpdating: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left p-5 flex items-center gap-4 hover:bg-surface-elevated/30 transition-colors"
      >
        <div className={cn(
          "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
          ticket.priority === "critical" ? "bg-red-500/10" :
          ticket.priority === "high" ? "bg-orange-500/10" :
          ticket.priority === "medium" ? "bg-amber-500/10" : "bg-emerald-500/10"
        )}>
          <Wrench className={cn("w-5 h-5",
            ticket.priority === "critical" ? "text-red-400" :
            ticket.priority === "high" ? "text-orange-400" :
            ticket.priority === "medium" ? "text-amber-400" : "text-emerald-400"
          )} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">{ticket.title}</span>
            <TicketStatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            {ticket.station_name && (
              <span className="text-xs text-foreground-muted">{ticket.station_name}</span>
            )}
            {ticket.assigned_to && (
              <span className="inline-flex items-center gap-1 text-xs text-foreground-muted">
                <User className="w-3 h-3" />
                {ticket.assigned_to}
              </span>
            )}
            <span className="text-xs text-foreground-muted">{formatDate(ticket.created_at)}</span>
          </div>
        </div>
        <ChevronDown className={cn("w-4 h-4 text-foreground-muted shrink-0 transition-transform", expanded && "rotate-180")} />
      </button>

      {expanded && (
        <div className="border-t border-border px-5 py-4 space-y-3">
          {ticket.description && (
            <p className="text-sm text-foreground-muted">{ticket.description}</p>
          )}
          {ticket.resolution_note && (
            <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg">
              <p className="text-xs font-semibold text-emerald-400 mb-1">Note de résolution</p>
              <p className="text-sm text-foreground">{ticket.resolution_note}</p>
            </div>
          )}
          {ticket.resolved_at && (
            <p className="text-xs text-foreground-muted flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              Résolu le {formatDate(ticket.resolved_at)}
            </p>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2 border-t border-border flex-wrap">
            {ticket.status === "open" && (
              <button
                onClick={onAcknowledge}
                disabled={isUpdating}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded-lg hover:bg-amber-500/15 disabled:opacity-50 transition-colors"
              >
                <Clock className="w-3 h-3" />
                Acquitter
              </button>
            )}
            {(ticket.status === "open" || ticket.status === "acknowledged") && (
              <button
                onClick={onInProgress}
                disabled={isUpdating}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-400 bg-blue-500/10 border border-blue-500/25 rounded-lg hover:bg-blue-500/15 disabled:opacity-50 transition-colors"
              >
                <User className="w-3 h-3" />
                Assigner / En cours
              </button>
            )}
            {(ticket.status !== "resolved" && ticket.status !== "closed") && (
              <button
                onClick={onResolve}
                disabled={isUpdating}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 rounded-lg hover:bg-emerald-500/15 disabled:opacity-50 transition-colors"
              >
                <CheckCircle2 className="w-3 h-3" />
                Résoudre
              </button>
            )}
            {ticket.status === "resolved" && (
              <button
                onClick={onClose}
                disabled={isUpdating}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-foreground-muted bg-surface-elevated border border-border rounded-lg hover:text-foreground disabled:opacity-50 transition-colors"
              >
                <XCircle className="w-3 h-3" />
                Fermer
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
