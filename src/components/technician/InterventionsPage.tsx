// ============================================================
// EZDrive — Interventions Technicien Page
// CRUD interventions, diagnostics, firmware, KPIs
// ============================================================

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
  Wrench,
  Plus,
  X,
  Loader2,
  Search,
  MapPin,
  Clock,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  Camera,
  Navigation,
} from "lucide-react";

interface Intervention {
  id: string;
  title: string;
  description: string | null;
  category: string;
  priority: string;
  status: string;
  station_id: string | null;
  assigned_to: string | null;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_minutes: number | null;
  actions_performed: string | null;
  resolution_notes: string | null;
  photos: string[] | null;
  created_at: string;
  stations: { name: string; city: string | null; ocpp_identity: string | null; latitude: number | null; longitude: number | null } | null;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: typeof Clock }> = {
  assigned: { label: "Assignée", color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20", icon: AlertCircle },
  in_progress: { label: "En cours", color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20", icon: Clock },
  completed: { label: "Terminée", color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", icon: CheckCircle2 },
  cancelled: { label: "Annulée", color: "text-foreground-muted", bg: "bg-foreground-muted/10 border-foreground-muted/20", icon: X },
};

const CATEGORIES = [
  { value: "maintenance", label: "Maintenance" },
  { value: "repair", label: "Réparation" },
  { value: "installation", label: "Installation" },
  { value: "inspection", label: "Inspection" },
  { value: "firmware", label: "Firmware" },
];

export function InterventionsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [detail, setDetail] = useState<Intervention | null>(null);

  const { data: interventions, isLoading } = useQuery<Intervention[]>({
    queryKey: ["interventions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("interventions")
        .select("*, stations(name, city, ocpp_identity, latitude, longitude)")
        .order("created_at", { ascending: false });
      if (error) return [];
      return (data ?? []) as Intervention[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: { title: string; description: string; station_id: string; category: string; priority: string }) => {
      const { error } = await supabase.from("interventions").insert({
        ...data,
        station_id: data.station_id || null,
        assigned_to: user?.id,
        created_by: user?.id,
        status: "assigned",
      });
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["interventions"] }); setShowCreate(false); },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status, notes }: { id: string; status: string; notes?: string }) => {
      const updates: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
      if (status === "in_progress") updates.started_at = new Date().toISOString();
      if (status === "completed") { updates.completed_at = new Date().toISOString(); if (notes) updates.resolution_notes = notes; }
      const { error } = await supabase.from("interventions").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["interventions"] }); setDetail(null); },
  });

  const filtered = useMemo(() => {
    if (!interventions) return [];
    return interventions.filter((i) => {
      if (statusFilter !== "all" && i.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return i.title.toLowerCase().includes(q) || (i.stations?.name ?? "").toLowerCase().includes(q);
      }
      return true;
    });
  }, [interventions, statusFilter, search]);

  const kpis = useMemo(() => {
    if (!interventions) return { total: 0, assigned: 0, inProgress: 0, completed: 0 };
    return {
      total: interventions.length,
      assigned: interventions.filter((i) => i.status === "assigned").length,
      inProgress: interventions.filter((i) => i.status === "in_progress").length,
      completed: interventions.filter((i) => i.status === "completed").length,
    };
  }, [interventions]);

  const inputClass = "w-full px-3 py-2.5 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50 transition-colors";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-xl font-bold text-foreground">Interventions Technicien</h1>
          <p className="text-sm text-foreground-muted mt-1">Gestion des interventions sur les bornes de recharge</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-4 py-2 bg-primary text-background rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors">
          <Plus className="w-4 h-4" />
          Nouvelle intervention
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total", value: kpis.total, color: "#8892B0" },
          { label: "Assignées", value: kpis.assigned, color: "#3B82F6" },
          { label: "En cours", value: kpis.inProgress, color: "#F59E0B" },
          { label: "Terminées", value: kpis.completed, color: "#10B981" },
        ].map((k) => (
          <div key={k.label} className="bg-surface border border-border rounded-xl p-4 text-center">
            <p className="text-2xl font-bold" style={{ color: k.color }}>{k.value}</p>
            <p className="text-xs text-foreground-muted">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
          <input type="text" placeholder="Rechercher..." value={search} onChange={(e) => setSearch(e.target.value)} className={cn(inputClass, "pl-9")} />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 bg-surface border border-border rounded-xl text-sm">
          <option value="all">Tous</option>
          <option value="assigned">Assignées</option>
          <option value="in_progress">En cours</option>
          <option value="completed">Terminées</option>
        </select>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="h-20 bg-surface border border-border rounded-xl animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 bg-surface border border-border rounded-2xl">
          <Wrench className="w-8 h-8 text-foreground-muted/40 mb-2" />
          <p className="text-foreground-muted">Aucune intervention</p>
          <button onClick={() => setShowCreate(true)} className="mt-2 text-xs text-primary hover:underline">+ Créer une intervention</button>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((intervention) => {
            const cfg = STATUS_CONFIG[intervention.status] ?? STATUS_CONFIG.assigned;
            const StatusIcon = cfg.icon;
            return (
              <div key={intervention.id} onClick={() => setDetail(intervention)} className="bg-surface border border-border rounded-xl p-4 hover:border-primary/20 transition-colors cursor-pointer">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <StatusIcon className={cn("w-4 h-4 shrink-0", cfg.color)} />
                      <h3 className="font-medium text-foreground text-sm truncate">{intervention.title}</h3>
                      <span className={cn("inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border", cfg.bg)}>{cfg.label}</span>
                      <span className={cn("text-[10px] font-semibold", intervention.priority === "critical" ? "text-red-400" : intervention.priority === "high" ? "text-orange-400" : "text-foreground-muted")}>{intervention.priority}</span>
                    </div>
                    {intervention.stations && (
                      <div className="flex items-center gap-1 text-xs text-foreground-muted mt-1">
                        <MapPin className="w-3 h-3" />
                        <span>{intervention.stations.name} — {intervention.stations.city}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="text-[10px] text-foreground-muted bg-surface-elevated px-1.5 py-0.5 rounded">{intervention.category}</span>
                      <span className="text-[10px] text-foreground-muted">
                        {new Date(intervention.created_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {intervention.stations?.latitude && intervention.stations?.longitude && (
                      <a href={`https://www.google.com/maps/dir/?api=1&destination=${intervention.stations.latitude},${intervention.stations.longitude}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="p-2 text-foreground-muted hover:text-primary bg-surface-elevated border border-border rounded-lg transition-colors" title="Naviguer">
                        <Navigation className="w-4 h-4" />
                      </a>
                    )}
                    {intervention.status === "assigned" && (
                      <button onClick={(e) => { e.stopPropagation(); updateStatusMutation.mutate({ id: intervention.id, status: "in_progress" }); }} className="px-2 py-1 text-[10px] font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg hover:bg-amber-500/20 transition-colors whitespace-nowrap">
                        Démarrer
                      </button>
                    )}
                    {intervention.status === "in_progress" && (
                      <button onClick={(e) => { e.stopPropagation(); updateStatusMutation.mutate({ id: intervention.id, status: "completed", notes: "Intervention terminée" }); }} className="px-2 py-1 text-[10px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg hover:bg-emerald-500/20 transition-colors whitespace-nowrap">
                        Terminer
                      </button>
                    )}
                    <ChevronRight className="w-4 h-4 text-foreground-muted" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Modal */}
      {showCreate && <CreateInterventionModal onClose={() => setShowCreate(false)} onSubmit={(d) => createMutation.mutate(d)} isLoading={createMutation.isPending} />}
    </div>
  );
}

// ── Create Modal ───────────────────────────────────────────

function CreateInterventionModal({ onClose, onSubmit, isLoading }: { onClose: () => void; onSubmit: (d: any) => void; isLoading: boolean }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [stationId, setStationId] = useState("");
  const [category, setCategory] = useState("maintenance");
  const [priority, setPriority] = useState("medium");

  const { data: stations } = useQuery({
    queryKey: ["stations-list-tech"],
    queryFn: async () => {
      const { data } = await supabase.from("stations").select("id, name, city").order("name");
      return data ?? [];
    },
  });

  const inputClass = "w-full px-3 py-2.5 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50 transition-colors";

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-surface border border-border rounded-2xl w-full max-w-lg shadow-2xl">
          <div className="flex items-center justify-between p-5 border-b border-border">
            <h2 className="font-heading font-bold text-lg">Nouvelle intervention</h2>
            <button onClick={onClose} className="p-1.5 hover:bg-surface-elevated rounded-lg transition-colors">
              <X className="w-5 h-5 text-foreground-muted" />
            </button>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); if (title.trim()) onSubmit({ title, description, station_id: stationId, category, priority }); }} className="p-5 space-y-4">
            <div>
              <label className="block text-xs text-foreground-muted mb-1.5">Titre *</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Borne en panne — connecteur HS" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-foreground-muted mb-1.5">Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Détails de l'intervention..." rows={3} className={cn(inputClass, "resize-none")} />
            </div>
            <div>
              <label className="block text-xs text-foreground-muted mb-1.5">Station</label>
              <select value={stationId} onChange={(e) => setStationId(e.target.value)} className={inputClass}>
                <option value="">— Sélectionner —</option>
                {(stations ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} — {s.city}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-foreground-muted mb-1.5">Catégorie</label>
                <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
                  {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-foreground-muted mb-1.5">Priorité</label>
                <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inputClass}>
                  <option value="low">Basse</option>
                  <option value="medium">Moyenne</option>
                  <option value="high">Haute</option>
                  <option value="critical">Critique</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-xl text-sm text-foreground-muted hover:text-foreground transition-colors">Annuler</button>
              <button type="submit" disabled={isLoading || !title.trim()} className="flex-1 py-2.5 bg-primary text-background rounded-xl text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                Créer
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
