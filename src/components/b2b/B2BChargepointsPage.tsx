import { useOutletContext } from "react-router-dom";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { Download } from "lucide-react";
import { useB2BCdrs } from "@/hooks/useB2BCdrs";
import { groupByChargePoint, formatDuration, formatNumber } from "@/lib/b2b-formulas";
import { downloadCSV, todayISO } from "@/lib/export";
import type { B2BClient } from "@/types/b2b";

const CHART_COLORS = [
  "#00D4AA", "#3498DB", "#FF6B6B", "#F39C12", "#9B59B6",
  "#E74C3C", "#1ABC9C", "#2ECC71", "#E67E22", "#34495E",
  "#16A085", "#8E44AD", "#D35400", "#27AE60",
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

export function B2BChargepointsPage() {
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
  const rows = groupByChargePoint(data);

  // Chart data
  const totalVolume = rows.reduce((s, r) => s + r.volume, 0);
  const chartData = rows.map((r) => ({
    name: r.chargePointId,
    value: Math.round(r.volume * 100) / 100,
    pct: totalVolume > 0 ? ((r.volume / totalVolume) * 100).toFixed(1) : "0",
  }));

  // Totals
  const totals = {
    volume: totalVolume,
    duration: rows.reduce((s, r) => s + r.duration, 0),
    saturation: rows.length > 0 ? rows.reduce((s, r) => s + r.saturation, 0) / rows.length : 0,
    co2: rows.reduce((s, r) => s + r.co2Evite, 0),
  };

  function handleExport() {
    const exportRows = rows.map((r) => ({
      Charge_Point_ID: r.chargePointId,
      "Volume (kWh)": formatNumber(r.volume),
      Durée_totale: formatDuration(r.duration),
      "Saturation (%)": formatNumber(r.saturation * 100),
      "CO2 évité (kg)": formatNumber(r.co2Evite),
    }));
    downloadCSV(exportRows, `b2b-par-borne-${activeClient?.slug ?? "client"}-${todayISO()}.csv`);
  }

  return (
    <div className="space-y-6">
      {/* Donut chart + Legend */}
      <div className="bg-surface border border-border rounded-2xl p-6">
        <h3 className="text-sm font-semibold text-foreground mb-4">
          Répartition des Volumes délivrés par Borne
        </h3>
        {chartData.length > 0 ? (
          <div className="flex flex-col lg:flex-row items-center gap-6">
            <ResponsiveContainer width="100%" height={280} className="max-w-[400px]">
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={65}
                  outerRadius={110}
                  dataKey="value"
                  stroke="none"
                  paddingAngle={2}
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 flex-1">
              {chartData.map((entry, i) => (
                <div key={entry.name} className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                  />
                  <span className="text-xs text-foreground truncate">{entry.name}</span>
                  <span className="text-xs text-foreground-muted ml-auto">{entry.pct}%</span>
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
        <h3 className="text-sm font-semibold text-foreground">Détail par borne</h3>
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
                <th className={thClass}>Charge Point ID</th>
                <th className={`${thClass} text-right`}>Volume (kWh)</th>
                <th className={`${thClass} text-right`}>Durée totale</th>
                <th className={`${thClass} text-right`}>Saturation</th>
                <th className={`${thClass} text-right`}>CO₂ évité</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.chargePointId} className="border-b border-border/50 hover:bg-surface-elevated/50 transition-colors">
                  <td className={`${tdClass} font-medium`}>{r.chargePointId}</td>
                  <td className={`${tdClass} text-right`}>{formatNumber(r.volume)}</td>
                  <td className={`${tdClass} text-right`}>{formatDuration(r.duration)}</td>
                  <td className={`${tdClass} text-right`}>{formatNumber(r.saturation * 100)} %</td>
                  <td className={`${tdClass} text-right`}>{formatNumber(r.co2Evite)} kg CO₂</td>
                </tr>
              ))}
              {rows.length > 0 && (
                <tr className="bg-surface-elevated/30 font-bold border-t-2 border-primary/30">
                  <td className={tdClass}>Total</td>
                  <td className={`${tdClass} text-right`}>{formatNumber(totals.volume)}</td>
                  <td className={`${tdClass} text-right`}>{formatDuration(totals.duration)}</td>
                  <td className={`${tdClass} text-right`}>{formatNumber(totals.saturation * 100)} %</td>
                  <td className={`${tdClass} text-right`}>{formatNumber(totals.co2)} kg CO₂</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
