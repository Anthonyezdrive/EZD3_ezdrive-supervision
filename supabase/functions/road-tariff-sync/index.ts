// ============================================
// Edge Function: Road Tariff Sync
// Syncs tariff profiles from Road.io API into ocpi_tariffs
// Full sync (no watermark) — small dataset
// Multi-account: EZDrive Reunion / VCity AG (hermetic CPO isolation)
// ============================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { corsHeaders } from "../_shared/cors.ts";
import {
  getRoadAccounts,
  roadPostWithAuth,
  type RoadAccountConfig,
} from "../_shared/road-client.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const COUNTRY_CODE = "FR";
const PARTY_ID = "EZD";
const PAGE_SIZE = 100;
const MAX_PAGES = 10; // Max 1000 tariff profiles per account

// -------------------------------------------------------
// Interfaces
// -------------------------------------------------------
interface SyncResult {
  total_fetched: number;
  total_created: number;
  total_updated: number;
  errors: string[];
  accounts: Array<{ label: string; fetched: number; created: number; updated: number }>;
}

interface RoadTariffProfile {
  _id?: string;
  id?: string;
  name?: string;
  currency?: string;
  pricePerKwh?: number;
  pricePerSession?: number;
  pricePerMinute?: number;
  [key: string]: unknown;
}

// -------------------------------------------------------
// Main handler
// -------------------------------------------------------
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const result: SyncResult = {
    total_fetched: 0,
    total_created: 0,
    total_updated: 0,
    errors: [],
    accounts: [],
  };

  try {
    // CPO code -> cpo_id lookup
    const { data: cpos } = await supabase
      .from("cpo_operators")
      .select("id, code");
    const cpoMap = new Map(
      (cpos ?? []).map((c: { code: string; id: string }) => [c.code, c.id])
    );

    // Process each Road account independently (hermetic isolation)
    const roadAccounts = getRoadAccounts();

    if (roadAccounts.length === 0) {
      return new Response(
        JSON.stringify({ ...result, message: "No ROAD provider IDs configured." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    for (const account of roadAccounts) {
      const cpoId = cpoMap.get(account.cpoCode) ?? null;
      if (!cpoId) {
        result.errors.push(`CPO "${account.cpoCode}" not found for ${account.label}`);
        continue;
      }

      console.log(`[road-tariff-sync] Starting ${account.label} (provider: ${account.providerId.slice(0, 8)}...)`);

      const accountResult = await syncAccountTariffs(supabase, account, cpoId);

      result.total_fetched += accountResult.fetched;
      result.total_created += accountResult.created;
      result.total_updated += accountResult.updated;
      result.errors.push(...accountResult.errors);

      result.accounts.push({
        label: account.label,
        fetched: accountResult.fetched,
        created: accountResult.created,
        updated: accountResult.updated,
      });
    }

    console.log(`[road-tariff-sync] Done: ${JSON.stringify({ ...result, errors: result.errors.slice(0, 5) })}`);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[road-tariff-sync] Fatal error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message, result }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// -------------------------------------------------------
// Build OCPI 2.2.1 elements from Road price components
// -------------------------------------------------------
function buildElements(tariff: RoadTariffProfile): Record<string, unknown>[] {
  const priceComponents: Record<string, unknown>[] = [];

  if (tariff.pricePerKwh != null && tariff.pricePerKwh > 0) {
    priceComponents.push({
      type: "ENERGY",
      price: tariff.pricePerKwh,
      step_size: 1,
    });
  }

  if (tariff.pricePerSession != null && tariff.pricePerSession > 0) {
    priceComponents.push({
      type: "FLAT",
      price: tariff.pricePerSession,
    });
  }

  if (tariff.pricePerMinute != null && tariff.pricePerMinute > 0) {
    priceComponents.push({
      type: "TIME",
      price: tariff.pricePerMinute,
      step_size: 60,
    });
  }

  if (priceComponents.length === 0) {
    return [];
  }

  return [{ price_components: priceComponents }];
}

// -------------------------------------------------------
// Sync tariffs for a single Road account
// -------------------------------------------------------
async function syncAccountTariffs(
  supabase: ReturnType<typeof createClient>,
  account: RoadAccountConfig,
  cpoId: string
): Promise<{
  fetched: number;
  created: number;
  updated: number;
  errors: string[];
}> {
  const accountResult = { fetched: 0, created: 0, updated: 0, errors: [] as string[] };

  let skip = 0;
  let pagesProcessed = 0;

  while (pagesProcessed < MAX_PAGES) {
    const res = await roadPostWithAuth(
      "/1/tariff-profiles/search",
      { limit: PAGE_SIZE, skip },
      account.apiToken,
      account.providerId
    );

    if (!res.ok) {
      const errText = await res.text();
      accountResult.errors.push(`Road tariff-profiles API error ${res.status}: ${errText}`);
      break;
    }

    const responseData = await res.json();
    const tariffs: RoadTariffProfile[] = responseData?.data ?? [];
    const total: number = responseData?.meta?.total ?? tariffs.length;

    if (tariffs.length === 0) {
      console.log(`[road-tariff-sync] ${account.label}: no more tariffs at skip=${skip}`);
      break;
    }

    accountResult.fetched += tariffs.length;
    console.log(`[road-tariff-sync] ${account.label}: fetched ${tariffs.length} tariffs (skip=${skip}, total=${total})`);

    // Process each tariff profile
    for (const tariff of tariffs) {
      try {
        const roadId = tariff._id ?? tariff.id;
        if (!roadId) {
          accountResult.errors.push("Tariff profile missing _id");
          continue;
        }

        const tariffId = `road-${roadId}`;
        const elements = buildElements(tariff);
        const tariffAltText = tariff.name
          ? [{ language: "fr", text: tariff.name }]
          : null;
        const now = new Date().toISOString();

        // Check if tariff already exists by road_tariff_id
        const { data: existing } = await supabase
          .from("ocpi_tariffs")
          .select("id")
          .eq("road_tariff_id", roadId)
          .limit(1);

        if (existing && existing.length > 0) {
          // UPDATE existing tariff
          const { error: updateErr } = await supabase
            .from("ocpi_tariffs")
            .update({
              elements,
              tariff_alt_text: tariffAltText,
              currency: tariff.currency ?? "EUR",
              last_updated: now,
            })
            .eq("id", existing[0].id);

          if (updateErr) {
            accountResult.errors.push(`Update error ${tariffId}: ${updateErr.message}`);
          } else {
            accountResult.updated++;
          }
        } else {
          // INSERT new tariff
          const row = {
            country_code: COUNTRY_CODE,
            party_id: PARTY_ID,
            tariff_id: tariffId,
            road_tariff_id: roadId,
            currency: tariff.currency ?? "EUR",
            elements,
            tariff_alt_text: tariffAltText,
            source: "road",
            cpo_id: cpoId,
            last_updated: now,
          };

          const { error: insertErr } = await supabase
            .from("ocpi_tariffs")
            .insert(row);

          if (insertErr) {
            accountResult.errors.push(`Insert error ${tariffId}: ${insertErr.message}`);
          } else {
            accountResult.created++;
          }
        }
      } catch (tariffError) {
        accountResult.errors.push(`Tariff error: ${(tariffError as Error).message}`);
      }
    }

    skip += tariffs.length;
    pagesProcessed++;

    if (tariffs.length < PAGE_SIZE) break;
  }

  console.log(`[road-tariff-sync] ${account.label}: done — ${accountResult.created} created, ${accountResult.updated} updated, ${accountResult.errors.length} errors`);

  return accountResult;
}
