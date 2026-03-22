import { useState, useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import {
  Search,
  Zap,
  Clock,
  Euro,
  Hash,
  FileText,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useB2BCdrs } from "@/hooks/useB2BCdrs";
import { useXDriveB2BClient } from "@/hooks/useXDriveCDRs";
import { formatNumber, formatEUR, formatDuration, getChargePointId } from "@/lib/b2b-formulas";
import { exportCSV, exportPDF } from "@/lib/b2b-export";
import { todayISO } from "@/lib/export";
import { ExportButtons } from "@/components/b2b/ExportButtons";
import { SlideOver } from "@/components/ui/SlideOver";
import type { B2BCdr } from "@/types/b2b";
import type { XDrivePartner, XDriveTheme } from "@/types/xdrive";

// ─── Constants ──────────────────────────────────────────────

const thClass =
  "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-foreground-muted";
const tdClass = "px-4 py-3.5 text-sm text-foreground whitespace-nowrap";

const PAGE_SIZE = 50;

// ─── eMSP Name Mapping ──────────────────────────────────────

const EMSP_NAMES: Record<string, string> = {
  GFX: "Freshmile",
  CHM: "ChargeMap",
  SHR: "Shell Recharge",
  VIR: "Virta",
  PLG: "Plugsurfing",
  IOP: "Interop",
  BOL: "Bouygues",
  TOT: "TotalEnergies",
  EDF: "EDF",
  ENE: "Enedis",
  ESP: "ESP",
};

function getEmspName(countryCode: string | null, partyId: string | null): string {
  if (!partyId) return "Direct";
  return EMSP_NAMES[partyId] || `${countryCode ?? ""}${partyId}`;
}

// ─── CDR Status helpers ─────────────────────────────────────

type CdrStatus = "completed" | "interrupted" | "failed" | "ongoing";

function getCdrStatus(cdr: B2BCdr): CdrStatus {
  if (!cdr.end_date_time) return "ongoing";
  const energy = cdr.total_energy ?? 0;
  const time = cdr.total_time ?? 0;
  if (energy > 0 && time > 0) return "completed";
  if (energy === 0 && time > 0) return "interrupted";
  return "failed";
}

const STATUS_LABELS: Record<CdrStatus, string> = {
  completed: "Completée",
  interrupted: "Interrompue",
  failed: "Echec",
  ongoing: "En cours",
};

const STATUS_STYLES: Record<CdrStatus, string> = {
  completed: "bg-emerald-500/15 text-emerald-400",
  interrupted: "bg-amber-500/15 text-amber-400",
  failed: "bg-red-500/15 text-red-400",
  ongoing: "bg-blue-500/15 text-blue-400",
};

// ─── Payment type helpers ───────────────────────────────────

type PaymentType = "CB" | "Badge RFID" | "Application" | "QR code" | "Direct";

function getPaymentType(cdr: B2BCdr): PaymentType {
  const tokenType = cdr.cdr_token?.type?.toLowerCase() ?? "";
  const partyId = cdr.emsp_party_id?.toLowerCase() ?? "";

  if (tokenType === "app_user" || partyId === "app") return "Application";
  if (tokenType === "other" && partyId === "qrc") return "QR code";
  if (tokenType === "rfid" || tokenType === "other") {
    // Distinguish CB vs RFID by contract_id pattern
    const contractId = cdr.cdr_token?.contract_id ?? "";
    if (contractId.length === 0 || tokenType === "rfid") return "Badge RFID";
    return "CB";
  }
  if (!cdr.cdr_token) return "Direct";
  return "CB";
}

const PAYMENT_STYLES: Record<PaymentType, string> = {
  CB: "bg-violet-500/15 text-violet-400",
  "Badge RFID": "bg-sky-500/15 text-sky-400",
  Application: "bg-indigo-500/15 text-indigo-400",
  "QR code": "bg-teal-500/15 text-teal-400",
  Direct: "bg-gray-500/15 text-gray-400",
};

// ─── Charger type helper ────────────────────────────────────

function getChargerTypeLabel(cdr: B2BCdr): string {
  const type = cdr.charger_type?.toUpperCase();
  if (!type) return "—";
  if (type.includes("DC")) {
    const energy = cdr.total_energy ?? 0;
    const time = cdr.total_time ?? 0;
    if (time > 0) {
      const avgPowerKw = (energy / (time / 3600));
      if (avgPowerKw >= 50) return "DC 50-100 kW";
      return "DC 25 kW";
    }
    return "DC";
  }
  return "AC 22 kW";
}

// ─── Format helpers ─────────────────────────────────────────

function formatDateFR(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatTimeFR(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateTimeFR(iso: string): string {
  return `${formatDateFR(iso)} ${formatTimeFR(iso)}`;
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

function formatDurationMinutes(totalSeconds: number): string {
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${String(m).padStart(2, "0")}`;
}

// ─── Filter types ────────────────────────────────────────────

type StatusFilter = "all" | CdrStatus;
type PaymentFilter = "all" | PaymentType;

// ─── Main Component ──────────────────────────────────────────

export function XDriveCDRs() {
  const { partner } = useOutletContext<{
    partner: XDrivePartner | null;
    isEZDriveAdmin: boolean;
    theme: XDriveTheme;
  }>();

  // Fetch B2B client to get the real customer_external_ids
  const { data: b2bClient } = useXDriveB2BClient(partner?.b2b_client_id);

  const customerExternalIds = useMemo<string[]>(() => {
    return b2bClient?.customer_external_ids ?? [];
  }, [b2bClient]);

  const { data: cdrs, isLoading } = useB2BCdrs(customerExternalIds);

  // Local filters
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("all");
  const [emspFilter, setEmspFilter] = useState<string>("all");

  // Pagination
  const [page, setPage] = useState(0);

  // Detail drawer
  const [selectedCdr, setSelectedCdr] = useState<B2BCdr | null>(null);

  const allCdrs = cdrs ?? [];

  // Unique eMSP list for filter dropdown
  const emspOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of allCdrs) {
      const name = getEmspName(c.emsp_country_code, c.emsp_party_id);
      set.add(name);
    }
    return [...set].sort();
  }, [allCdrs]);

  // Filtered CDRs
  const filtered = useMemo(() => {
    let result = allCdrs;

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => {
        const id = c.id.toLowerCase();
        const loc = c.cdr_location?.name?.toLowerCase() ?? "";
        const evse = getChargePointId(c).toLowerCase();
        return id.includes(q) || loc.includes(q) || evse.includes(q);
      });
    }

    if (dateFrom) {
      const from = new Date(dateFrom).getTime();
      result = result.filter((c) => new Date(c.start_date_time).getTime() >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo + "T23:59:59").getTime();
      result = result.filter((c) => new Date(c.start_date_time).getTime() <= to);
    }

    if (statusFilter !== "all") {
      result = result.filter((c) => getCdrStatus(c) === statusFilter);
    }

    if (paymentFilter !== "all") {
      result = result.filter((c) => getPaymentType(c) === paymentFilter);
    }

    if (emspFilter !== "all") {
      result = result.filter(
        (c) => getEmspName(c.emsp_country_code, c.emsp_party_id) === emspFilter
      );
    }

    return result;
  }, [allCdrs, search, dateFrom, dateTo, statusFilter, paymentFilter, emspFilter]);

  // Sort by most recent first
  const sorted = useMemo(
    () =>
      [...filtered].sort(
        (a, b) =>
          new Date(b.start_date_time).getTime() - new Date(a.start_date_time).getTime()
      ),
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

  // Pagination
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function resetPage() {
    setPage(0);
  }

  // Export CSV
  function handleExportCSV() {
    const headers = [
      { key: "id", label: "ID Session" },
      { key: "date_debut", label: "Date/Heure début" },
      { key: "date_fin", label: "Date/Heure fin" },
      { key: "duree_min", label: "Durée (min)" },
      { key: "energie_kwh", label: "Énergie (kWh)" },
      { key: "station", label: "Station" },
      { key: "evse", label: "PdC (EVSE)" },
      { key: "type_pdc", label: "Type PdC" },
      { key: "paiement", label: "Moyen de paiement" },
      { key: "operateur", label: "Opérateur eMSP" },
      { key: "montant_ht", label: "Montant HT (€)" },
      { key: "montant_ttc", label: "Montant TTC (€)" },
      { key: "statut", label: "Statut" },
    ];

    const rows = sorted.map((c) => ({
      id: c.id,
      date_debut: formatDateTimeFR(c.start_date_time),
      date_fin: c.end_date_time ? formatDateTimeFR(c.end_date_time) : "—",
      duree_min: Math.round((c.total_time ?? 0) / 60),
      energie_kwh: formatNumber(c.total_energy ?? 0),
      station: c.cdr_location?.name ?? "—",
      evse: getChargePointId(c),
      type_pdc: getChargerTypeLabel(c),
      paiement: getPaymentType(c),
      operateur: getEmspName(c.emsp_country_code, c.emsp_party_id),
      montant_ht: formatNumber(c.total_retail_cost ?? 0),
      montant_ttc: formatNumber(c.total_retail_cost_incl_vat ?? 0),
      statut: STATUS_LABELS[getCdrStatus(c)],
    }));

    exportCSV(rows, headers, `xdrive-cdrs-${partner?.partner_code ?? "partner"}-${todayISO()}.csv`);
  }

  // Export PDF
  function handleExportPDF() {
    const columns = [
      { key: "date", label: "Date", width: 1.2 },
      { key: "station", label: "Station", width: 1.8 },
      { key: "type_pdc", label: "Type PdC", width: 1 },
      { key: "duree", label: "Durée", width: 0.8 },
      { key: "energie", label: "kWh", width: 0.7, align: "right" as const },
      { key: "paiement", label: "Paiement", width: 0.9 },
      { key: "operateur", label: "Opérateur", width: 1 },
      { key: "ttc", label: "Montant TTC", width: 0.9, align: "right" as const },
      { key: "statut", label: "Statut", width: 0.9 },
    ];

    const rows = sorted.map((c) => ({
      date: formatDateFR(c.start_date_time),
      station: c.cdr_location?.name ?? "—",
      type_pdc: getChargerTypeLabel(c),
      duree: formatDurationMinutes(c.total_time ?? 0),
      energie: formatNumber(c.total_energy ?? 0),
      paiement: getPaymentType(c),
      operateur: getEmspName(c.emsp_country_code, c.emsp_party_id),
      ttc: formatEUR(c.total_retail_cost_incl_vat ?? 0),
      statut: STATUS_LABELS[getCdrStatus(c)],
    }));

    exportPDF(
      `CDR détaillés — ${partner?.display_name ?? "X-DRIVE"}`,
      `Export du ${new Date().toLocaleDateString("fr-FR")} — ${stats.count} sessions`,
      columns,
      rows,
      `xdrive-cdrs-${partner?.partner_code ?? "partner"}-${todayISO()}.pdf`,
      {
        kpis: [
          { label: "Sessions", value: stats.count.toLocaleString("fr-FR") },
          { label: "Énergie totale", value: `${formatNumber(stats.energy)} kWh` },
          { label: "Durée totale", value: formatDuration(stats.duration) },
          { label: "Montant TTC", value: formatEUR(stats.cost) },
        ],
      }
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="bg-surface border border-border rounded-2xl p-6 h-[60px] animate-pulse" />
        <div className="flex gap-3">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="bg-surface border border-border rounded-2xl p-4 h-[72px] flex-1 animate-pulse"
            />
          ))}
        </div>
        <div className="bg-surface border border-border rounded-2xl p-6 h-[500px] animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters bar */}
      <div className="bg-surface border border-border rounded-2xl p-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
            <input
              type="text"
              placeholder="Rechercher ID session, station, borne…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                resetPage();
              }}
              className="w-full pl-9 pr-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          {/* Date from */}
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-foreground-muted">Du</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                resetPage();
              }}
              className="px-2.5 py-2 text-sm bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          {/* Date to */}
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-foreground-muted">Au</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                resetPage();
              }}
              className="px-2.5 py-2 text-sm bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as StatusFilter);
              resetPage();
            }}
            className="px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="all">Tous statuts</option>
            <option value="completed">Completée</option>
            <option value="interrupted">Interrompue</option>
            <option value="failed">Echec</option>
            <option value="ongoing">En cours</option>
          </select>

          {/* Payment filter */}
          <select
            value={paymentFilter}
            onChange={(e) => {
              setPaymentFilter(e.target.value as PaymentFilter);
              resetPage();
            }}
            className="px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="all">Tous paiements</option>
            <option value="CB">CB</option>
            <option value="Badge RFID">Badge RFID</option>
            <option value="Application">Application</option>
            <option value="QR code">QR code</option>
            <option value="Direct">Direct</option>
          </select>

          {/* eMSP filter */}
          {emspOptions.length > 1 && (
            <select
              value={emspFilter}
              onChange={(e) => {
                setEmspFilter(e.target.value);
                resetPage();
              }}
              className="px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="all">Tous opérateurs</option>
              {emspOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}

          {/* Export */}
          <ExportButtons
            onCSV={handleExportCSV}
            onPDF={handleExportPDF}
            disabled={sorted.length === 0}
          />
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={Hash} label="Sessions" value={stats.count.toLocaleString("fr-FR")} />
        <StatCard icon={Zap} label="Énergie totale" value={`${formatNumber(stats.energy)} kWh`} />
        <StatCard icon={Euro} label="Montant TTC" value={formatEUR(stats.cost)} />
        <StatCard icon={Clock} label="Durée totale" value={formatDuration(stats.duration)} />
      </div>

      {/* CDR Table */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className={thClass}>Date</th>
                <th className={thClass}>Station / PdC</th>
                <th className={thClass}>Type PdC</th>
                <th className={thClass}>Durée</th>
                <th className={`${thClass} text-right`}>Énergie</th>
                <th className={thClass}>Paiement</th>
                <th className={thClass}>Opérateur</th>
                <th className={`${thClass} text-right`}>Montant TTC</th>
                <th className={thClass}>Statut</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <FileText className="w-10 h-10 text-foreground-muted/40" />
                      <p className="text-foreground-muted text-sm">Aucun CDR trouvé</p>
                      <p className="text-foreground-muted/60 text-xs">
                        Modifiez vos filtres ou sélectionnez une autre période.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                pageRows.map((c, i) => {
                  const status = getCdrStatus(c);
                  const payment = getPaymentType(c);
                  const emsp = getEmspName(c.emsp_country_code, c.emsp_party_id);
                  const chargerType = getChargerTypeLabel(c);
                  const evseId = getChargePointId(c);

                  return (
                    <tr
                      key={c.id}
                      onClick={() => setSelectedCdr(c)}
                      className={`border-b border-border/50 hover:bg-surface-elevated/50 transition-colors cursor-pointer ${
                        i % 2 === 1 ? "bg-surface-elevated/20" : ""
                      }`}
                    >
                      <td className={tdClass}>
                        <div className="font-medium">{formatDateFR(c.start_date_time)}</div>
                        <div className="text-xs text-foreground-muted">
                          {formatTimeFR(c.start_date_time)}
                        </div>
                      </td>
                      <td className={`${tdClass} max-w-[200px]`}>
                        <div className="truncate font-medium">
                          {c.cdr_location?.name ?? "—"}
                        </div>
                        <div className="text-xs text-foreground-muted font-mono truncate">
                          {evseId !== "Inconnu" ? evseId : "—"}
                        </div>
                      </td>
                      <td className={tdClass}>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-surface-elevated border border-border">
                          {chargerType}
                        </span>
                      </td>
                      <td className={tdClass}>
                        {formatDurationMinutes(c.total_time ?? 0)}
                      </td>
                      <td className={`${tdClass} text-right font-medium tabular-nums`}>
                        {formatNumber(c.total_energy ?? 0)} kWh
                      </td>
                      <td className={tdClass}>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${PAYMENT_STYLES[payment]}`}
                        >
                          {payment}
                        </span>
                      </td>
                      <td className={tdClass}>
                        <span className="text-sm">{emsp}</span>
                      </td>
                      <td className={`${tdClass} text-right font-medium tabular-nums`}>
                        {formatEUR(c.total_retail_cost_incl_vat ?? 0)}
                      </td>
                      <td className={tdClass}>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[status]}`}
                        >
                          {STATUS_LABELS[status]}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {sorted.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <p className="text-xs text-foreground-muted">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sorted.length)} sur{" "}
              {sorted.length.toLocaleString("fr-FR")} CDRs
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="p-1.5 rounded-lg border border-border text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Page précédente"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs text-foreground-muted tabular-nums">
                {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="p-1.5 rounded-lg border border-border text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Page suivante"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* CDR Detail Drawer */}
      <SlideOver
        open={selectedCdr !== null}
        onClose={() => setSelectedCdr(null)}
        title="Détail du CDR"
        subtitle={selectedCdr ? `Session: ${selectedCdr.id.slice(0, 16)}…` : undefined}
        maxWidth="max-w-xl"
      >
        {selectedCdr && <XDriveCdrDetail cdr={selectedCdr} />}
      </SlideOver>
    </div>
  );
}

// ─── Stat Card ───────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Hash;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-surface border border-border rounded-2xl px-4 py-3 flex items-center gap-3">
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={{ backgroundColor: "#9ACC0E20" }}
      >
        <Icon className="w-4 h-4" style={{ color: "#9ACC0E" }} />
      </div>
      <div>
        <p className="text-xs text-foreground-muted">{label}</p>
        <p className="text-lg font-bold text-foreground tabular-nums">{value}</p>
      </div>
    </div>
  );
}

// ─── CDR Detail Slide-Over Content ──────────────────────────

function XDriveCdrDetail({ cdr }: { cdr: B2BCdr }) {
  const status = getCdrStatus(cdr);
  const payment = getPaymentType(cdr);
  const emsp = getEmspName(cdr.emsp_country_code, cdr.emsp_party_id);
  const chargerType = getChargerTypeLabel(cdr);
  const evseId = getChargePointId(cdr);
  const costTTC = cdr.total_retail_cost_incl_vat ?? 0;
  const costHT = cdr.total_retail_cost ?? 0;
  const location = cdr.cdr_location;
  const locationParts = [location?.name, location?.address, location?.city].filter(Boolean);

  return (
    <div className="p-6 space-y-6">
      {/* Top badges */}
      <div className="flex items-center gap-3 flex-wrap">
        <span
          className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${STATUS_STYLES[status]}`}
        >
          {STATUS_LABELS[status]}
        </span>
        <span
          className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${PAYMENT_STYLES[payment]}`}
        >
          {payment}
        </span>
        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-surface-elevated border border-border text-foreground-muted">
          {chargerType}
        </span>
        <span className="text-xl font-bold text-foreground tabular-nums ml-auto">
          {formatEUR(costTTC)}
        </span>
      </div>

      {/* Session info */}
      <div className="grid grid-cols-1 gap-4">
        <DetailRow label="ID Session" value={cdr.id} mono />

        <DetailRow label="Station" value={locationParts.join(", ") || "—"} />

        <DetailRow
          label="EVSE / PdC"
          value={evseId !== "Inconnu" ? evseId : "—"}
          mono
        />

        <div className="border-t border-border/50 pt-4 grid grid-cols-2 gap-4">
          <DetailRow
            label="Début"
            value={cdr.start_date_time ? formatDateLongFR(cdr.start_date_time) : "—"}
          />
          <DetailRow
            label="Fin"
            value={cdr.end_date_time ? formatDateLongFR(cdr.end_date_time) : "—"}
          />
          <DetailRow
            label="Durée"
            value={formatDurationMinutes(cdr.total_time ?? 0)}
          />
          {cdr.total_parking_time != null && (
            <DetailRow
              label="Temps de stationnement"
              value={formatDurationMinutes(cdr.total_parking_time)}
            />
          )}
        </div>

        <div className="border-t border-border/50 pt-4 grid grid-cols-2 gap-4">
          <DetailRow
            label="Énergie délivrée"
            value={`${formatNumber(cdr.total_energy ?? 0)} kWh`}
          />
          <DetailRow label="Type de chargeur" value={chargerType} />
        </div>

        <div className="border-t border-border/50 pt-4 grid grid-cols-2 gap-4">
          <DetailRow label="Montant HT" value={formatEUR(costHT)} />
          <DetailRow label="Montant TTC" value={formatEUR(costTTC)} />
        </div>

        <div className="border-t border-border/50 pt-4 grid grid-cols-1 gap-4">
          <DetailRow label="Moyen de paiement" value={payment} />
          <DetailRow label="Opérateur eMSP" value={emsp} />
          {cdr.emsp_country_code && cdr.emsp_party_id && (
            <DetailRow
              label="Code eMSP"
              value={`${cdr.emsp_country_code}-${cdr.emsp_party_id}`}
              mono
            />
          )}
          {cdr.cdr_token && (
            <DetailRow
              label="Token"
              value={`${cdr.cdr_token.uid}${cdr.cdr_token.type ? ` (${cdr.cdr_token.type})` : ""}`}
              mono
            />
          )}
          {cdr.cdr_token?.contract_id && (
            <DetailRow label="Contract ID" value={cdr.cdr_token.contract_id} mono />
          )}
          {cdr.gfx_cdr_id && (
            <DetailRow label="Référence CDR source" value={cdr.gfx_cdr_id} mono />
          )}
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-foreground-muted mb-0.5">{label}</p>
      <p className={`text-sm text-foreground ${mono ? "font-mono text-xs break-all" : ""}`}>
        {value}
      </p>
    </div>
  );
}
