import { useOutletContext } from "react-router-dom";
import { Download } from "lucide-react";
import { useB2BCdrs } from "@/hooks/useB2BCdrs";
import { useB2BFilters } from "@/contexts/B2BFilterContext";
import { groupByMonth, formatDuration, formatNumber, formatEUR } from "@/lib/b2b-formulas";
import { downloadCSV, todayISO } from "@/lib/export";
import type { B2BClient } from "@/types/b2b";

const thClass =
  "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-foreground-muted";
const tdClass = "px-4 py-3.5 text-sm text-foreground whitespace-nowrap";

export function B2BMonthlyPage() {
  const { activeClient, customerExternalIds } =
    useOutletContext<{ activeClient: B2BClient | null; customerExternalIds: string[] }>();
  const { year } = useB2BFilters();
  const { data: cdrs, isLoading } = useB2BCdrs(customerExternalIds);

  if (isLoading) {
    return (
      <div className="bg-surface border border-border rounded-2xl p-6 h-[500px] animate-pulse" />
    );
  }

  const data = cdrs ?? [];
  const rate = activeClient?.redevance_rate ?? 0.33;
  const rows = groupByMonth(data, rate);

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

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-heading font-bold text-foreground">
          Rapport mensuel — {year}
        </h3>
        <button
          onClick={handleExport}
          disabled={rows.length === 0}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-surface-elevated border border-border rounded-xl text-foreground-muted hover:text-foreground hover:border-border-focus transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>
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
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-foreground-muted text-sm">
                    Aucune donnée pour {year}
                  </td>
                </tr>
              ) : (
                <>
                  {rows.map((r) => (
                    <tr key={r.month} className="border-b border-border/50 hover:bg-surface-elevated/50 transition-colors">
                      <td className={tdClass}>{r.monthLabel}</td>
                      <td className={`${tdClass} text-right font-medium`}>{formatNumber(r.volume)}</td>
                      <td className={`${tdClass} text-right`}>{formatDuration(r.duration)}</td>
                      <td className={`${tdClass} text-right`}>{formatNumber(r.volumeAvecTarif)}</td>
                      <td className={`${tdClass} text-right`}>{formatNumber(r.volumeGratuit)}</td>
                      <td className={`${tdClass} text-right`}>{formatEUR(r.redevance)}</td>
                    </tr>
                  ))}
                  {/* Total row */}
                  <tr className="bg-surface-elevated/30 font-bold border-t-2 border-primary/30">
                    <td className={tdClass}>Total</td>
                    <td className={`${tdClass} text-right`}>{formatNumber(totals.volume)}</td>
                    <td className={`${tdClass} text-right`}>{formatDuration(totals.duration)}</td>
                    <td className={`${tdClass} text-right`}>{formatNumber(totals.volumeAvecTarif)}</td>
                    <td className={`${tdClass} text-right`}>{formatNumber(totals.volumeGratuit)}</td>
                    <td className={`${tdClass} text-right`}>{formatEUR(totals.redevance)}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
