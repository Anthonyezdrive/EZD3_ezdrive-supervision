// ============================================
// Edge Function: Road Data Cleanup (one-time)
// Fixes territory IDs for Road.io stations
// ============================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const result = {
    territories_fixed: 0,
    names_checked: 0,
    coordinates_missing: 0,
    errors: [] as string[],
  };

  try {
    // 1. Load territories for lookup
    const { data: territories } = await supabase
      .from("territories")
      .select("id, code, name");
    const territoryByCode = new Map(
      (territories ?? []).map((t: { id: string; code: string }) => [t.code, t.id])
    );

    // 2. Load Road stations
    const { data: stations } = await supabase
      .from("stations")
      .select("id, name, city, postal_code, latitude, longitude, territory_id, source")
      .eq("source", "road");

    for (const station of stations ?? []) {
      const updates: Record<string, unknown> = {};

      // Fix: assign territory_id from postal code
      if (!station.territory_id && station.postal_code) {
        const prefix = station.postal_code.substring(0, 3);
        const territoryCode =
          prefix === "971" ? "971" :
          prefix === "972" ? "972" :
          prefix === "973" ? "973" :
          prefix === "974" ? "974" : null;
        if (territoryCode) {
          const tid = territoryByCode.get(territoryCode);
          if (tid) {
            updates.territory_id = tid;
            result.territories_fixed++;
          }
        }
      }

      // Fix: assign territory from city name if no postal code
      if (!station.territory_id && !updates.territory_id && station.city) {
        const city = station.city.toLowerCase();
        if (city.includes("fort-de-france") || city.includes("lamentin") || city.includes("schœlcher") || city.includes("ducos") || city.includes("rivière-salée")) {
          const tid = territoryByCode.get("972");
          if (tid) { updates.territory_id = tid; result.territories_fixed++; }
        } else if (city.includes("pointe-à-pitre") || city.includes("baie-mahault") || city.includes("abymes") || city.includes("gosier")) {
          const tid = territoryByCode.get("971");
          if (tid) { updates.territory_id = tid; result.territories_fixed++; }
        } else if (city.includes("cayenne") || city.includes("kourou") || city.includes("matoury")) {
          const tid = territoryByCode.get("973");
          if (tid) { updates.territory_id = tid; result.territories_fixed++; }
        }
      }

      result.names_checked++;

      // Check missing coordinates
      if (!station.latitude || !station.longitude) {
        result.coordinates_missing++;
      }

      // Apply updates
      if (Object.keys(updates).length > 0) {
        const { error } = await supabase
          .from("stations")
          .update(updates)
          .eq("id", station.id);
        if (error) result.errors.push(`${station.name}: ${error.message}`);
      }
    }

    console.log(`[road-data-cleanup] Done: ${JSON.stringify(result)}`);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[road-data-cleanup] Fatal error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message, result }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
