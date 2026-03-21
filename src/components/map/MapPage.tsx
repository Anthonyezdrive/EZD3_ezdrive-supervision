import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, useMap, useMapEvents } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import { Search, X, MapPin, Zap, Database } from "lucide-react";
import { useStations } from "@/hooks/useStations";
import { useCPOs } from "@/hooks/useCPOs";
import { useTerritories } from "@/hooks/useTerritories";
import { useCpo } from "@/contexts/CpoContext";
import { OCPP_STATUS_CONFIG } from "@/lib/constants";
import { StationDetailDrawer } from "@/components/stations/StationDetailDrawer";
import type { Station, OCPPStatus } from "@/types/station";
import { PageHelp } from "@/components/ui/PageHelp";

// ── Source badge config ─────────────────────────────────────────────
const SOURCE_CONFIG = {
  road: { label: "Road.io", color: "#3B82F6", bg: "#3B82F620", ring: "#3B82F6" },
  gfx:  { label: "GreenFlux", color: "#A855F7", bg: "#A855F720", ring: "#A855F7" },
} as const;

function getSourceConfig(source: string) {
  return SOURCE_CONFIG[source as keyof typeof SOURCE_CONFIG] ?? { label: source, color: "#6B7280", bg: "#6B728020", ring: "#6B7280" };
}

// ── Nominatim geocoding result ──────────────────────────────────────
interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

// ── FlyTo helper (child of MapContainer) ────────────────────────────
function FlyToLocation({ target }: { target: { lat: number; lng: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) {
      map.flyTo([target.lat, target.lng], 14);
    }
  }, [map, target]);
  return null;
}

// Auto-fit map to show all stations
function AutoFitBounds({ bounds }: { bounds: LatLngBoundsExpression | null }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current && bounds) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
      fitted.current = true;
    }
  }, [map, bounds]);
  return null;
}

// Simple clustering: group nearby stations when zoomed out
interface Cluster {
  lat: number;
  lng: number;
  stations: Station[];
  mainStatus: OCPPStatus;
}

function clusterStations(stations: Station[], zoom: number): Cluster[] {
  if (zoom >= 11) {
    // No clustering at high zoom
    return stations.map((s) => ({
      lat: s.latitude!,
      lng: s.longitude!,
      stations: [s],
      mainStatus: s.ocpp_status,
    }));
  }
  const gridSize = zoom <= 7 ? 2 : zoom <= 9 ? 1 : 0.5;
  const clusters: Map<string, Cluster> = new Map();

  for (const s of stations) {
    const gLat = Math.floor(s.latitude! / gridSize) * gridSize;
    const gLng = Math.floor(s.longitude! / gridSize) * gridSize;
    const key = `${gLat},${gLng}`;
    const existing = clusters.get(key);
    if (existing) {
      existing.stations.push(s);
      existing.lat = (existing.lat * (existing.stations.length - 1) + s.latitude!) / existing.stations.length;
      existing.lng = (existing.lng * (existing.stations.length - 1) + s.longitude!) / existing.stations.length;
    } else {
      clusters.set(key, { lat: s.latitude!, lng: s.longitude!, stations: [s], mainStatus: s.ocpp_status });
    }
  }

  // Set main status as the most frequent
  for (const c of clusters.values()) {
    const counts: Record<string, number> = {};
    for (const s of c.stations) {
      counts[s.ocpp_status] = (counts[s.ocpp_status] || 0) + 1;
    }
    c.mainStatus = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] as OCPPStatus ?? "Unknown";
  }

  return Array.from(clusters.values());
}

function ZoomTracker({ onZoom }: { onZoom: (z: number) => void }) {
  const map = useMapEvents({
    zoomend: () => onZoom(map.getZoom()),
  });
  useEffect(() => { onZoom(map.getZoom()); }, []);
  return null;
}

// ── Power type filter ───────────────────────────────────────────────
type PowerFilter = "all" | "ac" | "dc";

const STATUS_FILTERS: OCPPStatus[] = ["Available", "Charging", "Faulted", "Unknown"];

