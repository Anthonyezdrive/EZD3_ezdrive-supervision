import { useState, useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import { Search, Zap, Clock, Euro, Hash, FileText } from "lucide-react";
import { useB2BCdrs } from "@/hooks/useB2BCdrs";
import { useB2BFilters } from "@/contexts/B2BFilterContext";
import { useDriverLookup } from "@/hooks/useDriverLookup";
import { useB2BStationLookup, resolveStation } from "@/hooks/useB2BStationLookup";
import { formatNumber, formatEUR, formatDuration, getChargePointId } from "@/lib/b2b-formulas";
import { downloadCSV, todayISO } from "@/lib/export";
import { ExportButtons } from "./ExportButtons";
import { SlideOver } from "@/components/ui/SlideOver";
import { PageHelp } from "@/components/ui/PageHelp";
import type { B2BClient, B2BCdr } from "@/types/b2b";

const thClass =
  "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-foreground-muted";
const tdClass = "px-4 py-3.5 text-sm text-foreground whitespace-nowrap";

type SessionTypeFilter = "all" | "paid" | "free";

function formatDateFR(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDateLongFR(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function tokenShort(uid: string | undefined | null): string {
  if (!uid) return "—";
  return uid.length > 8 ? uid.slice(-8) : uid;
}

export function B2BSessionsPage() {
  const { activeClient, customerExternalIds } =
    useOutletContext<{ activeClient: B2BClient | null; customerExternalIds: string[] }>();
  const { year } = useB2BFilters();
  const { data: cdrs, isLoading } = useB2BCdrs(customerExternalIds);
  const { data: driverMap } = useDriverLookup();
  const { data: stationLookup } = useB2BStationLookup();

  // Local filters
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sessionType, setSessionType] = useState<SessionTypeFilter>("all");

  // Detail drawer
  const [selectedCdr, setSelectedCdr] = useState<B2BCdr | null>(null);

  // Pagination
  const PAGE_SIZE = 100;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const allCdrs = cdrs ?? [];

  // Filtered CDRs
  const filtered = useMemo(() => {
    let result = allCdrs;

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => {
        const locName = c.cdr_location?.name?.toLowerCase() ?? "";
        const driver = (c.driver_external_id ?? "").toLowerCase();
        const driverName = (driverMap?.get(c.driver_external_id ?? "") ?? "").toLowerCase();
        const tokenUid = (c.cdr_token?.uid ?? "").toLowerCase();
        return locName.includes(q) || driver.includes(q) || driverName.includes(q) || tokenUid.includes(q);
      });
    }

    // Date range
    if (dateFrom) {
      const from = new Date(dateFrom).getTime();
      result = result.filter((c) => new Date(c.start_date_time).getTime() >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo + "T23:59:59").getTime();
      result = result.filter((c) => new Date(c.start_date_time).getTime() <= to);
    }

    // Session type
    if (sessionType === "paid") {
      result = result.filter((c) => (c.total_retail_cost_incl_vat ?? 0) > 0);
    } else if (sessionType === "free") {
      result = result.filter((c) => (c.total_retail_cost_incl_vat ?? 0) === 0);
    }

    return result;
  }, [allCdrs, search, dateFrom, dateTo, sessionType, driverMap]);

  // Sort by most recent first for display
  const sorted = useMemo(
    () => [...filtered].sort((a, b) => new Date(b.start_date_time).getTime() - new Date(a.start_date_time).getTime()),
    [filtered]
  );

  // Stats
  const stats = useMemo(() => {
    const totalEnergy = filtered.reduce((s, c) => s + (c.total_energy ?? 0), 0);
    const totalCost = filtered.reduce((s, c) => s + (c.total_retail_cost_incl_vat ?? 0), 0);
    const totalTimeHours = filtered.reduce((s, c) => s + (c.total_time ?? 0) / 3600, 0);
    return {
      count: filtered.length,
      energy: totalEnergy,
      cost: totalCost,
      duration: totalTimeHours,
    };
  }, [filtered]);

  const visibleRows = sorted.slice(0, visibleCount);
  const hasMore = visibleCount < sorted.length;

  // Export CSV
  function handleExportCSV() {
    const exportRows = sorted.map((c) => ({
      Date: formatDateFR(c.start_date_time),
      Lieu: c.cdr_location?.name ?? "—",
      Conducteur: driverMap?.get(c.driver_external_id ?? "") || c.driver_external_id || "—",
      Token: c.cdr_token?.uid ?? "—",
      "Énergie (kWh)": formatNumber(c.total_energy ?? 0),
      "Durée": formatDuration((c.total_time ?? 0) / 3600),
      "Coût TTC (€)": formatNumber(c.total_retail_cost_incl_vat ?? 0),
    }));
    downloadCSV(exportRows, `b2b-sessions-${activeClient?.slug ?? "client"}-${year}-${todayISO()}.csv`);
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="bg-surface border border-border rounded-2xl p-6 h-[60px] animate-pulse" />
        <div className="flex gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-4 h-[72px] flex-1 animate-pulse" />
          ))}
        </div>
        <div className="bg-surface border border-border rounded-2xl p-6 h-[500px] animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHelp
        summary="Détail de chaque session de charge (CDR) avec filtres et export"
        items={[
          { label: "CDR", description: "Charge Detail Record — relevé détaillé d'une session : énergie, durée, coût, borne utilisée." },
          { label: "Filtres", description: "Recherchez par lieu, conducteur ou token. Filtrez par date ou type de session." },
          { label: "Détail", description: "Cliquez sur une ligne pour afficher tous les détails de la session." },
          { label: "Export", description: "Téléchargez les sessions filtrées au format CSV ou PDF." },
        ]}
      />

      {/* Filters bar */}
      <div className="bg-surface border border-border rounded-2xl p-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
            <input
              type="text"
              placeholder="Rechercher lieu, conducteur, token…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setVisibleCount(PAGE_SIZE); }}
              className="w-full pl-9 pr-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          {/* Date from */}
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-foreground-muted">Du</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setVisibleCount(PAGE_SIZE); }}
              className="px-2.5 py-2 text-sm bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          {/* Date to */}
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-foreground-muted">Au</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setVisibleCount(PAGE_SIZE); }}
              className="px-2.5 py-2 text-sm bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          {/* Session type */}
          <select
            value={sessionType}
            onChange={(e) => { setSessionType(e.target.value as SessionTypeFilter); setVisibleCount(PAGE_SIZE); }}
            className="px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="all">Toutes</option>
            <option value="paid">Payantes</option>
            <option value="free">Gratuites</option>
          </select>

          {/* Export */}
          <ExportButtons onCSV={handleExportCSV} onPDF={handleExportCSV} disabled={sorted.length === 0} />
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-surface border border-border rounded-2xl px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: "#9ACC0E20" }}>
            <Hash className="w-4.5 h-4.5" style={{ color: "#9ACC0E" }} />
          </div>
          <div>
            <p className="text-xs text-foreground-muted">Sessions</p>
            <p className="text-lg font-bold text-foreground tabular-nums">{stats.count.toLocaleString("fr-FR")}</p>
          </div>
        </div>
        <div className="bg-surface border border-border rounded-2xl px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: "#9ACC0E20" }}>
            <Zap className="w-4.5 h-4.5" style={{ color: "#9ACC0E" }} />
          </div>
          <div>
            <p className="text-xs text-foreground-muted">Énergie totale</p>
            <p className="text-lg font-bold text-foreground tabular-nums">{formatNumber(stats.energy)} kWh</p>
          </div>
        </div>
        <div className="bg-surface border border-border rounded-2xl px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: "#9ACC0E20" }}>
            <Euro className="w-4.5 h-4.5" style={{ color: "#9ACC0E" }} />
          </div>
          <div>
            <p className="text-xs text-foreground-muted">Coût total</p>
            <p className="text-lg font-bold text-foreground tabular-nums">{formatEUR(stats.cost)}</p>
          </div>
        </div>
        <div className="bg-surface border border-border rounded-2xl px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: "#9ACC0E20" }}>
            <Clock className="w-4.5 h-4.5" style={{ color: "#9ACC0E" }} />
          </div>
          <div>
            <p className="text-xs text-foreground-muted">Durée totale</p>
            <p className="text-lg font-bold text-foreground tabular-nums">{formatDuration(stats.duration)}</p>
          </div>
        </div>
      </div>

      {/* Sessions table */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className={thClass}>Date</th>
                <th className={thClass}>Lieu</th>
                <th className={thClass}>Conducteur</th>
                <th className={thClass}>Token</th>
                <th className={`${thClass} text-right`}>Énergie</th>
                <th className={`${thClass} text-right`}>Durée</th>
                <th className={`${thClass} text-right`}>Coût TTC</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <FileText className="w-10 h-10 text-foreground-muted/40" />
                      <p className="text-foreground-muted text-sm">Aucune session trouvée</p>
                      <p className="text-foreground-muted/60 text-xs">
                        Modifiez vos filtres ou sélectionnez une autre période.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                visibleRows.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setSelectedCdr(c)}
                    className="border-b border-border/50 hover:bg-surface-elevated/50 transition-colors cursor-pointer"
                  >
                    <td className={tdClass}>{formatDateFR(c.start_date_time)}</td>
                    <td className={`${tdClass} max-w-[200px] truncate`}>{c.cdr_location?.name ?? "—"}</td>
                    <td className={`${tdClass} max-w-[160px] truncate`} title={c.driver_external_id ?? undefined}>
                      {driverMap?.get(c.driver_external_id ?? "") || c.driver_external_id || "—"}
                    </td>
                    <td className={`${tdClass} font-mono text-xs`}>{tokenShort(c.cdr_token?.uid)}</td>
                    <td className={`${tdClass} text-right font-medium`}>{formatNumber(c.total_energy ?? 0)} kWh</td>
                    <td className={`${tdClass} text-right`}>{formatDuration((c.total_time ?? 0) / 3600)}</td>
                    <td className={`${tdClass} text-right`}>{formatEUR(c.total_retail_cost_incl_vat ?? 0)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {sorted.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <p className="text-xs text-foreground-muted">
              {visibleRows.length} sur {sorted.length.toLocaleString("fr-FR")} sessions
            </p>
            {hasMore && (
              <button
                onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
                className="px-4 py-1.5 text-xs font-medium rounded-lg border border-border text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors"
              >
                Afficher plus
              </button>
            )}
          </div>
        )}
      </div>

      {/* CDR Detail Drawer */}
      <SlideOver
        open={selectedCdr !== null}
        onClose={() => setSelectedCdr(null)}
        title="Détail de la session"
        subtitle={selectedCdr ? `ID: ${selectedCdr.id}` : undefined}
        maxWidth="max-w-xl"
      >
        {selectedCdr && <CdrDetail cdr={selectedCdr} driverMap={driverMap} stationLookup={stationLookup} />}
      </SlideOver>
    </div>
  );
}

