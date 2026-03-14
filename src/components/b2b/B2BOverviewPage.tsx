import { useOutletContext } from "react-router-dom";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList,
} from "recharts";
import { Clock, Zap, Euro, Gauge, AlertTriangle, CheckCircle } from "lucide-react";
import { KPICard } from "@/components/ui/KPICard";
import { useB2BCdrs } from "@/hooks/useB2BCdrs";
import {
  computeKPIs, groupByMonth, formatDuration, formatDurationShort,
  formatNumber, formatEUR,
} from "@/lib/b2b-formulas";
import type { B2BClient } from "@/types/b2b";

const MONTH_SHORT = [
  "jan", "fév", "mars", "avr", "mai", "juin",
  "juil", "août", "sept", "oct", "nov", "déc",
];

const BAR_COLOR = "#00D4AA";

const tooltipStyle = {
  backgroundColor: "#111638",
  border: "1px solid #2A2F5A",
  borderRadius: "12px",
  color: "#F7F9FC",
  fontSize: "12px",
};

export function B2BOverviewPage() {
  const { activeClient, customerExternalIds } =
    useOutletContext<{ activeClient: B2BClient | null; customerExternalIds: string[] }>();

  const { data: cdrs, isLoading } = useB2BCdrs(customerExternalIds);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-5 h-[88px] animate-pulse" />
          ))}
        </div>
        <div className="bg-surface border border-border rounded-2xl p-6 h-[320px] animate-pulse" />
      </div>
    );
  }

  const data = cdrs ?? [];
  const rate = activeClient?.redevance_rate ?? 0.33;
  const kpis = computeKPIs(data, rate);
  const monthlyData = groupByMonth(data, rate);

  const chartData = monthlyData.map((m) => ({
    name: MONTH_SHORT[m.month - 1],
    volume: Math.round(m.volume),
  }));

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="Durée totale"
          value={formatDuration(kpis.totalTime)}
          icon={Clock}
          color="#3498DB"
        />
        <KPICard
          label="Volume total"
          value={`${formatNumber(kpis.totalEnergy)} kWh`}
          icon={Zap}
          color="#00D4AA"
        />
        <KPICard
          label="Redevance"
          value={formatEUR(kpis.redevance)}
          icon={Euro}
          color="#F39C12"
        />
        <KPICard
          label="Saturation"
          value={`${formatNumber(kpis.saturation * 100)}%`}
          icon={Gauge}
          color="#E74C3C"
        />
      </div>

      {/* Bar Chart: Volume par mois */}
      <div className="bg-surface border border-border rounded-2xl p-6">
        <h3 className="text-base font-semibold text-foreground mb-4">
          Somme de Volume par Mois
        </h3>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} margin={{ top: 20, right: 10, bottom: 5, left: -10 }}>
              <XAxis
                dataKey="name"
                tick={{ fill: "#B0B8D4", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "#B0B8D4", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} kWh`, "Volume"]} />
              <Bar dataKey="volume" radius={[8, 8, 0, 0]} maxBarSize={50}>
                <LabelList dataKey="volume" position="top" fill="#D0D6E8" fontSize={12} fontWeight={500} />
                {chartData.map((_, i) => (
                  <Cell key={i} fill={BAR_COLOR} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-48 text-foreground-muted text-sm">
            Aucune donnée pour cette période
          </div>
        )}
      </div>

      {/* Secondary stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-surface border border-border rounded-2xl p-5">
          <p className="text-sm text-foreground-muted mb-2">Volume moyen / session</p>
          <p className="text-2xl font-heading font-bold text-foreground">
            {formatNumber(kpis.avgEnergyPerSession)} <span className="text-base font-normal text-foreground-muted">kWh</span>
          </p>
        </div>
        <div className="bg-surface border border-border rounded-2xl p-5">
          <p className="text-sm text-foreground-muted mb-2">Temps réel / session</p>
          <p className="text-2xl font-heading font-bold text-foreground">
            {formatDurationShort(kpis.avgRealTime)}
          </p>
        </div>
        <div className="bg-surface border border-border rounded-2xl p-5">
          <p className="text-sm text-foreground-muted mb-2">Temps équivalent / session</p>
          <p className="text-2xl font-heading font-bold text-foreground">
            {formatDurationShort(kpis.avgEquivTime)}
          </p>
        </div>
        <div className={`bg-surface border rounded-2xl p-5 ${kpis.ventouse.isWarning ? "border-red-500/40" : "border-border"}`}>
          <p className="text-sm text-foreground-muted mb-2">Temps en ventouse</p>
          <div className="flex items-center gap-2">
            {kpis.ventouse.isWarning ? (
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
            ) : (
              <CheckCircle className="w-5 h-5 text-green-400 shrink-0" />
            )}
            <p className="text-2xl font-heading font-bold text-foreground">
              {formatNumber(kpis.saturation * 100)}%
            </p>
          </div>
          <p className="text-xs text-foreground-muted mt-1.5">
            {kpis.ventouse.label}
          </p>
        </div>
      </div>
    </div>
  );
}
