// ============================================
// Edge Function: Road Station Sync
// Syncs EVSE controllers from Road.io into stations table
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

interface SyncResult {
  total_synced: number;
  new_stations: number;
  status_changes: number;
  skipped: number;
  errors: string[];
  raw_sample?: string;
}

// -------------------------------------------------------
// E-Flux/Road status → OCPP status mapping
// -------------------------------------------------------
const EFLUX_TO_OCPP: Record<string, string> = {
  available: "Available",
  occupied: "Charging",
  reserved: "Preparing",
  faulted: "Faulted",
  unavailable: "Unavailable",
  unknown: "Unknown",
  operative: "Available",
  inoperative: "Unavailable",
  outoforder: "Faulted",
  Available: "Available",
  Preparing: "Preparing",
  Charging: "Charging",
  SuspendedEVSE: "SuspendedEVSE",
  SuspendedEV: "SuspendedEV",
  Finishing: "Finishing",
  Unavailable: "Unavailable",
  Faulted: "Faulted",
  Unknown: "Unknown",
};

function normalizeRoadStatus(raw: unknown): string {
  if (!raw || typeof raw !== "string") return "Unknown";
  return EFLUX_TO_OCPP[raw] ?? EFLUX_TO_OCPP[raw.toLowerCase()] ?? "Unknown";
}

/**
 * Extract the best available status string from a single Road.io connector object.
 * Road.io controllers may store connector status in various fields depending on
 * firmware/version. We check them all and pick the first non-empty value.
 */
function extractConnectorStatus(c: Record<string, unknown>): string {
  // Direct status fields
  const candidates: Array<string | undefined | null> = [
    c.status as string | undefined,
    c.connectorStatus as string | undefined,
    c.ocppStatus as string | undefined,
    c.operationalStatus as string | undefined,
    c.availability as string | undefined,
  ];

  // Some Road.io connectors nest status inside a `state` or `currentStatus` object
  if (c.state && typeof c.state === "object") {
    const stateObj = c.state as Record<string, unknown>;
    candidates.push(stateObj.status as string | undefined);
    candidates.push(stateObj.value as string | undefined);
  }
  if (c.currentStatus && typeof c.currentStatus === "object") {
    const cs = c.currentStatus as Record<string, unknown>;
    candidates.push(cs.status as string | undefined);
    candidates.push(cs.value as string | undefined);
  }
  if (typeof c.currentStatus === "string") {
    candidates.push(c.currentStatus as string);
  }

  for (const raw of candidates) {
    if (raw && typeof raw === "string" && raw.trim() !== "") {
      const normalized = normalizeRoadStatus(raw);
      if (normalized !== "Unknown") return normalized;
    }
  }

  // If nothing yielded a known OCPP status, return the first non-empty raw value
  // so the caller can still attempt normalisation
  for (const raw of candidates) {
    if (raw && typeof raw === "string" && raw.trim() !== "") return raw;
  }

  return "unknown";
}

function deriveStatusFromConnectors(
  connectors: Array<Record<string, unknown>>
): string {
  if (!connectors || connectors.length === 0) return "Unknown";

  const statuses = connectors.map((c) => {
    const raw = extractConnectorStatus(c);
    return normalizeRoadStatus(raw);
  });

  if (statuses.some((s) => s === "Charging")) return "Charging";
  if (statuses.every((s) => s === "Available")) return "Available";
  if (statuses.some((s) => s === "Faulted")) return "Faulted";
  if (statuses.some((s) => s === "Available")) return "Available";
  if (statuses.every((s) => s === "Unavailable")) return "Unavailable";
  // If all statuses resolved to "Unknown", return "Unknown" so the caller
  // can fall back to controller-level connectivity checks.
  return "Unknown";
}

/**
 * Derive OCPP status from the controller-level connectivity fields.
 * Road.io exposes `connectivityState` and `coordinatorStatus` on the
 * controller object itself; these tell us whether the charger is online.
 */
