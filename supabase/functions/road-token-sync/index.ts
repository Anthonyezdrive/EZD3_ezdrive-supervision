// ============================================
// Edge Function: Road Token Sync
// Ingests RFID/APP tokens from Road.io API into gfx_tokens
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
const MAX_PAGES_PER_RUN = 20; // Max 2000 tokens per invocation

// -------------------------------------------------------
// Interfaces
// -------------------------------------------------------
interface SyncResult {
  total_fetched: number;
  total_ingested: number;
  duplicates_updated: number;
  errors: string[];
  accounts: Array<{ label: string; fetched: number; ingested: number; updated: number }>;
}

interface RoadToken {
  _id?: string;
  id?: string;
  uid?: string;
  contractId?: string;
  type?: string; // RFID, APP_USER, AD_HOC_USER
  visualNumber?: string;
  issuer?: string;
  valid?: boolean;
  userId?: string;
  user?: { firstName?: string; lastName?: string };
}

// -------------------------------------------------------
// Watermark ID mapping per CPO
// -------------------------------------------------------
function getTokenWatermarkId(cpoCode: string): string {
  if (cpoCode === "ezdrive-reunion") return "road-token-sync-reunion";
  if (cpoCode === "vcity-ag") return "road-token-sync-vcity";
  return `road-token-sync-${cpoCode}`;
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
    total_ingested: 0,
    duplicates_updated: 0,
    errors: [],
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

      console.log(`[road-token-sync] Starting ${account.label} (provider: ${account.providerId.slice(0, 8)}…)`);

      const accountResult = await syncAccountTokens(
        supabase,
        account,
        cpoId
      );

      result.total_fetched += accountResult.fetched;
      result.total_ingested += accountResult.ingested;
      result.duplicates_updated += accountResult.updated;
      result.errors.push(...accountResult.errors);

      result.accounts.push({
        label: account.label,
        fetched: accountResult.fetched,
        ingested: accountResult.ingested,
        updated: accountResult.updated,
      });
    }

    console.log(`[road-token-sync] Done: ${JSON.stringify({ ...result, errors: result.errors.slice(0, 5) })}`);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[road-token-sync] Fatal error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message, result }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// -------------------------------------------------------
// Sync tokens for a single Road account
// -------------------------------------------------------
async function syncAccountTokens(
  supabase: ReturnType<typeof createClient>,
  account: RoadAccountConfig,
  cpoId: string
): Promise<{
  fetched: number;
  ingested: number;
  updated: number;
  errors: string[];
}> {
  const accountResult = { fetched: 0, ingested: 0, updated: 0, errors: [] as string[] };

  // 1. Read watermark for this account
  const watermarkId = getTokenWatermarkId(account.cpoCode);

  const { data: watermark } = await supabase
    .from("sync_watermarks")
    .select("*")
    .eq("id", watermarkId)
    .single();

  let currentSkip = watermark?.last_offset ?? 0;
  const lastRecordDate = watermark?.last_record_date ?? null;

  console.log(`[road-token-sync] ${account.label}: starting from skip=${currentSkip}, lastDate=${lastRecordDate}`);

  // 2. Paginated fetch from Road.io using account-specific credentials
  let pagesProcessed = 0;

  while (pagesProcessed < MAX_PAGES_PER_RUN) {
    const searchBody: Record<string, unknown> = {
      limit: PAGE_SIZE,
      skip: currentSkip,
    };

    const res = await roadPostWithAuth(
      "/1/tokens/search",
      searchBody,
      account.apiToken,
      account.providerId
    );

    if (!res.ok) {
      const errText = await res.text();
      accountResult.errors.push(`Road tokens API error ${res.status}: ${errText}`);
      break;
    }

    const responseData = await res.json();
    const tokens: RoadToken[] = responseData?.data ?? [];
    const total: number = responseData?.meta?.total ?? tokens.length;

    if (tokens.length === 0) {
      console.log(`[road-token-sync] ${account.label}: no more tokens at skip=${currentSkip}`);
      break;
    }

    accountResult.fetched += tokens.length;
    console.log(`[road-token-sync] ${account.label}: fetched ${tokens.length} tokens (skip=${currentSkip}, total=${total})`);

    // 3. Process each token
    for (const token of tokens) {
      try {
        const tokenUid = token.uid;
        if (!tokenUid) {
          accountResult.errors.push(`Token missing uid (road_id=${token._id})`);
          continue;
        }

        // Build driver name from user object
        const driverName = token.user
          ? [token.user.firstName, token.user.lastName].filter(Boolean).join(" ") || null
          : null;

        // Map valid boolean to status
        const status = token.valid === false ? "blocked" : "active";

        // Map token type
        const tokenType = token.type ?? "RFID";

        const row = {
          token_uid: tokenUid,
          road_token_id: token._id ?? token.id ?? null,
          contract_id: token.contractId ?? null,
          token_type: tokenType,
          visual_number: token.visualNumber ?? null,
          issuer: token.issuer ?? null,
          status,
          driver_external_id: token.userId ?? null,
          driver_name: driverName,
          cpo_id: cpoId,
          source: "road",
          updated_at: new Date().toISOString(),
        };

        // Check if token already exists by token_uid
        const { data: existing } = await supabase
          .from("gfx_tokens")
          .select("id")
          .eq("token_uid", tokenUid)
          .limit(1);

        if (existing && existing.length > 0) {
          // Update existing token
          const { error: updateErr } = await supabase
            .from("gfx_tokens")
            .update(row)
            .eq("id", existing[0].id);

          if (updateErr) {
            accountResult.errors.push(`Update error token_uid=${tokenUid}: ${updateErr.message}`);
          } else {
            accountResult.updated++;
          }
        } else {
          // Insert new token
          const { error: insertErr } = await supabase
            .from("gfx_tokens")
            .insert({
              ...row,
              created_at: new Date().toISOString(),
            });

          if (insertErr) {
            if (insertErr.message.includes("duplicate") || insertErr.message.includes("unique")) {
              accountResult.updated++;
            } else {
              accountResult.errors.push(`Insert error token_uid=${tokenUid}: ${insertErr.message}`);
            }
          } else {
            accountResult.ingested++;
          }
        }
      } catch (tokenError) {
        accountResult.errors.push(`Token error: ${(tokenError as Error).message}`);
      }
    }

    currentSkip += tokens.length;
    pagesProcessed++;

    if (tokens.length < PAGE_SIZE) break;
  }

  // 4. Update watermark
  const latestDate = accountResult.fetched > 0
    ? new Date().toISOString()
    : (lastRecordDate ?? new Date().toISOString());

  await supabase
    .from("sync_watermarks")
    .upsert({
      id: watermarkId,
      last_offset: currentSkip,
      last_synced_at: new Date().toISOString(),
      last_record_date: latestDate,
      metadata: {
        last_run_fetched: accountResult.fetched,
        last_run_ingested: accountResult.ingested,
        last_run_updated: accountResult.updated,
        last_run_errors: accountResult.errors.length,
        provider_id: account.providerId,
        cpo_code: account.cpoCode,
      },
    });

  console.log(`[road-token-sync] ${account.label}: done — ${accountResult.ingested} new, ${accountResult.updated} updated, ${accountResult.errors.length} errors`);

  return accountResult;
}
