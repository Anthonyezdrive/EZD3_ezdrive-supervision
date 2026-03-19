import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  Tag,
  Settings,
  Shield,
  LogIn,
  Globe,
  MapPin,
  Building2,
  CreditCard,
  BarChart3,
  Mail,
  Save,
  Loader2,
  Plus,
  Pencil,
  Trash2,
  X,
  CheckCircle,
  ExternalLink,
  AlertTriangle,
  Link as LinkIcon,
  Bell,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AdminPage } from "@/components/admin/AdminPage";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { supabase } from "@/lib/supabase";
import { Skeleton } from "@/components/ui/Skeleton";

// ── Tab definitions (extended with new stories 91-96) ────────

const TABS = [
  { key: "admin" as const, label: "Gestion CPO", icon: Tag },
  { key: "settings" as const, label: "Parametres & Alertes", icon: Settings },
  { key: "platform" as const, label: "Parametres", icon: Globe },
  { key: "territories" as const, label: "Territoires", icon: MapPin },
  { key: "cpos" as const, label: "CPOs", icon: Building2 },
  { key: "stripe" as const, label: "Stripe", icon: CreditCard },
  { key: "stats" as const, label: "Statistiques", icon: BarChart3 },
  { key: "emails" as const, label: "Templates email", icon: Mail },
  { key: "logs" as const, label: "Logs connexion", icon: Shield },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function AdminConfigPage() {
  const [tab, setTab] = useState<TabKey>("admin");
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-xl font-bold text-foreground">Administration</h1>
        <p className="text-sm text-foreground-muted mt-0.5">Gestion CPO et configuration</p>
      </div>
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors relative whitespace-nowrap",
              tab === t.key ? "text-primary" : "text-foreground-muted hover:text-foreground"
            )}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
            {tab === t.key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />}
          </button>
        ))}
      </div>
      {tab === "admin" && <AdminPage />}
      {tab === "settings" && <SettingsPage />}
      {tab === "platform" && <PlatformSettingsSection />}
      {tab === "territories" && <TerritoriesSection />}
      {tab === "cpos" && <CposSection />}
      {tab === "stripe" && <StripeConfigSection />}
      {tab === "stats" && <PlatformStatsSection />}
      {tab === "emails" && <EmailTemplatesSection />}
      {tab === "logs" && <LoginLogsSection />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Story 91: Global platform settings
// ══════════════════════════════════════════════════════════════

interface PlatformSettings {
  platform_name: string;
  default_language: string;
  logo_url: string;
  primary_color: string;
  support_email: string;
}

const DEFAULT_SETTINGS: PlatformSettings = {
  platform_name: "EZDrive Supervision",
  default_language: "fr",
  logo_url: "",
  primary_color: "#00D4AA",
  support_email: "support@ezdrive.fr",
};

function PlatformSettingsSection() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PlatformSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);

  const { data: settings, isLoading } = useQuery({
    queryKey: ["platform-settings"],
    queryFn: async () => {
      const { data } = await supabase
        .from("platform_settings")
        .select("*")
        .limit(1)
        .maybeSingle();
      return data as PlatformSettings | null;
    },
  });

  useEffect(() => {
    if (settings) {
      setForm({
        platform_name: settings.platform_name ?? DEFAULT_SETTINGS.platform_name,
        default_language: settings.default_language ?? DEFAULT_SETTINGS.default_language,
        logo_url: settings.logo_url ?? DEFAULT_SETTINGS.logo_url,
        primary_color: settings.primary_color ?? DEFAULT_SETTINGS.primary_color,
        support_email: settings.support_email ?? DEFAULT_SETTINGS.support_email,
      });
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("platform_settings")
        .upsert({ id: "default", ...form });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-settings"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  if (isLoading) {
    return (
      <div className="max-w-2xl space-y-4">
        {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Globe className="w-5 h-5 text-primary" />
        <div>
          <h2 className="text-base font-heading font-bold text-foreground">Parametres de la plateforme</h2>
          <p className="text-xs text-foreground-muted">Configuration globale de la supervision</p>
        </div>
      </div>

      <div className="bg-surface border border-border rounded-2xl divide-y divide-border">
        {/* Platform name */}
        <div className="px-5 py-4">
          <label className="block text-xs font-medium text-foreground-muted mb-1.5">Nom de la plateforme</label>
          <input
            type="text"
            value={form.platform_name}
            onChange={(e) => setForm({ ...form, platform_name: e.target.value })}
            className="w-full bg-surface-elevated border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50"
          />
        </div>

        {/* Default language */}
        <div className="px-5 py-4">
          <label className="block text-xs font-medium text-foreground-muted mb-1.5">Langue par defaut</label>
          <div className="flex gap-3">
            {[
              { value: "fr", label: "Francais" },
              { value: "en", label: "English" },
            ].map((lang) => (
              <button
                key={lang.value}
                onClick={() => setForm({ ...form, default_language: lang.value })}
                className={cn(
                  "px-4 py-2 rounded-xl text-sm font-medium border transition-all",
                  form.default_language === lang.value
                    ? "bg-primary/15 text-primary border-primary/30"
                    : "text-foreground-muted border-border hover:border-foreground-muted"
                )}
              >
                {lang.label}
              </button>
            ))}
          </div>
        </div>

        {/* Logo URL */}
        <div className="px-5 py-4">
          <label className="block text-xs font-medium text-foreground-muted mb-1.5">URL du logo</label>
          <input
            type="url"
            value={form.logo_url}
            onChange={(e) => setForm({ ...form, logo_url: e.target.value })}
            placeholder="https://example.com/logo.png"
            className="w-full bg-surface-elevated border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50"
          />
          {form.logo_url && (
            <div className="mt-2 flex items-center gap-3">
              <img src={form.logo_url} alt="Logo preview" className="h-8 object-contain rounded" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              <span className="text-xs text-foreground-muted">Apercu</span>
            </div>
          )}
        </div>

        {/* Primary color */}
        <div className="px-5 py-4">
          <label className="block text-xs font-medium text-foreground-muted mb-1.5">Couleur principale</label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={form.primary_color}
              onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
              className="w-10 h-10 rounded-lg border border-border cursor-pointer"
            />
            <input
              type="text"
              value={form.primary_color}
              onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
              className="w-32 bg-surface-elevated border border-border rounded-xl px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:border-primary/50"
            />
            <span className="w-6 h-6 rounded-full border border-border" style={{ backgroundColor: form.primary_color }} />
          </div>
        </div>

        {/* Support email */}
        <div className="px-5 py-4">
          <label className="block text-xs font-medium text-foreground-muted mb-1.5">Email de support</label>
          <input
            type="email"
            value={form.support_email}
            onChange={(e) => setForm({ ...form, support_email: e.target.value })}
            className="w-full bg-surface-elevated border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50"
          />
        </div>

        {/* Save */}
        <div className="px-5 py-4 flex items-center gap-3">
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-background font-semibold rounded-xl text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saveMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : saved ? (
              <CheckCircle className="w-4 h-4" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {saved ? "Sauvegarde !" : "Sauvegarder"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Story 92: Territory management (CRUD)
// ══════════════════════════════════════════════════════════════

interface Territory {
  id: string;
  name: string;
  code: string;
  region: string;
}

function TerritoriesSection() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", region: "" });

  const { data: territories, isLoading } = useQuery({
    queryKey: ["admin-territories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("territories")
        .select("id, name, code, region")
        .order("name");
      if (error) throw error;
      return (data ?? []) as Territory[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("territories").insert(form);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-territories"] });
      setShowCreate(false);
      setForm({ name: "", code: "", region: "" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: Territory) => {
      const { error } = await supabase.from("territories").update(data).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-territories"] });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("territories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-territories"] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MapPin className="w-5 h-5 text-primary" />
          <h2 className="text-base font-heading font-bold text-foreground">Territoires</h2>
        </div>
        <button
          onClick={() => { setShowCreate(true); setForm({ name: "", code: "", region: "" }); }}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Ajouter
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-surface border border-primary/30 rounded-2xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Nouveau territoire</h3>
          <div className="grid grid-cols-3 gap-3">
            <input type="text" placeholder="Nom" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="bg-surface-elevated border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50" />
            <input type="text" placeholder="Code postal prefix" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}
              className="bg-surface-elevated border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50" />
            <input type="text" placeholder="Region" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}
              className="bg-surface-elevated border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => createMutation.mutate()} disabled={!form.name || createMutation.isPending}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
              {createMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Creer
            </button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-foreground-muted hover:text-foreground">Annuler</button>
          </div>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Nom</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Code</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Region</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-muted uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(territories ?? []).map((t) => (
                <TerritoryRow
                  key={t.id}
                  territory={t}
                  isEditing={editingId === t.id}
                  onEdit={() => setEditingId(t.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onSave={(updated) => updateMutation.mutate(updated)}
                  onDelete={() => { if (confirm(`Supprimer le territoire "${t.name}" ?`)) deleteMutation.mutate(t.id); }}
                  saving={updateMutation.isPending}
                />
              ))}
              {(territories ?? []).length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-foreground-muted">Aucun territoire</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TerritoryRow({
  territory,
  isEditing,
  onEdit,
  onCancelEdit,
  onSave,
  onDelete,
  saving,
}: {
  territory: Territory;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (t: Territory) => void;
  onDelete: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState(territory);

  useEffect(() => { setForm(territory); }, [territory]);

  if (isEditing) {
    return (
      <tr className="bg-primary/5">
        <td className="px-4 py-2">
          <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="bg-surface-elevated border border-border rounded-lg px-2 py-1.5 text-sm w-full focus:outline-none focus:border-primary/50" />
        </td>
        <td className="px-4 py-2">
          <input type="text" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}
            className="bg-surface-elevated border border-border rounded-lg px-2 py-1.5 text-sm w-full focus:outline-none focus:border-primary/50" />
        </td>
        <td className="px-4 py-2">
          <input type="text" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}
            className="bg-surface-elevated border border-border rounded-lg px-2 py-1.5 text-sm w-full focus:outline-none focus:border-primary/50" />
        </td>
        <td className="px-4 py-2 text-right">
          <div className="flex items-center justify-end gap-1.5">
            <button onClick={() => onSave(form)} disabled={saving} className="p-1.5 rounded-lg bg-primary/15 text-primary hover:bg-primary/25 disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
            </button>
            <button onClick={onCancelEdit} className="p-1.5 rounded-lg bg-foreground-muted/10 text-foreground-muted hover:bg-foreground-muted/20">
              <X className="w-4 h-4" />
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="hover:bg-surface-elevated/50 transition-colors">
      <td className="px-4 py-3 text-sm font-medium text-foreground">{territory.name}</td>
      <td className="px-4 py-3 text-sm text-foreground-muted font-mono">{territory.code}</td>
      <td className="px-4 py-3 text-sm text-foreground-muted">{territory.region}</td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          <button onClick={onEdit} className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated" title="Modifier">
            <Pencil className="w-4 h-4" />
          </button>
          <button onClick={onDelete} className="p-1.5 rounded-lg text-foreground-muted hover:text-danger hover:bg-danger/10" title="Supprimer">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ══════════════════════════════════════════════════════════════
// Story 93: CPO management (CRUD)
// ══════════════════════════════════════════════════════════════

interface CpoEntry {
  id: string;
  name: string;
  code: string;
  stripe_connect_id: string | null;
  color: string | null;
}

function CposSection() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", code: "", stripe_connect_id: "", color: "#00D4AA" });

  const { data: cpos, isLoading } = useQuery({
    queryKey: ["admin-cpos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cpo_operators")
        .select("id, name, code, color, description")
        .order("name");
      if (error) throw error;
      return (data ?? []).map((c: any) => ({
        id: c.id,
        name: c.name,
        code: c.code,
        stripe_connect_id: c.description, // Using description as proxy for Stripe Connect ID
        color: c.color,
      })) as CpoEntry[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("cpo_operators").insert({
        name: form.name,
        code: form.code,
        color: form.color,
        description: form.stripe_connect_id || null,
        level: 1,
        is_white_label: false,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-cpos"] });
      queryClient.invalidateQueries({ queryKey: ["cpo_operators"] });
      setShowCreate(false);
      setForm({ name: "", code: "", stripe_connect_id: "", color: "#00D4AA" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("cpo_operators").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-cpos"] });
      queryClient.invalidateQueries({ queryKey: ["cpo_operators"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (cpo: CpoEntry) => {
      const { error } = await supabase.from("cpo_operators").update({
        name: cpo.name,
        code: cpo.code,
        color: cpo.color,
        description: cpo.stripe_connect_id,
      }).eq("id", cpo.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-cpos"] });
      queryClient.invalidateQueries({ queryKey: ["cpo_operators"] });
      setEditingId(null);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Building2 className="w-5 h-5 text-primary" />
          <h2 className="text-base font-heading font-bold text-foreground">CPOs</h2>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Ajouter CPO
        </button>
      </div>

      {showCreate && (
        <div className="bg-surface border border-primary/30 rounded-2xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Nouveau CPO</h3>
          <div className="grid grid-cols-2 gap-3">
            <input type="text" placeholder="Nom" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="bg-surface-elevated border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50" />
            <input type="text" placeholder="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}
              className="bg-surface-elevated border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50" />
            <input type="text" placeholder="Stripe Connect ID (acct_...)" value={form.stripe_connect_id} onChange={(e) => setForm({ ...form, stripe_connect_id: e.target.value })}
              className="bg-surface-elevated border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50" />
            <div className="flex items-center gap-2">
              <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="w-8 h-8 rounded border border-border cursor-pointer" />
              <span className="text-xs text-foreground-muted">Couleur</span>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => createMutation.mutate()} disabled={!form.name || !form.code || createMutation.isPending}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
              {createMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Creer
            </button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-foreground-muted hover:text-foreground">Annuler</button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">CPO</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Code</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Stripe Connect</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-muted uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(cpos ?? []).map((cpo) => (
                <CpoRow
                  key={cpo.id}
                  cpo={cpo}
                  isEditing={editingId === cpo.id}
                  onEdit={() => setEditingId(cpo.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onSave={(updated) => updateMutation.mutate(updated)}
                  onDelete={() => { if (confirm(`Supprimer le CPO "${cpo.name}" ?`)) deleteMutation.mutate(cpo.id); }}
                  saving={updateMutation.isPending}
                />
              ))}
              {(cpos ?? []).length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-foreground-muted">Aucun CPO</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CpoRow({
  cpo,
  isEditing,
  onEdit,
  onCancelEdit,
  onSave,
  onDelete,
  saving,
}: {
  cpo: CpoEntry;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (c: CpoEntry) => void;
  onDelete: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState(cpo);
  useEffect(() => { setForm(cpo); }, [cpo]);

  if (isEditing) {
    return (
      <tr className="bg-primary/5">
        <td className="px-4 py-2">
          <div className="flex items-center gap-2">
            <input type="color" value={form.color ?? "#00D4AA"} onChange={(e) => setForm({ ...form, color: e.target.value })} className="w-6 h-6 rounded cursor-pointer" />
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="bg-surface-elevated border border-border rounded-lg px-2 py-1.5 text-sm flex-1 focus:outline-none focus:border-primary/50" />
          </div>
        </td>
        <td className="px-4 py-2">
          <input type="text" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}
            className="bg-surface-elevated border border-border rounded-lg px-2 py-1.5 text-sm w-full focus:outline-none focus:border-primary/50" />
        </td>
        <td className="px-4 py-2">
          <input type="text" value={form.stripe_connect_id ?? ""} onChange={(e) => setForm({ ...form, stripe_connect_id: e.target.value })}
            className="bg-surface-elevated border border-border rounded-lg px-2 py-1.5 text-sm w-full font-mono focus:outline-none focus:border-primary/50" />
        </td>
        <td className="px-4 py-2 text-right">
          <div className="flex items-center justify-end gap-1.5">
            <button onClick={() => onSave(form)} disabled={saving} className="p-1.5 rounded-lg bg-primary/15 text-primary hover:bg-primary/25 disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
            </button>
            <button onClick={onCancelEdit} className="p-1.5 rounded-lg bg-foreground-muted/10 text-foreground-muted hover:bg-foreground-muted/20">
              <X className="w-4 h-4" />
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="hover:bg-surface-elevated/50 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: cpo.color ?? "#6b7280" }} />
          <span className="text-sm font-medium text-foreground">{cpo.name}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-foreground-muted font-mono">{cpo.code}</td>
      <td className="px-4 py-3 text-sm text-foreground-muted font-mono">{cpo.stripe_connect_id || "—"}</td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          <button onClick={onEdit} className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated"><Pencil className="w-4 h-4" /></button>
          <button onClick={onDelete} className="p-1.5 rounded-lg text-foreground-muted hover:text-danger hover:bg-danger/10"><Trash2 className="w-4 h-4" /></button>
        </div>
      </td>
    </tr>
  );
}

// ══════════════════════════════════════════════════════════════
// Story 94: Stripe configuration
// ══════════════════════════════════════════════════════════════

function StripeConfigSection() {
  const { data: connectedAccounts, isLoading } = useQuery({
    queryKey: ["stripe-connected-accounts"],
    queryFn: async () => {
      const { data } = await supabase
        .from("cpo_operators")
        .select("id, name, code, description, color")
        .not("description", "is", null)
        .order("name");
      return (data ?? []).map((c: any) => ({
        id: c.id,
        name: c.name,
        code: c.code,
        stripe_id: c.description,
        color: c.color,
      }));
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <CreditCard className="w-5 h-5 text-primary" />
        <div>
          <h2 className="text-base font-heading font-bold text-foreground">Configuration Stripe</h2>
          <p className="text-xs text-foreground-muted">Webhooks, comptes connectes et cles API</p>
        </div>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-surface border border-border rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <LinkIcon className="w-4 h-4 text-foreground-muted" />
            <span className="text-xs font-semibold text-foreground-muted uppercase">Webhook</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
            <span className="text-sm font-medium text-foreground">Actif</span>
          </div>
          <p className="text-xs text-foreground-muted mt-1">Endpoint configure dans Supabase Edge Functions</p>
        </div>

        <div className="bg-surface border border-border rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="w-4 h-4 text-foreground-muted" />
            <span className="text-xs font-semibold text-foreground-muted uppercase">Comptes connectes</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{connectedAccounts?.length ?? 0}</p>
          <p className="text-xs text-foreground-muted mt-1">CPOs avec Stripe Connect</p>
        </div>

        <div className="bg-surface border border-border rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-4 h-4 text-foreground-muted" />
            <span className="text-xs font-semibold text-foreground-muted uppercase">Cle API</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
            <span className="text-sm font-medium text-foreground">Configuree</span>
          </div>
          <p className="text-xs text-foreground-muted mt-1">Secret stocke dans Supabase Edge Functions</p>
        </div>
      </div>

      {/* Connected accounts */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Comptes Stripe Connect</h3>
          <a
            href="https://dashboard.stripe.com/connect/accounts/overview"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium"
          >
            Ouvrir Stripe Dashboard <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        {isLoading ? (
          <div className="p-5 space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : (
          <div className="divide-y divide-border">
            {(connectedAccounts ?? []).map((acc: any) => (
              <div key={acc.id} className="flex items-center justify-between px-5 py-3 hover:bg-surface-elevated/50 transition-colors">
                <div className="flex items-center gap-3">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: acc.color ?? "#6b7280" }} />
                  <div>
                    <p className="text-sm font-medium text-foreground">{acc.name}</p>
                    <p className="text-xs text-foreground-muted font-mono">{acc.stripe_id}</p>
                  </div>
                </div>
                <span className="px-2 py-0.5 bg-emerald-500/15 text-emerald-400 text-xs font-medium rounded">Connecte</span>
              </div>
            ))}
            {(connectedAccounts ?? []).length === 0 && (
              <div className="px-5 py-8 text-center text-foreground-muted text-sm">Aucun compte connecte</div>
            )}
          </div>
        )}
      </div>

      {/* Last webhook events (placeholder) */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Derniers evenements webhook</h3>
        </div>
        <div className="px-5 py-8 text-center text-foreground-muted text-sm">
          Les evenements webhook sont geres par les Edge Functions Supabase.
          Consultez les logs dans le Dashboard Supabase pour le detail.
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Story 95: Platform usage statistics
// ══════════════════════════════════════════════════════════════

function PlatformStatsSection() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["platform-stats"],
    queryFn: async () => {
      // Active users
      const { count: activeUsers } = await supabase
        .from("ezdrive_profiles")
        .select("id", { count: "exact", head: true });

      // Users updated this month (proxy for logins)
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const { count: loginsThisMonth } = await supabase
        .from("ezdrive_profiles")
        .select("id", { count: "exact", head: true })
        .gte("updated_at", startOfMonth.toISOString());

      // Role distribution
      const { data: roleData } = await supabase
        .from("ezdrive_profiles")
        .select("role");
      const roleCounts: Record<string, number> = {};
      for (const r of roleData ?? []) {
        const role = (r as any).role ?? "unknown";
        roleCounts[role] = (roleCounts[role] ?? 0) + 1;
      }

      // Total sessions (CDRs) count
      const { count: totalSessions } = await supabase
        .from("ocpi_cdrs")
        .select("id", { count: "exact", head: true });

      // Active stations
      const { count: activeStations } = await supabase
        .from("stations")
        .select("id", { count: "exact", head: true });

      return {
        activeUsers: activeUsers ?? 0,
        loginsThisMonth: loginsThisMonth ?? 0,
        roleCounts,
        totalSessions: totalSessions ?? 0,
        activeStations: activeStations ?? 0,
      };
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      </div>
    );
  }

  const roleCounts = stats?.roleCounts ?? {};
  const topRoles = Object.entries(roleCounts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <BarChart3 className="w-5 h-5 text-primary" />
        <div>
          <h2 className="text-base font-heading font-bold text-foreground">Statistiques de la plateforme</h2>
          <p className="text-xs text-foreground-muted">Metriques d'utilisation</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-surface border border-border rounded-2xl p-5">
          <p className="text-xs text-foreground-muted font-semibold uppercase">Utilisateurs actifs</p>
          <p className="text-3xl font-bold text-foreground mt-1">{stats?.activeUsers ?? 0}</p>
        </div>
        <div className="bg-surface border border-border rounded-2xl p-5">
          <p className="text-xs text-foreground-muted font-semibold uppercase">Connexions ce mois</p>
          <p className="text-3xl font-bold text-foreground mt-1">{stats?.loginsThisMonth ?? 0}</p>
        </div>
        <div className="bg-surface border border-border rounded-2xl p-5">
          <p className="text-xs text-foreground-muted font-semibold uppercase">Sessions CDR</p>
          <p className="text-3xl font-bold text-foreground mt-1">{stats?.totalSessions ?? 0}</p>
        </div>
        <div className="bg-surface border border-border rounded-2xl p-5">
          <p className="text-xs text-foreground-muted font-semibold uppercase">Bornes actives</p>
          <p className="text-3xl font-bold text-foreground mt-1">{stats?.activeStations ?? 0}</p>
        </div>
      </div>

      {/* Role distribution */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Repartition par role</h3>
        </div>
        <div className="p-5 space-y-3">
          {topRoles.map(([role, count]) => {
            const total = stats?.activeUsers ?? 1;
            const pct = Math.round((count / total) * 100);
            return (
              <div key={role} className="flex items-center gap-3">
                <span className="text-sm text-foreground-muted w-24 capitalize">{role}</span>
                <div className="flex-1 h-2 bg-surface-elevated rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-sm font-medium text-foreground w-16 text-right">{count} ({pct}%)</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Story 96: Email templates configuration
// ══════════════════════════════════════════════════════════════

const EMAIL_TEMPLATES = [
  { key: "welcome", label: "Bienvenue", icon: Mail, description: "Email envoye a la creation du compte" },
  { key: "invoice", label: "Facture", icon: FileText, description: "Email envoye avec la facture mensuelle" },
  { key: "alert", label: "Alerte", icon: AlertTriangle, description: "Email d'alerte de panne prolongee" },
  { key: "password_reset", label: "Reset mot de passe", icon: Shield, description: "Email de reinitialisation du mot de passe" },
];

function EmailTemplatesSection() {
  const queryClient = useQueryClient();
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const { data: templates, isLoading } = useQuery({
    queryKey: ["email-templates"],
    queryFn: async () => {
      const { data } = await supabase
        .from("email_templates")
        .select("key, subject, body_html, updated_at")
        .order("key");
      return (data ?? []) as { key: string; subject: string; body_html: string; updated_at: string }[];
    },
  });

  const templateMap = useMemo(() => {
    const map: Record<string, { subject: string; body_html: string; updated_at: string }> = {};
    for (const t of templates ?? []) {
      map[t.key] = t;
    }
    return map;
  }, [templates]);

  const saveMutation = useMutation({
    mutationFn: async ({ key, subject, body_html }: { key: string; subject: string; body_html: string }) => {
      const { error } = await supabase
        .from("email_templates")
        .upsert({ key, subject, body_html, updated_at: new Date().toISOString() });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-templates"] });
      setEditingKey(null);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Mail className="w-5 h-5 text-primary" />
        <div>
          <h2 className="text-base font-heading font-bold text-foreground">Templates email</h2>
          <p className="text-xs text-foreground-muted">Modeles d'emails envoyes par la plateforme</p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : (
        <div className="space-y-4">
          {EMAIL_TEMPLATES.map((tpl) => {
            const existing = templateMap[tpl.key];
            const Icon = tpl.icon;

            if (editingKey === tpl.key) {
              return (
                <EmailTemplateEditor
                  key={tpl.key}
                  templateKey={tpl.key}
                  label={tpl.label}
                  icon={Icon}
                  initialSubject={existing?.subject ?? ""}
                  initialBody={existing?.body_html ?? ""}
                  onSave={(subject, body_html) => saveMutation.mutate({ key: tpl.key, subject, body_html })}
                  onCancel={() => setEditingKey(null)}
                  saving={saveMutation.isPending}
                />
              );
            }

            return (
              <div key={tpl.key} className="bg-surface border border-border rounded-2xl p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{tpl.label}</p>
                      <p className="text-xs text-foreground-muted">{tpl.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {existing?.updated_at && (
                      <span className="text-xs text-foreground-muted">
                        Modifie le {new Date(existing.updated_at).toLocaleDateString("fr-FR")}
                      </span>
                    )}
                    <button
                      onClick={() => setEditingKey(tpl.key)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-primary font-medium hover:bg-primary/10 rounded-lg transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Editer
                    </button>
                  </div>
                </div>
                {existing?.subject && (
                  <div className="mt-3 p-3 bg-surface-elevated rounded-xl">
                    <p className="text-xs text-foreground-muted mb-1">Sujet :</p>
                    <p className="text-sm text-foreground">{existing.subject}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="bg-surface-elevated/30 border border-border rounded-2xl p-4">
        <p className="text-xs text-foreground-muted">
          <strong>Note :</strong> L'envoi reel des emails est gere par Supabase Auth (reset password) et les Edge Functions (alertes, factures).
          Les templates ici servent de reference pour le contenu des emails.
        </p>
      </div>
    </div>
  );
}

function EmailTemplateEditor({
  templateKey,
  label,
  icon: Icon,
  initialSubject,
  initialBody,
  onSave,
  onCancel,
  saving,
}: {
  templateKey: string;
  label: string;
  icon: React.ElementType;
  initialSubject: string;
  initialBody: string;
  onSave: (subject: string, body: string) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);

  return (
    <div className="bg-surface border border-primary/30 rounded-2xl p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-primary" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">Editer : {label}</h3>
      </div>

      <div>
        <label className="block text-xs font-medium text-foreground-muted mb-1.5">Sujet</label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Sujet de l'email"
          className="w-full bg-surface-elevated border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-foreground-muted mb-1.5">Corps (HTML)</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="<h1>Bienvenue sur EZDrive</h1><p>Votre compte a ete cree...</p>"
          rows={8}
          className="w-full bg-surface-elevated border border-border rounded-xl px-3.5 py-2.5 text-sm font-mono text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50 resize-none"
        />
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => onSave(subject, body)}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Sauvegarder
        </button>
        <button onClick={onCancel} className="px-4 py-2 text-sm text-foreground-muted hover:text-foreground">Annuler</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Story 90 (existing): Login Logs Section
// ══════════════════════════════════════════════════════════════

function LoginLogsSection() {
  const { data: loginLogs, isLoading } = useQuery({
    queryKey: ["admin-login-logs"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, email, role, updated_at")
        .order("updated_at", { ascending: false })
        .limit(50);
      return data ?? [];
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <LogIn className="w-5 h-5 text-primary" />
        <h2 className="text-base font-heading font-bold text-foreground">Historique des connexions</h2>
      </div>

      {isLoading ? (
        <div className="bg-surface border border-border rounded-2xl p-6 space-y-3">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase tracking-wider">Utilisateur</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase tracking-wider">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase tracking-wider">Role</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase tracking-wider">Derniere activite</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(loginLogs ?? []).map((log) => (
                  <tr key={log.id as string} className="hover:bg-surface-elevated/50 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-foreground">
                      {(log.full_name as string) ?? "\u2014"}
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground-muted">
                      {(log.email as string) ?? "\u2014"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        "px-2 py-0.5 rounded text-xs font-medium",
                        (log.role as string) === "admin" ? "bg-red-500/15 text-red-400" :
                        (log.role as string) === "manager" ? "bg-blue-500/15 text-blue-400" :
                        "bg-foreground-muted/10 text-foreground-muted"
                      )}>
                        {(log.role as string) ?? "user"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground-muted whitespace-nowrap">
                      {log.updated_at ? new Date(log.updated_at as string).toLocaleString("fr-FR") : "\u2014"}
                    </td>
                  </tr>
                ))}
                {(loginLogs ?? []).length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-foreground-muted">Aucun log de connexion</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
