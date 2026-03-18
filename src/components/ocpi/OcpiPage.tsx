// ============================================================
// EZDrive — OCPI Subscriptions Page (GFX-style)
// List → Detail view with tabs (Détails, Parties relayées, Diagnostic)
// ============================================================

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  Globe,
  Send,
  CheckCircle,
  XCircle,
  RefreshCw,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/Skeleton";

// ── Types ─────────────────────────────────────────────────────

interface OcpiCredential {
  id: string;
  role: "CPO" | "EMSP";
  country_code: string;
  party_id: string;
  token_a: string | null;
  token_b: string | null;
  token_c: string | null;
  versions_url: string | null;
  our_versions_url: string | null;
  our_base_url: string | null;
  status: "PENDING" | "CONNECTED" | "SUSPENDED" | "BLOCKED";
  platform: "PREPROD" | "PROD";
  gireve_country_code: string | null;
  gireve_party_id: string | null;
  created_at: string;
  updated_at: string;
}

interface OcpiSubscription {
  id: string;
  name: string;
  subscription_id: string;
  party: string;
  role: "CPO" | "eMSP";
  other_party: string;
  other_party_role: "CPO" | "eMSP";
  protocol: string;
  status: "CONNECTED" | "PENDING" | "SUSPENDED" | "BLOCKED";
  // Detail fields
  our_country_code: string;
  our_party_id: string;
  our_url: string;
  our_token: string;
  our_date: string;
  our_version: string;
  our_is_platform: boolean;
  other_country_code: string;
  other_party_id: string;
  other_url: string;
  other_token: string;
  other_broadcast_name: string;
  other_website: string;
  // Modules
  modules_own: string[];
  modules_other: string[];
}

type SortKey = "subscription_id" | "name" | "party" | "role" | "other_party" | "other_party_role" | "protocol";
type SortDir = "asc" | "desc";
type DetailTab = "details" | "parties" | "diagnostic";

const PAGE_SIZE = 25;

// ── Helpers ───────────────────────────────────────────────────

const OCPI_MODULES = ["cdrs", "commands", "credentials", "locations", "sessions", "tariffs", "tokens"];

const CONFIG_OWN = [
  { key: "unique_connector_id", label: "Rendre l'ID du connecteur unique", value: false },
  { key: "rfid_capability", label: "Appliquer la capacité RFID", value: false },
  { key: "session_id_for_cdr", label: "Utiliser l'ID de la session pour l'ID du CDR", value: false },
  { key: "use_ocpi_2_1_id2", label: "UseOcpi2_1_ID2", value: false },
  { key: "token_issuer_owner", label: "Propriétaire du token basé sur l'émetteur", value: false },
  { key: "poi_expose_unpublished", label: "POI_EXPOSE_UNPUBLISHED_LOCATIONS", value: false },
  { key: "poi_expose_blacklist", label: "POI_EXPOSE_BLACKLIST_LOCATIONS", value: false },
  { key: "publish_all_cdrs", label: "PUBLISH_ALL_CDRS", value: false },
];

const CONFIG_OTHER = [
  { key: "add_connected_emsps", label: "ADD_CONNECTED_EMSPS_TO_API_HEADER", value: "No" },
  { key: "set_cdr_coupon", label: "SetCdrCouponInformation", value: "false" },
  { key: "allow_custom_location", label: "AllowCustomLocationId", value: "false" },
  { key: "pull_process_tokens", label: "PULL_AND_PROCESS_TOKENS", value: "true" },
  { key: "use_base64_token", label: "USE_BASE_64_CREDENTIALS_TOKEN", value: "false" },
  { key: "zero_parking_fee", label: "SET_TOTAL_PARKING_TIME_TO_ZERO_IF_NO_PARKING_FEE", value: "false" },
];

function maskToken(token: string | null): string {
  if (!token) return "—";
  if (token.length <= 8) return "****" + token.slice(-4);
  return "*".repeat(Math.min(30, token.length - 4)) + token.slice(-4);
}

const formatDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }) + " @ " + new Date(d).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

// ── Main Component ────────────────────────────────────────────