function deriveStatusFromConnectivity(
  ctrl: Record<string, unknown>
): string {
  // 1. Check connectivityState (top-level field)
  const connectivity = (
    ctrl.connectivityState ?? ctrl.connectivity_state ?? ctrl.connectionState
  ) as string | undefined;

  if (connectivity) {
    const lower = connectivity.toLowerCase();
    if (lower === "disconnected" || lower === "offline" || lower === "not_connected") {
      return "Unavailable";
    }
    // "connected" handled below after checking coordinatorStatus
  }

  // 2. Check coordinatorStatus (may be a string or nested object with .state)
  let coordState: string | undefined;
  if (ctrl.coordinatorStatus && typeof ctrl.coordinatorStatus === "object") {
    const coord = ctrl.coordinatorStatus as Record<string, unknown>;
    coordState = (coord.state ?? coord.status ?? coord.value) as string | undefined;
  } else if (typeof ctrl.coordinatorStatus === "string") {
    coordState = ctrl.coordinatorStatus as string;
  }

  if (coordState) {
    const normalized = normalizeRoadStatus(coordState);
    if (normalized !== "Unknown") return normalized;

    const lower = coordState.toLowerCase();
    if (lower === "connected" || lower === "online") return "Available";
    if (lower === "disconnected" || lower === "offline") return "Unavailable";
    if (lower === "error" || lower === "faulted") return "Faulted";
  }

  // 3. Check lastConnectorStatuses (array of status snapshots)
  const lastStatuses = ctrl.lastConnectorStatuses as
    | Array<Record<string, unknown>>
    | undefined;
  if (Array.isArray(lastStatuses) && lastStatuses.length > 0) {
    const derived = deriveStatusFromConnectors(lastStatuses);
    if (derived !== "Unknown") return derived;
  }

  // 4. If connectivity says "connected" but no more specific info, assume Available
  if (connectivity) {
    const lower = connectivity.toLowerCase();
    if (lower === "connected" || lower === "online") {
      return "Available";
    }
  }

  return "Unknown";
}

function detectTerritory(postalCode: string | null | undefined): string | null {
  if (!postalCode) return null;
  const code = postalCode.trim().replace(/\s/g, "");
  if (code.startsWith("971")) return "971";
  if (code.startsWith("972")) return "972";
  if (code.startsWith("973")) return "973";
  if (code.startsWith("974")) return "974";
  return null;
}

function extractRoadId(ctrl: Record<string, unknown>): string | null {
  return (
    (ctrl._id as string) ??
    (ctrl.id as string) ??
    (ctrl.evseControllerId as string) ??
    null
  );
}

