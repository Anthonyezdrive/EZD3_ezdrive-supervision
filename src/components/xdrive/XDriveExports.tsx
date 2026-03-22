import { useState, useMemo, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import {
  FileSpreadsheet,
  FileText,
  Download,
  Clock,
  Loader2,
  CheckCircle2,
  Lock,
} from "lucide-react";
import {
  useXDriveB2BClient,
  useXDriveCDRs,
  computeXDriveKPIs,
  groupCDRsByMonth,
  type XDriveFilters,
} from "@/hooks/useXDriveCDRs";
import { exportCSV, exportPDF } from "@/lib/b2b-export";
import type { XDrivePartner, XDriveTheme } from "@/types/xdrive";
import type { B2BCdr } from "@/types/b2b";

// ── Outlet context ─────────────────────────────────────────

interface XDriveOutletContext {
  partner: XDrivePartner | null;
  isEZDriveAdmin: boolean;
  theme: XDriveTheme;
}

// ── Recent export tracking ─────────────────────────────────

interface RecentExport {
  id: string;
  label: string;
  format: "CSV" | "PDF";
  filename: string;
  timestamp: number;
  period: string;
}

const STORAGE_KEY = "xdrive-recent-exports";

function loadRecentExports(): RecentExport[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RecentExport[]) : [];
  } catch {
    return [];
  }
}

function saveRecentExport(entry: Omit<RecentExport, "id">) {
  const entries = loadRecentExports();
  const newEntry: RecentExport = { ...entry, id: `${Date.now()}-${Math.random()}` };
  const updated = [newEntry, ...entries].slice(0, 5);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // ignore storage errors
  }
  return updated;
}

// ── Period helpers ─────────────────────────────────────────

const MONTHS_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

function getPeriodLabel(year: number, month: number): string {
  return `${MONTHS_FR[month - 1]} ${year}`;
}

function getMonthRange(year: number, month: number): { dateFrom: string; dateTo: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  return {
    dateFrom: `${year}-${pad(month)}-01`,
    dateTo: `${year}-${pad(month)}-${lastDay}`,
  };
}

// ── CDR CSV headers ────────────────────────────────────────

const CDR_HEADERS = [
  { key: "id", label: "ID CDR" },
  { key: "start_date_time", label: "Début" },
  { key: "end_date_time", label: "Fin" },
  { key: "total_energy", label: "Énergie (kWh)" },
  { key: "total_time", label: "Durée (h)" },
  { key: "total_cost", label: "CA HT (€)" },
  { key: "total_retail_cost", label: "CA TTC (€)" },
  { key: "total_retail_cost_incl_vat", label: "CA TTC incl. TVA (€)" },
  { key: "customer_external_id", label: "Client ID" },
  { key: "driver_external_id", label: "Driver ID" },
  { key: "station_id", label: "Station ID" },
  { key: "auth_id", label: "Auth ID" },
  { key: "emsp_party_id", label: "eMSP" },
  { key: "emsp_country_code", label: "Pays eMSP" },
  { key: "charger_type", label: "Type chargeur" },
  { key: "source", label: "Source" },
];

// ── Monthly summary headers ────────────────────────────────

const MONTHLY_HEADERS = [
  { key: "mois", label: "Mois" },
  { key: "sessions", label: "Sessions" },
  { key: "energie_kwh", label: "Énergie (kWh)" },
  { key: "ca_ht", label: "CA HT (€)" },
  { key: "ca_ttc", label: "CA TTC (€)" },
];

// ── Flatten CDR for CSV ────────────────────────────────────

function flattenCDR(cdr: B2BCdr): Record<string, string | number> {
  return {
    id: cdr.id ?? "",
    start_date_time: cdr.start_date_time ?? "",
    end_date_time: cdr.end_date_time ?? "",
    total_energy: cdr.total_energy ?? 0,
    total_time: cdr.total_time ?? 0,
    total_cost: cdr.total_cost ?? 0,
    total_retail_cost: cdr.total_retail_cost ?? 0,
    total_retail_cost_incl_vat: cdr.total_retail_cost_incl_vat ?? 0,
    customer_external_id: cdr.customer_external_id ?? "",
    driver_external_id: cdr.driver_external_id ?? "",
    station_id: cdr.station_id ?? "",
    auth_id: cdr.auth_id ?? "",
    emsp_party_id: cdr.emsp_party_id ?? "",
    emsp_country_code: cdr.emsp_country_code ?? "",
    charger_type: cdr.charger_type ?? "",
    source: cdr.source ?? "",
  };
}

