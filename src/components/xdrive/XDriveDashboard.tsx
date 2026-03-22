import { useState, useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Legend,
  PieChart,
  Pie,
} from "recharts";
import {
  Zap,
  Clock,
  Euro,
  Gauge,
  CreditCard,
  Wifi,
  BarChart2,
} from "lucide-react";
import { KPICard } from "@/components/ui/KPICard";
import {
  useXDriveB2BClient,
  useXDriveCDRs,
  computeXDriveKPIs,
  groupCDRsByMonth,
  type XDriveFilters,
} from "@/hooks/useXDriveCDRs";
import type { XDrivePartner, XDriveTheme } from "@/types/xdrive";

// ── Outlet context ────────────────────────────────────────

interface XDriveOutletContext {
  partner: XDrivePartner | null;
  isEZDriveAdmin: boolean;
  theme: XDriveTheme;
}

// ── Constants ─────────────────────────────────────────────

const TOOLTIP_STYLE = {
  backgroundColor: "#111638",
  border: "1px solid #2A2F5A",
  borderRadius: "12px",
  color: "#F7F9FC",
  fontSize: "12px",
};

const PAYMENT_COLORS: Record<string, string> = {
  CB: "#3498DB",
  RFID: "#9ACC0E",
  App: "#F39C12",
  QR: "#9B59B6",
};

const EMSP_COLORS = [
  "#9ACC0E", "#3498DB", "#F39C12", "#E74C3C", "#9B59B6",
  "#1ABC9C", "#E67E22", "#2ECC71", "#34495E",
];

// ── Period presets ────────────────────────────────────────

type PeriodPreset = "day" | "week" | "month" | "quarter" | "year";

function computeDateRange(preset: PeriodPreset): { from: string; to: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const today = fmt(now);

  if (preset === "day") {
    return { from: today, to: today };
  }
  if (preset === "week") {
    const day = now.getDay(); // 0 = sun
    const diff = now.getDate() - day + (day === 0 ? -6 : 1); // monday
    const mon = new Date(now);
    mon.setDate(diff);
    return { from: fmt(mon), to: today };
  }
  if (preset === "month") {
    const from = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
    return { from, to: today };
  }
  if (preset === "quarter") {
    const q = Math.floor(now.getMonth() / 3);
    const from = `${now.getFullYear()}-${pad(q * 3 + 1)}-01`;
    return { from, to: today };
  }
  // year
  return { from: `${now.getFullYear()}-01-01`, to: today };
}

// ── Formatting helpers ────────────────────────────────────