export function MapPage() {
  const { selectedCpoId } = useCpo();
  const { data: stations = [], isLoading } = useStations(selectedCpoId);
  const { data: cpos = [] } = useCPOs();
  const { data: territories = [] } = useTerritories();

  const [selectedStation, setSelectedStation] = useState<Station | null>(null);
  const [statusFilter, setStatusFilter] = useState<OCPPStatus | null>(null);
  const [zoom, setZoom] = useState(9);

  // ── New filter state ──────────────────────────────────────────────
  const [cpoFilter, setCpoFilter] = useState<string | null>(null);
  const [territoryFilter, setTerritoryFilter] = useState<string | null>(null);
  const [powerFilter, setPowerFilter] = useState<PowerFilter>("all");

  // ── Address search state ──────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [flyTarget, setFlyTarget] = useState<{ lat: number; lng: number } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Debounced geocoding search
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 3) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(value)}&format=json&limit=5`,
          { headers: { "Accept-Language": "fr" } }
        );
        const data: NominatimResult[] = await res.json();
        setSearchResults(data);
        setShowResults(data.length > 0);
      } catch {
        setSearchResults([]);
        setShowResults(false);
      }
    }, 300);
  }, []);

  const handleSelectResult = useCallback((result: NominatimResult) => {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    setFlyTarget({ lat, lng });
    setSearchQuery(result.display_name);
    setShowResults(false);
    setSearchResults([]);
  }, []);

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setSearchResults([]);
    setShowResults(false);
  }, []);

  // ── Filtering pipeline ────────────────────────────────────────────
  const mappableStations = stations.filter(
    (s) => s.latitude != null && s.longitude != null
  );

  const filteredStations = useMemo(() => {
    let result = mappableStations;

    if (statusFilter) {
      result = result.filter((s) => s.ocpp_status === statusFilter);
    }
    if (cpoFilter) {
      result = result.filter((s) => s.cpo_id === cpoFilter);
    }
    if (territoryFilter) {
      result = result.filter((s) => s.territory_id === territoryFilter);
    }
    if (powerFilter === "ac") {
      result = result.filter((s) => s.max_power_kw != null && s.max_power_kw <= 22);
    } else if (powerFilter === "dc") {
      result = result.filter((s) => s.max_power_kw != null && s.max_power_kw > 22);
    }

    return result;
  }, [mappableStations, statusFilter, cpoFilter, territoryFilter, powerFilter]);

  const bounds: LatLngBoundsExpression | null =
    mappableStations.length > 0
      ? (mappableStations.map((s) => [s.latitude!, s.longitude!]) as LatLngBoundsExpression)
      : null;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-4 shrink-0">
        <PageHelp
          summary="Carte interactive de votre réseau de bornes avec position et statut en temps réel"
          items={[
            { label: "Marqueurs colorés", description: "Vert = disponible, bleu = en charge, rouge = en panne, gris = hors service." },
            { label: "Clusters", description: "Les bornes proches sont regroupées en clusters. Zoomez pour les détailler." },
            { label: "Popup détail", description: "Cliquez sur un marqueur pour voir le nom, l'adresse et le statut de la borne." },
            { label: "Zoom & navigation", description: "Utilisez la molette pour zoomer, ou les boutons +/- en haut à gauche." },
          ]}
        />
      </div>
      <div className="px-6 py-4 border-b border-border shrink-0 space-y-3">
        {/* Row 1: title + status pills */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="font-heading font-bold text-xl">Carte</h1>
            <p className="text-sm text-foreground-muted">
              {filteredStations.length}/{mappableStations.length} bornes affichées · refresh 30s
            </p>
          </div>

          {/* Status filter pills */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setStatusFilter(null)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                statusFilter === null
                  ? "bg-primary/15 text-primary border-primary/30"
                  : "text-foreground-muted border-border hover:border-foreground-muted"
              }`}
            >
              Toutes ({mappableStations.length})
            </button>
            {STATUS_FILTERS.map((s) => {
              const cfg = OCPP_STATUS_CONFIG[s];
              const count = mappableStations.filter((st) => st.ocpp_status === s).length;
              return (
                <button
                  key={s}
                  onClick={() => setStatusFilter(statusFilter === s ? null : s)}
                  className="px-3 py-1 rounded-full text-xs font-medium border transition-all"
                  style={{
                    backgroundColor:
                      statusFilter === s ? `${cfg.color}22` : "transparent",
                    color: statusFilter === s ? cfg.color : "#8892B0",
                    borderColor:
                      statusFilter === s ? cfg.color : "rgba(255,255,255,0.12)",
                  }}
                >
                  {cfg.label} ({count})
                </button>
              );
            })}
          </div>
        </div>

        {/* Row 2: search bar + CPO / territory / power filters */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Address search */}
          <div ref={searchContainerRef} className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              onFocus={() => { if (searchResults.length > 0) setShowResults(true); }}
              placeholder="Rechercher une adresse ou ville..."
              className="w-full pl-9 pr-8 py-1.5 rounded-lg bg-card border border-border text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            {searchQuery && (
              <button onClick={clearSearch} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            {/* Dropdown results */}
            {showResults && searchResults.length > 0 && (
              <div
                className="absolute top-full left-0 right-0 mt-1 rounded-lg border border-border bg-card shadow-xl z-[2000] overflow-hidden"
              >
                {searchResults.map((r) => (
                  <button
                    key={r.place_id}
                    onClick={() => handleSelectResult(r)}
                    className="w-full text-left px-3 py-2 text-xs text-foreground hover:bg-primary/10 flex items-start gap-2 border-b border-border last:border-b-0 transition-colors"
                  >
                    <MapPin className="w-3.5 h-3.5 text-foreground-muted shrink-0 mt-0.5" />
                    <span className="line-clamp-2">{r.display_name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* CPO filter */}
          <select
            value={cpoFilter ?? ""}
            onChange={(e) => setCpoFilter(e.target.value || null)}
            className="px-3 py-1.5 rounded-lg bg-card border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 min-w-[140px]"
          >
            <option value="">Tous les CPO</option>
            {cpos.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          {/* Territory filter */}
          <select
            value={territoryFilter ?? ""}
            onChange={(e) => setTerritoryFilter(e.target.value || null)}
            className="px-3 py-1.5 rounded-lg bg-card border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 min-w-[140px]"
          >
            <option value="">Tous les territoires</option>
            {territories.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>

          {/* Power type toggle */}
          <div className="flex items-center gap-1 bg-card border border-border rounded-lg p-0.5">
            {([
              { key: "all" as PowerFilter, label: "Tous" },
              { key: "ac" as PowerFilter, label: "AC" },
              { key: "dc" as PowerFilter, label: "DC" },
            ]).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setPowerFilter(key)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1 ${
                  powerFilter === key
                    ? "bg-primary/15 text-primary"
                    : "text-foreground-muted hover:text-foreground"
                }`}
              >
                {key !== "all" && <Zap className="w-3 h-3" />}
                {label}
                {key === "ac" && " ≤22kW"}
                {key === "dc" && " >22kW"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-foreground-muted text-sm">Chargement de la carte...</p>
          </div>
        ) : mappableStations.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-foreground-muted text-sm">Aucune borne géolocalisée disponible.</p>
          </div>
        ) : (
          <MapContainer
            center={[14.6, -61]}
            zoom={9}
            className="h-full w-full"
            style={{ background: "#0D1117" }}
          >
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
            />
            <AutoFitBounds bounds={bounds} />
            <ZoomTracker onZoom={setZoom} />
            <FlyToLocation target={flyTarget} />

            {clusterStations(filteredStations, zoom).map((cluster, idx) => {
              const isCluster = cluster.stations.length > 1;
              const cfg = OCPP_STATUS_CONFIG[cluster.mainStatus];
              const station = cluster.stations[0];

              return (
                <CircleMarker
                  key={isCluster ? `cluster-${idx}` : station.id}
                  center={[cluster.lat, cluster.lng]}
                  radius={isCluster ? Math.min(12 + cluster.stations.length, 25) : 7}
                  pathOptions={{
                    fillColor: cfg.color,
                    fillOpacity: isCluster ? 0.7 : 0.9,
                    color: isCluster ? "#fff" : getSourceConfig(station.source).ring,
                    weight: isCluster ? 2.5 : 2,
                    opacity: isCluster ? 0.6 : 0.8,
                  }}
                >
                  <Popup minWidth={200}>
                    {isCluster ? (
                      <div style={{ fontFamily: "system-ui, sans-serif", padding: "2px 0" }}>
                        <p style={{ fontWeight: 700, fontSize: 13, margin: "0 0 6px" }}>
                          {cluster.stations.length} bornes
                        </p>
                        <div style={{ fontSize: 11, color: "#888", maxHeight: 150, overflowY: "auto" }}>
                          {cluster.stations.slice(0, 10).map((s) => (
                            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                              <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: OCPP_STATUS_CONFIG[s.ocpp_status].color, flexShrink: 0 }} />
                              <span style={{ cursor: "pointer", color: "#ccc", flex: 1 }} onClick={() => setSelectedStation(s)}>{s.name}</span>
                              <span style={{ fontSize: 9, color: getSourceConfig(s.source).color, fontWeight: 600, flexShrink: 0 }}>
                                {getSourceConfig(s.source).label === "Road.io" ? "R" : "G"}
                              </span>
                            </div>
                          ))}
                          {cluster.stations.length > 10 && <p style={{ color: "#666", marginTop: 4 }}>+{cluster.stations.length - 10} autres...</p>}
                        </div>
                        <p style={{ fontSize: 10, color: "#666", marginTop: 6 }}>Zoomez pour detailler</p>
                      </div>
                    ) : (
                      <div style={{ fontFamily: "system-ui, sans-serif", padding: "2px 0" }}>
                        <p style={{ fontWeight: 700, fontSize: 13, margin: "0 0 3px" }}>
                          {station.name}
                        </p>
                        <p style={{ color: "#888", fontSize: 11, margin: "0 0 8px" }}>
                          {[station.city, station.territory_name]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                          <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", backgroundColor: cfg.color, flexShrink: 0 }} />
                          <span style={{ fontSize: 11, color: cfg.color, fontWeight: 600 }}>{cfg.label}</span>
                          {station.cpo_name && <span style={{ fontSize: 10, color: "#999" }}>· {station.cpo_name}</span>}
                        </div>
                        <div style={{ marginBottom: 10 }}>
                          <span style={{
                            display: "inline-flex", alignItems: "center", gap: 3,
                            fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 4,
                            backgroundColor: getSourceConfig(station.source).bg,
                            color: getSourceConfig(station.source).color,
                          }}>
                            <Database style={{ width: 10, height: 10 }} />
                            {getSourceConfig(station.source).label}
                          </span>
                        </div>
                        {station.max_power_kw && (
                          <p style={{ fontSize: 10, color: "#888", margin: "0 0 8px" }}>Puissance max : {station.max_power_kw} kW</p>
                        )}
                        <button
                          onClick={() => setSelectedStation(station)}
                          style={{ width: "100%", padding: "5px 10px", borderRadius: 6, backgroundColor: "#00D4AA", color: "#fff", fontSize: 11, fontWeight: 600, border: "none", cursor: "pointer" }}
                        >
                          Voir le detail →
                        </button>
                      </div>
                    )}
                  </Popup>
                </CircleMarker>
              );
            })}
          </MapContainer>
        )}

        {/* Legend (bottom-left, overlaid on map) */}
        {!isLoading && mappableStations.length > 0 && (
          <div
            className="absolute bottom-5 left-5 z-[1000] rounded-xl p-3 space-y-2"
            style={{
              background: "rgba(13,17,23,0.88)",
              border: "1px solid rgba(255,255,255,0.1)",
              backdropFilter: "blur(8px)",
            }}
          >
            <p className="text-[10px] font-semibold text-foreground-muted uppercase tracking-wider mb-2">
              Légende
            </p>
            {STATUS_FILTERS.map((s) => {
              const cfg = OCPP_STATUS_CONFIG[s];
              const count = mappableStations.filter((st) => st.ocpp_status === s).length;
              return (
                <div key={s} className="flex items-center gap-2.5">
                  <span
                    className="w-3 h-3 rounded-full shrink-0 border border-white/30"
                    style={{ backgroundColor: cfg.color }}
                  />
                  <span className="text-xs text-foreground-muted">{cfg.label}</span>
                  <span className="text-xs font-semibold text-foreground ml-auto pl-3">
                    {count}
                  </span>
                </div>
              );
            })}
            <div className="border-t border-white/10 mt-2 pt-2">
              <p className="text-[10px] font-semibold text-foreground-muted uppercase tracking-wider mb-2">
                Source (contour)
              </p>
              {(["road", "gfx"] as const).map((src) => {
                const srcCfg = getSourceConfig(src);
                const count = mappableStations.filter((st) => st.source === src).length;
                return (
                  <div key={src} className="flex items-center gap-2.5">
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ border: `2.5px solid ${srcCfg.ring}`, backgroundColor: "transparent" }}
                    />
                    <span className="text-xs text-foreground-muted">{srcCfg.label}</span>
                    <span className="text-xs font-semibold text-foreground ml-auto pl-3">
                      {count}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Station detail drawer */}
      {selectedStation && (
        <StationDetailDrawer
          station={selectedStation}
          onClose={() => setSelectedStation(null)}
        />
      )}
    </div>
  );
}