// ─── CDR Detail ────────────────────────────────────────────

function CdrDetail({
  cdr,
  driverMap,
  stationLookup,
}: {
  cdr: B2BCdr;
  driverMap?: Map<string, string> | null;
  stationLookup?: { byGfxId: Map<string, any>; byName: Map<string, any> } | null;
}) {
  const costTTC = cdr.total_retail_cost_incl_vat ?? 0;
  const isFree = costTTC === 0;

  const location = cdr.cdr_location;
  const locationParts = [location?.name, location?.address, location?.city].filter(Boolean);
  const evseId = location?.evses?.[0]?.evse_id ?? location?.evses?.[0]?.uid ?? "—";
  const driverName = driverMap?.get(cdr.driver_external_id ?? "");
  const chargePointId = getChargePointId(cdr);
  const station = resolveStation(chargePointId, location?.name, stationLookup);

  return (
    <div className="p-6 space-y-6">
      {/* Cost badge */}
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold"
          style={{
            backgroundColor: isFree ? "#9ACC0E20" : "#3B82F620",
            color: isFree ? "#9ACC0E" : "#3B82F6",
          }}
        >
          {isFree ? "Gratuite" : "Payante"}
        </span>
        <span className="text-xl font-bold text-foreground tabular-nums">{formatEUR(costTTC)}</span>
      </div>

      {/* Detail grid */}
      <div className="grid grid-cols-1 gap-4">
        <DetailRow label="Lieu" value={locationParts.join(", ") || "—"} />
        <DetailRow label="Début" value={cdr.start_date_time ? formatDateLongFR(cdr.start_date_time) : "—"} />
        <DetailRow label="Fin" value={cdr.end_date_time ? formatDateLongFR(cdr.end_date_time) : "—"} />

        <div className="border-t border-border/50 pt-4 grid grid-cols-2 gap-4">
          <DetailRow label="Énergie" value={`${formatNumber(cdr.total_energy ?? 0)} kWh`} />
          <DetailRow label="Durée totale" value={formatDuration((cdr.total_time ?? 0) / 3600)} />
          <DetailRow
            label="Temps de stationnement"
            value={cdr.total_parking_time != null ? formatDuration(cdr.total_parking_time / 3600) : "—"}
          />
          <DetailRow label="Type de chargeur" value={cdr.charger_type ?? "—"} />
        </div>

        <div className="border-t border-border/50 pt-4 grid grid-cols-2 gap-4">
          <DetailRow label="Coût HT" value={formatEUR(cdr.total_retail_cost ?? 0)} />
          <DetailRow label="Coût TTC" value={formatEUR(costTTC)} />
        </div>

        <div className="border-t border-border/50 pt-4 grid grid-cols-1 gap-4">
          <DetailRow
            label="Token"
            value={
              cdr.cdr_token
                ? `${cdr.cdr_token.uid}${cdr.cdr_token.type ? ` (${cdr.cdr_token.type})` : ""}`
                : "—"
            }
            mono
          />
          {cdr.cdr_token?.contract_id && (
            <DetailRow label="Contract ID" value={cdr.cdr_token.contract_id} mono />
          )}
          <DetailRow label="Conducteur" value={driverName ? `${driverName} (${cdr.driver_external_id})` : cdr.driver_external_id ?? "—"} />
          <DetailRow label="EVSE ID" value={evseId} mono />
          {station && (
            <>
              {station.charge_point_vendor && (
                <DetailRow label="Borne" value={`${station.charge_point_vendor}${station.charge_point_model ? ` ${station.charge_point_model}` : ""}`} />
              )}
              {station.max_power_kw != null && (
                <DetailRow label="Puissance max" value={`${station.max_power_kw} kW`} />
              )}
            </>
          )}
          <DetailRow label="Source (GFX CDR)" value={cdr.gfx_cdr_id ?? "—"} mono />
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-foreground-muted mb-0.5">{label}</p>
      <p className={`text-sm text-foreground ${mono ? "font-mono text-xs break-all" : ""}`}>{value}</p>
    </div>
  );
}