export function OcpiPage() {
  const queryClient = useQueryClient();

  // Navigation
  const [selectedSubscription, setSelectedSubscription] = useState<OcpiSubscription | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("details");

  // List state
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [colFilters, setColFilters] = useState<Record<string, string>>({
    subscription_id: "", name: "", party: "", role: "", other_party: "", other_party_role: "", protocol: "",
  });

  // ── Data ──
  const { data: credentials, isLoading } = useQuery<OcpiCredential[]>({
    queryKey: ["ocpi-credentials"],
    queryFn: async () => {
      const { data, error } = await supabase.from("ocpi_credentials").select("*").order("role");
      if (error) return [];
      return (data ?? []) as OcpiCredential[];
    },
  });

  // Build subscriptions from credentials (our internal representation)
  const subscriptions = useMemo<OcpiSubscription[]>(() => {
    if (!credentials) return [];
    return credentials.map((cred) => {
      const isCpo = cred.role === "CPO";
      return {
        id: cred.id,
        subscription_id: cred.id,
        name: `[GFX-M-Roam] EZDrive ${cred.role} - ${cred.gireve_country_code}${cred.gireve_party_id}`,
        party: "GreenFlux Netherlands",
        role: cred.role as "CPO" | "eMSP",
        other_party: `Gireve ${isCpo ? "eMSP" : "CPO"}`,
        other_party_role: isCpo ? "eMSP" as const : "CPO" as const,
        protocol: "OCPI 2.2.1",
        status: cred.status,
        our_country_code: `${cred.country_code}/${cred.party_id}`,
        our_party_id: cred.party_id,
        our_url: cred.our_versions_url ?? "—",
        our_token: cred.token_a ?? "",
        our_date: cred.created_at,
        our_version: "2.1.1",
        our_is_platform: false,
        other_country_code: `${cred.gireve_country_code ?? "FR"}/${cred.gireve_party_id ?? "107"}`,
        other_party_id: cred.gireve_party_id ?? "107",
        other_url: cred.versions_url ?? "—",
        other_token: cred.token_b ?? "",
        other_broadcast_name: isCpo ? "Gireve" : "Gireve",
        other_website: "—",
        modules_own: OCPI_MODULES,
        modules_other: OCPI_MODULES,
      };
    });
  }, [credentials]);

  // ── CPO parties for "Parties relayées" tab ──
  const { data: cpoParties } = useQuery({
    queryKey: ["ocpi-cpo-parties"],
    queryFn: async () => {
      const { data, error } = await supabase.from("cpos").select("id, name, external_id, country_code, gfx_id").order("name");
      if (error) return [];
      return data ?? [];
    },
    enabled: !!selectedSubscription,
  });

  // ── Mutations (keep operational buttons) ──
  const seedMutation = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ocpi-seed-locations`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" },
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ocpi-credentials"] });
    },
  });

  const pushMutation = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ocpi-push`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" },
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ocpi-credentials"] });
    },
  });

  // ── Sorting ──
  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
    setPage(1);
  }

  // ── Filter + Sort ──
  const processed = useMemo(() => {
    let list = subscriptions;

    // Column filters
    Object.entries(colFilters).forEach(([key, val]) => {
      if (!val) return;
      const q = val.toLowerCase();
      list = list.filter((s) => {
        const v = s[key as keyof OcpiSubscription];
        return typeof v === "string" && v.toLowerCase().includes(q);
      });
    });

    // Sort
    return [...list].sort((a, b) => {
      const av = a[sortKey] as string; const bv = b[sortKey] as string;
      if (!av && !bv) return 0; if (!av) return 1; if (!bv) return -1;
      const cmp = av.localeCompare(bv, "fr");
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [subscriptions, colFilters, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(processed.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const paginated = processed.slice(start, start + PAGE_SIZE);

  const thClass = "px-3 py-2.5 text-left text-[11px] font-semibold text-foreground-muted uppercase tracking-wider cursor-pointer hover:text-foreground transition-colors select-none whitespace-nowrap";
  const filterInputClass = "w-full px-2 py-1.5 bg-surface-elevated border border-border rounded text-xs text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50 transition-colors";

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (col !== sortKey) return <span className="inline-flex ml-0.5 opacity-30"><ChevronUp className="w-3 h-3" /></span>;
    return sortDir === "asc" ? <ChevronUp className="w-3 h-3 inline ml-0.5 text-primary" /> : <ChevronDown className="w-3 h-3 inline ml-0.5 text-primary" />;
  };

  // ════════════════════════════════════════════════════════════
  // DETAIL VIEW
  // ════════════════════════════════════════════════════════════
  if (selectedSubscription) {
    const sub = selectedSubscription;

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <button onClick={() => { setSelectedSubscription(null); setDetailTab("details"); }} className="mt-1 p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="font-heading text-xl font-bold text-foreground flex items-center gap-2">
                <Globe className="w-5 h-5 text-primary" />
                {sub.name}
              </h1>
              <p className="text-sm text-foreground-muted mt-0.5 font-mono">{sub.subscription_id}</p>
            </div>
          </div>
          {/* Status badge */}
          <span className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-semibold",
            sub.status === "CONNECTED" ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25" :
            sub.status === "PENDING" ? "bg-amber-500/15 text-amber-400 border border-amber-500/25" :
            "bg-red-500/15 text-red-400 border border-red-500/25"
          )}>
            {sub.status === "CONNECTED" ? "Actif" : sub.status}
          </span>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border">
          {([
            { key: "details" as DetailTab, label: "Détails" },
            { key: "parties" as DetailTab, label: "Parties relayées" },
            { key: "diagnostic" as DetailTab, label: "Diagnostic" },
          ]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setDetailTab(tab.key)}
              className={cn(
                "px-4 py-2.5 text-sm font-medium transition-colors relative",
                detailTab === tab.key ? "text-primary" : "text-foreground-muted hover:text-foreground"
              )}
            >
              {tab.label}
              {detailTab === tab.key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />}
            </button>
          ))}
        </div>

        {/* Detail tab content */}
        {detailTab === "details" && (
          <div className="space-y-6">
            {/* Détails section */}
            <div className="bg-surface border border-border rounded-2xl p-6">
              <h2 className="text-lg font-semibold text-foreground mb-6">Détails</h2>
              <div className="grid grid-cols-2 gap-8">
                {/* Votre partie */}
                <div>
                  <h3 className="text-base font-semibold text-foreground mb-4">Votre partie</h3>
                  <div className="space-y-3">
                    <DetailField label="Partie impliquée" value={sub.our_country_code} />
                    <DetailField label="Date d'enregistrement" value={formatDate(sub.our_date)} />
                    <DetailField label="Identifiant abonnement" value={sub.subscription_id} mono />
                    <DetailField label="Version OCPI" value={sub.our_version} />
                    <DetailField label="Est un abonnement à la plate-forme">
                      <XCircle className="w-4 h-4 text-red-400" />
                    </DetailField>
                    <DetailField label="Rôle" value={sub.role} />
                    <DetailField label="Partie" value={`${sub.party} (GreenFlux)`} />
                    <DetailField label="URL d'abonnement" value={sub.our_url} mono />
                    <DetailField label="Token crypté" value={maskToken(sub.our_token)} mono />
                  </div>
                </div>

                {/* Autre partie */}
                <div>
                  <h3 className="text-base font-semibold text-foreground mb-4">Autre partie</h3>
                  <div className="space-y-3">
                    <DetailField label="Partie impliquée" value={sub.other_country_code} />
                    <DetailField label="Partie" value={sub.other_party} />
                    <DetailField label="Rôle" value={sub.other_party_role} />
                    <DetailField label="URL d'abonnement" value={sub.other_url} mono />
                    <DetailField label="Token crypté" value={maskToken(sub.other_token)} mono />
                    <DetailField label="Nom de diffusion" value={sub.other_broadcast_name} />
                    <DetailField label="URL du site Internet de l'OCPI" value={sub.other_website} />
                  </div>
                </div>
              </div>
            </div>

            {/* Modules section */}
            <div className="bg-surface border border-border rounded-2xl p-6">
              <h2 className="text-lg font-semibold text-foreground mb-6">Modules</h2>
              <div className="grid grid-cols-2 gap-8">
                {/* Votre partie modules */}
                <div>
                  <h3 className="text-base font-semibold text-foreground mb-4">Votre partie</h3>
                  <div className="space-y-2">
                    {OCPI_MODULES.map((mod) => (
                      <div key={mod} className="flex items-center justify-between py-1.5">
                        <span className="text-sm text-foreground flex items-center gap-1">
                          {mod}
                          <span className="text-foreground-muted text-xs cursor-help" title={`Module OCPI ${mod}`}>&#9432;</span>
                        </span>
                        {sub.modules_own.includes(mod) ? (
                          <CheckCircle className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-400" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Autre partie modules */}
                <div>
                  <h3 className="text-base font-semibold text-foreground mb-4">Autre partie</h3>
                  <div className="space-y-2">
                    {OCPI_MODULES.map((mod) => (
                      <div key={mod} className="flex items-center justify-between py-1.5">
                        <span className="text-sm text-foreground flex items-center gap-1">
                          {mod}
                          <span className="text-foreground-muted text-xs cursor-help" title={`Module OCPI ${mod}`}>&#9432;</span>
                        </span>
                        {sub.modules_other.includes(mod) ? (
                          <CheckCircle className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-400" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Configuration section */}
            <div className="bg-surface border border-border rounded-2xl p-6">
              <h2 className="text-lg font-semibold text-foreground mb-6">Configuration</h2>
              <div className="grid grid-cols-2 gap-8">
                {/* Own config */}
                <div className="space-y-2">
                  {CONFIG_OWN.map((cfg) => (
                    <div key={cfg.key} className="flex items-center justify-between py-1.5">
                      <span className="text-sm text-foreground flex items-center gap-1">
                        {cfg.label}
                        <span className="text-foreground-muted text-xs cursor-help" title={cfg.label}>&#9432;</span>
                      </span>
                      <XCircle className="w-4 h-4 text-red-400" />
                    </div>
                  ))}
                </div>

                {/* Other config */}
                <div className="space-y-2">
                  {CONFIG_OTHER.map((cfg) => (
                    <div key={cfg.key} className="flex items-center justify-between py-1.5">
                      <span className="text-sm text-foreground flex items-center gap-1">
                        {cfg.label}
                        <span className="text-foreground-muted text-xs cursor-help" title={cfg.label}>&#9432;</span>
                      </span>
                      <span className="text-sm text-foreground-muted font-mono">{cfg.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Operational buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => seedMutation.mutate()}
                disabled={seedMutation.isPending}
                className="flex items-center gap-2 px-4 py-2.5 bg-surface-elevated hover:bg-surface border border-border rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
              >
                <RefreshCw className={cn("w-4 h-4", seedMutation.isPending && "animate-spin")} />
                {seedMutation.isPending ? "Seeding..." : "Seed Locations"}
              </button>
              <button
                onClick={() => pushMutation.mutate()}
                disabled={pushMutation.isPending}
                className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white hover:bg-primary/90 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
              >
                <Send className={cn("w-4 h-4", pushMutation.isPending && "animate-spin")} />
                {pushMutation.isPending ? "Pushing..." : "Push to Gireve"}
              </button>
            </div>
          </div>
        )}

        {/* Parties relayées tab */}
        {detailTab === "parties" && (
          <div className="space-y-4">
            <CollapsibleSection title={`Autorisations de publication de CPO (${(cpoParties ?? []).length})`} defaultOpen>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className={thClass}>Nom</th>
                      <th className={thClass}>Identifiant externe</th>
                      <th className={thClass}>Contrat CPO</th>
                      <th className={thClass}>Code pays</th>
                      <th className={thClass}>Identifiant de groupe</th>
                      <th className={thClass}>Réseau CPO</th>
                    </tr>
                    {/* Filter row */}
                    <tr className="border-b border-border bg-surface-elevated/30">
                      <td className="px-3 py-2"><input placeholder="Recherche..." className={filterInputClass} /></td>
                      <td className="px-3 py-2"><input placeholder="Recherche..." className={filterInputClass} /></td>
                      <td className="px-3 py-2"><input placeholder="Recherche..." className={filterInputClass} /></td>
                      <td className="px-3 py-2"><input placeholder="Recherche..." className={filterInputClass} /></td>
                      <td className="px-3 py-2"><input placeholder="Recherche..." className={filterInputClass} /></td>
                      <td className="px-3 py-2"><input placeholder="Recherche..." className={filterInputClass} /></td>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {(cpoParties ?? []).map((cpo: Record<string, unknown>) => (
                      <tr key={cpo.id as string} className="hover:bg-surface-elevated/50 transition-colors">
                        <td className="px-3 py-2.5 text-sm text-foreground font-medium">{cpo.name as string}</td>
                        <td className="px-3 py-2.5 text-sm text-foreground-muted font-mono">{(cpo.external_id as string) ?? "—"}</td>
                        <td className="px-3 py-2.5 text-sm text-foreground-muted">{cpo.gfx_id ? `GFX ${cpo.country_code} GFX` : "—"}</td>
                        <td className="px-3 py-2.5 text-sm text-foreground-muted">{(cpo.country_code as string) ?? "FR"}</td>
                        <td className="px-3 py-2.5 text-sm text-foreground-muted">GFX</td>
                        <td className="px-3 py-2.5 text-sm text-foreground-muted">GreenFlux CPO Network</td>
                      </tr>
                    ))}
                    {(cpoParties ?? []).length === 0 && (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-foreground-muted text-sm">Aucune partie relayée</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CollapsibleSection>
          </div>
        )}

        {/* Diagnostic tab */}
        {detailTab === "diagnostic" && (
          <DiagnosticTab subscriptionId={sub.id} />
        )}
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════
  // LIST VIEW
  // ════════════════════════════════════════════════════════════
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-xl font-bold text-foreground flex items-center gap-2">
          <Globe className="w-5 h-5 text-primary" />
          Abonnements OCPI
        </h1>
      </div>

      {/* Tab */}
      <div className="flex gap-1 border-b border-border">
        <button className="px-4 py-2.5 text-sm font-medium text-primary relative">
          Normal
          <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
        </button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden divide-y divide-border">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="px-4 py-3.5 flex items-center gap-6">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      ) : processed.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 bg-surface border border-border rounded-2xl">
          <Globe className="w-10 h-10 text-foreground-muted mb-3" />
          <p className="text-foreground font-medium">Aucun abonnement OCPI</p>
          <p className="text-sm text-foreground-muted mt-1">Configurez vos credentials OCPI pour commencer.</p>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                {/* Column headers */}
                <tr className="border-b border-border">
                  <th className={thClass} onClick={() => handleSort("subscription_id")}>
                    Identifiant abonnement <SortIcon col="subscription_id" />
                  </th>
                  <th className={thClass} onClick={() => handleSort("name")}>
                    Nom <SortIcon col="name" />
                  </th>
                  <th className={thClass} onClick={() => handleSort("party")}>
                    Partie <SortIcon col="party" />
                  </th>
                  <th className={thClass} onClick={() => handleSort("role")}>
                    Rôle <SortIcon col="role" />
                  </th>
                  <th className={thClass} onClick={() => handleSort("other_party")}>
                    Autre partie <SortIcon col="other_party" />
                  </th>
                  <th className={thClass} onClick={() => handleSort("other_party_role")}>
                    Autre partie rôle <SortIcon col="other_party_role" />
                  </th>
                  <th className={thClass} onClick={() => handleSort("protocol")}>
                    Protocole <SortIcon col="protocol" />
                  </th>
                </tr>
                {/* Column filter inputs */}
                <tr className="border-b border-border bg-surface-elevated/30">
                  <td className="px-3 py-2">
                    <input placeholder="Recherche..." value={colFilters.subscription_id} onChange={(e) => { setColFilters((f) => ({ ...f, subscription_id: e.target.value })); setPage(1); }} className={filterInputClass} />
                  </td>
                  <td className="px-3 py-2">
                    <input placeholder="Recherche..." value={colFilters.name} onChange={(e) => { setColFilters((f) => ({ ...f, name: e.target.value })); setPage(1); }} className={filterInputClass} />
                  </td>
                  <td className="px-3 py-2">
                    <input placeholder="Recherche..." value={colFilters.party} onChange={(e) => { setColFilters((f) => ({ ...f, party: e.target.value })); setPage(1); }} className={filterInputClass} />
                  </td>
                  <td className="px-3 py-2">
                    <select value={colFilters.role} onChange={(e) => { setColFilters((f) => ({ ...f, role: e.target.value })); setPage(1); }} className={filterInputClass}>
                      <option value="">Filtrer...</option>
                      <option value="CPO">CPO</option>
                      <option value="eMSP">eMSP</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input placeholder="Recherche..." value={colFilters.other_party} onChange={(e) => { setColFilters((f) => ({ ...f, other_party: e.target.value })); setPage(1); }} className={filterInputClass} />
                  </td>
                  <td className="px-3 py-2">
                    <select value={colFilters.other_party_role} onChange={(e) => { setColFilters((f) => ({ ...f, other_party_role: e.target.value })); setPage(1); }} className={filterInputClass}>
                      <option value="">Filtrer...</option>
                      <option value="CPO">CPO</option>
                      <option value="eMSP">eMSP</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select value={colFilters.protocol} onChange={(e) => { setColFilters((f) => ({ ...f, protocol: e.target.value })); setPage(1); }} className={filterInputClass}>
                      <option value="">Filtrer...</option>
                      <option value="OCPI 2.1.1">OCPI 2.1.1</option>
                      <option value="OCPI 2.2.1">OCPI 2.2.1</option>
                    </select>
                  </td>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paginated.map((sub) => (
                  <tr
                    key={sub.id}
                    onClick={() => setSelectedSubscription(sub)}
                    className="hover:bg-surface-elevated/50 transition-colors cursor-pointer"
                  >
                    <td className="px-3 py-2.5 text-sm text-foreground-muted font-mono truncate max-w-[200px]">
                      {sub.subscription_id.slice(0, 28)}...
                    </td>
                    <td className="px-3 py-2.5 text-sm text-foreground truncate max-w-[260px]">
                      {sub.name}
                    </td>
                    <td className="px-3 py-2.5 text-sm text-foreground-muted">
                      {sub.party}
                    </td>
                    <td className="px-3 py-2.5 text-sm text-foreground-muted">
                      {sub.role}
                    </td>
                    <td className="px-3 py-2.5 text-sm text-foreground-muted truncate max-w-[200px]">
                      {sub.other_party}
                    </td>
                    <td className="px-3 py-2.5 text-sm text-foreground-muted">
                      {sub.other_party_role}
                    </td>
                    <td className="px-3 py-2.5 text-sm text-foreground-muted">
                      {sub.protocol}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <span className="text-xs text-foreground-muted">
              retrieved on {new Date().toLocaleDateString("fr-FR")} @ {new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
            <div className="flex items-center gap-4">
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground disabled:opacity-30 transition-colors">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs text-foreground-muted px-2">{safePage} / {totalPages}</span>
                  <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground disabled:opacity-30 transition-colors">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
              <span className="text-xs text-foreground-muted">
                montrer {processed.length} enregistrements
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────

function DetailField({ label, value, mono, children }: { label: string; value?: string; mono?: boolean; children?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <span className="text-sm text-foreground-muted shrink-0">{label}</span>
      {children ? (
        <span className="text-sm text-foreground text-right">{children}</span>
      ) : (
        <span className={cn("text-sm text-foreground text-right truncate max-w-[300px]", mono && "font-mono text-xs")}>{value ?? "—"}</span>
      )}
    </div>
  );
}

function CollapsibleSection({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-surface-elevated/50 transition-colors"
      >
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {open ? <ChevronDown className="w-4 h-4 text-foreground-muted" /> : <ChevronRight className="w-4 h-4 text-foreground-muted" />}
      </button>
      {open && <div className="border-t border-border">{children}</div>}
    </div>
  );
}

function DiagnosticTab({ subscriptionId }: { subscriptionId: string }) {
  const { data: recentLogs, isLoading } = useQuery({
    queryKey: ["ocpi-push-logs", subscriptionId],
    queryFn: async () => {
      const { data } = await supabase
        .from("ocpi_push_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30);
      return data ?? [];
    },
    refetchInterval: 15000,
  });

  const { data: pushQueuePending } = useQuery({
    queryKey: ["ocpi-push-pending"],
    queryFn: async () => {
      const { count } = await supabase.from("ocpi_push_queue").select("*", { count: "exact", head: true }).in("status", ["PENDING", "RETRY"]);
      return count ?? 0;
    },
    refetchInterval: 10000,
  });

  const { data: pushQueueFailed } = useQuery({
    queryKey: ["ocpi-push-failed"],
    queryFn: async () => {
      const { count } = await supabase.from("ocpi_push_queue").select("*", { count: "exact", head: true }).eq("status", "FAILED");
      return count ?? 0;
    },
  });

  return (
    <div className="space-y-6">
      {/* Push Queue Status */}
      <div className="bg-surface border border-border rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">File d'attente Push</h2>
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-surface-elevated rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{pushQueuePending ?? 0}</p>
            <p className="text-xs text-foreground-muted mt-1">En attente</p>
          </div>
          <div className="bg-surface-elevated rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-red-400">{pushQueueFailed ?? 0}</p>
            <p className="text-xs text-foreground-muted mt-1">Échoués</p>
          </div>
          <div className="bg-surface-elevated rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-emerald-400">{(recentLogs ?? []).filter((l: Record<string, unknown>) => (l.response_status as number) >= 200 && (l.response_status as number) < 300).length}</p>
            <p className="text-xs text-foreground-muted mt-1">Succès récents</p>
          </div>
        </div>
      </div>

      {/* Endpoints */}
      <div className="bg-surface border border-border rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Endpoints OCPI exposés</h2>
        <div className="space-y-1.5 text-xs font-mono">
          {[
            "GET  /versions", "GET  /2.2.1", "POST /2.2.1/credentials",
            "GET  /2.2.1/locations", "GET  /2.2.1/tariffs", "GET  /2.2.1/sessions",
            "GET  /2.2.1/cdrs", "GET  /2.2.1/tokens",
            "POST /2.2.1/tokens/{uid}/authorize",
            "POST /2.2.1/commands/START_SESSION", "POST /2.2.1/commands/STOP_SESSION",
          ].map((ep) => (
            <div key={ep} className="flex items-center gap-2 text-foreground-muted py-0.5">
              <CheckCircle className="w-3 h-3 text-emerald-400 shrink-0" />
              <span>{ep}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Logs */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Derniers logs OCPI</h2>
        </div>
        {isLoading ? (
          <div className="p-6 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-foreground-muted uppercase">Date</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-foreground-muted uppercase">Module</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-foreground-muted uppercase">Action</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-foreground-muted uppercase">Path</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-foreground-muted uppercase">Status</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-foreground-muted uppercase">Durée</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(recentLogs ?? []).map((log: Record<string, unknown>) => (
                  <tr key={log.id as string} className="hover:bg-surface-elevated/50 transition-colors">
                    <td className="px-4 py-2.5 text-xs text-foreground-muted whitespace-nowrap">{new Date(log.created_at as string).toLocaleString("fr-FR")}</td>
                    <td className="px-4 py-2.5 text-xs font-medium text-foreground">{log.module as string}</td>
                    <td className="px-4 py-2.5">
                      <span className="px-2 py-0.5 rounded bg-primary/15 text-primary text-xs font-medium">{log.action as string}</span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-foreground-muted truncate max-w-[200px]">{log.ocpi_path as string}</td>
                    <td className="px-4 py-2.5">
                      <span className={cn(
                        "px-2 py-0.5 rounded text-xs font-medium",
                        (log.response_status as number) >= 200 && (log.response_status as number) < 300 ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
                      )}>
                        {log.response_status as number}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-foreground-muted">{log.duration_ms as number}ms</td>
                  </tr>
                ))}
                {(recentLogs ?? []).length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-foreground-muted">Aucun log</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
