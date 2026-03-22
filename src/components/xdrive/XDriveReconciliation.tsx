import { useState, useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Scale,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  Edit3,
  Save,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  FileDown,
  Clock,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  useXDriveB2BClient,
  useXDriveCDRs,
  computeXDriveKPIs,
} from "@/hooks/useXDriveCDRs";
import type { XDrivePartner, XDriveTheme, XDriveReconciliation as XDriveReconciliationType } from "@/types/xdrive";

// ── Outlet context ─────────────────────────────────────────

interface XDriveOutletContext {
  partner: XDrivePartner | null;
  isEZDriveAdmin: boolean;
  theme: XDriveTheme;
}

// ── Formatting helpers ─────────────────────────────────────

function fmtEUR(n: number): string {
  return n.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + " €";
}

function fmtMonthLabel(yyyyMM: string): string {
  const [y, m] = yyyyMM.split("-");
  const months = [
    "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
    "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
  ];
  return `${months[parseInt(m, 10) - 1]} ${y}`;
}

function monthOffset(yyyyMM: string, delta: number): string {
  const [y, m] = yyyyMM.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function currentMonth(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

// ── Status badge ───────────────────────────────────────────

function StatusBadge({ status }: { status: "draft" | "verified" | "approved" }) {
  if (status === "approved") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-500/15 text-green-400 border border-green-500/25">
        <CheckCircle2 className="w-3.5 h-3.5" />
        Approuvé
      </span>
    );
  }
  if (status === "verified") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-yellow-500/15 text-yellow-400 border border-yellow-500/25">
        <CheckCircle2 className="w-3.5 h-3.5" />
        Vérifié
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-surface-elevated text-foreground-muted border border-border">
      <Clock className="w-3.5 h-3.5" />
      Brouillon
    </span>
  );
}

// ── History status dot ─────────────────────────────────────

function StatusDot({ status }: { status: "draft" | "verified" | "approved" }) {
  const colors = {
    approved: "bg-green-500",
    verified: "bg-yellow-500",
    draft: "bg-foreground-muted/40",
  };
  return <span className={`inline-block w-2 h-2 rounded-full ${colors[status]}`} />;
}

// ── Main component ─────────────────────────────────────────

