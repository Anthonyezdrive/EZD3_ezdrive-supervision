import { useOutletContext } from "react-router-dom";
import { useState, useMemo } from "react";
import { Download, FileText, Eye, ChevronDown, ChevronUp } from "lucide-react";
import { useB2BCdrs } from "@/hooks/useB2BCdrs";
import { useB2BFilters } from "@/contexts/B2BFilterContext";
import { groupByMonth, formatDuration, formatNumber, formatEUR } from "@/lib/b2b-formulas";
import { downloadCSV, todayISO } from "@/lib/export";
import { exportPDF, exportInvoicePDF } from "@/lib/b2b-export";
import type { InvoiceData } from "@/lib/b2b-export";
import { ExportButtons } from "./ExportButtons";
import { PageHelp } from "@/components/ui/PageHelp";
import { SlideOver } from "@/components/ui/SlideOver";
import type { B2BClient, B2BCdr } from "@/types/b2b";

const thClass =
  "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-foreground-muted";
const tdClass = "px-4 py-3.5 text-sm text-foreground whitespace-nowrap";

const MONTH_NAMES = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

export function B2BMonthlyPage() {
  const { activeClient, customerExternalIds } =
    useOutletContext<{ activeClient: B2BClient | null; customerExternalIds: string[] }>();
  const { year } = useB2BFilters();
  const { data: cdrs, isLoading } = useB2BCdrs(customerExternalIds);
  const [expandedMonth, setExpandedMonth] = useState<number | null>(null);
  const [selectedCdr, setSelectedCdr] = useState<B2BCdr | null>(null);

  const data = cdrs ?? [];

  // CDRs grouped by month for drilldown
  const cdrsByMonth = useMemo(() => {
    const map = new Map<number, B2BCdr[]>();
    for (const cdr of data) {
      const m = new Date(cdr.start_date_time).getMonth() + 1;
      if (!map.has(m)) map.set(m, []);
      map.get(m)!.push(cdr);
    }
    return map;
  }, [data]);

  if (isLoading) {
    return (
      <div className="bg-surface border border-border rounded-2xl p-6 h-[500px] animate-pulse" />
    );
  }

  const rate = activeClient?.redevance_rate ?? 0.33;
  const rows = groupByMonth(data, rate);

  function generateInvoice(monthNum: number) {
    if (!activeClient) return;
    const monthCdrs = cdrsByMonth.get(monthNum) ?? [];
    if (monthCdrs.length === 0) return;

    const monthRow = rows.find((r) => r.month === monthNum);
    if (!monthRow) return;

    const monthLabel = `${MONTH_NAMES[monthNum - 1]} ${year}`;
    const invoiceNum = `EZD-${activeClient.slug.toUpperCase()}-${year}${String(monthNum).padStart(2, "0")}`;
    const totalRetail = monthCdrs.reduce((s, c) => s + (c.total_retail_cost ?? 0), 0);
    const redevanceHT = totalRetail * rate;
    const tvaRate = 0.20;
    const tva = redevanceHT * tvaRate;
    const ttc = redevanceHT + tva;

    const invoice: InvoiceData = {
      invoiceNumber: invoiceNum,
      invoiceDate: new Date().toLocaleDateString("fr-FR"),
      periodLabel: monthLabel,
      clientName: activeClient.name,
      clientSlug: activeClient.slug,
      redevanceRate: rate,
      lines: [
        {
          description: `Redevance charge - ${monthLabel}`,
          quantity: monthRow.volumeAvecTarif,
          unitLabel: "kWh",
          unitPrice: totalRetail > 0 ? (redevanceHT / monthRow.volumeAvecTarif) : 0,
          total: redevanceHT,
        },
        ...(monthRow.volumeGratuit > 0
          ? [{
              description: `Volume gratuit (RFID) - ${monthLabel}`,
              quantity: monthRow.volumeGratuit,
              unitLabel: "kWh",
              unitPrice: 0,
              total: 0,
            }]
          : []),
      ],
      totalHT: redevanceHT,
      tvaRate,
      totalTVA: tva,
      totalTTC: ttc,
    };

    exportInvoicePDF(invoice, `facture-${activeClient.slug}-${year}-${String(monthNum).padStart(2, "0")}.pdf`);
  }

  // Totals
  const totals = {
    volume: rows.reduce((s, r) => s + r.volume, 0),
    duration: rows.reduce((s, r) => s + r.duration, 0),
    volumeAvecTarif: rows.reduce((s, r) => s + r.volumeAvecTarif, 0),
    volumeGratuit: rows.reduce((s, r) => s + r.volumeGratuit, 0),
    redevance: rows.reduce((s, r) => s + r.redevance, 0),
  };

  function handleExport() {
    const exportRows = rows.map((r) => ({
      Mois: r.monthLabel,
      "Volume (kWh)": formatNumber(r.volume),
      Durée_totale: formatDuration(r.duration),
      "Volume avec tarif": formatNumber(r.volumeAvecTarif),
      "Volume tarif gratuit": formatNumber(r.volumeGratuit),
      "Redevance (€)": formatNumber(r.redevance),
    }));
    exportRows.push({
      Mois: "Total",
      "Volume (kWh)": formatNumber(totals.volume),
      Durée_totale: formatDuration(totals.duration),
      "Volume avec tarif": formatNumber(totals.volumeAvecTarif),
      "Volume tarif gratuit": formatNumber(totals.volumeGratuit),
      "Redevance (€)": formatNumber(totals.redevance),
    });
    downloadCSV(exportRows, `b2b-rapport-mensuel-${activeClient?.slug ?? "client"}-${year}-${todayISO()}.csv`);
  }

  function handleExportPDF() {
    const clientName = activeClient?.name ?? "B2B";
    const pdfRows = rows.map((r) => ({
      mois: r.monthLabel,
      volume: formatNumber(r.volume),
      duree: formatDuration(r.duration),
      volAvecTarif: formatNumber(r.volumeAvecTarif),
      volGratuit: formatNumber(r.volumeGratuit),
      redevance: formatNumber(r.redevance),
    }));
    exportPDF(
      `Rapport mensuel — ${clientName}`,
      `Annee ${year}`,
      [
        { key: "mois", label: "Mois", width: 2 },
        { key: "volume", label: "Volume (kWh)", align: "right", width: 1.5 },
        { key: "duree", label: "Duree", align: "right", width: 1.5 },
        { key: "volAvecTarif", label: "Vol. avec tarif", align: "right", width: 1.5 },
        { key: "volGratuit", label: "Vol. gratuit", align: "right", width: 1.5 },
        { key: "redevance", label: "Redevance (EUR)", align: "right", width: 1.5 },
      ],
      pdfRows,
      `rapport-mensuel-${activeClient?.slug ?? "client"}-${year}.pdf`,
      {
        totalsRow: {
          mois: "TOTAL",
          volume: formatNumber(totals.volume),
          duree: formatDuration(totals.duration),
          volAvecTarif: formatNumber(totals.volumeAvecTarif),
          volGratuit: formatNumber(totals.volumeGratuit),
          redevance: formatNumber(totals.redevance),
        },
      }
    );
  }

  return (
    <div className="space-y-4">
      <PageHelp
        summary="Détail mois par mois de votre consommation avec répartition et export"
        items={[
          { label: "Vue mensuelle", description: "Sélectionnez un mois pour voir le détail de chaque session de charge." },
          { label: "CDR", description: "Charge Detail Record — relevé détaillé d'une session : énergie, durée, coût, borne utilisée." },
          { label: "Export CSV", description: "Téléchargez les données du mois sélectionné au format CSV pour votre comptabilité." },
          { label: "Redevance mensuelle", description: "Montant dû pour le mois sélectionné, basé sur le taux contractuel." },
        ]}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-heading font-bold text-foreground">
          Rapport mensuel — {year}
        </h3>
        <ExportButtons onCSV={handleExport} onPDF={handleExportPDF} disabled={rows.length === 0} />
      </div>

      {/* Table */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className={thClass}>Mois</th>
                <th className={`${thClass} text-right`}>Volume (kWh)</th>
                <th className={`${thClass} text-right`}>Durée totale</th>
                <th className={`${thClass} text-right`}>Volume avec tarif</th>
                <th className={`${thClass} text-right`}>Volume tarif gratuit</th>
                <th className={`${thClass} text-right`}>Redevance (€)</th>
                <th className={`${thClass} text-center`}>Facture</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-foreground-muted text-sm">
                    Aucune donnée pour {year}
                  </td>
                </tr>
              ) : (
                <>
                  {rows.map((r) => {
                    const monthCdrs = cdrsByMonth.get(r.month) ?? [];
                    const isExpanded = expandedMonth === r.month;
                    return (
                      <>
                        <tr
                          key={r.month}
                          className="border-b border-border/50 hover:bg-surface-elevated/50 transition-colors cursor-pointer"
                          onClick={() => setExpandedMonth(isExpanded ? null : r.month)}
                        >
                          <td className={tdClass}>
                            <div className="flex items-center gap-2">
                              {monthCdrs.length > 0 && (
                                isExpanded
                                  ? <ChevronUp className="w-3.5 h-3.5 text-foreground-muted" />
                                  : <ChevronDown className="w-3.5 h-3.5 text-foreground-muted" />
                              )}
                              {r.monthLabel}
                            </div>
                          </td>
                          <td className={`${tdClass} text-right font-medium`}>{formatNumber(r.volume)}</td>
                          <td className={`${tdClass} text-right`}>{formatDuration(r.duration)}</td>
                          <td className={`${tdClass} text-right`}>{formatNumber(r.volumeAvecTarif)}</td>
                          <td className={`${tdClass} text-right`}>{formatNumber(r.volumeGratuit)}</td>
                          <td className={`${tdClass} text-right`}>{formatEUR(r.redevance)}</td>
                          <td className="px-3 py-2">
                            {monthCdrs.length > 0 && (
                              <button
                                onClick={(e) => { e.stopPropagation(); generateInvoice(r.month); }}
                                className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg border border-primary/30 bg-primary/5 text-primary hover:bg-primary/15 transition-colors"
                                title="Télécharger la facture"
                              >
                                <FileText className="w-3 h-3" />
                                Facture
                              </button>
                            )}
                          </td>
                        </tr>
                        {/* Expanded: CDR detail rows */}
                        {isExpanded && monthCdrs.length > 0 && (
                          <tr key={`exp-${r.month}`}>
                            <td colSpan={7} className="p-0">
                              <div className="bg-surface-elevated/30 border-y border-border/30">
                                <table className="w-full">
                                  <thead>
                                    <tr className="text-[10px] text-foreground-muted uppercase tracking-wider">
                                      <th className="px-4 py-2 text-left">Date</th>
                                      <th className="px-4 py-2 text-left">Lieu</th>
                                      <th className="px-4 py-2 text-left">Conducteur</th>
                                      <th className="px-4 py-2 text-right">Énergie</th>
                                      <th className="px-4 py-2 text-right">Coût</th>
                                      <th className="px-4 py-2 text-right"></th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {monthCdrs.slice(0, 50).map((cdr) => (
                                      <tr
                                        key={cdr.id}
                                        className="text-xs border-t border-border/20 hover:bg-surface-elevated/50 cursor-pointer transition-colors"
                                        onClick={(e) => { e.stopPropagation(); setSelectedCdr(cdr); }}
                                      >
                                        <td className="px-4 py-2 text-foreground-muted">
                                          {new Date(cdr.start_date_time).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                                        </td>
                                        <td className="px-4 py-2 text-foreground truncate max-w-[180px]">
                                          {cdr.cdr_location?.name ?? "—"}
                                        </td>
                                        <td className="px-4 py-2 text-foreground-muted truncate max-w-[140px]">
                                          {cdr.driver_external_id ?? "—"}
                                        </td>
                                        <td className="px-4 py-2 text-right text-foreground tabular-nums">
                                          {formatNumber(cdr.total_energy)} kWh
                                        </td>
                                        <td className="px-4 py-2 text-right text-foreground tabular-nums">
                                          {cdr.total_retail_cost_incl_vat != null
                                            ? formatEUR(cdr.total_retail_cost_incl_vat)
                                            : cdr.total_retail_cost != null
                                            ? formatEUR(cdr.total_retail_cost)
                                            : "Gratuit"}
                                        </td>
                                        <td className="px-4 py-2 text-right">
                                          <Eye className="w-3 h-3 text-foreground-muted" />
                                        </td>
                                      </tr>
                                    ))}
                                    {monthCdrs.length > 50 && (
                                      <tr>
                                        <td colSpan={6} className="px-4 py-2 text-xs text-foreground-muted text-center">
                                          +{monthCdrs.length - 50} autres sessions
                                        </td>
                                      </tr>
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                  {/* Total row */}
                  <tr className="bg-surface-elevated/30 font-bold border-t-2" style={{ borderTopColor: "#9ACC0E40" }}>
                    <td className={tdClass}>Total</td>
                    <td className={`${tdClass} text-right`}>{formatNumber(totals.volume)}</td>
                    <td className={`${tdClass} text-right`}>{formatDuration(totals.duration)}</td>
                    <td className={`${tdClass} text-right`}>{formatNumber(totals.volumeAvecTarif)}</td>
                    <td className={`${tdClass} text-right`}>{formatNumber(totals.volumeGratuit)}</td>
                    <td className={`${tdClass} text-right`}>{formatEUR(totals.redevance)}</td>
                    <td></td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CDR Detail Drawer */}
      <SlideOver
        open={selectedCdr !== null}
        onClose={() => setSelectedCdr(null)}
        title="Détail de la session"
      >
        {selectedCdr && (
          <div className="space-y-5 p-1">
            {/* Cost badge */}
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                (selectedCdr.total_retail_cost ?? 0) > 0
                  ? "bg-blue-500/10 text-blue-400 border-blue-500/25"
                  : "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
              }`}>
                {(selectedCdr.total_retail_cost ?? 0) > 0 ? "Session payante" : "Session gratuite"}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-foreground-muted mb-0.5">Lieu</p>
                <p className="text-sm font-medium text-foreground">{selectedCdr.cdr_location?.name ?? "—"}</p>
                {selectedCdr.cdr_location?.address && (
                  <p className="text-xs text-foreground-muted">{selectedCdr.cdr_location.address}</p>
                )}
                {selectedCdr.cdr_location?.city && (
                  <p className="text-xs text-foreground-muted">{selectedCdr.cdr_location.city}</p>
                )}
              </div>
              <div>
                <p className="text-xs text-foreground-muted mb-0.5">Conducteur</p>
                <p className="text-sm font-medium text-foreground">{selectedCdr.driver_external_id ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted mb-0.5">Début</p>
                <p className="text-sm text-foreground">
                  {new Date(selectedCdr.start_date_time).toLocaleString("fr-FR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted mb-0.5">Fin</p>
                <p className="text-sm text-foreground">
                  {new Date(selectedCdr.end_date_time).toLocaleString("fr-FR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted mb-0.5">Énergie</p>
                <p className="text-sm font-semibold text-foreground">{formatNumber(selectedCdr.total_energy)} kWh</p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted mb-0.5">Durée</p>
                <p className="text-sm text-foreground">{formatDuration(selectedCdr.total_time / 3600)}</p>
              </div>
              {selectedCdr.total_parking_time != null && (
                <div>
                  <p className="text-xs text-foreground-muted mb-0.5">Temps de stationnement</p>
                  <p className="text-sm text-foreground">{formatDuration(selectedCdr.total_parking_time / 3600)}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-foreground-muted mb-0.5">Coût HT</p>
                <p className="text-sm text-foreground">{selectedCdr.total_retail_cost != null ? formatEUR(selectedCdr.total_retail_cost) : "—"}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted mb-0.5">Coût TTC</p>
                <p className="text-sm font-semibold text-foreground">{selectedCdr.total_retail_cost_incl_vat != null ? formatEUR(selectedCdr.total_retail_cost_incl_vat) : "—"}</p>
              </div>
            </div>

            {/* Token info */}
            {selectedCdr.cdr_token && (
              <div className="bg-surface-elevated border border-border rounded-xl p-4 space-y-2">
                <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider">Token RFID</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-foreground-muted">UID</p>
                    <p className="text-sm font-mono text-foreground">{selectedCdr.cdr_token.uid}</p>
                  </div>
                  <div>
                    <p className="text-xs text-foreground-muted">Type</p>
                    <p className="text-sm text-foreground">{selectedCdr.cdr_token.type}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-xs text-foreground-muted">Contract ID</p>
                    <p className="text-sm font-mono text-foreground">{selectedCdr.cdr_token.contract_id}</p>
                  </div>
                </div>
              </div>
            )}

            {/* EVSE info */}
            {selectedCdr.cdr_location?.evses?.[0] && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-foreground-muted mb-0.5">EVSE ID</p>
                  <p className="text-xs font-mono text-foreground">{selectedCdr.cdr_location.evses[0].evse_id}</p>
                </div>
                <div>
                  <p className="text-xs text-foreground-muted mb-0.5">Type de chargeur</p>
                  <p className="text-sm text-foreground">{selectedCdr.charger_type ?? "—"}</p>
                </div>
              </div>
            )}

            {/* Metadata */}
            <div className="text-xs text-foreground-muted/60 border-t border-border pt-3 space-y-1">
              <p>Source: {selectedCdr.source} {selectedCdr.gfx_cdr_id ? `(${selectedCdr.gfx_cdr_id})` : ""}</p>
              <p>EMSP: {selectedCdr.emsp_country_code}-{selectedCdr.emsp_party_id}</p>
            </div>
          </div>
        )}
      </SlideOver>
    </div>
  );
}
