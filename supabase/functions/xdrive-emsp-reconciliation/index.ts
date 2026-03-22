import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// eMSP commission rates (typical)
const EMSP_COMMISSION_RATES: Record<string, number> = {
  GFX: 0.15,    // Freshmile 15%
  CHM: 0.18,    // ChargeMap 18%
  SHL: 0.20,    // Shell Recharge 20%
  VRT: 0.15,    // Virta 15%
  PLG: 0.20,    // Plugsurfing 20%
  DEFAULT: 0.17,
};

const EMSP_NAMES: Record<string, string> = {
  GFX: "Freshmile",
  CHM: "ChargeMap",
  SHL: "Shell Recharge",
  VRT: "Virta",
  PLG: "Plugsurfing",
  EON: "E.ON Drive",
  EDF: "EDF",
  TOT: "TotalEnergies",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body = await req.json().catch(() => ({}));
    const now = new Date();
    const targetMonth = body.month || `${now.getFullYear()}-${String(now.getMonth()).padStart(2, "0")}-01`;

    const monthStart = new Date(targetMonth);
    const monthEnd = new Date(monthStart);
    monthEnd.setMonth(monthEnd.getMonth() + 1);

    // Get all X-DRIVE partners
    const { data: partners } = await supabase
      .from("xdrive_partners")
      .select("id, partner_code, b2b_client_id, b2b_clients(customer_external_ids)")
      .not("b2b_client_id", "is", null);

    const results = [];

    for (const partner of (partners || [])) {
      const customerIds = partner.b2b_clients?.customer_external_ids || [];
      if (customerIds.length === 0) continue;

      // Get roaming CDRs (sessions from eMSP operators)
      const { data: cdrs } = await supabase
        .from("ocpi_cdrs")
        .select("total_retail_cost, total_energy, emsp_party_id, emsp_country_code, cdr_token")
        .in("customer_external_id", customerIds)
        .gte("start_date_time", monthStart.toISOString())
        .lt("start_date_time", monthEnd.toISOString())
        .not("emsp_party_id", "is", null);

      // Group by eMSP
      const byEmsp: Record<string, { sessions: number; kwh: number; gross: number }> = {};

      for (const cdr of (cdrs || [])) {
        const partyId = cdr.emsp_party_id;
        if (!partyId) continue;

        // Skip "direct" sessions (own eMSP)
        const tokenType = cdr.cdr_token?.type?.toUpperCase();
        if (tokenType !== "RFID" || !partyId) continue;

        if (!byEmsp[partyId]) {
          byEmsp[partyId] = { sessions: 0, kwh: 0, gross: 0 };
        }
        byEmsp[partyId].sessions++;
        byEmsp[partyId].kwh += Number(cdr.total_energy) || 0;
        byEmsp[partyId].gross += Number(cdr.total_retail_cost) || 0;
      }

      // Upsert per eMSP
      let totalEmspNet = 0;

      for (const [partyId, data] of Object.entries(byEmsp)) {
        const commissionRate = EMSP_COMMISSION_RATES[partyId] ?? EMSP_COMMISSION_RATES.DEFAULT;
        const commission = data.gross * commissionRate;
        const net = data.gross - commission;
        totalEmspNet += net;

        await supabase.from("xdrive_emsp_settlements").upsert({
          partner_id: partner.id,
          period_month: targetMonth,
          emsp_party_id: partyId,
          emsp_name: EMSP_NAMES[partyId] ?? partyId,
          sessions_count: data.sessions,
          total_energy_kwh: Math.round(data.kwh * 100) / 100,
          gross_amount: Math.round(data.gross * 100) / 100,
          commission: Math.round(commission * 100) / 100,
          net_amount: Math.round(net * 100) / 100,
          source: "auto",
        }, { onConflict: "partner_id,period_month,emsp_party_id" });
      }

      // Auto-update reconciliation
      await supabase.from("xdrive_reconciliations").upsert({
        partner_id: partner.id,
        period_month: targetMonth,
        encaissements_emsp: Math.round(totalEmspNet * 100) / 100,
      }, { onConflict: "partner_id,period_month" });

      results.push({
        partner: partner.partner_code,
        month: targetMonth,
        emspCount: Object.keys(byEmsp).length,
        totalGross: Object.values(byEmsp).reduce((s, d) => s + d.gross, 0),
        totalNet: totalEmspNet,
      });
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
