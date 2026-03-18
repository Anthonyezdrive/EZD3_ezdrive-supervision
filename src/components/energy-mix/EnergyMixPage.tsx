// ============================================================
// EZDrive — Energy Mix Profiles Page (GreenFlux-style)
// List → click name → Detail view (read-only) → click Editer → Edit view
// ============================================================

import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Leaf,
  Plus,
  Sun,
  Wind,
  Droplets,
  Atom,
  Flame,
  Factory,
  Trash2,
  ChevronDown,
  ChevronUp,
  X,
  Save,
  Loader2,
  MoreHorizontal,
  Search,
  ArrowLeft,
  Info,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCpo } from "@/contexts/CpoContext";
import { cn } from "@/lib/utils";
import { useToast } from "@/contexts/ToastContext";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

// ── Types ─────────────────────────────────────────────────────

interface EnergySource {
  type: string;
  percentage: number;
}

interface EnergyMixProfile {
  id: string;
  name: string;
  supplier: string;
  product: string;
  renewable_percentage: number;
  sources: EnergySource[];
  sites_count: number;
  description: string | null;
  is_green: boolean;
  nuclear_waste: number;
  carbon_gas: number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

// ── Source config ─────────────────────────────────────────────

const SOURCE_CONFIG: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string; label: string; isRenewable: boolean }> = {
  solar:      { icon: Sun,      color: "#FBBF24", label: "Solaire",       isRenewable: true },
  hydro:      { icon: Droplets, color: "#34D399", label: "Eau",           isRenewable: true },
  wind:       { icon: Wind,     color: "#60A5FA", label: "Vent",          isRenewable: true },
  green:      { icon: Leaf,     color: "#10B981", label: "Vert Général",  isRenewable: true },
  coal:       { icon: Factory,  color: "#8892B0", label: "Charbon",       isRenewable: false },
  nuclear:    { icon: Atom,     color: "#A78BFA", label: "Nucléaire",     isRenewable: false },
  gas:        { icon: Flame,    color: "#F97316", label: "Gaz",           isRenewable: false },
  fossil:     { icon: Factory,  color: "#EF4444", label: "Fossile Général", isRenewable: false },
  biomass:    { icon: Leaf,     color: "#22C55E", label: "Biomasse",      isRenewable: true },
  geothermal: { icon: Flame,    color: "#EC4899", label: "Géothermie",    isRenewable: true },
  other:      { icon: Flame,    color: "#8892B0", label: "Autre",         isRenewable: false },
};

const RENEWABLE_TYPES = new Set(Object.entries(SOURCE_CONFIG).filter(([, v]) => v.isRenewable).map(([k]) => k));

function computeRenewablePercentage(sources: EnergySource[]): number {
  return sources.reduce((sum, s) => sum + (RENEWABLE_TYPES.has(s.type) ? s.percentage : 0), 0);
}

const EMPTY_FORM = {
  name: "",
  supplier: "",
  product: "",
  description: "",
  is_green: false,
  sites_count: 0,
  sources: [] as EnergySource[],
  nuclear_waste: 0,
  carbon_gas: 0,
};

// ── Donut chart ───────────────────────────────────────────────

