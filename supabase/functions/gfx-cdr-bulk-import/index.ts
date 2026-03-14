// ============================================
// Edge Function: GFX CDR Bulk Import
// One-time bulk import of all CDRs from GreenFlux
// Processes 10,000 CDRs per invocation (vs 500 for regular sync)
// Uses upsert with ON CONFLICT for idempotency
// ============================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { corsHeaders } from "../_shared/cors.ts";
import { gfxFetch } from "../_shared/gfx-client.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const COUNTRY_CODE = "FR";
const PARTY_ID = "EZD";
const PAGE_SIZE = 1000; // GFX max per request
const MAX_PAGES_PER_RUN = 10; // 10,000 CDRs per invocation
const BATCH_SIZE = 100; // Upsert batch size

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const result = {
    total_fetched: 0,
    total_upserted: 0,
    errors: [] as string[],
    start_offset: 0,
    end_offset: 0,
    has_more: false,
    duration_ms: 0,
  };

  const startTime = Date.now();

  try {
    // Read start offset from query or watermark
    const url = new URL(req.url);
    let startOffset = parseInt(url.searchParams.get("offset") ?? "");

    if (isNaN(startOffset)) {
      // Fall back to watermark
      const { data: watermark } = await supabase
        .from("sync_watermarks")
        .select("last_offset")
        .eq("id", "gfx-cdr-sync")
        .single();
      startOffset = watermark?.last_offset ?? 0;
    }

    result.start_offset = startOffset;
    let currentOffset = startOffset;

    console.log(`[gfx-cdr-bulk] Starting bulk import from offset ${currentOffset}`);

    // Build station lookup
    const { data: stations } = await supabase
      .from("stations")
      .select("id, gfx_id, gfx_location_id")
      .eq("source", "gfx");

    const stationByGfxLocationId = new Map<string, string>();
    const stationByGfxId = new Map<string, string>();
    for (const s of stations ?? []) {
      if (s.gfx_location_id) stationByGfxLocationId.set(s.gfx_location_id, s.id);
      if (s.gfx_id) stationByGfxId.set(s.gfx_id, s.id);
    }

    let pagesProcessed = 0;

    while (pagesProcessed < MAX_PAGES_PER_RUN) {
      const res = await gfxFetch(`/cdrs?offset=${currentOffset}&limit=${PAGE_SIZE}`);

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`GFX CDR API error ${res.status}: ${errText}`);
      }

      const data = await res.json();
      const cdrs: Array<Record<string, unknown>> = data?.data ?? [];

      if (cdrs.length === 0) {
        console.log(`[gfx-cdr-bulk] No more CDRs at offset ${currentOffset}`);
        break;
      }

      result.total_fetched += cdrs.length;
      console.log(`[gfx-cdr-bulk] Fetched ${cdrs.length} CDRs (offset ${currentOffset})`);

      // Map all CDRs to rows
      const rows: Record<string, unknown>[] = [];
      for (const cdr of cdrs) {
        try {
          const gfxCdrId = cdr.id as string;
          if (!gfxCdrId) continue;

          // Resolve station_id
          let stationId: string | null = null;
          const location = cdr.location as Record<string, unknown> | null;
          if (location) {
            const locId = location.id as string;
            if (locId) stationId = stationByGfxLocationId.get(locId) ?? null;
            if (!stationId) {
              const evses = location.evses as Array<Record<string, unknown>> | undefined;
              if (evses?.[0]) {
                const csId = evses[0].charge_station_id as string;
                if (csId) stationId = stationByGfxId.get(csId) ?? null;
              }
            }
          }

          const authId = cdr.auth_id as string | null;
          const authMethod = cdr.auth_method as string | null;

          rows.push({
            country_code: (cdr.emsp_country_code as string) ?? COUNTRY_CODE,
            party_id: PARTY_ID,
            cdr_id: gfxCdrId,
            gfx_cdr_id: gfxCdrId,
            source: "gfx",
            start_date_time: cdr.start_date_time,
            end_date_time: cdr.stop_date_time,
            cdr_token: authId
              ? { uid: authId, type: authMethod === "WHITELIST" ? "RFID" : (authMethod ?? "OTHER"), contract_id: authId }
              : null,
            cdr_location: location
              ? { id: location.id, name: location.name, address: location.address, city: location.city, postal_code: location.postal_code, country: location.country ?? "FRA", coordinates: location.coordinates, evses: location.evses }
              : null,
            total_energy: (cdr.total_energy as number) ?? 0,
            total_time: (cdr.total_time as number) ?? 0,
            total_parking_time: (cdr.total_parking_time as number) ?? 0,
            currency: (cdr.currency as string) ?? "EUR",
            total_cost: (cdr.total_cost as number) ?? 0,
            total_cost_incl_vat: cdr.total_cost_incl_vat ?? null,
            total_vat: cdr.total_vat ?? null,
            vat_rate: cdr.vat ?? null,
            total_retail_cost: cdr.total_retail_cost ?? null,
            total_retail_cost_incl_vat: cdr.total_retail_cost_incl_vat ?? null,
            total_retail_vat: cdr.total_retail_vat ?? null,
            retail_vat_rate: cdr.retail_vat ?? null,
            customer_external_id: cdr.customer_external_id ?? null,
            retail_package_id: cdr.retail_package_id ?? null,
            custom_groups: cdr.custom_groups ?? null,
            charger_type: cdr.charger_type ?? null,
            driver_external_id: cdr.driver_external_id ?? null,
            emsp_country_code: cdr.emsp_country_code ?? null,
            emsp_party_id: cdr.emsp_party_id ?? null,
            emsp_external_id: cdr.emsp_external_id ?? null,
            charging_periods: cdr.charging_periods ? JSON.stringify(cdr.charging_periods) : "[]",
            station_id: stationId,
            last_updated: new Date().toISOString(),
          });
        } catch (cdrError) {
          result.errors.push(`Map error: ${(cdrError as Error).message}`);
        }
      }

      // Batch upsert
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const { error: upsertErr, count } = await supabase
          .from("ocpi_cdrs")
          .upsert(batch, {
            onConflict: "country_code,party_id,cdr_id",
            ignoreDuplicates: false,
          });

        if (upsertErr) {
          result.errors.push(`Upsert batch error: ${upsertErr.message}`);
        } else {
          result.total_upserted += batch.length;
        }
      }

      currentOffset += cdrs.length;
      pagesProcessed++;

      if (cdrs.length < PAGE_SIZE) break;
    }

    result.has_more = pagesProcessed >= MAX_PAGES_PER_RUN;
    result.end_offset = currentOffset;
    result.duration_ms = Date.now() - startTime;

    // Update watermark
    await supabase
      .from("sync_watermarks")
      .update({
        last_offset: currentOffset,
        last_synced_at: new Date().toISOString(),
        metadata: {
          last_bulk_fetched: result.total_fetched,
          last_bulk_upserted: result.total_upserted,
          last_bulk_errors: result.errors.length,
          last_bulk_duration_ms: result.duration_ms,
        },
      })
      .eq("id", "gfx-cdr-sync");

    console.log(`[gfx-cdr-bulk] Done in ${result.duration_ms}ms: ${result.total_upserted} upserted, ${result.errors.length} errors`);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    result.duration_ms = Date.now() - startTime;
    console.error("[gfx-cdr-bulk] Fatal error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message, result }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