// ── Export card types ──────────────────────────────────────

type ExportStatus = "idle" | "loading" | "done" | "error";

interface ExportCardDef {
  id: string;
  title: string;
  description: string;
  formats: Array<"CSV" | "PDF">;
  available: boolean;
}

const EXPORT_CARDS: ExportCardDef[] = [
  {
    id: "cdr-detailed",
    title: "CDR détaillés",
    description: "Tous les CDR de la période avec l'ensemble des champs (énergie, durée, CA, token, eMSP).",
    formats: ["CSV"],
    available: true,
  },
  {
    id: "synthese-activite",
    title: "Synthèse d'activité",
    description: "Rapport PDF avec KPIs, tendance mensuelle et ventilation par mode de paiement.",
    formats: ["PDF"],
    available: true,
  },
  {
    id: "rapport-mensuel",
    title: "Rapport mensuel",
    description: "Données agrégées mois par mois : sessions, énergie et CA.",
    formats: ["CSV"],
    available: true,
  },
  {
    id: "annexe-cdr-facturation",
    title: "Annexe CDR facturation",
    description: "CDR du mois sélectionné pour annexe de facture, format comptable.",
    formats: ["CSV"],
    available: true,
  },
  {
    id: "rapprochement",
    title: "Rapprochement financier",
    description: "Comparaison CA CDR vs encaissements réels par mode de paiement.",
    formats: ["PDF", "CSV"],
    available: false,
  },
  {
    id: "factures",
    title: "Factures",
    description: "Factures BPU SURAYA→Total et factures Total→EZDrive avec annexes.",
    formats: ["PDF"],
    available: false,
  },
];

// ── Export card component ──────────────────────────────────

interface ExportCardProps {
  card: ExportCardDef;
  recordCount: number | null;
  onExport: (cardId: string, format: "CSV" | "PDF") => void;
  statusMap: Record<string, ExportStatus>;
  theme: XDriveTheme;
}

