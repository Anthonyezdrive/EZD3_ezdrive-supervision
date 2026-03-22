/**
 * X-DRIVE BPU (Bordereau des Prix Unitaires) Calculation Engine
 *
 * Implements the 5-step BPU billing calculation:
 * 1. PdC inventory classification by type and pricing tier
 * 2. Fixed fees (supervision + connectivity + support)
 * 3. Variable transaction fees by charger type
 * 4. Floor application (max of connect+trans vs floor)
 * 5. Total HT = supervision + max(connect+trans, floor) + support + optionals
 */

import type { XDriveBPUConfig } from "@/types/xdrive";

// ── Types ────────────────────────────────────────────────────

export interface PdCInventory {
  ac22_public: number;
  ac_privatif: number;
  dc_50_100: number;
  total: number;
}

export interface BPULineItem {
  code: string;
  label: string;
  quantity: number;
  unit_price: number;
  amount: number;
  detail?: string;
}

export interface BPUCalculation {
  period_month: string;
  pdc_inventory: PdCInventory;
  pricing_tier_used: { min_pdc: number; max_pdc: number | null };
  // Line items
  supervision: BPULineItem;
  connectivity_lines: BPULineItem[];
  connectivity_total: number;
  transaction_lines: BPULineItem[];
  transaction_total: number;
  floor_applied: boolean;
  connectivity_plus_transactions: number;
  support: BPULineItem;
  optional_lines: BPULineItem[];
  optional_total: number;
  // Totals
  total_ht: number;
  tva_rate: number;
  tva_amount: number;
  total_ttc: number;
  all_line_items: BPULineItem[];
}

// ── CDR type for BPU input ───────────────────────────────────

export interface BPUCdrInput {
  total_retail_cost: number;
  charger_type: string;
}

// ── Main calculation function ────────────────────────────────

