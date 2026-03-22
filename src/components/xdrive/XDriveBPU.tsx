import { useState, useMemo, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Receipt,
  ChevronLeft,
  ChevronRight,
  Calculator,
  Save,
  CheckCircle2,
  FileDown,
  Clock,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Plus,
  X,
  Eye,
  Send,
  Banknote,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  useXDriveB2BClient,
  useXDriveCDRs,
} from "@/hooks/useXDriveCDRs";
import { exportInvoicePDF } from "@/lib/b2b-export";
import {
  calculateBPU,
  generateBPUInvoiceNumber,
  type BPUCalculation,
  type PdCInventory,
  type BPUCdrInput,
} from "@/lib/xdrive-bpu-engine";
import type {
  XDrivePartner,
  XDriveTheme,
  XDriveBPUConfig,
  XDriveBPUInvoice,
} from "@/types/xdrive";

// ── Outlet context ─────────────────────────────────────────

interface XDriveOutletContext {
  partner: XDrivePartner | null;
  isEZDriveAdmin: boolean;
  theme: XDriveTheme;
}

// ── Formatting helpers ─────────────────────────────────────

function fmtEUR(n: number): string {
  return (
    n.toLocaleString("fr-FR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " €"
  );
}

function fmtPct(n: number): string {
  return (n * 100).toFixed(2) + " %";
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

function previousMonth(): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

// ── Status badge ───────────────────────────────────────────

const STATUS_CONFIG: Record<
  string,
  { label: string; bg: string; text: string; border: string; icon: typeof Clock }
> = {
  draft: {
    label: "Brouillon",
    bg: "bg-surface-elevated",
    text: "text-foreground-muted",
    border: "border-border",
    icon: Clock,
  },
  review: {
    label: "En revue",
    bg: "bg-blue-500/15",
    text: "text-blue-400",
    border: "border-blue-500/25",
    icon: Eye,
  },
  validated: {
    label: "Validée",
    bg: "bg-green-500/15",
    text: "text-green-400",
    border: "border-green-500/25",
    icon: CheckCircle2,
  },
  sent: {
    label: "Envoyée",
    bg: "bg-purple-500/15",
    text: "text-purple-400",
    border: "border-purple-500/25",
    icon: Send,
  },
  paid: {
    label: "Payée",
    bg: "bg-emerald-500/15",
    text: "text-emerald-400",
    border: "border-emerald-500/25",
    icon: Banknote,
  },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.draft;
  const Icon = cfg.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text} border ${cfg.border}`}
    >
      <Icon className="w-3.5 h-3.5" />
      {cfg.label}
    </span>
  );
}

// ── Loading skeleton ───────────────────────────────────────

function BPUSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="bg-surface border border-border rounded-2xl p-6 h-[80px]" />
      <div className="bg-surface border border-border rounded-2xl p-6 h-[200px]" />
      <div className="bg-surface border border-border rounded-2xl p-6 h-[400px]" />
      <div className="bg-surface border border-border rounded-2xl p-6 h-[200px]" />
    </div>
  );
}

// ── Main component ─────────────────────────────────────────

export function XDriveBPU() {
  const { partner, isEZDriveAdmin, theme } =
    useOutletContext<XDriveOutletContext>();
  const queryClient = useQueryClient();
  const primaryColor = theme?.primaryColor ?? "#9ACC0E";

  // Month selector state
  const [selectedMonth, setSelectedMonth] = useState<string>(previousMonth);

  // PdC inventory state (editable by admin)
  const [pdcAc22Public, setPdcAc22Public] = useState(0);
  const [pdcAcPrivatif, setPdcAcPrivatif] = useState(0);
  const [pdcDc50100, setPdcDc50100] = useState(0);

  // Optional services state
  const [selectedOptionals, setSelectedOptionals] = useState<
    Array<{ code: string; quantity: number }>
  >([]);

  // Calculation result
  const [calculation, setCalculation] = useState<BPUCalculation | null>(null);

  // CDR drill-down
  const [showCdrDrilldown, setShowCdrDrilldown] = useState(false);

  const partnerId = partner?.id ?? null;
  const partnerCode = partner?.partner_code ?? "PARTNER";

  // ── Fetch B2B client ────────────────────────────────────
  const { data: b2bClient } = useXDriveB2BClient(partner?.b2b_client_id);
  const customerExternalIds = useMemo(
    () => b2bClient?.customer_external_ids ?? [],
    [b2bClient]
  );

  // ── Fetch CDRs for selected month ───────────────────────
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

  const { data: cdrs, isLoading: cdrsLoading } = useXDriveCDRs(
    customerExternalIds,
    cdrFilters
  );

  // ── Fetch CDRs for M-1 (comparison) ─────────────────────
  const prevMonth = monthOffset(selectedMonth, -1);
  const prevCdrFilters = useMemo(() => {
    const [y, m] = prevMonth.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return {
      dateFrom: `${prevMonth}-01T00:00:00Z`,
      dateTo: `${prevMonth}-${String(lastDay).padStart(2, "0")}T23:59:59Z`,
      paymentTypes: ["CB", "RFID", "App", "QR"] as Array<"CB" | "RFID" | "App" | "QR">,
      operatorType: "all" as const,
    };
  }, [prevMonth]);

  const { data: prevCdrs } = useXDriveCDRs(customerExternalIds, prevCdrFilters);

  // ── Fetch BPU config ────────────────────────────────────
  const { data: bpuConfig, isLoading: configLoading } = useQuery({
    queryKey: ["xdrive-bpu-config", partnerId],
    queryFn: async () => {
      if (!partnerId) return null;
      const { data, error } = await supabase
        .from("xdrive_bpu_config")
        .select("*")
        .eq("partner_id", partnerId)
        .order("effective_from", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as XDriveBPUConfig | null;
    },
    enabled: !!partnerId,
    staleTime: 300_000,
  });

  // ── Fetch existing invoice for selected month ───────────
  const { data: existingInvoice, isLoading: invoiceLoading } = useQuery({
    queryKey: ["xdrive-bpu-invoice", partnerId, selectedMonth],
    queryFn: async () => {
      if (!partnerId) return null;
      const { data, error } = await supabase
        .from("xdrive_bpu_invoices")
        .select("*")
        .eq("partner_id", partnerId)
        .eq("period_month", selectedMonth)
        .maybeSingle();
      if (error) throw error;
      return data as XDriveBPUInvoice | null;
    },
    enabled: !!partnerId,
  });

  // ── Fetch invoice history ───────────────────────────────
  const { data: invoiceHistory } = useQuery({
    queryKey: ["xdrive-bpu-history", partnerId],
    queryFn: async () => {
      if (!partnerId) return [];
      const { data, error } = await supabase
        .from("xdrive_bpu_invoices")
        .select("*")
        .eq("partner_id", partnerId)
        .order("period_month", { ascending: false })
        .limit(12);
      if (error) throw error;
      return (data ?? []) as XDriveBPUInvoice[];
    },
    enabled: !!partnerId,
  });

  // ── Fetch M-1 invoice for comparison ────────────────────
  const { data: prevInvoice } = useQuery({
    queryKey: ["xdrive-bpu-invoice", partnerId, prevMonth],
    queryFn: async () => {
      if (!partnerId) return null;
      const { data, error } = await supabase
        .from("xdrive_bpu_invoices")
        .select("*")
        .eq("partner_id", partnerId)
        .eq("period_month", prevMonth)
        .maybeSingle();
      if (error) throw error;
      return data as XDriveBPUInvoice | null;
    },
    enabled: !!partnerId,
  });

  // ── Restore inventory from existing invoice ─────────────
  useMemo(() => {
    if (existingInvoice?.pdc_inventory) {
      const inv = existingInvoice.pdc_inventory as Record<string, number>;
      setPdcAc22Public(inv.ac22_public ?? 0);
      setPdcAcPrivatif(inv.ac_privatif ?? 0);
      setPdcDc50100(inv.dc_50_100 ?? 0);
    }
    if (existingInvoice?.line_items) {
      const optionals = (existingInvoice.line_items as Array<Record<string, unknown>>)
        .filter((l) => {
          const code = String(l.code ?? "");
          return (
            code !== "SUPERVISION" &&
            !code.startsWith("CONNECT_") &&
            !code.startsWith("TRANS_") &&
            code !== "SUPPORT"
          );
        })
        .map((l) => ({ code: String(l.code), quantity: Number(l.quantity) || 1 }));
      if (optionals.length > 0) setSelectedOptionals(optionals);
    }
  }, [existingInvoice]);

  // ── Run calculation ─────────────────────────────────────
  const handleCalculate = useCallback(() => {
    if (!bpuConfig || !cdrs) return;

    const inventory: PdCInventory = {
      ac22_public: pdcAc22Public,
      ac_privatif: pdcAcPrivatif,
      dc_50_100: pdcDc50100,
      total: pdcAc22Public + pdcAcPrivatif + pdcDc50100,
    };

    const cdrInputs: BPUCdrInput[] = cdrs.map((c) => ({
      total_retail_cost: c.total_retail_cost ?? 0,
      charger_type: c.charger_type ?? "",
    }));

    const result = calculateBPU(bpuConfig, inventory, cdrInputs, selectedOptionals);
    result.period_month = selectedMonth;
    setCalculation(result);
  }, [bpuConfig, cdrs, pdcAc22Public, pdcAcPrivatif, pdcDc50100, selectedOptionals, selectedMonth]);

  // ── M-1 calculation for comparison ──────────────────────
  const prevCalculation = useMemo(() => {
    if (!bpuConfig || !prevCdrs || !prevInvoice) return null;

    const inv = (prevInvoice.pdc_inventory ?? {}) as Record<string, number>;
    const inventory: PdCInventory = {
      ac22_public: inv.ac22_public ?? 0,
      ac_privatif: inv.ac_privatif ?? 0,
      dc_50_100: inv.dc_50_100 ?? 0,
      total: (inv.ac22_public ?? 0) + (inv.ac_privatif ?? 0) + (inv.dc_50_100 ?? 0),
    };

    const cdrInputs: BPUCdrInput[] = prevCdrs.map((c) => ({
      total_retail_cost: c.total_retail_cost ?? 0,
      charger_type: c.charger_type ?? "",
    }));

    const result = calculateBPU(bpuConfig, inventory, cdrInputs);
    result.period_month = prevMonth;
    return result;
  }, [bpuConfig, prevCdrs, prevInvoice, prevMonth]);

  // ── Save draft mutation ─────────────────────────────────
  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      if (!partnerId || !calculation) throw new Error("Missing data");

      const invoiceNumber =
        existingInvoice?.invoice_number ??
        generateBPUInvoiceNumber(partnerCode, selectedMonth);

      const payload = {
        partner_id: partnerId,
        invoice_number: invoiceNumber,
        period_month: selectedMonth,
        supervision_amount: calculation.supervision.amount,
        connectivity_amount: calculation.connectivity_total,
        transaction_amount: calculation.transaction_total,
        floor_applied: calculation.floor_applied,
        support_amount: calculation.support.amount,
        optional_amount: calculation.optional_total,
        total_ht: calculation.total_ht,
        tva_rate: calculation.tva_rate,
        tva_amount: calculation.tva_amount,
        total_ttc: calculation.total_ttc,
        line_items: calculation.all_line_items,
        pdc_inventory: calculation.pdc_inventory,
        status: existingInvoice?.status ?? "draft",
      };

      if (existingInvoice) {
        const { error } = await supabase
          .from("xdrive_bpu_invoices")
          .update(payload)
          .eq("id", existingInvoice.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("xdrive_bpu_invoices")
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["xdrive-bpu-invoice", partnerId, selectedMonth],
      });
      queryClient.invalidateQueries({
        queryKey: ["xdrive-bpu-history", partnerId],
      });
    },
  });

  // ── Validate mutation (admin only) ──────────────────────
  const validateMutation = useMutation({
    mutationFn: async () => {
      if (!existingInvoice) throw new Error("No invoice to validate");
      const { error } = await supabase
        .from("xdrive_bpu_invoices")
        .update({
          status: "validated",
          validated_at: new Date().toISOString(),
        })
        .eq("id", existingInvoice.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["xdrive-bpu-invoice", partnerId, selectedMonth],
      });
      queryClient.invalidateQueries({
        queryKey: ["xdrive-bpu-history", partnerId],
      });
    },
  });

  // ── Export PDF ──────────────────────────────────────────
  const handleExportPDF = useCallback(() => {
    const calc = calculation;
    if (!calc) return;

    const lines = calc.all_line_items.map((item) => ({
      description: item.label,
      quantity: item.quantity,
      unitLabel: item.code.startsWith("TRANS_") ? "%" : "unit.",
      unitPrice: item.unit_price,
      total: item.amount,
    }));

    if (calc.floor_applied) {
      const floorDiff = calc.connectivity_plus_transactions - (calc.connectivity_total + calc.transaction_total);
      lines.push({
        description: `Ajustement plancher (${fmtEUR(bpuConfig?.floor_monthly ?? 9000)})`,
        quantity: 1,
        unitLabel: "forfait",
        unitPrice: floorDiff,
        total: floorDiff,
      });
    }

    exportInvoicePDF(
      {
        invoiceNumber:
          existingInvoice?.invoice_number ??
          generateBPUInvoiceNumber(partnerCode, selectedMonth),
        invoiceDate: new Date().toLocaleDateString("fr-FR"),
        periodLabel: fmtMonthLabel(selectedMonth),
        clientName: partner?.display_name ?? "Partenaire",
        clientSlug: partnerCode,
        clientAddress: "",
        redevanceRate: 0,
        lines,
        totalHT: calc.total_ht,
        tvaRate: calc.tva_rate,
        totalTVA: calc.tva_amount,
        totalTTC: calc.total_ttc,
      },
      `facture-bpu-${partnerCode}-${selectedMonth}.pdf`
    );
  }, [calculation, existingInvoice, partnerCode, selectedMonth, partner, bpuConfig]);

  // ── Add optional service ────────────────────────────────
  const addOptional = (code: string) => {
    if (selectedOptionals.some((o) => o.code === code)) return;
    setSelectedOptionals((prev) => [...prev, { code, quantity: 1 }]);
  };

  const removeOptional = (code: string) => {
    setSelectedOptionals((prev) => prev.filter((o) => o.code !== code));
  };

  const updateOptionalQty = (code: string, qty: number) => {
    setSelectedOptionals((prev) =>
      prev.map((o) => (o.code === code ? { ...o, quantity: Math.max(1, qty) } : o))
    );
  };

  // ── Derived state ───────────────────────────────────────
  const isLoading = configLoading || cdrsLoading || invoiceLoading;
  const pdcTotal = pdcAc22Public + pdcAcPrivatif + pdcDc50100;
  const activeTier = bpuConfig?.pricing_tiers.find(
    (t) => pdcTotal >= t.min_pdc && (t.max_pdc === null || pdcTotal <= t.max_pdc)
  );

  // Delta helpers for comparison
  const delta = (current: number, previous: number | undefined) => {
    if (previous === undefined || previous === 0) return null;
    return ((current - previous) / previous) * 100;
  };

  // ── Render ──────────────────────────────────────────────

  if (!partner) {
    return (
      <div className="rounded-2xl border border-border bg-surface-elevated p-8 text-center">
        <p className="text-sm text-foreground-muted">Aucun partenaire sélectionné.</p>
      </div>
    );
  }

  if (isLoading) return <BPUSkeleton />;

  if (!bpuConfig) {
    return (
      <div className="rounded-2xl border border-border bg-surface-elevated p-8 text-center">
        <div className="flex justify-center mb-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 flex items-center justify-center">
            <AlertTriangle className="w-7 h-7 text-amber-500" />
          </div>
        </div>
        <h2 className="text-xl font-heading font-bold text-foreground mb-2">
          Configuration BPU manquante
        </h2>
        <p className="text-sm text-foreground-muted max-w-md mx-auto">
          Aucune configuration BPU active trouvée pour ce partenaire.
          Veuillez contacter l'administrateur EZDrive pour configurer le barème.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Month selector ──────────────────────────────── */}
      <div className="bg-surface border border-border rounded-2xl p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Receipt className="w-5 h-5 text-foreground-muted" />
            <h2 className="text-lg font-heading font-semibold text-foreground">
              Facturation BPU
            </h2>
            {existingInvoice && (
              <StatusBadge status={existingInvoice.status} />
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedMonth(monthOffset(selectedMonth, -1))}
              className="p-1.5 rounded-lg border border-border hover:bg-surface-elevated transition-colors"
            >
              <ChevronLeft className="w-4 h-4 text-foreground-muted" />
            </button>
            <span className="text-sm font-medium text-foreground min-w-[140px] text-center">
              {fmtMonthLabel(selectedMonth)}
            </span>
            <button
              onClick={() => setSelectedMonth(monthOffset(selectedMonth, 1))}
              className="p-1.5 rounded-lg border border-border hover:bg-surface-elevated transition-colors"
            >
              <ChevronRight className="w-4 h-4 text-foreground-muted" />
            </button>
          </div>
        </div>
      </div>

      {/* ── BPU Config summary ──────────────────────────── */}
      <div className="bg-surface border border-border rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-foreground mb-3">
          Configuration BPU active
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-foreground-muted mb-0.5">Supervision</p>
            <p className="text-sm font-semibold text-foreground">
              {fmtEUR(bpuConfig.supervision_monthly)}
            </p>
          </div>
          <div>
            <p className="text-xs text-foreground-muted mb-0.5">Plancher mensuel</p>
            <p className="text-sm font-semibold text-foreground">
              {fmtEUR(bpuConfig.floor_monthly)}
            </p>
          </div>
          <div>
            <p className="text-xs text-foreground-muted mb-0.5">Support / territoire</p>
            <p className="text-sm font-semibold text-foreground">
              {fmtEUR(bpuConfig.support_monthly_per_territory)} x{" "}
              {bpuConfig.support_territories}
            </p>
          </div>
          <div>
            <p className="text-xs text-foreground-muted mb-0.5">TVA DOM-TOM</p>
            <p className="text-sm font-semibold text-foreground">8,50 %</p>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-border">
          <p className="text-xs text-foreground-muted mb-2">
            Taux de transaction
          </p>
          <div className="flex flex-wrap gap-3">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-elevated text-xs text-foreground">
              AC privatif: {fmtPct(bpuConfig.transaction_rates.ac22_privatif)}
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-elevated text-xs text-foreground">
              DC privatif: {fmtPct(bpuConfig.transaction_rates.dc25_privatif)}
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-elevated text-xs text-foreground">
              AC-DC public: {fmtPct(bpuConfig.transaction_rates.ac_dc_public)}
            </span>
          </div>
        </div>
      </div>

      {/* ── PdC Inventory ───────────────────────────────── */}
      <div className="bg-surface border border-border rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-foreground mb-3">
          Inventaire PdC (dernier jour du mois)
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs text-foreground-muted mb-1">
              AC22/DC25 public
            </label>
            {isEZDriveAdmin ? (
              <input
                type="number"
                min={0}
                value={pdcAc22Public}
                onChange={(e) => setPdcAc22Public(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-full px-3 py-2 text-sm bg-surface-elevated border border-border rounded-lg text-foreground focus:outline-none focus:border-border-focus"
              />
            ) : (
              <p className="text-sm font-semibold text-foreground">{pdcAc22Public}</p>
            )}
          </div>
          <div>
            <label className="block text-xs text-foreground-muted mb-1">
              AC privatif
            </label>
            {isEZDriveAdmin ? (
              <input
                type="number"
                min={0}
                value={pdcAcPrivatif}
                onChange={(e) => setPdcAcPrivatif(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-full px-3 py-2 text-sm bg-surface-elevated border border-border rounded-lg text-foreground focus:outline-none focus:border-border-focus"
              />
            ) : (
              <p className="text-sm font-semibold text-foreground">{pdcAcPrivatif}</p>
            )}
          </div>
          <div>
            <label className="block text-xs text-foreground-muted mb-1">
              DC 50-100 kW
            </label>
            {isEZDriveAdmin ? (
              <input
                type="number"
                min={0}
                value={pdcDc50100}
                onChange={(e) => setPdcDc50100(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-full px-3 py-2 text-sm bg-surface-elevated border border-border rounded-lg text-foreground focus:outline-none focus:border-border-focus"
              />
            ) : (
              <p className="text-sm font-semibold text-foreground">{pdcDc50100}</p>
            )}
          </div>
          <div>
            <label className="block text-xs text-foreground-muted mb-1">
              Total PdC
            </label>
            <p className="text-sm font-bold text-foreground py-2">{pdcTotal}</p>
            {activeTier && (
              <p className="text-xs text-foreground-muted">
                Palier: {activeTier.min_pdc}
                {activeTier.max_pdc ? `-${activeTier.max_pdc}` : "+"} PdC
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Optional services (admin only) ──────────────── */}
      {isEZDriveAdmin && bpuConfig.optional_services.length > 0 && (
        <div className="bg-surface border border-border rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">
            Services optionnels
          </h3>
          <div className="space-y-2">
            {selectedOptionals.map((opt) => {
              const svc = bpuConfig.optional_services.find(
                (s) => s.code === opt.code
              );
              if (!svc) return null;
              return (
                <div
                  key={opt.code}
                  className="flex items-center gap-3 px-3 py-2 bg-surface-elevated rounded-lg"
                >
                  <span className="text-sm text-foreground flex-1">
                    {svc.label} ({fmtEUR(svc.unit_price)} / {svc.unit})
                  </span>
                  <input
                    type="number"
                    min={1}
                    value={opt.quantity}
                    onChange={(e) =>
                      updateOptionalQty(opt.code, parseInt(e.target.value) || 1)
                    }
                    className="w-16 px-2 py-1 text-sm bg-surface border border-border rounded-lg text-foreground text-center focus:outline-none focus:border-border-focus"
                  />
                  <button
                    onClick={() => removeOptional(opt.code)}
                    className="p-1 rounded hover:bg-red-500/10 text-foreground-muted hover:text-red-400 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            {bpuConfig.optional_services
              .filter((s) => !selectedOptionals.some((o) => o.code === s.code))
              .map((svc) => (
                <button
                  key={svc.code}
                  onClick={() => addOptional(svc.code)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-dashed border-border text-foreground-muted hover:text-foreground hover:border-foreground-muted transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  {svc.label}
                </button>
              ))}
          </div>
        </div>
      )}

      {/* ── Action buttons ──────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        {isEZDriveAdmin && (
          <button
            onClick={handleCalculate}
            disabled={pdcTotal === 0}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              borderColor: `${primaryColor}66`,
              backgroundColor: `${primaryColor}18`,
              color: primaryColor,
            }}
          >
            <Calculator className="w-4 h-4" />
            Calculer
          </button>
        )}
        {isEZDriveAdmin && calculation && (
          <button
            onClick={() => saveDraftMutation.mutate()}
            disabled={saveDraftMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl border border-border text-foreground hover:bg-surface-elevated transition-colors disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saveDraftMutation.isPending ? "Enregistrement..." : "Enregistrer brouillon"}
          </button>
        )}
        {isEZDriveAdmin &&
          existingInvoice &&
          (existingInvoice.status === "draft" || existingInvoice.status === "review") && (
            <button
              onClick={() => validateMutation.mutate()}
              disabled={validateMutation.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-green-500/15 text-green-400 border border-green-500/25 hover:bg-green-500/25 transition-colors disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              {validateMutation.isPending ? "Validation..." : "Valider"}
            </button>
          )}
        {calculation && (
          <button
            onClick={handleExportPDF}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl border border-border text-foreground hover:bg-surface-elevated transition-colors"
          >
            <FileDown className="w-4 h-4" />
            Exporter PDF
          </button>
        )}
      </div>

      {/* ── Invoice preview ─────────────────────────────── */}
      {calculation && (
        <div className="bg-surface border border-border rounded-2xl p-6 space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between pb-4 border-b border-border">
            <div>
              <h3 className="text-lg font-heading font-bold text-foreground">
                Facture BPU — {fmtMonthLabel(selectedMonth)}
              </h3>
              <p className="text-xs text-foreground-muted mt-1">
                SURAYA SAS → {partner.display_name}
              </p>
              <p className="text-xs text-foreground-muted">
                N°{" "}
                {existingInvoice?.invoice_number ??
                  generateBPUInvoiceNumber(partnerCode, selectedMonth)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-heading font-bold text-foreground">
                {fmtEUR(calculation.total_ttc)}
              </p>
              <p className="text-xs text-foreground-muted">TTC</p>
            </div>
          </div>

          {/* Floor alert */}
          {calculation.floor_applied && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/25">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-400">
                  Plancher {fmtEUR(bpuConfig.floor_monthly)} appliqué
                </p>
                <p className="text-xs text-amber-400/70">
                  Connectivité + Transactions ({fmtEUR(calculation.connectivity_total + calculation.transaction_total)}) inférieur au plancher contractuel.
                </p>
              </div>
            </div>
          )}

          {/* Section A: Supervision */}
          <InvoiceSection label="A — Supervision">
            <InvoiceLine
              label={calculation.supervision.label}
              detail=""
              amount={calculation.supervision.amount}
            />
          </InvoiceSection>

          {/* Section B: Connectivity */}
          <InvoiceSection label="B — Connectivité" total={calculation.connectivity_total}>
            {calculation.connectivity_lines.map((line) => (
              <InvoiceLine
                key={line.code}
                label={line.label}
                detail={`${line.quantity} × ${fmtEUR(line.unit_price)}`}
                amount={line.amount}
              />
            ))}
            {calculation.connectivity_lines.length === 0 && (
              <p className="text-xs text-foreground-muted italic py-1">
                Aucun PdC renseigné
              </p>
            )}
          </InvoiceSection>

          {/* Section C: Transactions */}
          <InvoiceSection label="C — Frais de transaction" total={calculation.transaction_total}>
            {calculation.transaction_lines.map((line) => (
              <InvoiceLine
                key={line.code}
                label={line.label}
                detail={line.detail ?? ""}
                amount={line.amount}
              />
            ))}
            {calculation.transaction_lines.length === 0 && (
              <p className="text-xs text-foreground-muted italic py-1">
                Aucun CDR ce mois
              </p>
            )}
            {cdrs && cdrs.length > 0 && (
              <button
                onClick={() => setShowCdrDrilldown(!showCdrDrilldown)}
                className="mt-1 text-xs underline text-foreground-muted hover:text-foreground transition-colors"
              >
                {showCdrDrilldown
                  ? "Masquer le détail CDR"
                  : `Voir le détail (${cdrs.length} CDR)`}
              </button>
            )}
            {showCdrDrilldown && cdrs && (
              <div className="mt-2 max-h-[200px] overflow-y-auto border border-border rounded-lg">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-surface-elevated text-foreground-muted">
                      <th className="px-2 py-1.5 text-left font-medium">Date</th>
                      <th className="px-2 py-1.5 text-left font-medium">Type</th>
                      <th className="px-2 py-1.5 text-right font-medium">CA TTC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cdrs.slice(0, 100).map((cdr, i) => (
                      <tr
                        key={cdr.id ?? i}
                        className={i % 2 === 1 ? "bg-surface-elevated/50" : ""}
                      >
                        <td className="px-2 py-1 text-foreground">
                          {new Date(cdr.start_date_time).toLocaleDateString("fr-FR")}
                        </td>
                        <td className="px-2 py-1 text-foreground">{cdr.charger_type ?? "—"}</td>
                        <td className="px-2 py-1 text-right text-foreground">
                          {fmtEUR(cdr.total_retail_cost ?? 0)}
                        </td>
                      </tr>
                    ))}
                    {cdrs.length > 100 && (
                      <tr>
                        <td colSpan={3} className="px-2 py-1 text-center text-foreground-muted">
                          ... et {cdrs.length - 100} autres
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </InvoiceSection>

          {/* Section D: Support */}
          <InvoiceSection label="D — Support conducteurs VE">
            <InvoiceLine
              label={calculation.support.label}
              detail={`${calculation.support.quantity} × ${fmtEUR(calculation.support.unit_price)}`}
              amount={calculation.support.amount}
            />
          </InvoiceSection>

          {/* Section E: Optional services */}
          {calculation.optional_lines.length > 0 && (
            <InvoiceSection label="E — Services optionnels" total={calculation.optional_total}>
              {calculation.optional_lines.map((line) => (
                <InvoiceLine
                  key={line.code}
                  label={line.label}
                  detail={`${line.quantity} × ${fmtEUR(line.unit_price)}`}
                  amount={line.amount}
                />
              ))}
            </InvoiceSection>
          )}

          {/* Totals */}
          <div className="pt-4 border-t border-border space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground-muted">Total HT</span>
              <span className="text-sm font-semibold text-foreground">
                {fmtEUR(calculation.total_ht)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground-muted">
                TVA ({(calculation.tva_rate * 100).toFixed(1)} %)
              </span>
              <span className="text-sm text-foreground">
                {fmtEUR(calculation.tva_amount)}
              </span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <span className="text-base font-bold text-foreground">Total TTC</span>
              <span
                className="text-xl font-heading font-bold"
                style={{ color: primaryColor }}
              >
                {fmtEUR(calculation.total_ttc)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Comparison M vs M-1 ─────────────────────────── */}
      {calculation && prevInvoice && (
        <div className="bg-surface border border-border rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">
            Comparaison {fmtMonthLabel(selectedMonth)} vs {fmtMonthLabel(prevMonth)}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <ComparisonCard
              label="Total HT"
              current={calculation.total_ht}
              previous={prevInvoice.total_ht}
            />
            <ComparisonCard
              label="Connectivité"
              current={calculation.connectivity_total}
              previous={prevInvoice.connectivity_amount}
            />
            <ComparisonCard
              label="Transactions"
              current={calculation.transaction_total}
              previous={prevInvoice.transaction_amount}
            />
            <ComparisonCard
              label="Plancher"
              current={calculation.floor_applied ? 1 : 0}
              previous={prevInvoice.floor_applied ? 1 : 0}
              isBoolean
            />
          </div>
        </div>
      )}

      {/* ── Invoice history ─────────────────────────────── */}
      {invoiceHistory && invoiceHistory.length > 0 && (
        <div className="bg-surface border border-border rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">
            Historique des factures BPU
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-foreground-muted border-b border-border">
                  <th className="py-2 px-3 text-left font-medium">Mois</th>
                  <th className="py-2 px-3 text-left font-medium">N° Facture</th>
                  <th className="py-2 px-3 text-right font-medium">Total HT</th>
                  <th className="py-2 px-3 text-right font-medium">Total TTC</th>
                  <th className="py-2 px-3 text-center font-medium">Statut</th>
                  <th className="py-2 px-3 text-center font-medium">Plancher</th>
                  <th className="py-2 px-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoiceHistory.map((inv) => (
                  <tr
                    key={inv.id}
                    className="border-b border-border/50 hover:bg-surface-elevated/50 transition-colors"
                  >
                    <td className="py-2.5 px-3 text-foreground font-medium">
                      {fmtMonthLabel(inv.period_month)}
                    </td>
                    <td className="py-2.5 px-3 text-foreground-muted font-mono text-xs">
                      {inv.invoice_number}
                    </td>
                    <td className="py-2.5 px-3 text-right text-foreground">
                      {fmtEUR(inv.total_ht)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-foreground font-semibold">
                      {fmtEUR(inv.total_ttc)}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <StatusBadge status={inv.status} />
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      {inv.floor_applied ? (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-400">
                          <AlertTriangle className="w-3 h-3" />
                          Oui
                        </span>
                      ) : (
                        <span className="text-xs text-foreground-muted">Non</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        onClick={() => setSelectedMonth(inv.period_month)}
                        className="text-xs underline text-foreground-muted hover:text-foreground transition-colors"
                      >
                        Voir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────

function InvoiceSection({
  label,
  total,
  children,
}: {
  label: string;
  total?: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">
          {label}
        </h4>
        {total !== undefined && (
          <span className="text-xs font-semibold text-foreground">
            {fmtEUR(total)}
          </span>
        )}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function InvoiceLine({
  label,
  detail,
  amount,
}: {
  label: string;
  detail: string;
  amount: number;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 px-3 rounded-lg hover:bg-surface-elevated/50">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate">{label}</p>
        {detail && (
          <p className="text-xs text-foreground-muted">{detail}</p>
        )}
      </div>
      <span className="text-sm font-medium text-foreground ml-4 shrink-0">
        {fmtEUR(amount)}
      </span>
    </div>
  );
}

function ComparisonCard({
  label,
  current,
  previous,
  isBoolean,
}: {
  label: string;
  current: number;
  previous: number;
  isBoolean?: boolean;
}) {
  if (isBoolean) {
    const currentBool = current === 1;
    const previousBool = previous === 1;
    return (
      <div className="bg-surface-elevated rounded-xl p-3">
        <p className="text-xs text-foreground-muted mb-1">{label}</p>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">
            {currentBool ? "Oui" : "Non"}
          </span>
          {currentBool !== previousBool && (
            <span className="text-xs text-amber-400">(changement)</span>
          )}
        </div>
      </div>
    );
  }

  const diff = previous !== 0 ? ((current - previous) / previous) * 100 : 0;
  const isUp = diff > 0;
  const isDown = diff < 0;

  return (
    <div className="bg-surface-elevated rounded-xl p-3">
      <p className="text-xs text-foreground-muted mb-1">{label}</p>
      <p className="text-sm font-semibold text-foreground">{fmtEUR(current)}</p>
      <div className="flex items-center gap-1 mt-0.5">
        {isUp && <TrendingUp className="w-3 h-3 text-red-400" />}
        {isDown && <TrendingDown className="w-3 h-3 text-green-400" />}
        <span
          className={`text-xs ${
            isUp ? "text-red-400" : isDown ? "text-green-400" : "text-foreground-muted"
          }`}
        >
          {diff === 0
            ? "="
            : `${isUp ? "+" : ""}${diff.toFixed(1)} %`}
        </span>
      </div>
    </div>
  );
}
