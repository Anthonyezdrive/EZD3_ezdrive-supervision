// ============================================================
// EZDrive — Support Page
// Tickets, useful links, API documentation
// ============================================================

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
  LifeBuoy,
  Plus,
  X,
  Loader2,
  ExternalLink,
  BookOpen,
  FileText,
  MessageSquare,
  AlertCircle,
  CheckCircle2,
  Clock,
  Search,
  ChevronDown,
  Github,
  Globe,
  Database,
  Server,
  Zap,
  CreditCard,
  Shield,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────

interface Ticket {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  station_id: string | null;
  created_by: string;
  assigned_to: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  created_at: string;
  updated_at: string;
}

type Tab = "tickets" | "links" | "api";

const STATUS_CONFIG: Record<string, { label: string; icon: typeof Clock; color: string; bg: string }> = {
  open: { label: "Ouvert", icon: AlertCircle, color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20" },
  in_progress: { label: "En cours", icon: Clock, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
  resolved: { label: "Résolu", icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
  closed: { label: "Fermé", icon: CheckCircle2, color: "text-foreground-muted", bg: "bg-foreground-muted/10 border-foreground-muted/20" },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  low: { label: "Basse", color: "text-foreground-muted" },
  medium: { label: "Moyenne", color: "text-amber-400" },
  high: { label: "Haute", color: "text-orange-400" },
  critical: { label: "Critique", color: "text-red-400" },
};

const CATEGORIES = [
  { value: "general", label: "Général" },
  { value: "borne", label: "Borne / Station" },
  { value: "facturation", label: "Facturation" },
  { value: "ocpp", label: "OCPP" },
  { value: "ocpi", label: "OCPI / Roaming" },
  { value: "app", label: "Application mobile" },
  { value: "api", label: "API / Intégration" },
  { value: "autre", label: "Autre" },
];

// ── Useful Links ───────────────────────────────────────────

const USEFUL_LINKS = [
  {
    category: "Plateforme",
    links: [
      { label: "EZDrive Supervision", url: "https://pro.ezdrive.fr", icon: Globe, description: "Plateforme de supervision" },
      { label: "Portail B2B", url: "https://pro.ezdrive.fr/b2b/overview", icon: Globe, description: "Portail client B2B" },
      { label: "GitHub Repository", url: "https://github.com/Anthonyezdrive/ezdrive-supervision", icon: Github, description: "Code source" },
    ],
  },
  {
    category: "Infrastructure",
    links: [
      { label: "Supabase Dashboard", url: "https://supabase.com/dashboard/project/phnqtqvwofzrhpuydoom", icon: Database, description: "Base de données & Edge Functions" },
      { label: "Vercel Dashboard", url: "https://vercel.com", icon: Server, description: "Déploiement frontend" },
      { label: "Fly.io (OCPP)", url: "https://fly.io/apps/ezdrive-ocpp", icon: Zap, description: "Serveur OCPP" },
      { label: "Stripe Dashboard", url: "https://dashboard.stripe.com", icon: CreditCard, description: "Paiements" },
    ],
  },
  {
    category: "Partenaires",
    links: [
      { label: "GreenFlux API", url: "https://developer.greenflux.com/docs/crm-api", icon: BookOpen, description: "Documentation API GreenFlux" },
      { label: "Road / E-Flux", url: "https://road.io", icon: Globe, description: "Backend Road" },
      { label: "Gireve", url: "https://www.gireve.com", icon: Shield, description: "Interopérabilité OCPI" },
    ],
  },
  {
    category: "Documentation",
    links: [
      { label: "OCPP 1.6-J Specification", url: "https://www.openchargealliance.org/protocols/ocpp-16/", icon: FileText, description: "Protocole de communication bornes" },
      { label: "OCPI 2.2.1 Specification", url: "https://evroaming.org/ocpi-background/", icon: FileText, description: "Protocole de roaming" },
    ],
  },
];

// ── API Endpoints ──────────────────────────────────────────

const API_ENDPOINTS = [
  { method: "GET", path: "/api/admin-stations", description: "Lister les stations (filtre CPO, recherche, pagination)" },
  { method: "POST", path: "/api/admin-stations", description: "Créer une station" },
  { method: "PUT", path: "/api/admin-stations/:id", description: "Modifier une station" },
  { method: "DELETE", path: "/api/admin-stations/:id", description: "Supprimer une station (soft)" },
  { method: "POST", path: "/api/admin-stations/:id/link-chargepoint", description: "Lier un chargepoint à une station" },
  { method: "GET", path: "/api/admin-stations/:id/status-log", description: "Historique des changements de statut" },
  { method: "GET", path: "/api/admin-stations/stats", description: "KPIs stations (total, online, par CPO)" },
  { method: "GET", path: "/api/admin-users", description: "Lister les utilisateurs" },
  { method: "POST", path: "/api/admin-users", description: "Créer un utilisateur" },
  { method: "PUT", path: "/api/admin-users/:id", description: "Modifier un utilisateur" },
  { method: "GET", path: "/api/invoices", description: "Lister les factures" },
  { method: "POST", path: "/api/invoices/generate", description: "Générer des factures depuis CDRs" },
  { method: "GET", path: "/api/roles", description: "Lister les rôles RBAC" },
  { method: "POST", path: "/api/roles", description: "Créer un rôle" },
  { method: "GET", path: "/api/coupons", description: "Lister les coupons" },
  { method: "POST", path: "/api/coupons/validate", description: "Valider un coupon" },
  { method: "GET", path: "/api/energy-mix", description: "Profils mix énergétique" },
  { method: "GET", path: "/api/exceptions", description: "Groupes d'exceptions (whitelist/blacklist)" },
  { method: "POST", path: "/register-consumer/start", description: "Démarrer inscription conducteur" },
  { method: "POST", path: "/register-consumer/verify-phone", description: "Vérifier code téléphone" },
  { method: "POST", path: "/register-consumer/complete", description: "Finaliser inscription" },
  { method: "POST", path: "/register-consumer/setup-payment", description: "Configurer moyen de paiement (CB/SEPA)" },
  { method: "POST", path: "/spot-payment/authorize", description: "Pré-autorisation paiement SPOT (20€)" },
  { method: "POST", path: "/spot-payment/capture", description: "Capturer paiement après charge" },
  { method: "POST", path: "/spot-payment/authorize-sepa", description: "Débit SEPA post-session" },
];

const METHOD_COLORS: Record<string, string> = {
  GET: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  POST: "bg-blue-500/15 text-blue-400 border-blue-500/25",
  PUT: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  DELETE: "bg-red-500/15 text-red-400 border-red-500/25",
};

// ── Component ──────────────────────────────────────────────

export function SupportPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("tickets");
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Fetch tickets
  const { data: tickets, isLoading } = useQuery<Ticket[]>({
    queryKey: ["support-tickets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_tickets")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) { console.warn("Tickets:", error.message); return []; }
      return (data ?? []) as Ticket[];
    },
  });

  // Create ticket
  const createMutation = useMutation({
    mutationFn: async (data: { title: string; description: string; category: string; priority: string; station_id?: string }) => {
      const { error } = await supabase.from("support_tickets").insert({
        ...data,
        created_by: user?.id,
        station_id: data.station_id || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
      setShowCreate(false);
    },
  });

  // Update ticket status
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status, notes }: { id: string; status: string; notes?: string }) => {
      const updates: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
      if (status === "resolved") {
        updates.resolved_at = new Date().toISOString();
        if (notes) updates.resolution_notes = notes;
      }
      const { error } = await supabase.from("support_tickets").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["support-tickets"] }),
  });

  const filtered = useMemo(() => {
    if (!tickets) return [];
    return tickets.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q);
      }
      return true;
    });
  }, [tickets, statusFilter, search]);

  const kpis = useMemo(() => {
    if (!tickets) return { total: 0, open: 0, inProgress: 0, resolved: 0 };
    return {
      total: tickets.length,
      open: tickets.filter((t) => t.status === "open").length,
      inProgress: tickets.filter((t) => t.status === "in_progress").length,
      resolved: tickets.filter((t) => t.status === "resolved" || t.status === "closed").length,
    };
  }, [tickets]);

  const inputClass = "w-full px-3 py-2.5 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50 transition-colors";

  const tabs: { key: Tab; label: string; icon: typeof LifeBuoy }[] = [
    { key: "tickets", label: "Tickets", icon: MessageSquare },
    { key: "links", label: "Liens utiles", icon: ExternalLink },
    { key: "api", label: "Documentation API", icon: BookOpen },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-xl font-bold text-foreground">Support & Ressources</h1>
          <p className="text-sm text-foreground-muted mt-1">Tickets, documentation et liens utiles</p>
        </div>
        {activeTab === "tickets" && (
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-4 py-2 bg-primary text-background rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors">
            <Plus className="w-4 h-4" />
            Nouveau ticket
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={cn(
              "flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors relative",
              activeTab === t.key ? "text-primary" : "text-foreground-muted hover:text-foreground"
            )}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
            {t.key === "tickets" && kpis.open > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold bg-red-500/15 text-red-400 rounded-full">{kpis.open}</span>
            )}
            {activeTab === t.key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />}
          </button>
        ))}
      </div>

      {/* TICKETS TAB */}
      {activeTab === "tickets" && (
        <div className="space-y-4">
          {/* KPIs */}
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-surface border border-border rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-foreground">{kpis.total}</p>
              <p className="text-xs text-foreground-muted">Total</p>
            </div>
            <div className="bg-surface border border-border rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-blue-400">{kpis.open}</p>
              <p className="text-xs text-foreground-muted">Ouverts</p>
            </div>
            <div className="bg-surface border border-border rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-amber-400">{kpis.inProgress}</p>
              <p className="text-xs text-foreground-muted">En cours</p>
            </div>
            <div className="bg-surface border border-border rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-emerald-400">{kpis.resolved}</p>
              <p className="text-xs text-foreground-muted">Résolus</p>
            </div>
          </div>

          {/* Filters */}
          <div className="flex gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
              <input type="text" placeholder="Rechercher un ticket..." value={search} onChange={(e) => setSearch(e.target.value)} className={cn(inputClass, "pl-9")} />
            </div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 bg-surface border border-border rounded-xl text-sm text-foreground">
              <option value="all">Tous les statuts</option>
              <option value="open">Ouverts</option>
              <option value="in_progress">En cours</option>
              <option value="resolved">Résolus</option>
              <option value="closed">Fermés</option>
            </select>
          </div>

          {/* Ticket List */}
          {isLoading ? (
            <div className="space-y-3">{[1,2,3].map((i) => <div key={i} className="h-20 bg-surface border border-border rounded-xl animate-pulse" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 bg-surface border border-border rounded-2xl">
              <LifeBuoy className="w-8 h-8 text-foreground-muted/40 mb-2" />
              <p className="text-foreground-muted">Aucun ticket</p>
              <button onClick={() => setShowCreate(true)} className="mt-2 text-xs text-primary hover:underline">+ Créer un ticket</button>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((ticket) => {
                const statusCfg = STATUS_CONFIG[ticket.status] ?? STATUS_CONFIG.open;
                const priorityCfg = PRIORITY_CONFIG[ticket.priority] ?? PRIORITY_CONFIG.medium;
                const StatusIcon = statusCfg.icon;
                return (
                  <div key={ticket.id} className="bg-surface border border-border rounded-xl p-4 hover:border-primary/20 transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <StatusIcon className={cn("w-4 h-4 shrink-0", statusCfg.color)} />
                          <h3 className="font-medium text-foreground text-sm truncate">{ticket.title}</h3>
                          <span className={cn("inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border", statusCfg.bg)}>
                            {statusCfg.label}
                          </span>
                          <span className={cn("text-[10px] font-semibold", priorityCfg.color)}>
                            {priorityCfg.label}
                          </span>
                        </div>
                        <p className="text-xs text-foreground-muted line-clamp-2">{ticket.description}</p>
                        <div className="flex items-center gap-3 mt-2">
                          <span className="text-[10px] text-foreground-muted bg-surface-elevated px-1.5 py-0.5 rounded">{ticket.category}</span>
                          <span className="text-[10px] text-foreground-muted">
                            {new Date(ticket.created_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </span>
                          {ticket.resolution_notes && (
                            <span className="text-[10px] text-emerald-400">Résolu : {ticket.resolution_notes}</span>
                          )}
                        </div>
                      </div>
                      {ticket.status === "open" && (
                        <button
                          onClick={() => updateStatusMutation.mutate({ id: ticket.id, status: "in_progress" })}
                          className="px-2 py-1 text-[10px] font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg hover:bg-amber-500/20 transition-colors whitespace-nowrap"
                        >
                          Prendre en charge
                        </button>
                      )}
                      {ticket.status === "in_progress" && (
                        <button
                          onClick={() => updateStatusMutation.mutate({ id: ticket.id, status: "resolved", notes: "Résolu" })}
                          className="px-2 py-1 text-[10px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg hover:bg-emerald-500/20 transition-colors whitespace-nowrap"
                        >
                          Marquer résolu
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* LINKS TAB */}
      {activeTab === "links" && (
        <div className="space-y-6">
          {USEFUL_LINKS.map((group) => (
            <div key={group.category}>
              <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-3">{group.category}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {group.links.map((link) => (
                  <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-surface border border-border rounded-xl p-4 hover:border-primary/30 transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <link.icon className="w-4 h-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">{link.label}</p>
                        <p className="text-xs text-foreground-muted truncate">{link.description}</p>
                      </div>
                      <ExternalLink className="w-3.5 h-3.5 text-foreground-muted/40 group-hover:text-primary transition-colors shrink-0" />
                    </div>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* API DOC TAB */}
      {activeTab === "api" && (
        <div className="space-y-4">
          <div className="bg-surface border border-border rounded-xl p-4">
            <p className="text-sm text-foreground-muted">
              Base URL : <code className="text-primary font-mono text-xs bg-primary/10 px-1.5 py-0.5 rounded">https://phnqtqvwofzrhpuydoom.supabase.co/functions/v1</code>
            </p>
            <p className="text-xs text-foreground-muted mt-1">
              Authentification : <code className="font-mono text-xs">Authorization: Bearer &lt;JWT&gt;</code>
            </p>
          </div>

          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-elevated">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-foreground-muted w-20">Méthode</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-foreground-muted">Endpoint</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-foreground-muted">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {API_ENDPOINTS.map((ep, i) => (
                  <tr key={i} className="hover:bg-surface-elevated/50 transition-colors">
                    <td className="px-4 py-2.5">
                      <span className={cn("inline-flex px-2 py-0.5 rounded text-[10px] font-bold border", METHOD_COLORS[ep.method] ?? "")}>
                        {ep.method}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-foreground">{ep.path}</td>
                    <td className="px-4 py-2.5 text-xs text-foreground-muted">{ep.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create Ticket Modal */}
      {showCreate && <CreateTicketModal onClose={() => setShowCreate(false)} onSubmit={(data) => createMutation.mutate(data)} isLoading={createMutation.isPending} error={(createMutation.error as Error | null)?.message ?? null} />}
    </div>
  );
}

// ── Create Ticket Modal ────────────────────────────────────

function CreateTicketModal({ onClose, onSubmit, isLoading, error }: {
  onClose: () => void;
  onSubmit: (data: { title: string; description: string; category: string; priority: string }) => void;
  isLoading: boolean;
  error: string | null;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("general");
  const [priority, setPriority] = useState("medium");

  const inputClass = "w-full px-3 py-2.5 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50 transition-colors";

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-surface border border-border rounded-2xl w-full max-w-lg shadow-2xl">
          <div className="flex items-center justify-between p-5 border-b border-border">
            <h2 className="font-heading font-bold text-lg">Nouveau ticket</h2>
            <button onClick={onClose} className="p-1.5 hover:bg-surface-elevated rounded-lg transition-colors">
              <X className="w-5 h-5 text-foreground-muted" />
            </button>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); if (title.trim() && description.trim()) onSubmit({ title, description, category, priority }); }} className="p-5 space-y-4">
            <div>
              <label className="block text-xs text-foreground-muted mb-1.5">Titre *</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Borne hors ligne depuis 24h" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-foreground-muted mb-1.5">Description *</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Décrivez le problème en détail..." rows={4} className={cn(inputClass, "resize-none")} />
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
            {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-xl text-sm text-foreground-muted hover:text-foreground transition-colors">Annuler</button>
              <button type="submit" disabled={isLoading || !title.trim() || !description.trim()} className="flex-1 py-2.5 bg-primary text-background rounded-xl text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                Créer le ticket
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