export function calculateBPU(
  config: XDriveBPUConfig,
  pdcInventory: PdCInventory,
  cdrs: BPUCdrInput[],
  optionalServices: Array<{ code: string; quantity: number }> = []
): BPUCalculation {
  // ── Step 1: Determine pricing tier ─────────────────────────
  const tier = config.pricing_tiers.find(
    (t) =>
      pdcInventory.total >= t.min_pdc &&
      (t.max_pdc === null || pdcInventory.total <= t.max_pdc)
  ) || config.pricing_tiers[0];

  // ── Step 2: Fixed fees ─────────────────────────────────────

  // Supervision
  const supervision: BPULineItem = {
    code: "SUPERVISION",
    label: "Supervision plateforme",
    quantity: 1,
    unit_price: config.supervision_monthly,
    amount: config.supervision_monthly,
  };

  // Connectivity per PdC type
  const connectivity_lines: BPULineItem[] = [];
  if (pdcInventory.ac22_public > 0) {
    connectivity_lines.push({
      code: "CONNECT_AC22",
      label: `Connectivité AC22/DC25 public (${pdcInventory.ac22_public} PdC)`,
      quantity: pdcInventory.ac22_public,
      unit_price: tier.ac22_public,
      amount: round2(pdcInventory.ac22_public * tier.ac22_public),
    });
  }
  if (pdcInventory.ac_privatif > 0) {
    connectivity_lines.push({
      code: "CONNECT_AC_PRIV",
      label: `Connectivité AC privatif (${pdcInventory.ac_privatif} PdC)`,
      quantity: pdcInventory.ac_privatif,
      unit_price: tier.ac_privatif,
      amount: round2(pdcInventory.ac_privatif * tier.ac_privatif),
    });
  }
  if (pdcInventory.dc_50_100 > 0) {
    connectivity_lines.push({
      code: "CONNECT_DC",
      label: `Connectivité DC 50-100 kW (${pdcInventory.dc_50_100} PdC)`,
      quantity: pdcInventory.dc_50_100,
      unit_price: tier.dc_50_100,
      amount: round2(pdcInventory.dc_50_100 * tier.dc_50_100),
    });
  }
  const connectivity_total = round2(
    connectivity_lines.reduce((s, l) => s + l.amount, 0)
  );

  // ── Step 3: Transaction fees ───────────────────────────────
  const rates = config.transaction_rates;
  let ca_ac22_privatif = 0;
  let ca_dc25_privatif = 0;
  let ca_public = 0;

  for (const cdr of cdrs) {
    const ca = Number(cdr.total_retail_cost) || 0;
    const type = (cdr.charger_type || "").toLowerCase();
    if (type.includes("privatif") && type.includes("ac")) {
      ca_ac22_privatif += ca;
    } else if (type.includes("privatif") && type.includes("dc")) {
      ca_dc25_privatif += ca;
    } else {
      ca_public += ca;
    }
  }

  const transaction_lines: BPULineItem[] = [];
  if (ca_ac22_privatif > 0) {
    transaction_lines.push({
      code: "TRANS_AC_PRIV",
      label: "Frais transactions AC privatif",
      quantity: 1,
      unit_price: rates.ac22_privatif,
      amount: round2(ca_ac22_privatif * rates.ac22_privatif),
      detail: `${(rates.ac22_privatif * 100).toFixed(2)}% × ${fmtNum(ca_ac22_privatif)} €`,
    });
  }
  if (ca_dc25_privatif > 0) {
    transaction_lines.push({
      code: "TRANS_DC_PRIV",
      label: "Frais transactions DC privatif",
      quantity: 1,
      unit_price: rates.dc25_privatif,
      amount: round2(ca_dc25_privatif * rates.dc25_privatif),
      detail: `${(rates.dc25_privatif * 100).toFixed(2)}% × ${fmtNum(ca_dc25_privatif)} €`,
    });
  }
  if (ca_public > 0) {
    transaction_lines.push({
      code: "TRANS_PUBLIC",
      label: "Frais transactions AC-DC public",
      quantity: 1,
      unit_price: rates.ac_dc_public,
      amount: round2(ca_public * rates.ac_dc_public),
      detail: `${(rates.ac_dc_public * 100).toFixed(2)}% × ${fmtNum(ca_public)} €`,
    });
  }
  const transaction_total = round2(
    transaction_lines.reduce((s, l) => s + l.amount, 0)
  );

  // ── Step 4: Floor ──────────────────────────────────────────
  const raw_connectivity_plus_transactions = round2(connectivity_total + transaction_total);
  const floor_applied = raw_connectivity_plus_transactions < config.floor_monthly;
  const connectivity_plus_transactions = Math.max(
    raw_connectivity_plus_transactions,
    config.floor_monthly
  );

  // ── Step 5: Support + optionals + total ────────────────────
  const support_amount = round2(
    config.support_monthly_per_territory * config.support_territories
  );
  const support: BPULineItem = {
    code: "SUPPORT",
    label: `Support conducteurs VE (${config.support_territories} territoires)`,
    quantity: config.support_territories,
    unit_price: config.support_monthly_per_territory,
    amount: support_amount,
  };

  const optional_lines: BPULineItem[] = optionalServices
    .map((os) => {
      const svc = config.optional_services.find((s) => s.code === os.code);
      if (!svc) return null;
      return {
        code: os.code,
        label: svc.label,
        quantity: os.quantity,
        unit_price: svc.unit_price,
        amount: round2(svc.unit_price * os.quantity),
      };
    })
    .filter(Boolean) as BPULineItem[];
  const optional_total = round2(
    optional_lines.reduce((s, l) => s + l.amount, 0)
  );

  // Total HT
  const total_ht = round2(
    supervision.amount + connectivity_plus_transactions + support_amount + optional_total
  );
  const tva_rate = 0.085; // DOM-TOM TVA
  const tva_amount = round2(total_ht * tva_rate);
  const total_ttc = round2(total_ht + tva_amount);

  const all_line_items = [
    supervision,
    ...connectivity_lines,
    ...transaction_lines,
    support,
    ...optional_lines,
  ];

  return {
    period_month: "",
    pdc_inventory: pdcInventory,
    pricing_tier_used: { min_pdc: tier.min_pdc, max_pdc: tier.max_pdc },
    supervision,
    connectivity_lines,
    connectivity_total,
    transaction_lines,
    transaction_total,
    floor_applied,
    connectivity_plus_transactions,
    support,
    optional_lines,
    optional_total,
    total_ht,
    tva_rate,
    tva_amount,
    total_ttc,
    all_line_items,
  };
}

// ── Helpers ──────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmtNum(n: number): string {
  return n.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Generate a BPU invoice number: BPU-{partnerCode}-{YYYYMM}-{seq}
 */
export function generateBPUInvoiceNumber(
  partnerCode: string,
  periodMonth: string,
  seq = 1
): string {
  const ym = periodMonth.replace("-", "");
  return `BPU-${partnerCode.toUpperCase()}-${ym}-${String(seq).padStart(3, "0")}`;
}
