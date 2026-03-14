import { useOutletContext } from "react-router-dom";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { Download } from "lucide-react";
import { useB2BCdrs } from "@/hooks/useB2BCdrs";
import { groupByDriver, formatNumber } from "@/lib/b2b-formulas";
import { downloadCSV, todayISO } from "@/lib/export";
import type { B2BClient } from "@/types/b2b";

const CHART_COLORS = [
  "#00D4AA", "#3498DB", "#FF6B6B", "#F39C12", "#9B59B6",
  "#E74C3C", "#1ABC9C", "#2ECC71", "#E67E22", "#34495E",
  "#16A085", "#8E44AD", "#D35400", "#27AE60", "#2980B9",
  "#C0392B", "#7F8C8D", "#BDC3C7",
];

const tooltipStyle = {
  backgroundColor: "#111638",
  border: "1px solid #2A2F5A",
  borderRadius: "12px",
  color: "#F7F9FC",
  fontSize: "12px",
};

const thClass =
  "px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-foreground-muted";
const tdClass = "px-4 py-3 text-sm text-foreground whitespace-nowrap";

export function B2BDriversPage() {
  const { activeClient, customerExternalIds } =
    useOutletContext<{ activeClient: B2BClient | null; customerExternalIds: string[] }>();
  const { data: cdrs, isLoading } = useB2BCdrs(customerExternalIds);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="bg-surface border border-border rounded-2xl p-6 h-[300px] animate-pulse" />
        <div className="bg-surface border border-border rounded-2xl p-6 h-[400px] animate-pulse" />
      </div>
    );
  }

  const data = cdrs ?? [];
  const rows = groupByDriver(data);

  // Chart data (top 15 + "Autres")
  const topN = 15;
  const topDrivers = rows.slice(0, topN);
  const othersVolume = rows.slice(topN).reduce((s, r) => s + r.volumeGratuit, 0);
  const chartData = [
    ...topDrivers.map((r) => ({
      name: r.driverName,
      value: Math.round(r.volumeGratuit * 100) / 100,
    })),
    ...(othersVolume > 0 ? [{ name: "Autres", value: Math.round(othersVolume * 100) / 100 }] : []),
  ].filter((d) => d.value > 0);

  const totalVolume = rows.reduce((s, r) => s + r.volumeGratuit, 0);

  function handleExport() {
    const exportRows = rows.map((r) => ({
      Nom: r.lastName,
      Prénom: r.firstName,
      Token_Visual_Number: r.tokenVisualNumber,
      "Volume tarif gratuit (kWh)": formatNumber(r.volumeGratuit),
    }));
    downloadCSV(exportRows, `b2b-par-conducteur-${activeClient?.slug ?? "client"}-${todayISO()}.csv`);
  }

  return (
    <div className="space-y-6">
      {/* Pie chart */}
      <div className="bg-surface border border-border rounded-2xl p-6">
        <h3 className="text-sm font-semibold text-foreground mb-4">
          Volume (kWh) Mobilité flotte par Nom du conducteur
        </h3>
        {chartData.length > 0 ? (
          <div className="flex flex-col lg:flex-row items-center gap-6">
            <ResponsiveContainer width="100%" height={320} className="max-w-[400px]">
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  outerRadius={120}
                  dataKey="value"
                  stroke="none"
                  paddingAngle={1}
                >
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v: number, name: string) => [`${formatNumber(v)} kWh`, name]}
                />
              </PieChart>
            </ResponsiveContainer>

            {/* Legend */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 flex-1">
              {chartData.map((entry, i) => (
                <div key={entry.name} className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                  />
                  <span className="text-xs text-foreground truncate">{entry.name}</span>
                  <span className="text-xs text-foreground-muted ml-auto">
                    {totalVolume > 0
                      ? `${((entry.value / totalVolume) * 100).toFixed(0)}%`
                      : "0%"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-48 text-foreground-muted text-sm">
            Aucune donnée
          </div>
        )}
      </div>

      {/* Table */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          Détail par conducteur
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

      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className={thClass}>Nom</th>
                <th className={thClass}>Prénom</th>
                <th className={thClass}>Token Visual Number</th>
                <th className={`${thClass} text-right`}>Volume tarif gratuit (kWh)</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-foreground-muted text-sm">
                    Aucune donnée
                  </td>
                </tr>
              ) : (
                <>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-surface-elevated/50 transition-colors">
                      <td className={`${tdClass} font-medium`}>{r.lastName}</td>
                      <td className={tdClass}>{r.firstName}</td>
                      <td className={`${tdClass} font-mono text-xs`}>{r.tokenVisualNumber}</td>
                      <td className={`${tdClass} text-right`}>{formatNumber(r.volumeGratuit)}</td>
                    </tr>
                  ))}
                  {/* Total */}
                  <tr className="bg-surface-elevated/30 font-bold border-t-2 border-primary/30">
                    <td colSpan={3} className={tdClass}>Total</td>
                    <td className={`${tdClass} text-right`}>{formatNumber(totalVolume)}</td>
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