function ExportCard({ card, recordCount, onExport, statusMap, theme }: ExportCardProps) {
  const getStatus = (format: "CSV" | "PDF") => statusMap[`${card.id}-${format}`] ?? "idle";

  return (
    <div
      className={[
        "rounded-2xl border border-border bg-surface-elevated p-5 flex flex-col gap-4 transition-opacity",
        !card.available ? "opacity-60" : "",
      ].join(" ")}
    >
      {/* Icon + title */}
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${theme.primaryColor}18` }}
        >
          {card.formats.includes("CSV") && !card.formats.includes("PDF") ? (
            <FileSpreadsheet className="w-5 h-5" style={{ color: theme.primaryColor }} />
          ) : (
            <FileText className="w-5 h-5" style={{ color: theme.primaryColor }} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{card.title}</h3>
            {!card.available && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface border border-border text-[11px] text-foreground-muted">
                <Lock className="w-2.5 h-2.5" />
                Bientôt
              </span>
            )}
          </div>
          <p className="text-xs text-foreground-muted mt-0.5 leading-relaxed">
            {card.description}
          </p>
        </div>
      </div>

      {/* Record count hint */}
      {card.available && recordCount !== null && (
        <div className="text-xs text-foreground-muted">
          <span className="font-medium text-foreground">{recordCount.toLocaleString("fr-FR")}</span>{" "}
          {recordCount === 1 ? "enregistrement" : "enregistrements"} sur la période
        </div>
      )}

      {/* Format buttons */}
      <div className="flex items-center gap-2 flex-wrap mt-auto pt-1">
        {card.formats.map((fmt) => {
          const status = getStatus(fmt);
          const isLoading = status === "loading";
          const isDone = status === "done";

          return (
            <button
              key={fmt}
              disabled={!card.available || isLoading}
              onClick={() => card.available && onExport(card.id, fmt)}
              className={[
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border",
                !card.available
                  ? "opacity-40 cursor-not-allowed border-border text-foreground-muted"
                  : isLoading
                  ? "cursor-wait border-border text-foreground-muted"
                  : isDone
                  ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                  : "border-border text-foreground hover:text-foreground hover:bg-surface cursor-pointer",
              ].join(" ")}
              style={
                card.available && !isLoading && !isDone
                  ? { borderColor: `${theme.primaryColor}40`, color: theme.primaryColor }
                  : {}
              }
            >
              {isLoading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : isDone ? (
                <CheckCircle2 className="w-3 h-3" />
              ) : (
                <Download className="w-3 h-3" />
              )}
              {fmt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────

export function XDriveExports() {
  const { partner, theme } = useOutletContext<XDriveOutletContext>();

  // Period state (default: current month)
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);

  // Status map: cardId-format → ExportStatus
  const [statusMap, setStatusMap] = useState<Record<string, ExportStatus>>({});

  // Recent exports
  const [recentExports, setRecentExports] = useState<RecentExport[]>(loadRecentExports);

  // B2B client
  const { data: b2bClient } = useXDriveB2BClient(partner?.b2b_client_id);

  const customerExternalIds = useMemo(
    () =>
      b2bClient?.customer_external_ids ??
      (b2bClient?.id ? [b2bClient.id] : []),
    [b2bClient]
  );

  const { dateFrom, dateTo } = useMemo(
    () => getMonthRange(selectedYear, selectedMonth),
    [selectedYear, selectedMonth]
  );

  const filters: XDriveFilters = useMemo(
    () => ({
      dateFrom,
      dateTo,
      paymentTypes: ["CB", "RFID", "App", "QR"],
      operatorType: "all",
    }),
    [dateFrom, dateTo]
  );

  const { data: cdrs, isLoading: cdrsLoading } = useXDriveCDRs(customerExternalIds, filters);

  const cdrCount = cdrs?.length ?? null;

  const setStatus = useCallback((key: string, status: ExportStatus) => {
    setStatusMap((prev) => ({ ...prev, [key]: status }));
  }, []);

  const trackExport = useCallback(
    (label: string, format: "CSV" | "PDF", filename: string) => {
      const updated = saveRecentExport({
        label,
        format,
        filename,
        timestamp: Date.now(),
        period: getPeriodLabel(selectedYear, selectedMonth),
      });
      setRecentExports(updated);
    },
    [selectedYear, selectedMonth]
  );

  const handleExport = useCallback(
    async (cardId: string, format: "CSV" | "PDF") => {
      const key = `${cardId}-${format}`;
      setStatus(key, "loading");

      const periodLabel = getPeriodLabel(selectedYear, selectedMonth);
      const periodSlug = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}`;
      const partnerSlug = partner?.partner_code?.toLowerCase() ?? "export";

      try {
        // ── Card: CDR détaillés ──────────────────────────────────
        if (cardId === "cdr-detailed" && format === "CSV") {
          const rows = (cdrs ?? []).map(flattenCDR);
          const filename = `cdrs_${partnerSlug}_${periodSlug}.csv`;
          exportCSV(rows, CDR_HEADERS, filename);
          trackExport("CDR détaillés", "CSV", filename);
        }

        // ── Card: Synthèse d'activité ────────────────────────────
        else if (cardId === "synthese-activite" && format === "PDF") {
          const kpis = computeXDriveKPIs(cdrs ?? []);
          const monthly = groupCDRsByMonth(cdrs ?? []);

          const pdfKPIs = [
            { label: "Sessions", value: kpis.sessionCount.toLocaleString("fr-FR") },
            { label: "Énergie (kWh)", value: kpis.totalEnergy.toFixed(1) },
            { label: "CA HT (€)", value: kpis.caHT.toFixed(2) },
            { label: "Durée moy. (min)", value: kpis.sessionCount > 0 ? (kpis.totalDuration / kpis.sessionCount).toFixed(0) : "0" },
          ];

          const pdfCols = [
            { key: "monthLabel", label: "Mois", width: 1 },
            { key: "sessionCount", label: "Sessions", align: "right" as const, width: 1 },
            { key: "energy", label: "Énergie (kWh)", align: "right" as const, width: 1.5 },
            { key: "caHT", label: "CA HT (€)", align: "right" as const, width: 1.5 },
          ];

          const pdfRows = monthly
            .filter((r) => r.sessionCount > 0)
            .map((r) => ({
              monthLabel: r.monthLabel,
              sessionCount: r.sessionCount,
              energy: r.energy.toFixed(2),
              caHT: r.caHT.toFixed(2),
            }));

          const filename = `synthese_activite_${partnerSlug}_${periodSlug}.pdf`;
          exportPDF(
            `Synthèse d'activité — ${periodLabel}`,
            `${partner?.display_name ?? "Partenaire"} — Rapport généré le ${new Date().toLocaleDateString("fr-FR")}`,
            pdfCols,
            pdfRows,
            filename,
            { kpis: pdfKPIs }
          );
          trackExport("Synthèse d'activité", "PDF", filename);
        }

        // ── Card: Rapport mensuel ────────────────────────────────
        else if (cardId === "rapport-mensuel" && format === "CSV") {
          const monthly = groupCDRsByMonth(cdrs ?? []);
          const rows = monthly.map((r) => ({
            mois: r.monthLabel,
            sessions: r.sessionCount,
            energie_kwh: r.energy.toFixed(3),
            ca_ht: r.caHT.toFixed(2),
            ca_ttc: (r.caHT * 1.2).toFixed(2), // approximate TTC
          }));
          const filename = `rapport_mensuel_${partnerSlug}_${periodSlug}.csv`;
          exportCSV(rows, MONTHLY_HEADERS, filename);
          trackExport("Rapport mensuel", "CSV", filename);
        }

        // ── Card: Annexe CDR facturation ─────────────────────────
        else if (cardId === "annexe-cdr-facturation" && format === "CSV") {
          const rows = (cdrs ?? []).map(flattenCDR);
          const filename = `annexe_cdr_facture_${partnerSlug}_${periodSlug}.csv`;
          exportCSV(rows, CDR_HEADERS, filename);
          trackExport("Annexe CDR facturation", "CSV", filename);
        }

        setStatus(key, "done");
        // Reset to idle after 2.5s
        setTimeout(() => setStatus(key, "idle"), 2500);
      } catch (err) {
        console.error("[XDriveExports] Export error:", err);
        setStatus(key, "error");
        setTimeout(() => setStatus(key, "idle"), 3000);
      }
    },
    [cdrs, b2bClient, partner, selectedYear, selectedMonth, setStatus, trackExport]
  );

  // Available years for selector
  const currentYear = now.getFullYear();
  const years = [currentYear - 1, currentYear, currentYear + 1].filter((y) => y <= currentYear);

  return (
    <div className="space-y-6">
      {/* ── Page header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-lg font-heading font-bold text-foreground">Centre d'exports</h2>
          <p className="text-sm text-foreground-muted mt-0.5">
            Générez et téléchargez vos exports pour la période sélectionnée.
          </p>
        </div>

        {/* ── Period selector ── */}
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <label className="block text-xs text-foreground-muted uppercase tracking-wider mb-1">
              Mois
            </label>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="px-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground focus:border-border-focus focus:outline-none"
            >
              {MONTHS_FR.map((label, i) => (
                <option key={i + 1} value={i + 1}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-foreground-muted uppercase tracking-wider mb-1">
              Année
            </label>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="px-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground focus:border-border-focus focus:outline-none"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          {/* Loading indicator */}
          {cdrsLoading && (
            <div className="flex items-center gap-1.5 text-xs text-foreground-muted pt-5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Chargement…
            </div>
          )}
          {!cdrsLoading && cdrCount !== null && (
            <div className="text-xs text-foreground-muted pt-5">
              <span className="font-medium text-foreground">{cdrCount.toLocaleString("fr-FR")}</span> CDR trouvés
            </div>
          )}
        </div>
      </div>

      {/* ── Export cards grid ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {EXPORT_CARDS.map((card) => (
          <ExportCard
            key={card.id}
            card={card}
            recordCount={
              card.available && (card.id === "cdr-detailed" || card.id === "annexe-cdr-facturation")
                ? cdrCount
                : card.available && card.id === "rapport-mensuel"
                ? 12
                : null
            }
            onExport={handleExport}
            statusMap={statusMap}
            theme={theme}
          />
        ))}
      </div>

      {/* ── Recent exports section ── */}
      {recentExports.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface-elevated p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-foreground-muted" />
            <h3 className="text-sm font-semibold text-foreground">Exports récents</h3>
          </div>

          <div className="space-y-2">
            {recentExports.map((entry) => {
              const age = Date.now() - entry.timestamp;
              const ageLabel =
                age < 60_000
                  ? "À l'instant"
                  : age < 3_600_000
                  ? `${Math.floor(age / 60_000)} min`
                  : age < 86_400_000
                  ? `${Math.floor(age / 3_600_000)} h`
                  : new Date(entry.timestamp).toLocaleDateString("fr-FR");

              return (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-0"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {entry.format === "CSV" ? (
                      <FileSpreadsheet className="w-4 h-4 text-foreground-muted shrink-0" />
                    ) : (
                      <FileText className="w-4 h-4 text-foreground-muted shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm text-foreground font-medium truncate">{entry.label}</p>
                      <p className="text-xs text-foreground-muted">
                        {entry.period} · {entry.format}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-foreground-muted">{ageLabel}</span>
                    <span className="px-2 py-0.5 rounded-full text-[11px] bg-surface border border-border text-foreground-muted">
                      {entry.format}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
