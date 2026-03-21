// ============================================================
// EZDrive — Locations Page (GreenFlux-style)
// Flat table of charging sites → click "Editer" → full-page edit
// ============================================================

import { useState, useMemo, useEffect, useCallback } from "react";
import { useStations } from "@/hooks/useStations";
import { useCPOs } from "@/hooks/useCPOs";
import { useCpo } from "@/contexts/CpoContext";
import { useQueryClient } from "@tanstack/react-query";
import {
  MapPin,
  Plus,
  ChevronDown,
  X,
  Loader2,
  ArrowLeft,
  Save,
  AlertCircle,
  Globe,
  RefreshCcw,
  Send,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { apiPost, apiPut, apiDelete } from "@/lib/api";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/contexts/ToastContext";
import type { Station } from "@/types/station";
import { OcpiPushModal } from "@/components/ocpi/OcpiPushModal";
import { LocationPhotoManager } from "@/components/locations/LocationPhotoManager";

// ── Types ────────────────────────────────────────────────────

type LocationTab = "normal" | "published" | "unpublished" | "sync";
type EditTab = "site" | "groups";

interface LocationRow {
  id: string;
  published: boolean;
  name: string;
  street: string;
  houseNumber: string;
  postalCode: string;
  city: string;
  country: string;
  chargerCount: number;
  energyProfile: string;
  greenEnergy: boolean;
  isPrivate: boolean;
  station: Station; // underlying station for edit
}

// ── Helpers ──────────────────────────────────────────────────

function parseConnectorCount(station: Station): number {
  if (!station.connectors) return 0;
  if (Array.isArray(station.connectors)) return station.connectors.length;
  if (typeof station.connectors === "string") {
    try { return JSON.parse(station.connectors).length; } catch { return 0; }
  }
  return 0;
}

function stationToRow(station: Station): LocationRow {
  // Try to extract house number from address (e.g. "12 rue de la Paix" -> "12")
  const addr = station.address ?? "";
  const houseMatch = addr.match(/^(\d+\s*(?:bis|ter)?)\s/i);
  const houseNumber = houseMatch ? houseMatch[1] : "";
  const street = houseMatch ? addr.slice(houseMatch[0].length).trim() : addr;

  return {
    id: station.id,
    published: (station as any).is_public !== false,
    name: station.name,
    street,
    houseNumber,
    postalCode: station.postal_code ?? "",
    city: station.city ?? "",
    country: "FRA",
    chargerCount: parseConnectorCount(station),
    energyProfile: "",
    greenEnergy: false,
    isPrivate: station.charger_type !== "Public",
    station,
  };
}

// ══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════

export function LocationsPage() {
  const { selectedCpoId } = useCpo();
  const { data: stations, isLoading, isError, refetch, dataUpdatedAt } = useStations(selectedCpoId);
  const [editingStation, setEditingStation] = useState<Station | null>(null);
  const queryClient = useQueryClient();

  const handleSaved = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["stations"] });
    setEditingStation(null);
  }, [queryClient]);

  // Level 2: Edit view (full page)
  if (editingStation) {
    return (
      <LocationEditView
        station={editingStation}
        onBack={() => setEditingStation(null)}
        onSaved={handleSaved}
      />
    );
  }

  // Level 1: Location list
  return (
    <LocationListView
      stations={stations ?? []}
      isLoading={isLoading}
      isError={isError}
      refetch={refetch}
      dataUpdatedAt={dataUpdatedAt}
      onEdit={setEditingStation}
    />
  );
}

// ══════════════════════════════════════════════════════════════
// LOCATION LIST VIEW
// ══════════════════════════════════════════════════════════════

