import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useOutletContext } from "react-router-dom";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList, Legend,
} from "recharts";
import { Clock, Zap, Euro, Gauge, AlertTriangle, CheckCircle, GitCompareArrows, CreditCard, Tag, FileDown, X } from "lucide-react";
import { KPICard } from "@/components/ui/KPICard";
import { PageHelp } from "@/components/ui/PageHelp";
import { ExportButtons } from "./ExportButtons";
import { useB2BCdrs, useB2BCdrsPrevYear } from "@/hooks/useB2BCdrs";
import { useB2BFilters } from "@/contexts/B2BFilterContext";
import {
  computeKPIs, groupByMonth, formatDuration, formatDurationShort,
  formatNumber, formatEUR,
} from "@/lib/b2b-formulas";
import { exportCSV, exportPDF } from "@/lib/b2b-export";
import type { B2BClient } from "@/types/b2b";

const MONTH_SHORT = [
  "jan", "fév", "mars", "avr", "mai", "juin",
  "juil", "août", "sept", "oct", "nov", "déc",
];

const BAR_COLOR = "#9ACC0E";
const BAR_COLOR_PREV = "#4A5568";

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
  const { year } = useB2BFilters();

  const [showComparison, setShowComparison] = useState(false);
  const [sessionFilter, setSessionFilter] = useState<"all" | "free" | "paid">("all");

  const { data: cdrs, isLoading } = useB2BCdrs(customerExternalIds);
  const { data: prevCdrs } = useB2BCdrsPrevYear(customerExternalIds, showComparison);

  const allData = cdrs ?? [];

  // Session type counts (computed on unfiltered data)
  const freeSessionCount = useMemo(
    () => allData.filter((c) => c.total_retail_cost === 0 || c.total_retail_cost == null).length,
    [allData]
  );
  const paidSessionCount = useMemo(
    () => allData.filter((c) => c.total_retail_cost != null && c.total_retail_cost > 0).length,
    [allData]
  );

  // Apply session type filter
  const data = useMemo(() => {
    if (sessionFilter === "free") return allData.filter((c) => c.total_retail_cost === 0 || c.total_retail_cost == null);
    if (sessionFilter === "paid") return allData.filter((c) => c.total_retail_cost != null && c.total_retail_cost > 0);
    return allData;
  }, [allData, sessionFilter]);

  // Budget gauge: sum of total_cost for the current month
  const totalSpentThisMonth = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth(); // 0-indexed
    const currentYear = now.getFullYear();
    return allData
      .filter((c) => {
        const d = new Date(c.start_date_time);
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
      })
      .reduce((sum, c) => sum + (c.total_cost ?? 0), 0);
  }, [allData]);

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

  const rate = activeClient?.redevance_rate ?? 0.33;
  const kpis = computeKPIs(data, rate);
  const monthlyData = groupByMonth(data, rate);

  const budgetAmount = activeClient?.monthly_budget ?? 0;
  const pct = budgetAmount > 0 ? Math.round((totalSpentThisMonth / budgetAmount) * 100) : 0;
  const barColor = pct > 80 ? "bg-red-500" : pct > 60 ? "bg-amber-500" : "bg-emerald-500";
  const percentClass = pct > 80 ? "text-red-400" : pct > 60 ? "text-amber-400" : "text-emerald-400";

  // Previous year data for comparison
  const prevMonthlyData = showComparison && prevCdrs ? groupByMonth(prevCdrs, rate) : null;
  const prevMonthMap = new Map(prevMonthlyData?.map((m) => [m.month, m.volume]) ?? []);

  const chartData = monthlyData.map((m) => ({
    name: MONTH_SHORT[m.month - 1],
    volume: Math.round(m.volume),
    ...(showComparison ? { volumePrev: Math.round(prevMonthMap.get(m.month) ?? 0) } : {}),
  }));

  const clientName = activeClient?.name ?? "B2B";

  const handleExportCSV = () => {
    const rows = monthlyData.map((m) => ({
      mois: MONTH_SHORT[m.month - 1],
      volume: formatNumber(m.volume),
      duree: formatDuration(m.duration),
      redevance: formatEUR(m.redevance),
    }));
    exportCSV(rows, [
      { key: "mois", label: "Mois" },
      { key: "volume", label: "Volume (kWh)" },
      { key: "duree", label: "Duree" },
      { key: "redevance", label: "Redevance (EUR)" },
    ], `rapport-overview-${clientName}-${year}.csv`);
  };

  const handleExportPDF = () => {
    const rows = monthlyData.map((m) => ({
      mois: MONTH_SHORT[m.month - 1],
      volume: formatNumber(m.volume),
      duree: formatDuration(m.duration),
      redevance: formatEUR(m.redevance),
    }));
    exportPDF(
      `Vue d'ensemble — ${clientName}`,
      `Annee ${year}`,
      [
        { key: "mois", label: "Mois", width: 2 },
        { key: "volume", label: "Volume (kWh)", align: "right", width: 2 },
        { key: "duree", label: "Duree", align: "right", width: 2 },
        { key: "redevance", label: "Redevance", align: "right", width: 2 },
      ],
      rows,
      `rapport-overview-${clientName}-${year}.pdf`,
      {
        kpis: [
          { label: "Duree totale", value: formatDuration(kpis.totalTime) },
          { label: "Volume total", value: `${formatNumber(kpis.totalEnergy)} kWh` },
          { label: "Redevance", value: formatEUR(kpis.redevance) },
          { label: "Saturation", value: `${formatNumber(kpis.saturation * 100)}%` },
        ],
        totalsRow: {
          mois: "TOTAL",
          volume: formatNumber(kpis.totalEnergy),
          duree: formatDuration(kpis.totalTime),
          redevance: formatEUR(kpis.redevance),
        },
      }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div />
        <div className="flex items-center gap-3">
          {/* Story 78: Download monthly invoice PDF */}
          <button
            onClick={handleExportPDF}
            className="flex items-center gap-2 px-3 py-1.5 bg-surface-elevated border border-border rounded-lg text-xs font-medium text-foreground-muted hover:text-foreground hover:bg-surface transition-colors"
          >
            <FileDown className="w-3.5 h-3.5" />
            Télécharger facture
          </button>
          <ExportButtons onCSV={handleExportCSV} onPDF={handleExportPDF} />
        </div>
      </div>

      <PageHelp
        summary="Tableau de bord de votre consommation de recharge — KPIs et évolution mensuelle"
        items={[
          { label: "Volume total (kWh)", description: "Quantité totale d'énergie consommée par vos collaborateurs sur toutes les bornes." },
          { label: "Durée totale", description: "Temps cumulé de toutes les sessions de charge de votre entreprise." },
          { label: "Coût HT", description: "Montant total hors taxe calculé à partir des CDRs (Charge Detail Records)." },
          { label: "Redevance", description: "Part reversée à EZDrive, calculée selon le taux défini dans votre contrat." },
        ]}
        tips={["Les données proviennent des CDRs GreenFlux et sont mises à jour quotidiennement."]}
      />

      {/* Session type filter + free/paid KPIs */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-foreground-muted">Sessions :</span>
        {(
          [
            { key: "all", label: "Toutes" },
            { key: "free", label: "Gratuites (RFID)" },
            { key: "paid", label: "Payantes (SPOT)" },
          ] as const
        ).map((opt) => (
          <button
            key={opt.key}
            onClick={() => setSessionFilter(opt.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              sessionFilter === opt.key
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border text-foreground-muted hover:text-foreground hover:bg-surface-elevated"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <KPICard
          label="Sessions gratuites (RFID)"
          value={freeSessionCount}
          icon={Tag}
          color="#3498DB"
        />
        <KPICard
          label="Sessions payantes (SPOT)"
          value={paidSessionCount}
          icon={CreditCard}
          color="#9B59B6"
        />
        <KPICard
          label="Total sessions"
          value={allData.length}
          icon={Zap}
          color="#2ECC71"
        />
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="Durée totale"
          value={formatDuration(kpis.totalTime)}
          icon={Clock}
          color="#00C3FF"
        />
        <KPICard
          label="Volume total"
          value={`${formatNumber(kpis.totalEnergy)} kWh`}
          icon={Zap}
          color="#9ACC0E"
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

      {/* Budget Gauge */}
      {activeClient?.monthly_budget && activeClient.monthly_budget > 0 && (
        <div className="bg-surface border border-border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm text-foreground-muted">Budget mensuel</p>
              <p className="text-lg font-bold text-foreground">
                {formatEUR(totalSpentThisMonth)} / {formatEUR(activeClient.monthly_budget)}
              </p>
            </div>
            <span className={cn("text-sm font-medium", percentClass)}>{pct}%</span>
          </div>
          <div className="w-full h-3 bg-white/5 rounded-full overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", barColor)}
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Bar Chart: Volume par mois */}
      <div className="bg-surface border border-border rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-foreground">
            Somme de Volume par Mois
          </h3>
          <button
            onClick={() => setShowComparison((v) => !v)}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              showComparison
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border text-foreground-muted hover:text-foreground hover:bg-surface-elevated"
            }`}
          >
            <GitCompareArrows className="w-3.5 h-3.5" />
            Comparer {year - 1}
          </button>
        </div>
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
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v: number, name: string) => [
                `${v.toLocaleString("fr-FR")} kWh`,
                name === "volumePrev" ? `${year - 1}` : `${year}`,
              ]}
            />
            {showComparison && (
              <>
                <Legend
                  wrapperStyle={{ fontSize: 12, color: "#B0B8D4" }}
                  formatter={(value: string) => (value === "volumePrev" ? `${year - 1}` : `${year}`)}
                />
                <Bar dataKey="volumePrev" radius={[6, 6, 0, 0]} maxBarSize={35} fill={BAR_COLOR_PREV} opacity={0.5} />
              </>
            )}
            <Bar dataKey="volume" radius={[8, 8, 0, 0]} maxBarSize={showComparison ? 35 : 50}>
              {!showComparison && (
                <LabelList dataKey="volume" position="top" fill="#D0D6E8" fontSize={12} fontWeight={500} />
              )}
              {chartData.map((_, i) => (
                <Cell key={i} fill={BAR_COLOR} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
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
