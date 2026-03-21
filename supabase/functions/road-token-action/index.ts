// ============================================
// Edge Function: Road Token Action
// Block or unblock a token via Road.io API
// ============================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { corsHeaders } from "../_shared/cors.ts";
import {
  getRoadAccounts,
  roadFetchWithAuth,
} from "../_shared/road-client.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req: Request) => {
  // ---- CORS preflight ----
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ---- Parse & validate ----
    const { tokenUid, action } = await req.json();

    if (!tokenUid) {
      return new Response(
        JSON.stringify({ error: "Missing tokenUid" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action !== "block" && action !== "unblock") {
      return new Response(
        JSON.stringify({ error: 'action must be "block" or "unblock"' }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ---- Look up token ----
    const { data: token, error: tokenErr } = await supabase
      .from("gfx_tokens")
      .select("road_token_id, cpo_id")
      .eq("token_uid", tokenUid)
      .maybeSingle();

    if (tokenErr) {
      console.error("[road-token-action] DB error fetching token:", tokenErr.message);
      return new Response(
        JSON.stringify({ error: "Database error", detail: tokenErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!token) {
      return new Response(
        JSON.stringify({ error: "Token not found", tokenUid }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!token.road_token_id) {
      return new Response(
        JSON.stringify({ error: "Token has no Road.io ID", tokenUid }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ---- Resolve Road account via CPO ----
    const { data: cpo, error: cpoErr } = await supabase
      .from("cpo_operators")
      .select("code")
      .eq("id", token.cpo_id)
      .maybeSingle();

    if (cpoErr || !cpo) {
      console.error("[road-token-action] CPO lookup failed:", cpoErr?.message);
      return new Response(
        JSON.stringify({ error: "CPO not found for token", cpo_id: token.cpo_id }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const accounts = getRoadAccounts();
    const account = accounts.find((a) => a.cpoCode === cpo.code);

    if (!account) {
      return new Response(
        JSON.stringify({ error: `No Road.io account configured for CPO "${cpo.code}"` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ---- Call Road.io API ----
    const roadPath = `/1/tokens/${token.road_token_id}/${action}`;
    console.log(`[road-token-action] ${action} token ${tokenUid} → ${roadPath}`);

    const roadRes = await roadFetchWithAuth(roadPath, account.apiToken, account.providerId, {
      method: "POST",
    });

    if (!roadRes.ok) {
      const body = await roadRes.text();
      console.error(`[road-token-action] Road.io ${roadRes.status}: ${body}`);
      return new Response(
        JSON.stringify({
          error: "Road.io API error",
          status: roadRes.status,
          detail: body,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ---- Update local status ----
    const newStatus = action === "block" ? "blocked" : "active";

    const { error: updateErr } = await supabase
      .from("gfx_tokens")
      .update({ status: newStatus })
      .eq("token_uid", tokenUid);

    if (updateErr) {
      console.error("[road-token-action] Failed to update local status:", updateErr.message);
      // Road.io succeeded but local update failed — still report success with warning
    }

    console.log(`[road-token-action] Done: ${tokenUid} → ${newStatus}`);

    return new Response(
      JSON.stringify({ success: true, tokenUid, action, newStatus }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[road-token-action] Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error", detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