function LocationListView({
  stations,
  isLoading,
  isError,
  refetch,
  dataUpdatedAt,
  onEdit,
}: {
  stations: Station[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  dataUpdatedAt: number;
  onEdit: (station: Station) => void;
}) {
  const [activeTab, setActiveTab] = useState<LocationTab>("normal");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showPushModal, setShowPushModal] = useState(false);
  const [pushLocationId, setPushLocationId] = useState<string | undefined>(undefined);
  const [syncingTokens, setSyncingTokens] = useState(false);
  const [syncTokensResult, setSyncTokensResult] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LocationRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Column search filters
  const [filterName, setFilterName] = useState("");
  const [filterStreet, setFilterStreet] = useState("");
  const [filterHouseNo, setFilterHouseNo] = useState("");
  const [filterPostal, setFilterPostal] = useState("");
  const [filterCity, setFilterCity] = useState("");
  const [filterCountry, setFilterCountry] = useState("");

  const rows = useMemo(() => stations.map(stationToRow), [stations]);

  const filtered = useMemo(() => {
    let result = rows;

    // Tab filter
    if (activeTab === "published") result = result.filter((r) => r.published);
    else if (activeTab === "unpublished") result = result.filter((r) => !r.published);

    // Column filters
    if (filterName) { const q = filterName.toLowerCase(); result = result.filter((r) => r.name.toLowerCase().includes(q)); }
    if (filterStreet) { const q = filterStreet.toLowerCase(); result = result.filter((r) => r.street.toLowerCase().includes(q)); }
    if (filterHouseNo) { const q = filterHouseNo.toLowerCase(); result = result.filter((r) => r.houseNumber.toLowerCase().includes(q)); }
    if (filterPostal) { const q = filterPostal.toLowerCase(); result = result.filter((r) => r.postalCode.toLowerCase().includes(q)); }
    if (filterCity) { const q = filterCity.toLowerCase(); result = result.filter((r) => r.city.toLowerCase().includes(q)); }
    if (filterCountry) { const q = filterCountry.toLowerCase(); result = result.filter((r) => r.country.toLowerCase().includes(q)); }

    return result;
  }, [rows, activeTab, filterName, filterStreet, filterHouseNo, filterPostal, filterCity, filterCountry]);

  const TABS: { key: LocationTab; label: string }[] = [
    { key: "normal", label: "Normal" },
    { key: "published", label: "Publie" },
    { key: "unpublished", label: "Depublier" },
    { key: "sync", label: "Synchronisation" },
  ];

  async function handleTogglePublish(stationId: string, currentlyPublished: boolean) {
    try {
      const { error } = await supabase
        .from("stations")
        .update({ is_public: !currentlyPublished })
        .eq("id", stationId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["stations"] });
    } catch (err) {
      console.error("Toggle publish failed:", err);
    }
  }

  async function handleSyncTokens() {
    setSyncingTokens(true);
    setSyncTokensResult(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("api", {
        body: { action: "ocpi_sync_tokens" },
      });
      if (invokeError) throw invokeError;
      const count = data?.synced_count ?? data?.count ?? 0;
      setSyncTokensResult(`${count} token(s) synchronise(s)`);
      setTimeout(() => setSyncTokensResult(null), 4000);
    } catch (err) {
      setSyncTokensResult(`Erreur: ${err instanceof Error ? err.message : "inconnue"}`);
      setTimeout(() => setSyncTokensResult(null), 5000);
    } finally {
      setSyncingTokens(false);
    }
  }

  async function handleDeleteLocation() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiDelete("admin-stations/" + deleteTarget.id);
      queryClient.invalidateQueries({ queryKey: ["stations"] });
      toast("Location supprimée avec succès", "success");
      setDeleteTarget(null);
    } catch (err) {
      // Fallback to direct Supabase delete
      try {
        const { error } = await supabase.from("stations").delete().eq("id", deleteTarget.id);
        if (error) throw error;
        queryClient.invalidateQueries({ queryKey: ["stations"] });
        toast("Location supprimée avec succès", "success");
        setDeleteTarget(null);
      } catch (fallbackErr) {
        toast("Erreur lors de la suppression : " + (fallbackErr instanceof Error ? fallbackErr.message : "inconnue"), "error");
      }
    } finally {
      setDeleting(false);
    }
  }

  function openPushModalForAll() {
    setPushLocationId(undefined);
    setShowPushModal(true);
  }

  function openPushModalForLocation(locationId: string) {
    setPushLocationId(locationId);
    setShowPushModal(true);
  }

  return (
    <div className="space-y-0">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <MapPin className="w-5 h-5 text-primary" />
          <h1 className="font-heading text-xl font-bold text-foreground">
            Sites de charge ({stations.length})
          </h1>
          <ChevronDown className="w-5 h-5 text-foreground-muted" />
        </div>
        <div className="flex items-center gap-2">
          {/* Sync tokens */}
          <div className="relative">
            <button
              onClick={handleSyncTokens}
              disabled={syncingTokens}
              className="flex items-center gap-1.5 px-3 py-2 border border-border text-foreground-muted rounded-xl text-sm font-medium hover:bg-surface-elevated hover:text-foreground transition-colors disabled:opacity-50"
              title="Synchroniser les tokens OCPI"
            >
              {syncingTokens ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCcw className="w-4 h-4" />
              )}
              Sync tokens
            </button>
            {syncTokensResult && (
              <div className="absolute top-full mt-1 right-0 whitespace-nowrap px-3 py-1.5 rounded-lg bg-surface-elevated border border-border text-xs text-foreground shadow-lg z-10">
                {syncTokensResult}
              </div>
            )}
          </div>
          {/* Push all */}
          <button
            onClick={openPushModalForAll}
            className="flex items-center gap-1.5 px-3 py-2 border border-primary/30 text-primary rounded-xl text-sm font-medium hover:bg-primary/10 transition-colors"
            title="Pousser toutes les locations vers les partenaires OCPI"
          >
            <Globe className="w-4 h-4" />
            Push toutes
          </button>
          {/* Add */}
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            + Ajouter Nouveau
            <ChevronDown className="w-3.5 h-3.5 ml-1" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-6 border-b border-border mb-0">
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

      {/* Error banner */}
      {isError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mx-6 mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-red-700">
            <AlertCircle className="h-5 w-5" />
            <span>Erreur lors du chargement des données. Veuillez réessayer.</span>
          </div>
          <button onClick={() => refetch()} className="text-red-700 hover:text-red-900 font-medium text-sm">
            Réessayer
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-surface border border-border rounded-b-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="w-10 px-3 py-2"><input type="checkbox" className="rounded border-border" disabled /></th>
                <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Publie</th>
                <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Nom</th>
                <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Rue</th>
                <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">N° de maison</th>
                <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Code postal</th>
                <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Ville</th>
                <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Pays</th>
                <th className="text-right py-2 px-3 text-xs font-semibold text-foreground-muted uppercase"># Chargeurs</th>
                <th className="text-left py-2 px-3 text-xs font-semibold text-foreground-muted uppercase">Profil</th>
                <th className="text-right py-2 px-3 text-xs font-semibold text-foreground-muted uppercase min-w-[120px]">Actions</th>
              </tr>
              {/* Filter row */}
              <tr className="border-b border-border bg-surface-elevated/30">
                <td className="px-3 py-1.5"><span className="text-xs text-foreground-muted">Tout</span></td>
                <td className="px-3 py-1.5"></td>
                <td className="px-3 py-1.5"><FilterInput value={filterName} onChange={setFilterName} /></td>
                <td className="px-3 py-1.5"><FilterInput value={filterStreet} onChange={setFilterStreet} /></td>
                <td className="px-3 py-1.5"><FilterInput value={filterHouseNo} onChange={setFilterHouseNo} /></td>
                <td className="px-3 py-1.5"><FilterInput value={filterPostal} onChange={setFilterPostal} /></td>
                <td className="px-3 py-1.5"><FilterInput value={filterCity} onChange={setFilterCity} /></td>
                <td className="px-3 py-1.5"><FilterInput value={filterCountry} onChange={setFilterCountry} /></td>
                <td className="px-3 py-1.5"></td>
                <td className="px-3 py-1.5"></td>
                <td className="px-3 py-1.5"></td>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={11} className="py-12 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-foreground-muted" /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={11} className="py-12 text-center text-foreground-muted text-sm">Aucun site de charge trouve</td></tr>
              ) : filtered.map((row) => (
                <tr key={row.id} className="border-b border-border/50 hover:bg-surface-elevated/30 transition-colors">
                  <td className="px-3 py-2.5"><input type="checkbox" className="rounded border-border" disabled /></td>
                  <td className="px-3 py-2.5">
                    <PublishBadge published={row.published} onClick={() => handleTogglePublish(row.id, row.published)} />
                  </td>
                  <td className="px-3 py-2.5 text-foreground font-medium">{row.name}</td>
                  <td className="px-3 py-2.5 text-foreground">{row.street || "\u2014"}</td>
                  <td className="px-3 py-2.5 text-foreground">{row.houseNumber || ""}</td>
                  <td className="px-3 py-2.5 text-foreground">{row.postalCode}</td>
                  <td className="px-3 py-2.5 text-foreground">{row.city}</td>
                  <td className="px-3 py-2.5 text-foreground">{row.country}</td>
                  <td className="px-3 py-2.5 text-right text-foreground">{row.chargerCount || ""}</td>
                  <td className="px-3 py-2.5 text-foreground-muted">{row.energyProfile || ""}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openPushModalForLocation(row.id)}
                        className="flex items-center gap-1 px-2 py-1 text-foreground-muted rounded-lg text-xs font-medium hover:bg-surface-elevated hover:text-primary transition-colors"
                        title="Push OCPI"
                      >
                        <Send className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => onEdit(row.station)}
                        className="flex items-center gap-1 px-3 py-1 bg-primary/10 text-primary rounded-lg text-xs font-medium hover:bg-primary/20 transition-colors"
                      >
                        Editer
                      </button>
                      <button
                        onClick={() => setDeleteTarget(row)}
                        className="flex items-center gap-1 px-2 py-1 text-red-400 rounded-lg text-xs font-medium hover:bg-red-500/10 transition-colors"
                        title="Supprimer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border text-xs text-foreground-muted">
          <span>
            recupere le {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "\u2014"}
          </span>
          <span>
            <span className="text-primary underline cursor-pointer">0 enregistrements selectionne</span>
            {" | "}
            montrer {filtered.length} of {stations.length} enregistrements
          </span>
        </div>
      </div>

      {/* Add Location Modal */}
      {showAddModal && (
        <AddLocationModal
          onClose={() => setShowAddModal(false)}
          onSaved={() => {
            setShowAddModal(false);
            queryClient.invalidateQueries({ queryKey: ["stations"] });
          }}
        />
      )}

      {/* OCPI Push Modal */}
      <OcpiPushModal
        open={showPushModal}
        onClose={() => setShowPushModal(false)}
        locationId={pushLocationId}
      />

      {/* Delete Location Confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onConfirm={handleDeleteLocation}
        onCancel={() => setDeleteTarget(null)}
        title="Supprimer la location"
        description={`Supprimer la location ${deleteTarget?.name ?? ""} ? Cette action est irréversible.`}
        confirmLabel="Supprimer"
        variant="danger"
        loading={deleting}
        loadingLabel="Suppression..."
      />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// LOCATION EDIT VIEW (Full-page, GreenFlux-style)
// ══════════════════════════════════════════════════════════════

const FACILITY_OPTIONS = [
  { key: "hotel", label: "Hotel", emoji: "🏨" },
  { key: "restaurant", label: "Restaurant", emoji: "🍴" },
  { key: "cafe", label: "Cafe", emoji: "☕" },
  { key: "shopping_mall", label: "Centre commercial", emoji: "🏬" },
  { key: "supermarket", label: "Supermarche", emoji: "🛒" },
  { key: "sport", label: "Sport", emoji: "⚽" },
  { key: "recreation_area", label: "Zone de loisirs", emoji: "🎡" },
  { key: "nature", label: "Nature", emoji: "🌲" },
  { key: "museum", label: "Musee", emoji: "🏛" },
  { key: "bus_stop", label: "Arret de bus", emoji: "🚏" },
  { key: "taxi_stand", label: "Station de taxi", emoji: "🚕" },
  { key: "train_station", label: "Gare", emoji: "🚉" },
  { key: "airport", label: "Aeroport", emoji: "✈️" },
  { key: "carpool_parking", label: "Parking de covoiturage", emoji: "🅿️" },
  { key: "fuel_station", label: "Station essence", emoji: "⛽" },
  { key: "wifi", label: "Wi-Fi", emoji: "📶" },
];

const SITE_TYPES = [
  { value: "ON_STREET", label: "On Street" },
  { value: "PARKING_GARAGE", label: "Parking Garage" },
  { value: "PARKING_LOT", label: "Parking Lot" },
  { value: "UNDERGROUND_GARAGE", label: "Underground Garage" },
  { value: "OTHER", label: "Other" },
];

function LocationEditView({
  station,
  onBack,
  onSaved,
}: {
  station: Station;
  onBack: () => void;
  onSaved: () => void;
}) {
  const { data: cpos, isError: _isCposError } = useCPOs();
  const [activeTab, setActiveTab] = useState<EditTab>("site");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [cpoId, setCpoId] = useState(station.cpo_id ?? "");
  const [cpoContract, setCpoContract] = useState("");
  const [siteName, setSiteName] = useState(station.name);
  const [street, setStreet] = useState(station.address ?? "");
  const [houseNumber, setHouseNumber] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [postalCode, setPostalCode] = useState(station.postal_code ?? "");
  const [city, setCity] = useState(station.city ?? "");
  const [country, setCountry] = useState("FRA");
  const [lat, setLat] = useState(station.latitude?.toString() ?? "");
  const [lng, setLng] = useState(station.longitude?.toString() ?? "");
  const [siteType, setSiteType] = useState("OTHER");
  const [directions, setDirections] = useState("");
  const [isPublished, setIsPublished] = useState((station as any).is_public !== false);
  const [isRestricted, setIsRestricted] = useState(station.charger_type === "Business");
  const [qrScan, setQrScan] = useState(false);
  const [facilities, setFacilities] = useState<Set<string>>(new Set());

  // Extract house number from address on init
  useEffect(() => {
    const addr = station.address ?? "";
    const match = addr.match(/^(\d+\s*(?:bis|ter)?)\s/i);
    if (match) {
      setHouseNumber(match[1]);
      setStreet(addr.slice(match[0].length).trim());
    }
  }, [station.address]);

  function toggleFacility(key: string) {
    setFacilities((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const fullAddress = houseNumber ? `${houseNumber} ${street}` : street;
      await apiPut(`admin-stations/${station.id}`, {
        name: siteName,
        address: fullAddress || null,
        address_line_2: addressLine2 || null,
        city: city || null,
        postal_code: postalCode || null,
        country: country || null,
        latitude: lat ? parseFloat(lat) : null,
        longitude: lng ? parseFloat(lng) : null,
        cpo_id: cpoId || null,
        is_public: isPublished,
        site_type: siteType || null,
        directions: directions || null,
        is_restricted: isRestricted,
        qr_scan_enabled: qrScan,
        facilities: facilities.size > 0 ? Array.from(facilities) : null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de la sauvegarde");
    } finally {
      setSaving(false);
    }
  }

  const subtitle = "Editer Site";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="p-2 rounded-xl border border-border hover:bg-surface-elevated transition-colors" title="Retour">
          <ArrowLeft className="w-4 h-4 text-foreground-muted" />
        </button>
        <div className="flex items-center gap-3">
          <MapPin className="w-5 h-5 text-primary" />
          <div>
            <h1 className="font-heading text-xl font-bold text-foreground">{station.name}</h1>
            <p className="text-sm text-foreground-muted">{subtitle}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-6 border-b border-border">
        <button
          onClick={() => setActiveTab("site")}
          className={cn("pb-2.5 text-sm font-medium transition-colors relative", activeTab === "site" ? "text-primary" : "text-foreground-muted hover:text-foreground")}
        >
          Site
          {activeTab === "site" && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />}
        </button>
        <button
          onClick={() => setActiveTab("groups")}
          className={cn("pb-2.5 text-sm font-medium transition-colors relative", activeTab === "groups" ? "text-primary" : "text-foreground-muted hover:text-foreground")}
        >
          Groupes
          {activeTab === "groups" && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />}
        </button>
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">{error}</p>
      )}

      {activeTab === "site" ? (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-8">
          {/* LEFT COLUMN: Operator + Site */}
          <div className="space-y-8">
            {/* Operator section */}
            <div>
              <h2 className="text-base font-semibold text-foreground mb-4">Operateur</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-foreground mb-1">CPO <span className="text-red-400">*</span></label>
                  <select
                    value={cpoId}
                    onChange={(e) => setCpoId(e.target.value)}
                    className="w-full px-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50"
                  >
                    <option value="">Selectionner...</option>
                    {(cpos ?? []).map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-foreground mb-1">Contrat CPO:</label>
                  <input
                    type="text"
                    value={cpoContract}
                    onChange={(e) => setCpoContract(e.target.value)}
                    placeholder="GFX FR GFX"
                    className="w-full px-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50"
                  />
                </div>
              </div>
            </div>

            {/* Site section */}
            <div>
              <h2 className="text-base font-semibold text-foreground mb-4">Site</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-foreground mb-1">Nom du site <span className="text-red-400">*</span></label>
                  <input
                    type="text"
                    value={siteName}
                    onChange={(e) => setSiteName(e.target.value)}
                    className="w-full px-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50"
                  />
                </div>


                <div className="grid grid-cols-[1fr_120px] gap-3">
                  <div>
                    <label className="block text-sm text-foreground mb-1">Rue <span className="text-red-400">*</span></label>
                    <input
                      type="text"
                      value={street}
                      onChange={(e) => setStreet(e.target.value)}
                      className="w-full px-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-foreground mb-1">Numero de maison</label>
                    <input
                      type="text"
                      value={houseNumber}
                      onChange={(e) => setHouseNumber(e.target.value)}
                      className="w-full px-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-foreground mb-1">Ligne d'adresse 2</label>
                  <input
                    type="text"
                    value={addressLine2}
                    onChange={(e) => setAddressLine2(e.target.value)}
                    placeholder="Saisissez eventuellement toute information complementaire sur l'adresse..."
                    className="w-full px-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50"
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm text-foreground mb-1">Code postal <span className="text-red-400">*</span></label>
                    <input
                      type="text"
                      value={postalCode}
                      onChange={(e) => setPostalCode(e.target.value)}
                      className="w-full px-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-foreground mb-1">Ville <span className="text-red-400">*</span></label>
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="w-full px-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-foreground mb-1">Pays</label>
                    <input
                      type="text"
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      className="w-full px-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50"
                    />
                  </div>
                </div>

                {/* Map placeholder */}
                <div className="w-full h-56 bg-surface-elevated border border-border rounded-xl flex items-center justify-center">
                  {lat && lng ? (
                    <div className="text-center">
                      <MapPin className="w-8 h-8 text-primary mx-auto mb-2" />
                      <p className="text-xs text-foreground-muted">{parseFloat(lat).toFixed(4)}, {parseFloat(lng).toFixed(4)}</p>
                    </div>
                  ) : (
                    <p className="text-xs text-foreground-muted">Carte - saisissez les coordonnees GPS</p>
                  )}
                </div>

                {/* Lat/Lng toggle */}
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-foreground-muted cursor-pointer">
                    <div className="relative">
                      <input type="checkbox" className="sr-only peer" checked={!!(lat && lng)} readOnly />
                      <div className="w-9 h-5 bg-border rounded-full peer-checked:bg-primary transition-colors" />
                      <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow peer-checked:translate-x-4 transition-transform" />
                    </div>
                    lat / long personnalise
                  </label>
                </div>
                {(lat || lng) && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm text-foreground mb-1">Latitude</label>
                      <input type="number" step="any" value={lat} onChange={(e) => setLat(e.target.value)}
                        className="w-full px-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50" />
                    </div>
                    <div>
                      <label className="block text-sm text-foreground mb-1">Longitude</label>
                      <input type="number" step="any" value={lng} onChange={(e) => setLng(e.target.value)}
                        className="w-full px-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50" />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Site info, facilities, settings */}
          <div className="space-y-8">
            {/* Information sur le site */}
            <div>
              <h2 className="text-base font-semibold text-foreground mb-4">Information sur le site</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-foreground mb-1">Profil des sources d'energie</label>
                  <input
                    type="text"
                    placeholder="Saisissez le nom d'un autre profil..."
                    className="w-full px-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50"
                  />
                </div>

                {/* Installations (facilities grid) */}
                <div>
                  <label className="block text-sm text-foreground mb-2">Installations</label>
                  <div className="grid grid-cols-2 gap-2">
                    {FACILITY_OPTIONS.map((f) => (
                      <label key={f.key} className="flex items-center gap-2 text-sm text-foreground cursor-pointer py-1">
                        <input
                          type="checkbox"
                          checked={facilities.has(f.key)}
                          onChange={() => toggleFacility(f.key)}
                          className="rounded border-border text-primary focus:ring-primary"
                        />
                        <span>{f.emoji}</span>
                        <span>{f.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Type de site */}
                <div>
                  <label className="block text-sm text-foreground mb-1">Type de site</label>
                  <select
                    value={siteType}
                    onChange={(e) => setSiteType(e.target.value)}
                    className="w-full px-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50"
                  >
                    {SITE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>

                {/* Instructions pour aller vers le site */}
                <div>
                  <label className="block text-sm text-foreground mb-1">Instructions pour aller vers le site</label>
                  <textarea
                    value={directions}
                    onChange={(e) => setDirections(e.target.value)}
                    placeholder="Saisissez eventuellement des instructions ici..."
                    rows={3}
                    className="w-full px-3 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50 resize-none"
                  />
                </div>

                {/* Toggles */}
                <div className="flex items-center gap-8 pt-2">
                  <ToggleSwitch label="Publie" checked={isPublished} onChange={setIsPublished} tooltip="Rendre ce site visible aux operateurs partenaires" />
                  <ToggleSwitch label="Acces restreint" checked={isRestricted} onChange={setIsRestricted} tooltip="Limiter l'acces a ce site" />
                  <ToggleSwitch label="Scan du code QR" checked={qrScan} onChange={setQrScan} tooltip="Activer le scan QR pour demarrer une charge" />
                </div>
              </div>
            </div>

            {/* Collapsible sections */}
            <CollapsibleSection title="Heures D'ouverture Regulieres">
              <p className="text-sm text-foreground-muted py-4">Aucune heure d'ouverture configuree. Ce site est considere comme ouvert 24h/24.</p>
            </CollapsibleSection>

            <CollapsibleSection title="Exceptions Aux Heures D'ouverture">
              <p className="text-sm text-foreground-muted py-4">Aucune exception configuree.</p>
            </CollapsibleSection>

            <CollapsibleSection title="Emplacement Paiement Portefeuille">
              <p className="text-sm text-foreground-muted py-4">Aucun emplacement de paiement configure.</p>
            </CollapsibleSection>

            {/* Photos OCPI */}
            <LocationPhotoManager
              locationId={station.id}
              existingPhotos={
                (station as any).photos?.map((p: any) => ({
                  url: typeof p === "string" ? p : p.url,
                  category: (typeof p === "object" && p.category) || "LOCATION",
                })) ?? []
              }
              onPhotosChange={(photos) => {
                // Store photos on the station object for save
                (station as any)._pendingPhotos = photos;
              }}
            />
          </div>
        </div>
      ) : (
        /* Groups tab */
        <div className="bg-surface border border-border rounded-2xl p-8">
          <div className="flex flex-col items-center justify-center py-12 text-foreground-muted">
            <MapPin className="w-10 h-10 mb-3 text-foreground-muted/50" />
            <p className="text-sm">Aucun groupe configure pour ce site.</p>
            <p className="text-xs mt-1 text-foreground-muted/60">Les groupes permettent d'organiser les EVSE de ce site.</p>
          </div>
        </div>
      )}

      {/* Save bar */}
      <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
        <button
          onClick={onBack}
          className="px-4 py-2 text-sm text-foreground-muted hover:text-foreground transition-colors"
        >
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
  );
}

// ══════════════════════════════════════════════════════════════
// ADD LOCATION MODAL
// ══════════════════════════════════════════════════════════════

function AddLocationModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [formName, setFormName] = useState("");
  const [formAddress, setFormAddress] = useState("");
  const [formCity, setFormCity] = useState("");
  const [formPostalCode, setFormPostalCode] = useState("");
  const [formLat, setFormLat] = useState("");
  const [formLng, setFormLng] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiPost("admin-stations", {
        name: formName,
        address: formAddress || null,
        city: formCity,
        postal_code: formPostalCode || null,
        latitude: formLat ? parseFloat(formLat) : null,
        longitude: formLng ? parseFloat(formLng) : null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-surface border border-border rounded-2xl w-full max-w-md shadow-xl overflow-hidden">
          <div className="flex items-center justify-between p-5 border-b border-border">
            <h2 className="font-heading font-bold text-base text-foreground">Ajouter un site</h2>
            <button onClick={onClose} className="p-1.5 hover:bg-surface-elevated rounded-lg transition-colors">
              <X className="w-4 h-4 text-foreground-muted" />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto max-h-[70vh]">
            <div>
              <label className="block text-xs font-medium text-foreground-muted mb-1">Nom <span className="text-red-400">*</span></label>
              <input type="text" required value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Station EZDrive"
                className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50" />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground-muted mb-1">Adresse</label>
              <input type="text" value={formAddress} onChange={(e) => setFormAddress(e.target.value)} placeholder="12 rue de la Paix"
                className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-foreground-muted mb-1">Ville <span className="text-red-400">*</span></label>
                <input type="text" required value={formCity} onChange={(e) => setFormCity(e.target.value)} placeholder="Pointe-a-Pitre"
                  className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground-muted mb-1">Code postal</label>
                <input type="text" value={formPostalCode} onChange={(e) => setFormPostalCode(e.target.value)} placeholder="97110"
                  className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-foreground-muted mb-1">Latitude</label>
                <input type="number" step="any" value={formLat} onChange={(e) => setFormLat(e.target.value)} placeholder="16.0000"
                  className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground-muted mb-1">Longitude</label>
                <input type="number" step="any" value={formLng} onChange={(e) => setFormLng(e.target.value)} placeholder="-61.7000"
                  className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50" />
              </div>
            </div>
            {error && <p className="text-xs text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">{error}</p>}
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={onClose} className="flex-1 py-2 rounded-xl border border-border text-sm text-foreground-muted hover:text-foreground transition-colors">Annuler</button>
              <button type="submit" disabled={loading} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Creer le site"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

// ══════════════════════════════════════════════════════════════
// SHARED SUB-COMPONENTS
// ══════════════════════════════════════════════════════════════

function FilterInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Recherche..."
      className="w-full px-2 py-1 bg-surface border border-border rounded-lg text-xs text-foreground placeholder:text-foreground-muted/40 focus:outline-none focus:border-primary/50"
    />
  );
}

function PublishBadge({ published, onClick }: { published: boolean; onClick: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors",
        published
          ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
          : "bg-gray-500/15 text-gray-400 hover:bg-gray-500/25"
      )}
    >
      {published ? "Oui" : "Non"}
    </button>
  );
}

function ToggleSwitch({
  label,
  checked,
  onChange,
  tooltip,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  tooltip?: string;
}) {
  return (
    <label className="flex flex-col items-center gap-1.5 cursor-pointer" title={tooltip}>
      <span className="text-xs text-foreground-muted">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={cn(
          "relative w-10 h-5 rounded-full transition-colors",
          checked ? "bg-primary" : "bg-border"
        )}
      >
        <span className={cn(
          "absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform",
          checked && "translate-x-5"
        )} />
      </button>
    </label>
  );
}

function CollapsibleSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-5 py-3 text-sm font-medium text-foreground hover:bg-surface-elevated/50 transition-colors"
      >
        <ChevronDown className={cn("w-4 h-4 text-foreground-muted transition-transform", !open && "-rotate-90")} />
        {title}
      </button>
      {open && <div className="px-5 pb-4 border-t border-border">{children}</div>}
    </div>
  );
}