function fmtNumber(n: number, decimals = 1): string {
  return n.toLocaleString("fr-FR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtEUR(n: number): string {
  return `${fmtNumber(n, 2)} €`;
}

function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h${String(m).padStart(2, "0")}`;
}

// ── Loading skeleton ──────────────────────────────────────

function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="bg-surface border border-border rounded-2xl p-5 h-[88px]" />
        ))}
      </div>
      <div className="bg-surface border border-border rounded-2xl p-6 h-[320px]" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-surface border border-border rounded-2xl p-6 h-[280px]" />
        <div className="bg-surface border border-border rounded-2xl p-6 h-[280px]" />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────

export function XDriveDashboard() {
  const { partner, theme } = useOutletContext<XDriveOutletContext>();

  // Period state
  const [preset, setPreset] = useState<PeriodPreset>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [useCustom, setUseCustom] = useState(false);

  // Filter state
  const [paymentFilter, setPaymentFilter] = useState<"all" | "CB" | "RFID" | "App" | "QR">("all");
  const [operatorFilter, setOperatorFilter] = useState<"all" | "direct" | "emsp">("all");

  // Fetch B2B client (to get customer_external_ids)
  const { data: b2bClient, isLoading: clientLoading } = useXDriveB2BClient(partner?.b2b_client_id);

  const customerExternalIds = useMemo(
    () => b2bClient?.customer_external_ids ?? [],
    [b2bClient]
  );

  // Compute date range
  const dateRange = useMemo(() => {
    if (useCustom && customFrom && customTo) {
      return { from: `${customFrom}T00:00:00Z`, to: `${customTo}T23:59:59Z` };
    }
    const range = computeDateRange(preset);
    return { from: `${range.from}T00:00:00Z`, to: `${range.to}T23:59:59Z` };
  }, [preset, useCustom, customFrom, customTo]);

  const filters: XDriveFilters = useMemo(
    () => ({
      dateFrom: dateRange.from,
      dateTo: dateRange.to,
      paymentTypes: paymentFilter === "all" ? ["CB", "RFID", "App", "QR"] : [paymentFilter],
      operatorType: operatorFilter,
    }),
    [dateRange, paymentFilter, operatorFilter]
  );

  const { data: rawCdrs, isLoading: cdrsLoading, error: cdrsError } = useXDriveCDRs(customerExternalIds, filters);

  const isLoading = clientLoading || cdrsLoading;

  // DEBUG — remove after fixing
  if (import.meta.env.DEV || true) {
    console.log("[XDrive Dashboard Debug]", {
      partnerId: partner?.id,
      partnerName: partner?.display_name,
      b2bClientId: partner?.b2b_client_id,
      b2bClientLoaded: !!b2bClient,
      b2bClientName: b2bClient?.name,
      customerExternalIds,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      cdrsCount: rawCdrs?.length ?? "loading",
      cdrsError: cdrsError?.message,
      clientLoading,
      cdrsLoading,
    });
  }

  // Own eMSP party ID (partner's direct party)
  // We assume the partner's own emsp_party_id = GFX or can be inferred;
  // for now we treat "Direct" as sessions where emsp_party_id is null or matches GFX (EZDrive's party)
  const ownEmspPartyId = "GFX";

  // Apply client-side filters
  const cdrs = useMemo(() => {
    if (!rawCdrs) return [];
    let result = rawCdrs;

    if (operatorFilter === "direct") {
      result = result.filter(
        (c) => !c.emsp_party_id || c.emsp_party_id === ownEmspPartyId
      );
    } else if (operatorFilter === "emsp") {
      result = result.filter(
        (c) => c.emsp_party_id && c.emsp_party_id !== ownEmspPartyId
      );
    }

    return result;
  }, [rawCdrs, operatorFilter]);

  const kpis = useMemo(() => computeXDriveKPIs(cdrs, ownEmspPartyId), [cdrs]);
  const monthlyData = useMemo(() => groupCDRsByMonth(cdrs), [cdrs]);

  // Payment pie chart data
  const paymentPieData = useMemo(
    () =>
      Object.entries(kpis.caByPayment)
        .filter(([, v]) => v > 0)
        .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 })),
    [kpis.caByPayment]
  );

  // eMSP bar chart data
  const emspBarData = useMemo(
    () =>
      Object.entries(kpis.caByEmsp)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([name, value]) => ({ name, ca: Math.round(value * 100) / 100 })),
    [kpis.caByEmsp]
  );

  const primaryColor = theme?.primaryColor ?? "#9ACC0E";

  if (!partner) {
    return (
      <div className="rounded-2xl border border-border bg-surface-elevated p-8 text-center">
        <p className="text-sm text-foreground-muted">Aucun partenaire sélectionné.</p>
      </div>
    );
  }

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  const PRESET_LABELS: { key: PeriodPreset; label: string }[] = [
    { key: "day", label: "Jour" },
    { key: "week", label: "Semaine" },
    { key: "month", label: "Mois" },
    { key: "quarter", label: "Trimestre" },
    { key: "year", label: "Année" },
  ];

  return (
    <div className="space-y-6">
      {/* ── Filter bar ──────────────────────────────────────── */}
      <div className="bg-surface border border-border rounded-2xl p-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Period presets */}
          <div className="flex items-center gap-1.5">
            {PRESET_LABELS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => { setPreset(key); setUseCustom(false); }}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                  !useCustom && preset === key
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border text-foreground-muted hover:text-foreground hover:bg-surface-elevated"
                }`}
                style={
                  !useCustom && preset === key
                    ? { borderColor: `${primaryColor}66`, backgroundColor: `${primaryColor}18`, color: primaryColor }
                    : {}
                }
              >
                {label}
              </button>
            ))}
          </div>

          {/* Separator */}
          <div className="h-6 w-px bg-border" />

          {/* Custom range */}
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => { setCustomFrom(e.target.value); setUseCustom(true); }}
              className="px-2 py-1.5 text-xs bg-surface-elevated border border-border rounded-lg text-foreground focus:outline-none focus:border-border-focus"
            />
            <span className="text-xs text-foreground-muted">→</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => { setCustomTo(e.target.value); setUseCustom(true); }}
              className="px-2 py-1.5 text-xs bg-surface-elevated border border-border rounded-lg text-foreground focus:outline-none focus:border-border-focus"
            />
          </div>

          {/* Separator */}
          <div className="h-6 w-px bg-border hidden sm:block" />

          {/* Payment filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-foreground-muted shrink-0">Paiement :</span>
            {(["all", "CB", "RFID", "App", "QR"] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => setPaymentFilter(opt)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                  paymentFilter === opt
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border text-foreground-muted hover:text-foreground hover:bg-surface-elevated"
                }`}
                style={
                  paymentFilter === opt
                    ? { borderColor: `${primaryColor}66`, backgroundColor: `${primaryColor}18`, color: primaryColor }
                    : {}
                }
              >
                {opt === "all" ? "Tous" : opt}
              </button>
            ))}
          </div>

          {/* Operator filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-foreground-muted shrink-0">Opérateur :</span>
            {(["all", "direct", "emsp"] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => setOperatorFilter(opt)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                  operatorFilter === opt
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border text-foreground-muted hover:text-foreground hover:bg-surface-elevated"
                }`}
                style={
                  operatorFilter === opt
                    ? { borderColor: `${primaryColor}66`, backgroundColor: `${primaryColor}18`, color: primaryColor }
                    : {}
                }
              >
                {opt === "all" ? "Tous" : opt === "direct" ? "Direct" : "eMSP"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* DEBUG BANNER — REMOVE AFTER FIX */}
      <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs font-mono text-yellow-300 space-y-1">
        <div>Partner: {partner?.display_name ?? "NULL"} | b2b_client_id: {partner?.b2b_client_id ?? "NULL"}</div>
        <div>B2B Client: {b2bClient?.name ?? (clientLoading ? "loading..." : "NULL")} | IDs: {JSON.stringify(customerExternalIds)}</div>
        <div>Filters: {filters.dateFrom} → {filters.dateTo}</div>
        <div>CDRs: {cdrsLoading ? "loading..." : `${rawCdrs?.length ?? 0} results`} {cdrsError ? `ERROR: ${cdrsError.message}` : ""}</div>
      </div>

      {/* ── KPI cards row ────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <KPICard
          label="Actes de recharge"
          value={kpis.sessionCount.toLocaleString("fr-FR")}
          icon={Zap}
          color={primaryColor}
        />
        <KPICard
          label="Énergie délivrée"
          value={`${fmtNumber(kpis.totalEnergy)} kWh`}
          icon={Zap}
          color="#9ACC0E"
        />
        <KPICard
          label="Durée de recharge"
          value={fmtDuration(kpis.totalDuration)}
          icon={Clock}
          color="#00C3FF"
        />
        <KPICard
          label="CA brut HT"
          value={fmtEUR(kpis.caHT)}
          icon={Euro}
          color="#F39C12"
        />
        <KPICard
          label="CA brut TTC"
          value={fmtEUR(kpis.caTTC)}
          icon={CreditCard}
          color="#E74C3C"
        />
        <KPICard
          label="Taux d'utilisation"
          value={`${fmtNumber(kpis.utilizationRate * 100, 1)} %`}
          icon={Gauge}
          color="#9B59B6"
        />
      </div>

      {/* ── Monthly trend bar chart ──────────────────────────── */}
      <div className="bg-surface border border-border rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-foreground-muted" />
            <h3 className="text-base font-semibold text-foreground">
              Évolution mensuelle
            </h3>
          </div>
          <div className="flex items-center gap-4 text-xs text-foreground-muted">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: primaryColor }} />
              Sessions
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm bg-blue-400" />
              Énergie (kWh)
            </span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={monthlyData} margin={{ top: 20, right: 10, bottom: 5, left: -10 }}>
            <XAxis
              dataKey="monthLabel"
              tick={{ fill: "#B0B8D4", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              yAxisId="sessions"
              orientation="left"
              tick={{ fill: "#B0B8D4", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <YAxis
              yAxisId="energy"
              orientation="right"
              tick={{ fill: "#B0B8D4", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(value: number, name: string) => {
                if (name === "sessionCount") return [`${value.toLocaleString("fr-FR")} sessions`, "Sessions"];
                if (name === "energy") return [`${fmtNumber(value)} kWh`, "Énergie"];
                return [value, name];
              }}
            />
            <Bar yAxisId="sessions" dataKey="sessionCount" radius={[6, 6, 0, 0]} maxBarSize={40}>
              {monthlyData.map((_, i) => (
                <Cell key={i} fill={primaryColor} />
              ))}
            </Bar>
            <Bar yAxisId="energy" dataKey="energy" radius={[6, 6, 0, 0]} maxBarSize={40} fill="#60A5FA" opacity={0.7} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ── Bottom charts row ────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Payment breakdown pie chart */}
        <div className="bg-surface border border-border rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <CreditCard className="w-4 h-4 text-foreground-muted" />
            <h3 className="text-base font-semibold text-foreground">
              CA par type de paiement
            </h3>
          </div>
          {paymentPieData.length === 0 ? (
            <div className="flex items-center justify-center h-[220px]">
              <p className="text-sm text-foreground-muted">Aucune donnée</p>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="55%" height={220}>
                <PieChart>
                  <Pie
                    data={paymentPieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={90}
                    dataKey="value"
                    paddingAngle={2}
                  >
                    {paymentPieData.map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={PAYMENT_COLORS[entry.name] ?? "#8884d8"}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(v: number) => [fmtEUR(v), "CA HT"]}
                  />
                </PieChart>
              </ResponsiveContainer>
              {/* Legend */}
              <div className="flex flex-col gap-2 text-sm">
                {paymentPieData.map((entry) => {
                  const sessions = kpis.sessionsByPayment[entry.name] ?? 0;
                  const pct =
                    kpis.caHT > 0
                      ? Math.round((entry.value / kpis.caHT) * 100)
                      : 0;
                  return (
                    <div key={entry.name} className="flex items-start gap-2">
                      <span
                        className="inline-block w-3 h-3 rounded-full mt-0.5 shrink-0"
                        style={{ backgroundColor: PAYMENT_COLORS[entry.name] ?? "#8884d8" }}
                      />
                      <div>
                        <p className="text-xs font-medium text-foreground">{entry.name}</p>
                        <p className="text-xs text-foreground-muted">
                          {fmtEUR(entry.value)} · {pct}% · {sessions.toLocaleString("fr-FR")} sess.
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* eMSP breakdown bar chart */}
        <div className="bg-surface border border-border rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Wifi className="w-4 h-4 text-foreground-muted" />
            <h3 className="text-base font-semibold text-foreground">
              CA par opérateur eMSP
            </h3>
          </div>
          {emspBarData.length === 0 ? (
            <div className="flex items-center justify-center h-[220px]">
              <p className="text-sm text-foreground-muted">Aucune donnée</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={emspBarData}
                layout="vertical"
                margin={{ top: 5, right: 20, bottom: 5, left: 10 }}
              >
                <XAxis
                  type="number"
                  tick={{ fill: "#B0B8D4", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `${v.toFixed(0)} €`}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fill: "#B0B8D4", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={80}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number) => [fmtEUR(v), "CA HT"]}
                />
                <Bar dataKey="ca" radius={[0, 6, 6, 0]} maxBarSize={28}>
                  {emspBarData.map((_, i) => (
                    <Cell key={i} fill={EMSP_COLORS[i % EMSP_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── Session stats summary ────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-surface border border-border rounded-2xl p-5">
          <p className="text-xs text-foreground-muted mb-1.5">Énergie moy. / session</p>
          <p className="text-2xl font-heading font-bold text-foreground">
            {fmtNumber(kpis.sessionCount > 0 ? kpis.totalEnergy / kpis.sessionCount : 0)}{" "}
            <span className="text-base font-normal text-foreground-muted">kWh</span>
          </p>
        </div>
        <div className="bg-surface border border-border rounded-2xl p-5">
          <p className="text-xs text-foreground-muted mb-1.5">Durée moy. / session</p>
          <p className="text-2xl font-heading font-bold text-foreground">
            {fmtDuration(kpis.sessionCount > 0 ? kpis.totalDuration / kpis.sessionCount : 0)}
          </p>
        </div>
        <div className="bg-surface border border-border rounded-2xl p-5">
          <p className="text-xs text-foreground-muted mb-1.5">CA HT moyen / session</p>
          <p className="text-2xl font-heading font-bold text-foreground">
            {fmtEUR(kpis.sessionCount > 0 ? kpis.caHT / kpis.sessionCount : 0)}
          </p>
        </div>
        <div className="bg-surface border border-border rounded-2xl p-5">
          <p className="text-xs text-foreground-muted mb-1.5">Sessions Direct vs eMSP</p>
          <p className="text-2xl font-heading font-bold text-foreground">
            {(kpis.sessionsByEmsp["Direct"] ?? 0).toLocaleString("fr-FR")}{" "}
            <span className="text-base font-normal text-foreground-muted">/ {kpis.sessionCount.toLocaleString("fr-FR")}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
