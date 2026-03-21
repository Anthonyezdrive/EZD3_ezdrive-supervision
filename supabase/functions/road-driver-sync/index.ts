// ============================================
// Edge Function: Road Driver Sync
// Syncs driver/account data from Road.io API into gfx_consumers
// Supports incremental sync via watermark table
// Multi-account: EZDrive Réunion / VCity AG (hermetic CPO isolation)
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

const PAGE_SIZE = 100;
const MAX_PAGES_PER_RUN = 20;

// -------------------------------------------------------
// Interfaces
// -------------------------------------------------------
interface SyncResult {
  total_fetched: number;
  total_inserted: number;
  total_updated: number;
  errors: string[];
  has_more: boolean;
  accounts: Array<{ label: string; fetched: number; inserted: number; updated: number }>;
}

interface RoadAccount {
  _id?: string;
  id?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  status?: string;
  address?: {
    street?: string;
    city?: string;
    postalCode?: string;
    country?: string;
  };
  billingPlan?: {
    id?: string;
    name?: string;
  };
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
    total_inserted: 0,
    total_updated: 0,
    errors: [],
    has_more: false,
    accounts: [],
  };

  try {
    // CPO code → cpo_id lookup
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

      console.log(`[road-driver-sync] Starting ${account.label} (provider: ${account.providerId.slice(0, 8)}...)`);

      const accountResult = await syncAccountDrivers(supabase, account, cpoId);

      result.total_fetched += accountResult.fetched;
      result.total_inserted += accountResult.inserted;
      result.total_updated += accountResult.updated;
      result.errors.push(...accountResult.errors);
      if (accountResult.has_more) result.has_more = true;

      result.accounts.push({
        label: account.label,
        fetched: accountResult.fetched,
        inserted: accountResult.inserted,
        updated: accountResult.updated,
      });
    }

    console.log(`[road-driver-sync] Done: ${JSON.stringify({ ...result, errors: result.errors.slice(0, 5) })}`);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[road-driver-sync] Fatal error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message, result }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// -------------------------------------------------------