function EnergyDonut({
  sources,
  size = 200,
  centerText,
  centerSub,
  showLegend = false,
}: {
  sources: EnergySource[];
  size?: number;
  centerText?: string;
  centerSub?: string;
  showLegend?: boolean;
}) {
  const radius = (size - 24) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className={cn("flex items-center", showLegend ? "gap-6" : "")}>
      <svg width={size} height={size} className="shrink-0">
        {sources.length === 0 ? (
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={20} className="text-border" />
        ) : (
          sources.map((source, i) => {
            const config = SOURCE_CONFIG[source.type] ?? SOURCE_CONFIG.other;
            const dashArray = (source.percentage / 100) * circumference;
            const currentOffset = offset;
            offset += dashArray;
            return (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={config.color}
                strokeWidth={20}
                strokeDasharray={`${dashArray} ${circumference - dashArray}`}
                strokeDashoffset={-currentOffset}
                className="transition-all duration-500"
              />
            );
          })
        )}
        <text x={size / 2} y={size / 2 - 6} textAnchor="middle" className="text-2xl font-bold fill-foreground">
          {centerText ?? `${computeRenewablePercentage(sources)}%`}
        </text>
        <text x={size / 2} y={size / 2 + 14} textAnchor="middle" className="text-xs fill-foreground-muted">
          {centerSub ?? "renewable"}
        </text>
      </svg>

      {showLegend && (
        <div className="space-y-1.5">
          {sources.map((source, i) => {
            const config = SOURCE_CONFIG[source.type] ?? SOURCE_CONFIG.other;
            return (
              <div key={i} className="flex items-center gap-2">
                <span className="text-sm text-foreground">{config.label}</span>
                <div className="w-1.5 h-4 rounded-sm" style={{ backgroundColor: config.color }} />
                <span className="text-sm text-foreground-muted">{source.percentage}%</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════

export function EnergyMixPage() {
  const [selectedProfile, setSelectedProfile] = useState<EnergyMixProfile | null>(null);
  const [editingProfile, setEditingProfile] = useState<EnergyMixProfile | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const queryClient = useQueryClient();

  // Level 3: Edit / Create view
  if (editingProfile || isCreating) {
    return (
      <ProfileEditView
        profile={editingProfile}
        onBack={() => {
          if (editingProfile) {
            setSelectedProfile(editingProfile);
          }
          setEditingProfile(null);
          setIsCreating(false);
        }}
        onSaved={(saved) => {
          queryClient.invalidateQueries({ queryKey: ["energy-mix-profiles"] });
          setEditingProfile(null);
          setIsCreating(false);
          if (saved) setSelectedProfile(saved);
        }}
      />
    );
  }

  // Level 2: Detail view (read-only)
  if (selectedProfile) {
    return (
      <ProfileDetailView
        profile={selectedProfile}
        onBack={() => setSelectedProfile(null)}
        onEdit={() => setEditingProfile(selectedProfile)}
      />
    );
  }

  // Level 1: List view
  return (
    <ProfileListView
      onSelect={setSelectedProfile}
      onCreate={() => setIsCreating(true)}
    />
  );
}

// ══════════════════════════════════════════════════════════════
// PROFILE LIST VIEW (GFX-style table)
// ══════════════════════════════════════════════════════════════

type ListTab = "all" | "green" | "other";

function ProfileListView({
  onSelect,
  onCreate,
}: {
  onSelect: (profile: EnergyMixProfile) => void;
  onCreate: () => void;
}) {
  const { selectedCpoId: _cpo } = useCpo();
  const [activeTab, setActiveTab] = useState<ListTab>("all");
  const [filterName, setFilterName] = useState("");
  const [filterSupplier, setFilterSupplier] = useState("");
  const [filterProduct, setFilterProduct] = useState("");
  const [filterUpdatedBy, setFilterUpdatedBy] = useState("");
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<EnergyMixProfile | null>(null);
  const queryClient = useQueryClient();
  const { success: toastSuccess, error: toastError } = useToast();

  const { data: profiles, isLoading } = useQuery<EnergyMixProfile[]>({
    queryKey: ["energy-mix-profiles"],
    retry: false,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("energy_mix_profiles")
          .select("*")
          .order("created_at", { ascending: true });
        if (error) {
          console.warn("[EnergyMixPage] Table error:", error.message);
          return [];
        }
        return (data ?? []).map((d: any) => ({
          ...d,
          nuclear_waste: d.nuclear_waste ?? 0,
          carbon_gas: d.carbon_gas ?? 0,
          updated_by: d.updated_by ?? null,
        })) as EnergyMixProfile[];
      } catch {
        return [];
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("energy_mix_profiles").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["energy-mix-profiles"] });
      setConfirmDelete(null);
      toastSuccess("Profil supprimé");
    },
    onError: (error: Error) => {
      setConfirmDelete(null);
      toastError("Erreur", error.message);
    },
  });

  const filtered = useMemo(() => {
    let list = profiles ?? [];
    if (activeTab === "green") list = list.filter((p) => p.is_green || p.renewable_percentage >= 80);
    if (activeTab === "other") list = list.filter((p) => !p.is_green && p.renewable_percentage < 80);
    if (filterName) {
      const q = filterName.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    if (filterSupplier) {
      const q = filterSupplier.toLowerCase();
      list = list.filter((p) => p.supplier.toLowerCase().includes(q));
    }
    if (filterProduct) {
      const q = filterProduct.toLowerCase();
      list = list.filter((p) => p.product.toLowerCase().includes(q));
    }
    if (filterUpdatedBy) {
      const q = filterUpdatedBy.toLowerCase();
      list = list.filter((p) => (p.updated_by ?? "").toLowerCase().includes(q));
    }
    return list;
  }, [profiles, activeTab, filterName, filterSupplier, filterProduct, filterUpdatedBy]);

  const totalCount = profiles?.length ?? 0;

  const TABS: { key: ListTab; label: string }[] = [
    { key: "all", label: "Tout" },
    { key: "green", label: "Vert" },
    { key: "other", label: "Autre" },
  ];

  return (
    <div className="space-y-4">
      {/* Header — collapsible section style like GFX */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Leaf className="w-5 h-5 text-primary" />
          <h1 className="font-heading text-xl font-bold text-foreground">
            Profils des sources d'énergie ({totalCount})
          </h1>
        </div>
        <button
          onClick={onCreate}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Ajouter Nouveau
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-border">
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

      {/* Table */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-3 px-4 text-xs font-semibold text-foreground-muted uppercase">
                  <span className="inline-flex items-center gap-1">Nom <ChevronDown className="w-3 h-3" /></span>
                </th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-foreground-muted uppercase">
                  <span className="inline-flex items-center gap-1">Fournisseur <ChevronDown className="w-3 h-3" /></span>
                </th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-foreground-muted uppercase">
                  <span className="inline-flex items-center gap-1">Product <ChevronDown className="w-3 h-3" /></span>
                </th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-foreground-muted uppercase">
                  <span className="inline-flex items-center gap-1">Renouvelable <ChevronDown className="w-3 h-3" /></span>
                </th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-foreground-muted uppercase">Sources d'énergie</th>
                <th className="text-center py-3 px-4 text-xs font-semibold text-foreground-muted uppercase">Sites</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-foreground-muted uppercase">Description</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-foreground-muted uppercase">
                  <span className="inline-flex items-center gap-1">Dernière mise à jour <ChevronDown className="w-3 h-3" /></span>
                </th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-foreground-muted uppercase">
                  <span className="inline-flex items-center gap-1">Mis à jour par <ChevronDown className="w-3 h-3" /></span>
                </th>
                <th className="py-3 px-4"></th>
              </tr>
              {/* Filter row */}
              <tr className="border-b border-border bg-surface-elevated/30">
                <td className="px-4 py-1.5">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-foreground-muted" />
                    <input type="text" value={filterName} onChange={(e) => setFilterName(e.target.value)} placeholder="Recherche..."
                      className="w-full pl-7 pr-2 py-1 bg-surface border border-border rounded-lg text-xs text-foreground placeholder:text-foreground-muted/40 focus:outline-none focus:border-primary/50" />
                  </div>
                </td>
                <td className="px-4 py-1.5">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-foreground-muted" />
                    <input type="text" value={filterSupplier} onChange={(e) => setFilterSupplier(e.target.value)} placeholder="Recherche..."
                      className="w-full pl-7 pr-2 py-1 bg-surface border border-border rounded-lg text-xs text-foreground placeholder:text-foreground-muted/40 focus:outline-none focus:border-primary/50" />
                  </div>
                </td>
                <td className="px-4 py-1.5">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-foreground-muted" />
                    <input type="text" value={filterProduct} onChange={(e) => setFilterProduct(e.target.value)} placeholder="Recherche..."
                      className="w-full pl-7 pr-2 py-1 bg-surface border border-border rounded-lg text-xs text-foreground placeholder:text-foreground-muted/40 focus:outline-none focus:border-primary/50" />
                  </div>
                </td>
                <td className="px-4 py-1.5"></td>
                <td className="px-4 py-1.5"></td>
                <td className="px-4 py-1.5"></td>
                <td className="px-4 py-1.5"></td>
                <td className="px-4 py-1.5"></td>
                <td className="px-4 py-1.5">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-foreground-muted" />
                    <input type="text" value={filterUpdatedBy} onChange={(e) => setFilterUpdatedBy(e.target.value)} placeholder="Recherche..."
                      className="w-full pl-7 pr-2 py-1 bg-surface border border-border rounded-lg text-xs text-foreground placeholder:text-foreground-muted/40 focus:outline-none focus:border-primary/50" />
                  </div>
                </td>
                <td className="px-4 py-1.5"></td>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={10} className="py-12 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-foreground-muted" /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} className="py-12 text-center text-foreground-muted text-sm">Aucun profil de sources d'énergie</td></tr>
              ) : filtered.map((profile) => {
                // Build source summary text like "Solaire + 5 ..."
                const sourceNames = profile.sources.map((s) => (SOURCE_CONFIG[s.type] ?? SOURCE_CONFIG.other).label);
                const sourceSummary = sourceNames.length > 0
                  ? `${sourceNames[0]}${sourceNames.length > 1 ? ` + ${sourceNames.length - 1}` : ""}`
                  : "-";

                return (
                  <tr
                    key={profile.id}
                    className="border-b border-border/50 hover:bg-surface-elevated/30 transition-colors"
                    onMouseEnter={() => setHoveredRow(profile.id)}
                    onMouseLeave={() => setHoveredRow(null)}
                  >
                    <td className="px-4 py-3">
                      <button
                        onClick={() => onSelect(profile)}
                        className="text-primary font-medium hover:underline"
                      >
                        {profile.name}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-foreground">{profile.supplier}</td>
                    <td className="px-4 py-3 text-foreground">{profile.product}</td>
                    <td className="px-4 py-3 text-foreground">{profile.renewable_percentage}%</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <span className="text-foreground text-xs">{sourceSummary}</span>
                        {profile.sources.length > 1 && (
                          <button className="p-0.5 text-foreground-muted hover:text-foreground">
                            <MoreHorizontal className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center text-foreground">{profile.sites_count}</td>
                    <td className="px-4 py-3 text-foreground-muted text-xs truncate max-w-[120px]">
                      {profile.description ?? "-"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-primary">
                        {new Date(profile.updated_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" })}
                        {" @ "}
                        {new Date(profile.updated_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-foreground-muted text-xs">
                      {profile.updated_by ?? "-"}
                    </td>
                    <td className="px-4 py-3">
                      {hoveredRow === profile.id && (
                        <button
                          onClick={() => onSelect(profile)}
                          className="px-3 py-1 bg-surface-elevated border border-border rounded-lg text-xs font-medium text-foreground hover:bg-surface transition-colors"
                        >
                          Éditer
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!confirmDelete}
        title="Supprimer ce profil ?"
        description={`Le profil "${confirmDelete?.name}" sera définitivement supprimé.`}
        confirmLabel="Supprimer"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate(confirmDelete!.id)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// PROFILE DETAIL VIEW (Read-only, GFX-style)
// ══════════════════════════════════════════════════════════════

function ProfileDetailView({
  profile,
  onBack,
  onEdit,
}: {
  profile: EnergyMixProfile;
  onBack: () => void;
  onEdit: () => void;
}) {
  const [editDropdownOpen, setEditDropdownOpen] = useState(false);
  const editRef = useRef<HTMLDivElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const queryClient = useQueryClient();
  const { success: toastSuccess } = useToast();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (editRef.current && !editRef.current.contains(e.target as Node)) {
        setEditDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("energy_mix_profiles").delete().eq("id", profile.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["energy-mix-profiles"] });
      toastSuccess("Profil supprimé");
      onBack();
    },
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-xl border border-border hover:bg-surface-elevated transition-colors">
            <ArrowLeft className="w-4 h-4 text-foreground-muted" />
          </button>
          <Leaf className="w-5 h-5 text-primary" />
          <div>
            <h1 className="font-heading text-xl font-bold text-foreground">{profile.name}</h1>
            <p className="text-xs text-foreground-muted uppercase tracking-wide">Profil Des Sources D'énergie</p>
          </div>
        </div>
        <div className="relative" ref={editRef}>
          <div className="flex items-center">
            <button
              onClick={onEdit}
              className="px-5 py-2.5 bg-primary text-white rounded-l-xl text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              Éditer
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
                Éditer
              </button>
              <button
                onClick={() => { setEditDropdownOpen(false); setConfirmDelete(true); }}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-surface-elevated transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Supprimer
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Two-column: Sources d'énergie + Informations diverses */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Sources d'énergie with donut */}
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-base font-semibold text-foreground">Sources d'énergie</h2>
          </div>
          <div className="p-6 flex justify-center">
            <EnergyDonut
              sources={profile.sources}
              size={240}
              centerText={`${profile.renewable_percentage}%`}
              centerSub="renewable"
              showLegend
            />
          </div>
        </div>

        {/* Right: Informations diverses */}
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-base font-semibold text-foreground">Informations diverses</h2>
          </div>
          <div className="p-6 space-y-3">
            <div className="flex items-center justify-between py-1.5">
              <span className="text-sm text-foreground-muted">Profil des sources d'énergie</span>
              <span className="text-sm text-foreground font-mono text-xs">{profile.id.slice(0, 8)}...{profile.id.slice(-12)}</span>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-sm text-foreground-muted">Fournisseur d'énergie</span>
              <span className="text-sm text-foreground">{profile.supplier}</span>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-sm text-foreground-muted">Nom du produit énergétique</span>
              <span className="text-sm text-foreground">{profile.product}</span>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-sm text-foreground-muted">Déchets nucléaires</span>
              <span className="text-sm text-foreground">{(profile.nuclear_waste ?? 0).toFixed(4)} grammes / kWh</span>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-sm text-foreground-muted">Gaz carbonique</span>
              <span className="text-sm text-foreground">{(profile.carbon_gas ?? 0).toFixed(4)} grammes / kWh</span>
            </div>
            <div className="py-1.5">
              <span className="text-sm text-foreground-muted">Description</span>
              <p className="text-sm text-foreground mt-1">{profile.description ?? "-"}</p>
            </div>
            <div className="flex items-center justify-between py-1.5 border-t border-border pt-3">
              <span className="text-sm text-foreground-muted">Dernière mise à jour</span>
              <span className="text-sm text-primary">
                {new Date(profile.updated_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" })}
                {" @ "}
                {new Date(profile.updated_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                {profile.updated_by && ` (${profile.updated_by})`}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Delete confirm */}
      <ConfirmDialog
        open={confirmDelete}
        title="Supprimer ce profil ?"
        description={`Le profil "${profile.name}" sera définitivement supprimé.`}
        confirmLabel="Supprimer"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// PROFILE EDIT VIEW (GFX-style full-page form)
// ══════════════════════════════════════════════════════════════

function ProfileEditView({
  profile,
  onBack,
  onSaved,
}: {
  profile: EnergyMixProfile | null;
  onBack: () => void;
  onSaved: (saved?: EnergyMixProfile) => void;
}) {
  const { success: toastSuccess, error: toastError } = useToast();
  const isEditing = !!profile;

  const [form, setForm] = useState(() => {
    if (profile) {
      return {
        name: profile.name,
        supplier: profile.supplier,
        product: profile.product,
        description: profile.description ?? "",
        is_green: profile.is_green,
        sites_count: profile.sites_count,
        sources: profile.sources.map((s) => ({ ...s })),
        nuclear_waste: profile.nuclear_waste ?? 0,
        carbon_gas: profile.carbon_gas ?? 0,
      };
    }
    return { ...EMPTY_FORM };
  });

  const [saving, setSaving] = useState(false);
  const [supplierOpen, setSupplierOpen] = useState(true);
  const [impactOpen, setImpactOpen] = useState(true);
  const [descOpen, setDescOpen] = useState(true);

  const renewableSources = form.sources.filter((s) => RENEWABLE_TYPES.has(s.type));
  const nonRenewableSources = form.sources.filter((s) => !RENEWABLE_TYPES.has(s.type));
  const totalPct = form.sources.reduce((sum, s) => sum + s.percentage, 0);
  const renewablePct = computeRenewablePercentage(form.sources);

  function updateSource(index: number, field: "type" | "percentage", value: string | number) {
    setForm((f) => {
      const updated = f.sources.map((s, i) =>
        i === index ? { ...s, [field]: field === "percentage" ? Number(value) : value } : s
      );
      return { ...f, sources: updated };
    });
  }

  function addRenewableSource() {
    const existing = new Set(form.sources.map((s) => s.type));
    const available = Object.entries(SOURCE_CONFIG)
      .filter(([k, v]) => v.isRenewable && !existing.has(k))
      .map(([k]) => k);
    if (available.length > 0) {
      setForm((f) => ({ ...f, sources: [...f.sources, { type: available[0], percentage: 0 }] }));
    }
  }

  function addNonRenewableSource() {
    const existing = new Set(form.sources.map((s) => s.type));
    const available = Object.entries(SOURCE_CONFIG)
      .filter(([k, v]) => !v.isRenewable && !existing.has(k))
      .map(([k]) => k);
    if (available.length > 0) {
      setForm((f) => ({ ...f, sources: [...f.sources, { type: available[0], percentage: 0 }] }));
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        supplier: form.supplier,
        product: form.product,
        description: form.description || null,
        renewable_percentage: renewablePct,
        is_green: form.is_green,
        sites_count: Number(form.sites_count) || 0,
        sources: form.sources as unknown as Record<string, unknown>[],
        nuclear_waste: form.nuclear_waste,
        carbon_gas: form.carbon_gas,
      };

      if (isEditing && profile) {
        const { data, error } = await supabase
          .from("energy_mix_profiles")
          .update(payload)
          .eq("id", profile.id)
          .select()
          .single();
        if (error) throw error;
        toastSuccess("Profil modifié", "Les modifications ont été enregistrées");
        onSaved(data as EnergyMixProfile);
      } else {
        const { data, error } = await supabase
          .from("energy_mix_profiles")
          .insert(payload)
          .select()
          .single();
        if (error) throw error;
        toastSuccess("Profil créé", "Le profil energy mix a été ajouté");
        onSaved(data as EnergyMixProfile);
      }
    } catch (err: any) {
      toastError("Erreur", err.message || "Une erreur est survenue");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Warning banner */}
      {isEditing && (
        <div className="flex items-center gap-3 px-4 py-3 bg-blue-500/10 border border-blue-500/20 rounded-xl">
          <Info className="w-4 h-4 text-blue-400 shrink-0" />
          <p className="text-sm text-foreground">
            Notez que toute modification apportée à ce profil de sources d'énergie sera propagée à tous les sites de charge qui lui sont liés.
          </p>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-xl border border-border hover:bg-surface-elevated transition-colors">
          <ArrowLeft className="w-4 h-4 text-foreground-muted" />
        </button>
        <Leaf className="w-5 h-5 text-primary" />
        <div>
          <h1 className="font-heading text-xl font-bold text-foreground">
            {isEditing ? "Mise à jour Profil des sources d'énergie" : "Nouveau Profil des sources d'énergie"}
          </h1>
          <p className="text-xs text-foreground-muted uppercase tracking-wide">
            {isEditing ? "Éditer le profil des sources d'énergie" : "Créer un profil des sources d'énergie"}
          </p>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Profile info + sources */}
        <div className="space-y-6">
          {/* 1. Informations sur le profil */}
          <div className="bg-surface border border-border rounded-2xl p-6 space-y-4">
            <h3 className="text-base font-semibold text-foreground">1. Informations sur le profil</h3>
            <div>
              <label className="block text-sm text-foreground mb-1">Nom <span className="text-red-400">*</span></label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50"
              />
            </div>

            {/* Donut in form */}
            <div className="flex justify-center py-4">
              <EnergyDonut
                sources={form.sources}
                size={200}
                centerText={totalPct === 100 ? "100%" : `${totalPct}%`}
                centerSub="assigned"
              />
            </div>

            {totalPct !== 100 && form.sources.length > 0 && (
              <div className="p-3 bg-blue-500/5 border-l-2 border-blue-500 rounded-r-xl">
                <p className="text-sm text-foreground">
                  Saisissez ci-dessous les valeurs qui composent les sources d'énergie souhaitées. La somme doit s'élever à 100 %.
                </p>
              </div>
            )}

            {/* 2a. Renouvelable */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <h4 className="text-sm font-semibold text-foreground">2a. Renouvelable</h4>
                <button
                  type="button"
                  onClick={addRenewableSource}
                  className="text-xs text-primary hover:text-primary/80 font-medium"
                >
                  ajouter
                </button>
                {renewableSources.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const types = renewableSources.map((s) => s.type);
                      setForm((f) => ({ ...f, sources: f.sources.filter((s) => !types.includes(s.type)) }));
                    }}
                    className="text-xs text-red-400 hover:text-red-300 font-medium"
                  >
                    supprimer
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                {renewableSources.map((source) => {
                  const config = SOURCE_CONFIG[source.type] ?? SOURCE_CONFIG.other;
                  const globalIdx = form.sources.findIndex((s) => s.type === source.type);
                  return (
                    <div key={source.type}>
                      <label className="flex items-center gap-1.5 text-sm text-foreground mb-1">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: config.color }} />
                        {config.label} <span className="text-red-400">*</span>
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={source.percentage}
                          onChange={(e) => updateSource(globalIdx, "percentage", e.target.value)}
                          className="w-full px-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50 pr-8"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-foreground-muted">%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 2b. Non renouvelable */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <h4 className="text-sm font-semibold text-foreground">2b. Non renouvelable</h4>
                <button
                  type="button"
                  onClick={addNonRenewableSource}
                  className="text-xs text-primary hover:text-primary/80 font-medium"
                >
                  ajouter
                </button>
                {nonRenewableSources.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const types = nonRenewableSources.map((s) => s.type);
                      setForm((f) => ({ ...f, sources: f.sources.filter((s) => !types.includes(s.type)) }));
                    }}
                    className="text-xs text-red-400 hover:text-red-300 font-medium"
                  >
                    supprimer
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                {nonRenewableSources.map((source) => {
                  const config = SOURCE_CONFIG[source.type] ?? SOURCE_CONFIG.other;
                  const globalIdx = form.sources.findIndex((s) => s.type === source.type);
                  return (
                    <div key={source.type}>
                      <label className="flex items-center gap-1.5 text-sm text-foreground mb-1">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: config.color }} />
                        {config.label} <span className="text-red-400">*</span>
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={source.percentage}
                          onChange={(e) => updateSource(globalIdx, "percentage", e.target.value)}
                          className="w-full px-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50 pr-8"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-foreground-muted">%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Informations diverses */}
        <div className="space-y-6">
          <div className="bg-surface border border-border rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <h3 className="text-base font-semibold text-foreground">3. Informations diverses</h3>
            </div>

            {/* Fournisseur (collapsible) */}
            <div className="border-b border-border">
              <button
                onClick={() => setSupplierOpen(!supplierOpen)}
                className="w-full flex items-center justify-between px-6 py-3"
              >
                <span className="text-sm font-semibold text-foreground">Fournisseur</span>
                {supplierOpen ? <ChevronUp className="w-4 h-4 text-foreground-muted" /> : <ChevronDown className="w-4 h-4 text-foreground-muted" />}
              </button>
              {supplierOpen && (
                <div className="px-6 pb-4 space-y-4">
                  <div>
                    <label className="block text-sm text-foreground-muted mb-1">Fournisseur d'énergie</label>
                    <input
                      type="text"
                      value={form.supplier}
                      onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))}
                      className="w-full px-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-foreground-muted mb-1">Nom du produit énergétique</label>
                    <input
                      type="text"
                      value={form.product}
                      onChange={(e) => setForm((f) => ({ ...f, product: e.target.value }))}
                      className="w-full px-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Impact Environnemental (collapsible) */}
            <div className="border-b border-border">
              <button
                onClick={() => setImpactOpen(!impactOpen)}
                className="w-full flex items-center justify-between px-6 py-3"
              >
                <span className="text-sm font-semibold text-foreground">Impact Environnemental</span>
                {impactOpen ? <ChevronUp className="w-4 h-4 text-foreground-muted" /> : <ChevronDown className="w-4 h-4 text-foreground-muted" />}
              </button>
              {impactOpen && (
                <div className="px-6 pb-4 space-y-4">
                  <div>
                    <label className="block text-sm text-foreground-muted mb-1">Déchets nucléaires</label>
                    <div className="relative">
                      <input
                        type="number"
                        step="0.0001"
                        value={form.nuclear_waste}
                        onChange={(e) => setForm((f) => ({ ...f, nuclear_waste: parseFloat(e.target.value) || 0 }))}
                        className="w-full px-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50 pr-28"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-primary font-medium">grammes / kWh</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm text-foreground-muted mb-1">Gaz carbonique</label>
                    <div className="relative">
                      <input
                        type="number"
                        step="0.0001"
                        value={form.carbon_gas}
                        onChange={(e) => setForm((f) => ({ ...f, carbon_gas: parseFloat(e.target.value) || 0 }))}
                        className="w-full px-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50 pr-28"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-primary font-medium">grammes / kWh</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Description (collapsible) */}
            <div>
              <button
                onClick={() => setDescOpen(!descOpen)}
                className="w-full flex items-center justify-between px-6 py-3"
              >
                <span className="text-sm font-semibold text-foreground">Description</span>
                {descOpen ? <ChevronUp className="w-4 h-4 text-foreground-muted" /> : <ChevronDown className="w-4 h-4 text-foreground-muted" />}
              </button>
              {descOpen && (
                <div className="px-6 pb-4">
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    rows={5}
                    placeholder="Saisissez éventuellement des remarques sur le Profil des sources d'énergie..."
                    className="w-full px-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50 resize-y"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

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
            disabled={saving || !form.name.trim()}
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