export function XDriveReconciliation() {
  const { partner, isEZDriveAdmin, theme } = useOutletContext<XDriveOutletContext>();
  const queryClient = useQueryClient();

  const primaryColor = theme?.primaryColor ?? "#9ACC0E";

  // Month selector
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonth);

  // Editing state (EZDrive admin only)
  const [isEditing, setIsEditing] = useState(false);
  const [formValues, setFormValues] = useState({
    encaissements_cb: 0,
    encaissements_emsp: 0,
    encaissements_app: 0,
    ecart_commissions: 0,
    ecart_emsp_pending: 0,
    ecart_litiges: 0,
    ecart_autres: 0,
    notes: "",
  });

  // Gap decomposition expanded state
  const [gapExpanded, setGapExpanded] = useState(false);

  // Partner ID
  const partnerId = partner?.id ?? null;

  // ── Fetch B2B client ──────────────────────────────────────
  const { data: b2bClient } = useXDriveB2BClient(partner?.b2b_client_id);
  const customerExternalIds = useMemo(
    () => b2bClient?.customer_external_ids ?? [],
    [b2bClient]
  );

  // ── Fetch CDRs for selected month ─────────────────────────
  const cdrFilters = useMemo(() => {
    const [y, m] = selectedMonth.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return {
      dateFrom: `${selectedMonth}-01T00:00:00Z`,
      dateTo: `${selectedMonth}-${String(lastDay).padStart(2, "0")}T23:59:59Z`,
      paymentTypes: ["CB", "RFID", "App", "QR"] as Array<"CB" | "RFID" | "App" | "QR">,
      operatorType: "all" as const,
    };
  }, [selectedMonth]);

  const { data: cdrs, isLoading: cdrsLoading } = useXDriveCDRs(customerExternalIds, cdrFilters);

  const kpis = useMemo(() => computeXDriveKPIs(cdrs ?? [], "GFX"), [cdrs]);

  const computedCATTC = kpis.caTTC;
  const computedCAHT = kpis.caHT;
  const totalEnergy = kpis.totalEnergy;
  const sessionsCount = kpis.sessionCount;

  // ── Fetch reconciliation record ───────────────────────────
  const { data: reconciliation, isLoading: recLoading } = useQuery({
    queryKey: ["xdrive-reconciliation", partnerId, selectedMonth],
    queryFn: async () => {
      if (!partnerId) return null;
      const { data, error } = await supabase
        .from("xdrive_reconciliations")
        .select("*")
        .eq("partner_id", partnerId)
        .eq("period_month", selectedMonth)
        .maybeSingle();
      if (error) throw error;
      return data as XDriveReconciliationType | null;
    },
    enabled: !!partnerId,
  });

  // ── Fetch reconciliation history (last 12 months) ─────────
  const { data: history } = useQuery({
    queryKey: ["xdrive-reconciliation-history", partnerId],
    queryFn: async () => {
      if (!partnerId) return [];
      const { data, error } = await supabase
        .from("xdrive_reconciliations")
        .select("*")
        .eq("partner_id", partnerId)
        .order("period_month", { ascending: false })
        .limit(12);
      if (error) throw error;
      return (data ?? []) as XDriveReconciliationType[];
    },
    enabled: !!partnerId,
  });

  // ── Init form when reconciliation loads ───────────────────
  useMemo(() => {
    if (reconciliation) {
      const details = reconciliation.ecart_details ?? {};
      setFormValues({
        encaissements_cb: reconciliation.encaissements_cb ?? 0,
        encaissements_emsp: reconciliation.encaissements_emsp ?? 0,
        encaissements_app: reconciliation.encaissements_app ?? 0,
        ecart_commissions: details.commissions ?? 0,
        ecart_emsp_pending: details.emsp_pending ?? 0,
        ecart_litiges: details.litiges ?? 0,
        ecart_autres: details.autres ?? 0,
        notes: reconciliation.notes ?? "",
      });
    }
  }, [reconciliation]);

  // ── Computed values ────────────────────────────────────────
  const encaissementsCB = isEditing ? formValues.encaissements_cb : (reconciliation?.encaissements_cb ?? 0);
  const encaissementsEMSP = isEditing ? formValues.encaissements_emsp : (reconciliation?.encaissements_emsp ?? 0);
  const encaissementsApp = isEditing ? formValues.encaissements_app : (reconciliation?.encaissements_app ?? 0);

  const totalEncaisse = encaissementsCB + encaissementsEMSP + encaissementsApp;
  const ecartBrut = totalEncaisse - computedCATTC;
  const montantDuTotal = computedCATTC;
  const soldeNetEZDrive = totalEncaisse - montantDuTotal;

  const hasReconciliation = !!reconciliation;
  const currentStatus = reconciliation?.status ?? "draft";

  const ecartPct = computedCATTC > 0 ? Math.abs(ecartBrut / computedCATTC) : 0;
  const showAlert = ecartPct > 0.05 && (hasReconciliation || isEditing);

  // ── Save mutation ──────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async (status?: "draft" | "verified" | "approved") => {
      if (!partnerId) throw new Error("No partner");
      const { error } = await supabase
        .from("xdrive_reconciliations")
        .upsert(
          {
            partner_id: partnerId,
            period_month: selectedMonth,
            ca_cdrs_ht: computedCAHT,
            ca_cdrs_ttc: computedCATTC,
            sessions_count: sessionsCount,
            energy_kwh: totalEnergy,
            encaissements_cb: formValues.encaissements_cb,
            encaissements_emsp: formValues.encaissements_emsp,
            encaissements_app: formValues.encaissements_app,
            total_encaisse: formValues.encaissements_cb + formValues.encaissements_emsp + formValues.encaissements_app,
            ecart_brut:
              formValues.encaissements_cb + formValues.encaissements_emsp + formValues.encaissements_app - computedCATTC,
            ecart_details: {
              commissions: formValues.ecart_commissions,
              emsp_pending: formValues.ecart_emsp_pending,
              litiges: formValues.ecart_litiges,
              autres: formValues.ecart_autres,
            },
            notes: formValues.notes || null,
            status: status ?? currentStatus,
          },
          { onConflict: "partner_id,period_month" }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["xdrive-reconciliation", partnerId, selectedMonth] });
      queryClient.invalidateQueries({ queryKey: ["xdrive-reconciliation-history", partnerId] });
      setIsEditing(false);
    },
  });

  const handleSave = () => saveMutation.mutate("draft");
  const handleVerify = () => saveMutation.mutate("verified");

  // ── Guard: no partner ──────────────────────────────────────
  if (!partner) {
    return (
      <div className="rounded-2xl border border-border bg-surface-elevated p-8 text-center">
        <p className="text-sm text-foreground-muted">Aucun partenaire sélectionné.</p>
      </div>
    );
  }

  const isLoading = cdrsLoading || recLoading;

  // ── Reconciliation lines ───────────────────────────────────
  type LineStatus = "auto" | "filled" | "empty" | "computed";
  interface RecLine {
    key: string;
    label: string;
    source: string;
    amount: number | null;
    status: LineStatus;
    highlight?: "primary" | "positive" | "negative" | "neutral";
    isBold?: boolean;
  }

  const lines: RecLine[] = [
    {
      key: "A",
      label: "A. CA Total réseau TTC (CDR)",
      source: "CDR agrégés",
      amount: computedCATTC,
      status: "auto",
      highlight: "primary",
      isBold: true,
    },
    {
      key: "B",
      label: "B. Encaissements CB (PSP)",
      source: "Relevés PSP",
      amount: hasReconciliation || isEditing ? encaissementsCB : null,
      status: hasReconciliation || isEditing ? "filled" : "empty",
    },
    {
      key: "C",
      label: "C. Reversements eMSP",
      source: "Factures eMSP",
      amount: hasReconciliation || isEditing ? encaissementsEMSP : null,
      status: hasReconciliation || isEditing ? "filled" : "empty",
    },
    {
      key: "D",
      label: "D. Encaissements App / QR",
      source: "Relevés PSP",
      amount: hasReconciliation || isEditing ? encaissementsApp : null,
      status: hasReconciliation || isEditing ? "filled" : "empty",
    },
    {
      key: "E",
      label: "E. Total encaissé (B + C + D)",
      source: "Calculé",
      amount: hasReconciliation || isEditing ? totalEncaisse : null,
      status: "computed",
      isBold: true,
    },
    {
      key: "F",
      label: "F. Écart brut (E − A)",
      source: "Calculé",
      amount: hasReconciliation || isEditing ? ecartBrut : null,
      status: "computed",
      highlight: hasReconciliation || isEditing
        ? ecartBrut >= 0 ? "positive" : "negative"
        : undefined,
      isBold: true,
    },
    {
      key: "G",
      label: "G. Montant dû à Total (= A)",
      source: "Contractuel",
      amount: computedCATTC,
      status: "computed",
    },
    {
      key: "H",
      label: "H. Solde net EZDrive (E − G)",
      source: "Calculé",
      amount: hasReconciliation || isEditing ? soldeNetEZDrive : null,
      status: "computed",
      highlight: hasReconciliation || isEditing
        ? soldeNetEZDrive >= 0 ? "positive" : "negative"
        : undefined,
      isBold: true,
    },
  ];

  return (
    <div className="space-y-6">
      {/* ── Header + month selector ───────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${primaryColor}18` }}
          >
            <Scale className="w-5 h-5" style={{ color: primaryColor }} />
          </div>
          <div>
            <h2 className="text-lg font-heading font-bold text-foreground">Rapprochement financier</h2>
            <p className="text-xs text-foreground-muted">Comparaison CA CDR vs encaissements réels</p>
          </div>
        </div>

        {/* Month nav */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSelectedMonth((m) => monthOffset(m, -1))}
            className="p-1.5 rounded-lg border border-border text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground focus:border-border-focus focus:outline-none min-w-[180px]"
          >
            {Array.from({ length: 24 }, (_, i) => monthOffset(currentMonth(), -i)).map((m) => (
              <option key={m} value={m}>
                {fmtMonthLabel(m)}
              </option>
            ))}
          </select>
          <button
            onClick={() => setSelectedMonth((m) => monthOffset(m, 1))}
            className="p-1.5 rounded-lg border border-border text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Alert: significant gap ─────────────────────────────── */}
      {showAlert && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-300">Écart significatif détecté</p>
            <p className="text-xs text-red-400/80 mt-0.5">
              L'écart entre le CA CDR et les encaissements représente {(ecartPct * 100).toFixed(1)}% du CA réseau.
              Un écart supérieur à 5% nécessite une analyse approfondie.
            </p>
          </div>
        </div>
      )}

      {/* ── Summary card ──────────────────────────────────────── */}
      <div className="bg-surface border border-border rounded-2xl p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-base font-semibold text-foreground">Synthèse — {fmtMonthLabel(selectedMonth)}</h3>
          <StatusBadge status={currentStatus} />
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-surface-elevated rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {/* CA Réseau TTC */}
            <div className="p-4 rounded-xl bg-surface-elevated border border-border">
              <p className="text-xs text-foreground-muted mb-2">CA Réseau TTC (CDR)</p>
              <p className="text-2xl font-heading font-bold" style={{ color: primaryColor }}>
                {fmtEUR(computedCATTC)}
              </p>
              <p className="text-xs text-foreground-muted mt-1">{sessionsCount.toLocaleString("fr-FR")} sessions · {totalEnergy.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} kWh</p>
            </div>

            {/* Total encaissé */}
            <div className="p-4 rounded-xl bg-surface-elevated border border-border">
              <p className="text-xs text-foreground-muted mb-2">Total encaissé</p>
              {hasReconciliation ? (
                <p className="text-2xl font-heading font-bold text-foreground">
                  {fmtEUR(totalEncaisse)}
                </p>
              ) : (
                <p className="text-base text-foreground-muted italic">Non saisi</p>
              )}
              {hasReconciliation && (
                <p className="text-xs text-foreground-muted mt-1">
                  CB: {fmtEUR(encaissementsCB)} · eMSP: {fmtEUR(encaissementsEMSP)} · App: {fmtEUR(encaissementsApp)}
                </p>
              )}
            </div>

            {/* Écart */}
            <div className="p-4 rounded-xl bg-surface-elevated border border-border">
              <p className="text-xs text-foreground-muted mb-2">Écart (Encaissé − CA CDR)</p>
              {hasReconciliation ? (
                <>
                  <p
                    className="text-2xl font-heading font-bold flex items-center gap-2"
                    style={{ color: ecartBrut >= 0 ? "#4ade80" : "#f87171" }}
                  >
                    {ecartBrut >= 0 ? (
                      <TrendingUp className="w-5 h-5" />
                    ) : (
                      <TrendingDown className="w-5 h-5" />
                    )}
                    {fmtEUR(ecartBrut)}
                  </p>
                  <p className="text-xs text-foreground-muted mt-1">
                    {ecartPct > 0 ? `${(ecartPct * 100).toFixed(2)}% du CA réseau` : "Équilibré"}
                  </p>
                </>
              ) : (
                <p className="text-base text-foreground-muted italic">Non calculé</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Reconciliation detail table ────────────────────────── */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="text-base font-semibold text-foreground">Tableau de rapprochement</h3>
          <div className="flex items-center gap-2">
            {isEZDriveAdmin && !isEditing && (
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors"
              >
                <Edit3 className="w-3.5 h-3.5" />
                Saisir encaissements
              </button>
            )}
            {!isEZDriveAdmin && (
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors"
              >
                <FileDown className="w-3.5 h-3.5" />
                Exporter PDF
              </button>
            )}
          </div>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-elevated">
              <th className="text-left px-6 py-3 text-xs font-medium text-foreground-muted uppercase tracking-wider w-8">Ligne</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-foreground-muted uppercase tracking-wider">Description</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-foreground-muted uppercase tracking-wider hidden sm:table-cell">Source</th>
              <th className="text-right px-6 py-3 text-xs font-medium text-foreground-muted uppercase tracking-wider">Montant</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => {
              const isInputLine = isEditing && ["B", "C", "D"].includes(line.key);
              const isSeparatorBefore = ["E", "G"].includes(line.key);

              let amountContent: React.ReactNode;

              if (isInputLine) {
                const fieldMap: Record<string, keyof typeof formValues> = {
                  B: "encaissements_cb",
                  C: "encaissements_emsp",
                  D: "encaissements_app",
                };
                const field = fieldMap[line.key];
                amountContent = (
                  <div className="flex items-center justify-end gap-1">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formValues[field]}
                      onChange={(e) =>
                        setFormValues((prev) => ({
                          ...prev,
                          [field]: parseFloat(e.target.value) || 0,
                        }))
                      }
                      className="w-36 px-2 py-1 text-right text-sm bg-surface border border-border-focus rounded-lg text-foreground focus:outline-none focus:border-border-focus"
                    />
                    <span className="text-foreground-muted text-xs">€</span>
                  </div>
                );
              } else if (line.amount === null) {
                amountContent = (
                  <span className="text-xs text-foreground-muted italic">
                    {isEZDriveAdmin ? "À saisir" : "—"}
                  </span>
                );
              } else {
                let colorStyle: React.CSSProperties = {};
                if (line.highlight === "primary") colorStyle = { color: primaryColor };
                else if (line.highlight === "positive") colorStyle = { color: "#4ade80" };
                else if (line.highlight === "negative") colorStyle = { color: "#f87171" };

                amountContent = (
                  <span
                    className={line.isBold ? "font-bold" : ""}
                    style={colorStyle}
                  >
                    {fmtEUR(line.amount)}
                  </span>
                );
              }

              return (
                <>
                  {isSeparatorBefore && (
                    <tr key={`sep-${line.key}`} className="border-t-2 border-border" />
                  )}
                  <tr
                    key={line.key}
                    className={`border-b border-border/50 transition-colors ${
                      line.isBold ? "bg-surface-elevated/50" : "hover:bg-surface-elevated/30"
                    }`}
                  >
                    <td className="px-6 py-3 text-xs font-mono font-bold text-foreground-muted">{line.key}</td>
                    <td className="px-4 py-3 text-foreground">
                      <span className={line.isBold ? "font-semibold" : ""}>{line.label}</span>
                    </td>
                    <td className="px-4 py-3 text-foreground-muted text-xs hidden sm:table-cell">{line.source}</td>
                    <td className="px-6 py-3 text-right">{amountContent}</td>
                  </tr>
                </>
              );
            })}
          </tbody>
        </table>

        {/* Notes field (editing mode) */}
        {isEditing && (
          <div className="px-6 py-4 border-t border-border">
            <label className="block text-xs text-foreground-muted mb-1.5 uppercase tracking-wider">Notes</label>
            <textarea
              value={formValues.notes}
              onChange={(e) => setFormValues((prev) => ({ ...prev, notes: e.target.value }))}
              rows={2}
              placeholder="Commentaires sur le rapprochement..."
              className="w-full px-3 py-2 text-sm bg-surface-elevated border border-border rounded-lg text-foreground focus:outline-none focus:border-border-focus resize-none placeholder:text-foreground-muted/50"
            />
          </div>
        )}

        {/* Action buttons */}
        {isEditing && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-surface-elevated/50">
            <button
              onClick={() => setIsEditing(false)}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-border text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors"
            >
              Annuler
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSave}
                disabled={saveMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-border text-foreground hover:bg-surface-elevated transition-colors disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                Enregistrer
              </button>
              <button
                onClick={handleVerify}
                disabled={saveMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg text-white transition-colors disabled:opacity-50"
                style={{ backgroundColor: primaryColor }}
              >
                <CheckCircle2 className="w-4 h-4" />
                Marquer comme vérifié
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Écart decomposition ────────────────────────────────── */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        <button
          onClick={() => setGapExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-6 py-4 hover:bg-surface-elevated/30 transition-colors"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-foreground-muted" />
            <h3 className="text-base font-semibold text-foreground">Décomposition des écarts</h3>
          </div>
          {gapExpanded ? (
            <ChevronUp className="w-4 h-4 text-foreground-muted" />
          ) : (
            <ChevronDown className="w-4 h-4 text-foreground-muted" />
          )}
        </button>

        {gapExpanded && (
          <div className="px-6 pb-6 border-t border-border pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                {
                  label: "Commissions PSP (frais bancaires)",
                  field: "ecart_commissions" as const,
                  description: "Frais prélevés par le prestataire de paiement",
                },
                {
                  label: "Reversements eMSP en attente",
                  field: "ecart_emsp_pending" as const,
                  description: "Factures eMSP reçues mais non encore réglées",
                },
                {
                  label: "Sessions en échec / litiges",
                  field: "ecart_litiges" as const,
                  description: "Sessions contestées ou avec erreur de paiement",
                },
                {
                  label: "Autres écarts",
                  field: "ecart_autres" as const,
                  description: "Ajustements divers, arrondis, corrections",
                },
              ].map((item) => {
                const savedValue =
                  reconciliation?.ecart_details?.[
                    item.field.replace("ecart_", "").replace("_pending", "_pending")
                  ] ??
                  reconciliation?.ecart_details?.[
                    {
                      ecart_commissions: "commissions",
                      ecart_emsp_pending: "emsp_pending",
                      ecart_litiges: "litiges",
                      ecart_autres: "autres",
                    }[item.field] ?? ""
                  ] ??
                  0;

                const displayValue = isEditing ? formValues[item.field] : savedValue;

                return (
                  <div key={item.field} className="p-4 rounded-xl bg-surface-elevated border border-border">
                    <p className="text-xs font-medium text-foreground mb-0.5">{item.label}</p>
                    <p className="text-xs text-foreground-muted mb-3">{item.description}</p>
                    {isEditing ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={formValues[item.field]}
                          onChange={(e) =>
                            setFormValues((prev) => ({
                              ...prev,
                              [item.field]: parseFloat(e.target.value) || 0,
                            }))
                          }
                          className="flex-1 px-2 py-1 text-sm text-right bg-surface border border-border-focus rounded-lg text-foreground focus:outline-none"
                        />
                        <span className="text-xs text-foreground-muted">€</span>
                      </div>
                    ) : (
                      <p className="text-lg font-bold text-foreground">
                        {hasReconciliation ? fmtEUR(displayValue as number) : <span className="text-sm text-foreground-muted italic">—</span>}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {hasReconciliation && !isEditing && (
              <div className="mt-4 p-3 rounded-xl bg-surface-elevated border border-border flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">Total écarts justifiés</span>
                <span className="text-sm font-bold text-foreground">
                  {fmtEUR(
                    (reconciliation?.ecart_details?.commissions ?? 0) +
                      (reconciliation?.ecart_details?.emsp_pending ?? 0) +
                      (reconciliation?.ecart_details?.litiges ?? 0) +
                      (reconciliation?.ecart_details?.autres ?? 0)
                  )}
                </span>
              </div>
            )}

            {reconciliation?.notes && !isEditing && (
              <div className="mt-3 p-3 rounded-xl bg-surface-elevated border border-border">
                <p className="text-xs text-foreground-muted uppercase tracking-wider mb-1">Notes</p>
                <p className="text-sm text-foreground">{reconciliation.notes}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Historical view ────────────────────────────────────── */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h3 className="text-base font-semibold text-foreground">Historique des rapprochements</h3>
        </div>

        {!history || history.length === 0 ? (
          <div className="px-6 py-8 text-center">
            <p className="text-sm text-foreground-muted">Aucun rapprochement enregistré pour ce partenaire.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-elevated">
                  <th className="text-left px-6 py-3 text-xs font-medium text-foreground-muted uppercase tracking-wider">Mois</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-foreground-muted uppercase tracking-wider">CA CDR</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-foreground-muted uppercase tracking-wider">Encaissé</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-foreground-muted uppercase tracking-wider">Écart</th>
                  <th className="text-center px-6 py-3 text-xs font-medium text-foreground-muted uppercase tracking-wider">Statut</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => {
                  const ecart = row.total_encaisse - row.ca_cdrs_ttc;
                  const isSelected = row.period_month === selectedMonth;
                  return (
                    <tr
                      key={row.id}
                      onClick={() => setSelectedMonth(row.period_month)}
                      className={`border-b border-border/50 cursor-pointer transition-colors hover:bg-surface-elevated/40 ${
                        isSelected ? "bg-surface-elevated" : ""
                      }`}
                    >
                      <td className="px-6 py-3 font-medium text-foreground">
                        <div className="flex items-center gap-2">
                          <StatusDot status={row.status} />
                          {fmtMonthLabel(row.period_month)}
                          {isSelected && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full border text-foreground-muted" style={{ borderColor: `${primaryColor}50`, color: primaryColor }}>
                              En cours
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-foreground">{fmtEUR(row.ca_cdrs_ttc)}</td>
                      <td className="px-4 py-3 text-right text-foreground">{fmtEUR(row.total_encaisse)}</td>
                      <td
                        className="px-4 py-3 text-right font-medium"
                        style={{ color: ecart >= 0 ? "#4ade80" : "#f87171" }}
                      >
                        {ecart >= 0 ? "+" : ""}{fmtEUR(ecart)}
                      </td>
                      <td className="px-6 py-3 text-center">
                        <StatusBadge status={row.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