// Sync drivers for a single Road account
// -------------------------------------------------------
async function syncAccountDrivers(
  supabase: ReturnType<typeof createClient>,
  account: RoadAccountConfig,
  cpoId: string
): Promise<{
  fetched: number;
  inserted: number;
  updated: number;
  errors: string[];
  has_more: boolean;
}> {
  const accountResult = { fetched: 0, inserted: 0, updated: 0, errors: [] as string[], has_more: false };

  // Watermark ID specific to driver sync for this account
  const watermarkId = account.watermarkId.replace("road-cdr-sync", "road-driver-sync");

  // 1. Read watermark for this account
  const { data: watermark } = await supabase
    .from("sync_watermarks")
    .select("*")
    .eq("id", watermarkId)
    .single();

  let currentSkip = watermark?.last_offset ?? 0;

  console.log(`[road-driver-sync] ${account.label}: starting from skip=${currentSkip}`);

  // 2. Paginated fetch from Road.io accounts/search
  let pagesProcessed = 0;

  while (pagesProcessed < MAX_PAGES_PER_RUN) {
    const searchBody = {
      limit: PAGE_SIZE,
      skip: currentSkip,
    };

    const res = await roadPostWithAuth(
      "/1/accounts/search",
      searchBody,
      account.apiToken,
      account.providerId
    );

    if (!res.ok) {
      const errText = await res.text();
      accountResult.errors.push(`Road accounts API error ${res.status}: ${errText}`);
      break;
    }

    const responseData = await res.json();
    const accounts: RoadAccount[] = responseData?.data ?? [];
    const total: number = responseData?.meta?.total ?? accounts.length;

    if (accounts.length === 0) {
      console.log(`[road-driver-sync] ${account.label}: no more accounts at skip=${currentSkip}`);
      break;
    }

    accountResult.fetched += accounts.length;
    console.log(`[road-driver-sync] ${account.label}: fetched ${accounts.length} accounts (skip=${currentSkip}, total=${total})`);

    // 3. Process each driver/account
    for (const roadDriver of accounts) {
      try {
        const roadAccountId = roadDriver._id ?? roadDriver.id;
        if (!roadAccountId) {
          accountResult.errors.push("Account missing _id and id");
          continue;
        }

        const email = roadDriver.email?.trim().toLowerCase() ?? null;
        const firstName = roadDriver.firstName?.trim() ?? null;
        const lastName = roadDriver.lastName?.trim() ?? null;
        const fullName = [firstName, lastName].filter(Boolean).join(" ") || null;
        const phone = roadDriver.phone?.trim() ?? null;
        const country = roadDriver.address?.country ?? "FR";
        // Combine street + postalCode + city into single address field
        const addressParts = [
          roadDriver.address?.street,
          roadDriver.address?.postalCode,
          roadDriver.address?.city,
        ].filter(Boolean);
        const address = addressParts.length > 0 ? addressParts.join(", ") : null;
        const billingPlan = roadDriver.billingPlan?.name ?? null;
        const status = roadDriver.status === "active" ? "active" : "inactive";

        // 3a. Try find existing by road_account_id
        const { data: existingByRoadId } = await supabase
          .from("gfx_consumers")
          .select("id, source")
          .eq("road_account_id", roadAccountId)
          .eq("cpo_id", cpoId)
          .limit(1);

        if (existingByRoadId && existingByRoadId.length > 0) {
          // Already linked — update with latest Road data
          const existing = existingByRoadId[0];
          const updateFields: Record<string, unknown> = {
            driver_external_id: roadAccountId,
            billing_plan: billingPlan,
            status: status,
            updated_at: new Date().toISOString(),
          };

          // Only update fields that are non-null from Road (don't overwrite existing GFX data with nulls)
          if (firstName) updateFields.first_name = firstName;
          if (lastName) updateFields.last_name = lastName;
          if (fullName) updateFields.full_name = fullName;
          if (phone) updateFields.phone = phone;
          if (country) updateFields.country = country;
          if (address) updateFields.address = address;
          if (email) updateFields.email = email;

          const { error: updateErr } = await supabase
            .from("gfx_consumers")
            .update(updateFields)
            .eq("id", existing.id);

          if (updateErr) {
            accountResult.errors.push(`Update error ${roadAccountId}: ${updateErr.message}`);
          } else {
            accountResult.updated++;
          }
          continue;
        }

        // 3b. Try match by email (case-insensitive)
        if (email) {
          const { data: existingByEmail } = await supabase
            .from("gfx_consumers")
            .select("id, source")
            .ilike("email", email)
            .eq("cpo_id", cpoId)
            .limit(1);

          if (existingByEmail && existingByEmail.length > 0) {
            // Found by email — link road_account_id and billing_plan, don't change source
            const existing = existingByEmail[0];
            const updateFields: Record<string, unknown> = {
              road_account_id: roadAccountId,
              driver_external_id: roadAccountId,
              billing_plan: billingPlan,
              status: status,
              updated_at: new Date().toISOString(),
            };

            // Only fill in fields that are currently null in GFX (don't overwrite)
            if (firstName) updateFields.first_name = firstName;
            if (lastName) updateFields.last_name = lastName;
            if (fullName) updateFields.full_name = fullName;
            if (phone) updateFields.phone = phone;
            if (country) updateFields.country = country;
            if (address) updateFields.address = address;

            const { error: updateErr } = await supabase
              .from("gfx_consumers")
              .update(updateFields)
              .eq("id", existing.id);

            if (updateErr) {
              accountResult.errors.push(`Update (email match) ${roadAccountId}: ${updateErr.message}`);
            } else {
              accountResult.updated++;
            }
            continue;
          }
        }

        // 3c. Not found — INSERT new driver with source='road'
        const newDriver: Record<string, unknown> = {
          driver_external_id: roadAccountId,
          road_account_id: roadAccountId,
          first_name: firstName,
          last_name: lastName,
          full_name: fullName,
          email: email,
          phone: phone,
          country: country,
          address: address,
          billing_plan: billingPlan,
          status: status,
          source: "road",
          cpo_id: cpoId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const { error: insertErr } = await supabase
          .from("gfx_consumers")
          .insert(newDriver);

        if (insertErr) {
          if (insertErr.message.includes("duplicate") || insertErr.message.includes("unique")) {
            // Race condition or constraint — treat as update
            accountResult.updated++;
          } else {
            accountResult.errors.push(`Insert error ${roadAccountId}: ${insertErr.message}`);
          }
        } else {
          accountResult.inserted++;
        }
      } catch (driverError) {
        accountResult.errors.push(`Driver error: ${(driverError as Error).message}`);
      }
    }

    currentSkip += accounts.length;
    pagesProcessed++;

    if (accounts.length < PAGE_SIZE) break;
  }

  accountResult.has_more = pagesProcessed >= MAX_PAGES_PER_RUN;

  // 4. Update watermark
  await supabase
    .from("sync_watermarks")
    .upsert({
      id: watermarkId,
      last_offset: currentSkip,
      last_synced_at: new Date().toISOString(),
      last_record_date: new Date().toISOString(),
      metadata: {
        last_run_fetched: accountResult.fetched,
        last_run_inserted: accountResult.inserted,
        last_run_updated: accountResult.updated,
        last_run_errors: accountResult.errors.length,
        provider_id: account.providerId,
        cpo_code: account.cpoCode,
      },
    });

  console.log(`[road-driver-sync] ${account.label}: done — ${accountResult.inserted} inserted, ${accountResult.updated} updated, ${accountResult.errors.length} errors`);

  return accountResult;
}