// -------------------------------------------------------
// Paginated fetch of all evse-controllers for a given account
// -------------------------------------------------------
async function fetchAllControllers(account: RoadAccountConfig): Promise<{
  controllers: Array<Record<string, unknown>>;
  sample: string;
}> {
  const LIMIT = 100;
  const allControllers: Array<Record<string, unknown>> = [];

  // First page — uses account-specific token + provider
  const firstRes = await roadPostWithAuth(
    "/1/evse-controllers/search",
    { limit: LIMIT, skip: 0 },
    account.apiToken,
    account.providerId
  );

  if (!firstRes.ok) {
    const errText = await firstRes.text();
    throw new Error(
      `ROAD evse-controllers error ${firstRes.status} for ${account.label}: ${errText}`
    );
  }

  const firstData = await firstRes.json();
  const sample = JSON.stringify(firstData).substring(0, 600);

  const firstItems: Array<Record<string, unknown>> =
    firstData?.items ?? firstData?.data ?? firstData?.evseControllers ?? [];
  const total: number =
    firstData?.total ?? firstData?.meta?.total ?? firstData?.count ?? firstItems.length;

  allControllers.push(...firstItems);

  // Paginate remaining pages
  let skip = LIMIT;
  while (allControllers.length < total && skip < total) {
    const pageRes = await roadPostWithAuth(
      "/1/evse-controllers/search",
      { limit: LIMIT, skip },
      account.apiToken,
      account.providerId
    );
    if (!pageRes.ok) break;

    const pageData = await pageRes.json();
    const pageItems: Array<Record<string, unknown>> =
      pageData?.items ?? pageData?.data ?? pageData?.evseControllers ?? [];
    if (pageItems.length === 0) break;

    allControllers.push(...pageItems);
    skip += LIMIT;
  }

  console.log(
    `[road-sync] Fetched ${allControllers.length} / ${total} evse-controllers for ${account.label}`
  );
  return { controllers: allControllers, sample };
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
    total_synced: 0,
    new_stations: 0,
    status_changes: 0,
    skipped: 0,
    errors: [],
  };

  try {
    // 1. Load DB references (only ROAD stations)
    const [
      { data: existingStations },
      { data: territories },
      { data: cpos },
    ] = await Promise.all([
      supabase
        .from("stations")
        .select("id, road_id, ocpp_status")
        .eq("source", "road"),
      supabase.from("territories").select("id, code"),
      supabase.from("cpo_operators").select("id, code, name"),
    ]);

    const stationMap = new Map(
      (existingStations ?? []).map(
        (s: { road_id: string; id: string; ocpp_status: string }) => [
          s.road_id,
          s,
        ]
      )
    );

    const territoryMap = new Map(
      (territories ?? []).map((t: { code: string; id: string }) => [
        t.code,
        t.id,
      ])
    );

    const cpoMap = new Map(
      (cpos ?? []).map((c: { code: string; id: string }) => [c.code, c.id])
    );

    // 2. Iterate over each ROAD account
    const roadAccounts = getRoadAccounts();

    if (roadAccounts.length === 0) {
      return new Response(
        JSON.stringify({
          ...result,
          message: "No ROAD provider IDs configured.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const seenRoadIds = new Set<string>();
    const accountResults: Array<{ label: string; count: number; cpoCode: string }> = [];

    for (const account of roadAccounts) {
      console.log(`[road-sync] Starting sync for ${account.label} (cpo: ${account.cpoCode})`);

      let controllers: Array<Record<string, unknown>> = [];
      let sample = "";

      try {
        const fetched = await fetchAllControllers(account);
        controllers = fetched.controllers;
        sample = fetched.sample;
        if (!result.raw_sample) result.raw_sample = sample;
      } catch (fetchErr) {
        const msg = `Failed to fetch controllers for ${account.label}: ${(fetchErr as Error).message}`;
        console.warn(`[road-sync] ${msg}`);
        result.errors.push(msg);
        continue;
      }

      if (controllers.length === 0) {
        console.warn(`[road-sync] No controllers for ${account.label} – skipping`);
        accountResults.push({ label: account.label, count: 0, cpoCode: account.cpoCode });
        continue;
      }

      // Resolve CPO ID for this account
      const cpoId = cpoMap.get(account.cpoCode) ?? null;
      if (!cpoId) {
        result.errors.push(`CPO code "${account.cpoCode}" not found for ${account.label}`);
        continue;
      }

      let accountSynced = 0;

      // 3. Process each evse-controller
      for (const ctrl of controllers) {
        try {
          const roadId = extractRoadId(ctrl);
          if (!roadId) {
            result.errors.push("Evse-controller missing ID field");
            continue;
          }

          seenRoadIds.add(roadId);

          const name =
            (ctrl.name as string) ??
            (ctrl.chargePointName as string) ??
            (ctrl.displayName as string) ??
            `ROAD-${roadId.slice(-6)}`;

          const location =
            (ctrl.location as Record<string, unknown>) ??
            (ctrl.address as Record<string, unknown>) ??
            {};

          const address =
            (location.address as string) ??
            (location.street as string) ??
            (ctrl.address as string) ??
            null;

          const city =
            (location.city as string) ??
            (ctrl.city as string) ??
            null;

          const postalCode =
            (location.postalCode as string) ??
            (location.zipCode as string) ??
            (ctrl.postalCode as string) ??
            (ctrl.zipCode as string) ??
            null;

          let lat: number | null = null;
          let lng: number | null = null;

          const geometry = (location.geometry ?? ctrl.geometry) as
            | Record<string, unknown>
            | undefined;

          if (
            geometry?.type === "Point" &&
            Array.isArray(geometry?.coordinates)
          ) {
            lng = (geometry.coordinates as number[])[0] ?? null;
            lat = (geometry.coordinates as number[])[1] ?? null;
          } else {
            const rawLat =
              location.latitude ?? location.lat ?? ctrl.latitude ?? ctrl.lat;
            const rawLng =
              location.longitude ?? location.lng ?? ctrl.longitude ?? ctrl.lng;
            if (rawLat !== undefined) lat = parseFloat(rawLat as string) || null;
            if (rawLng !== undefined) lng = parseFloat(rawLng as string) || null;
          }

          const rawConnectors =
            (ctrl.connectors as Array<Record<string, unknown>>) ??
            (ctrl.evses as Array<Record<string, unknown>>) ??
            (ctrl.ports as Array<Record<string, unknown>>) ??
            [];

          let ocppStatus = "Unknown";

          // Step A: Try to derive status from connector-level data
          if (rawConnectors.length > 0) {
            ocppStatus = deriveStatusFromConnectors(rawConnectors);
          }

          // Step B: If connectors didn't yield a known status, try controller-level fields
          if (ocppStatus === "Unknown") {
            const rawStatus = (
              ctrl.status ??
              ctrl.operationalStatus ??
              ctrl.connectorStatus ??
              ctrl.ocppStatus
            ) as string | undefined;
            const fromField = normalizeRoadStatus(rawStatus);
            if (fromField !== "Unknown") {
              ocppStatus = fromField;
            }
          }

          // Step C: Fall back to connectivity / coordinatorStatus fields
          if (ocppStatus === "Unknown") {
            ocppStatus = deriveStatusFromConnectivity(ctrl);
          }

          const connectors = rawConnectors.map(
            (c: Record<string, unknown>, idx: number) => ({
              id: ((c._id ?? c.id ?? `${roadId}-${idx}`) as string),
              type: ((c.standard ?? c.connectorType ?? c.type ?? "Unknown") as string),
              format: ((c.format ?? "Cable") as string),
              status: normalizeRoadStatus(extractConnectorStatus(c)),
              max_power_kw:
                Math.round(
                  (((c.maxPower ?? c.maxElectricPower ?? c.powerKw ?? 0) as number) /
                    1000) *
                    100
                ) / 100,
            })
          );

          const maxPower =
            connectors.length > 0
              ? Math.max(...connectors.map((c) => c.max_power_kw))
              : null;

          const territoryCode = detectTerritory(postalCode);
          const territoryId = territoryCode
            ? (territoryMap.get(territoryCode) ?? null)
            : null;

          const locationId =
            ((location._id ?? location.id ?? ctrl.locationId) as string) ?? null;

          // Road enriched fields (migration 058)
          const ocppIdentity = (ctrl.ocppIdentity ?? ctrl.identity ?? null) as string | null;
          const connectivityState = (ctrl.connectivityState ?? (ctrl.connectivity as Record<string, unknown>)?.state ?? null) as string | null;
          const connectivityStatus = connectivityState === "connected" ? "Online" : null;
          const enablePublic = (ctrl.enablePublicCharging ?? null) as boolean | null;
          const chargerType = enablePublic === true ? "Public" : enablePublic === false ? "Business" : null;
          const setupStatus = ((ctrl.setupProgress as Record<string, unknown>)?.state ?? null) as string | null;
          const accessGroupIds = (ctrl.accessGroupIds ?? []) as string[];
          const roamingCredentialIds = (ctrl.syncOcpiCredentialIds ?? []) as string[];
          const ocppChargingStationId = (ctrl.ocppChargingStationId ?? null) as string | null;
          const numericIdentity = (ctrl.numericIdentity ?? null) as number | null;

          const existing = stationMap.get(roadId);

          if (!existing) {
            // INSERT new ROAD station
            const { error: insertErr } = await supabase
              .from("stations")
              .insert({
                road_id: roadId,
                gfx_id: null,
                source: "road",
                gfx_location_id: locationId,
                name,
                address,
                city,
                postal_code: postalCode,
                latitude: lat,
                longitude: lng,
                cpo_id: cpoId,
                territory_id: territoryId,
                ocpp_status: ocppStatus,
                status_since: new Date().toISOString(),
                is_online: true,
                connectors: JSON.stringify(connectors),
                max_power_kw: maxPower,
                gfx_raw: ctrl,
                last_synced_at: new Date().toISOString(),
                ocpp_identity: ocppIdentity,
                connectivity_status: connectivityStatus,
                charger_type: chargerType,
                setup_status: setupStatus,
                access_group_ids: accessGroupIds,
                roaming_credential_ids: roamingCredentialIds,
                ocpp_charging_station_id: ocppChargingStationId,
                numeric_identity: numericIdentity,
              });

            if (insertErr) {
              result.errors.push(`Insert error ${roadId}: ${insertErr.message}`);
            } else {
              result.new_stations++;
              const { data: newStation } = await supabase
                .from("stations")
                .select("id")
                .eq("road_id", roadId)
                .single();
              if (newStation) {
                await supabase.from("station_status_log").insert({
                  station_id: newStation.id,
                  previous_status: null,
                  new_status: ocppStatus,
                });
              }
            }
          } else {
            // UPDATE existing ROAD station
            const statusChanged = existing.ocpp_status !== ocppStatus;

            const updateData: Record<string, unknown> = {
              last_synced_at: new Date().toISOString(),
              is_online: true,
              gfx_raw: ctrl,
              connectors: JSON.stringify(connectors),
              name,
              address,
              city,
              postal_code: postalCode,
            };

            if (lat !== null) updateData.latitude = lat;
            if (lng !== null) updateData.longitude = lng;
            if (statusChanged) {
              updateData.ocpp_status = ocppStatus;
              updateData.status_since = new Date().toISOString();
            }
            if (cpoId) updateData.cpo_id = cpoId;
            if (territoryId) updateData.territory_id = territoryId;
            if (maxPower !== null) updateData.max_power_kw = maxPower;
            updateData.ocpp_identity = ocppIdentity;
            updateData.connectivity_status = connectivityStatus;
            if (chargerType) updateData.charger_type = chargerType;
            updateData.setup_status = setupStatus;
            updateData.access_group_ids = accessGroupIds;
            updateData.roaming_credential_ids = roamingCredentialIds;
            updateData.ocpp_charging_station_id = ocppChargingStationId;
            updateData.numeric_identity = numericIdentity;

            const { error: updateErr } = await supabase
              .from("stations")
              .update(updateData)
              .eq("road_id", roadId);

            if (updateErr) {
              result.errors.push(`Update error ${roadId}: ${updateErr.message}`);
            }

            if (statusChanged) {
              await supabase.from("station_status_log").insert({
                station_id: existing.id,
                previous_status: existing.ocpp_status,
                new_status: ocppStatus,
              });
              result.status_changes++;
            }
          }

          result.total_synced++;
          accountSynced++;
        } catch (ctrlError) {
          result.errors.push(
            `Controller error (${account.label}): ${(ctrlError as Error).message}`
          );
        }
      }

      accountResults.push({ label: account.label, count: accountSynced, cpoCode: account.cpoCode });
      console.log(`[road-sync] ${account.label}: synced ${accountSynced} controllers → CPO ${account.cpoCode}`);
    }

    // 4. Mark unseen ROAD stations as offline
    if (seenRoadIds.size > 0 && existingStations) {
      const unseenStations = (existingStations as Array<{ road_id: string; id: string }>).filter(
        (s) => !seenRoadIds.has(s.road_id)
      );
      for (const unseen of unseenStations) {
        await supabase
          .from("stations")
          .update({
            is_online: false,
            last_synced_at: new Date().toISOString(),
          })
          .eq("id", unseen.id);
      }
      if (unseenStations.length > 0) {
        console.log(
          `[road-sync] Marked ${unseenStations.length} ROAD stations as offline`
        );
      }
    }

    console.log("[road-sync] Done:", JSON.stringify(result));

    return new Response(JSON.stringify({ ...result, accounts: accountResults }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[road-sync] Fatal error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message, result }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
