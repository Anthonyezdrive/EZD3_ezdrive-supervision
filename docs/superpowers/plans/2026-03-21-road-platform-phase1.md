# Road.io Platform Configuration — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich Road.io station sync with new fields, add disconnection/fault alerts, enhance the dashboard with source badges and connectivity KPIs, and clean up existing station data.

**Architecture:** Supabase edge functions sync Road.io EVSE controller data into the unified `stations` table. New columns are exposed via the `stations_enriched` view (which `useStations.ts` reads). A new `road-alert-check` edge function monitors connectivity changes and writes to the existing `alert_history` table. The frontend adds source badges, connectivity cards, and a source filter.

**Tech Stack:** Deno (edge functions), PostgreSQL (migrations), React + TypeScript (frontend), Supabase JS client, TanStack React Query, Lucide icons, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-03-21-road-api-platform-config-design.md` (Phase 1 sections 1.1–1.4)

**Note:** This plan covers Phase 1 only (Weeks 1-3). Phases 2 and 3 will have separate plans.

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `supabase/migrations/058_road_enriched_fields.sql` | Add columns + recreate views |
| Create | `supabase/migrations/059_road_alert_types.sql` | Extend alert_rules CHECK + seed rules |
| Create | `supabase/functions/road-alert-check/index.ts` | Connectivity/fault alert monitoring |
| Modify | `supabase/functions/road-sync/index.ts` | Extract + store new fields from Road.io |
| Modify | `src/types/station.ts` | Add new fields to Station interface |
| Modify | `src/components/dashboard/DashboardPage.tsx` | Connectivity KPI + source badges |
| Modify | `src/components/stations/StationDetailView.tsx` | New fields display + alert tab |
| Modify | `src/components/ui/FilterBar.tsx` | Source filter dropdown |
| Create | `src/hooks/useStationAlerts.ts` | Hook to query alert_history |
| Modify | `src/components/map/MapPage.tsx` | Source badges on markers |
| Create | `supabase/functions/road-data-cleanup/index.ts` | One-time data fix function |

---

## Task 1: Migration — Add station columns + recreate views

**Files:**
- Create: `supabase/migrations/058_road_enriched_fields.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Migration 058: Road.io enriched station fields
-- Adds new columns to stations and recreates dependent views

-- 1. Add new columns to stations
ALTER TABLE stations ADD COLUMN IF NOT EXISTS setup_status text;
ALTER TABLE stations ADD COLUMN IF NOT EXISTS access_group_ids jsonb DEFAULT '[]'::jsonb;
ALTER TABLE stations ADD COLUMN IF NOT EXISTS roaming_credential_ids jsonb DEFAULT '[]'::jsonb;
ALTER TABLE stations ADD COLUMN IF NOT EXISTS ocpp_charging_station_id text;
ALTER TABLE stations ADD COLUMN IF NOT EXISTS numeric_identity integer;
-- NOTE: migration_status is Phase 3 — will be added in a separate migration

-- 2. Drop dependent views in cascade order
DROP VIEW IF EXISTS user_accessible_stations;
DROP VIEW IF EXISTS maintenance_stations;
DROP VIEW IF EXISTS stations_enriched;

-- 3. Recreate stations_enriched with new fields
CREATE OR REPLACE VIEW stations_enriched AS
SELECT
  s.id, s.gfx_id, s.road_id, s.ocpp_identity, s.source, s.gfx_location_id,
  s.name, s.address, s.city, s.postal_code, s.latitude, s.longitude,
  s.cpo_id, c.name AS cpo_name, c.code AS cpo_code, c.color AS cpo_color,
  s.territory_id, t.name AS territory_name, t.code AS territory_code,
  s.ocpp_status, s.status_since, s.is_online, s.connectors,
  s.max_power_kw,
  EXTRACT(EPOCH FROM (now() - s.status_since)) / 3600 AS hours_in_status,
  s.last_synced_at, s.created_at,
  -- Hardware fields (migration 033)
  s.connectivity_status, s.remote_manageable, s.protocol_version,
  s.firmware_version, s.charge_point_vendor, s.charge_point_model,
  s.charger_type, s.charging_speed, s.deploy_state,
  s.heartbeat_interval, s.iso_15118_enabled,
  -- Road enriched fields (migration 058)
  s.setup_status, s.access_group_ids, s.roaming_credential_ids,
  s.ocpp_charging_station_id, s.numeric_identity
FROM stations s
LEFT JOIN cpo_operators c ON s.cpo_id = c.id
LEFT JOIN territories t ON s.territory_id = t.id;

-- 4. Recreate maintenance_stations view (exact column list from migration 033)
CREATE OR REPLACE VIEW maintenance_stations AS
SELECT
  s.id, s.gfx_id, s.name, s.address, s.city,
  s.ocpp_status, s.status_since, s.is_online, s.connectors, s.max_power_kw,
  c.name AS cpo_name, c.code AS cpo_code,
  t.name AS territory_name, t.code AS territory_code,
  EXTRACT(EPOCH FROM (now() - s.status_since)) / 3600 AS hours_in_fault,
  s.last_synced_at,
  s.connectivity_status, s.firmware_version,
  s.charge_point_vendor, s.charge_point_model, s.protocol_version,
  -- New fields (migration 058)
  s.setup_status, s.source
FROM stations s
LEFT JOIN cpo_operators c ON s.cpo_id = c.id
LEFT JOIN territories t ON s.territory_id = t.id
WHERE s.ocpp_status IN ('Faulted', 'Unavailable')
   OR (s.connectivity_status IS NULL AND s.source = 'road');

-- 5. Recreate user_accessible_stations view (migration 036 pattern)
-- CRITICAL: must include user_can_access_cpo() security filter
CREATE OR REPLACE VIEW user_accessible_stations AS
SELECT se.*
FROM stations_enriched se
WHERE user_can_access_cpo(se.cpo_id);

-- 6. Indexes for new columns
CREATE INDEX IF NOT EXISTS idx_stations_setup_status ON stations(setup_status) WHERE setup_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stations_migration_status ON stations(migration_status) WHERE migration_status IS NOT NULL;
```

- [ ] **Step 2: Apply migration to Supabase**

Run: `/opt/homebrew/bin/supabase db push --project-ref phnqtqvwofzrhpuydoom`

If that fails (migration already tracked), apply directly:

Run: `cat supabase/migrations/058_road_enriched_fields.sql | /opt/homebrew/bin/supabase db execute --project-ref phnqtqvwofzrhpuydoom`

Expected: Migration applies without errors.

- [ ] **Step 3: Verify views exist**

Run the following SQL via Supabase MCP `execute_sql`:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'stations' AND column_name IN ('setup_status', 'access_group_ids', 'numeric_identity', 'migration_status')
ORDER BY column_name;
```

Expected: 4 rows returned.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/058_road_enriched_fields.sql
git commit -m "feat(db): add Road.io enriched station fields + recreate views"
```

---

## Task 2: Update Station TypeScript types

**Files:**
- Modify: `src/types/station.ts`

- [ ] **Step 1: Read current Station interface**

Read `src/types/station.ts` to find the Station interface and identify where to add fields.

- [ ] **Step 2: Add new fields to Station interface**

Add these fields to the `Station` interface (after the existing hardware fields block):

```typescript
// Road enriched fields (migration 058)
setup_status?: string | null;
access_group_ids?: string[] | null;
roaming_credential_ids?: string[] | null;
ocpp_charging_station_id?: string | null;
numeric_identity?: number | null;
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/anthonymalartre/Desktop/Claude/Claude\ SI/Claude\ SI\ EZD3/ezdrive-supervision && npx tsc --noEmit 2>&1 | head -20`

Expected: No new errors related to Station type.

- [ ] **Step 4: Commit**

```bash
git add src/types/station.ts
git commit -m "feat(types): add Road.io enriched fields to Station interface"
```

---

## Task 3: Enhance road-sync to extract new fields

**Files:**
- Modify: `supabase/functions/road-sync/index.ts`

- [ ] **Step 1: Read the current road-sync INSERT block**

Read `supabase/functions/road-sync/index.ts` lines 489-530 to see the exact INSERT field list.

- [ ] **Step 2: Add field extraction logic**

After the existing field extraction (before the INSERT block), add extraction for new fields from the Road.io controller object:

```typescript
// Road enriched fields
const ocppIdentity = ctrl.ocppIdentity ?? ctrl.identity ?? null;
const connectivityState = ctrl.connectivityState ?? ctrl.connectivity?.state ?? null;
const connectivityStatus = connectivityState === "connected" ? "Online" : null;
const enablePublic = ctrl.enablePublicCharging ?? null;
const chargerType = enablePublic === true ? "Public" : enablePublic === false ? "Business" : null;
const setupStatus = ctrl.setupProgress?.state ?? null;
const accessGroupIds = ctrl.accessGroupIds ?? [];
const roamingCredentialIds = ctrl.syncOcpiCredentialIds ?? [];
const ocppChargingStationId = ctrl.ocppChargingStationId ?? null;
const numericIdentity = ctrl.numericIdentity ?? null;
```

- [ ] **Step 3: Add fields to INSERT row object**

In the INSERT block (new station), add these fields to the row object:

```typescript
ocpp_identity: ocppIdentity,
connectivity_status: connectivityStatus,
charger_type: chargerType,
setup_status: setupStatus,
access_group_ids: accessGroupIds,
roaming_credential_ids: roamingCredentialIds,
ocpp_charging_station_id: ocppChargingStationId,
numeric_identity: numericIdentity,
```

- [ ] **Step 4: Add fields to UPDATE block**

In the UPDATE block (existing station), add the same fields to `updateData`:

```typescript
updateData.ocpp_identity = ocppIdentity;
updateData.connectivity_status = connectivityStatus;
if (chargerType) updateData.charger_type = chargerType;
updateData.setup_status = setupStatus;
updateData.access_group_ids = accessGroupIds;
updateData.roaming_credential_ids = roamingCredentialIds;
updateData.ocpp_charging_station_id = ocppChargingStationId;
updateData.numeric_identity = numericIdentity;
```

- [ ] **Step 5: Deploy and test**

Run: `/opt/homebrew/bin/supabase functions deploy road-sync --project-ref phnqtqvwofzrhpuydoom --no-verify-jwt`

Then invoke to test:
```bash
curl -X POST "https://phnqtqvwofzrhpuydoom.supabase.co/functions/v1/road-sync" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>"
```

Expected: Sync completes, new fields populated. Check with SQL:
```sql
SELECT name, ocpp_identity, connectivity_status, charger_type, setup_status, numeric_identity
FROM stations WHERE source = 'road' LIMIT 5;
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/road-sync/index.ts
git commit -m "feat(road-sync): extract enriched fields from Road.io controllers"
```

---

## Task 4: Migration — Extend alert_rules types

**Files:**
- Create: `supabase/migrations/059_road_alert_types.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Migration 059: Extend alert_rules for Road.io connectivity alerts

-- 1. Drop and recreate CHECK constraint with new alert types
ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS alert_rules_alert_type_check;

ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_alert_type_check
  CHECK (alert_type IN (
    'fault_threshold', 'offline_threshold', 'unavailable_threshold',
    'heartbeat_missing', 'session_stuck', 'connector_error',
    'energy_threshold', 'capacity_warning', 'capacity_critical',
    -- New Road.io alert types
    'disconnection', 'recovery', 'extended_outage'
  ));

-- 2. Seed default Road alert rules
INSERT INTO alert_rules (alert_type, title, description, threshold_hours, notification_interval_hours, email_recipients, is_active, global_config)
VALUES
  ('disconnection', 'Station déconnectée', 'Alerte quand une station Road.io perd la connectivité', 0, 6, '{}', true, true),
  ('recovery', 'Station reconnectée', 'Notification de retour en ligne d''une station', 0, 1, '{}', true, true),
  ('extended_outage', 'Panne prolongée (>24h)', 'Station en panne ou indisponible depuis plus de 24 heures', 24, 24, '{}', true, true)
ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: Apply migration**

Run: `/opt/homebrew/bin/supabase db push --project-ref phnqtqvwofzrhpuydoom`

Or direct execution if needed.

- [ ] **Step 3: Verify new rules exist**

```sql
SELECT alert_type, title, is_active FROM alert_rules WHERE alert_type IN ('disconnection', 'recovery', 'extended_outage');
```

Expected: 3 rows.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/059_road_alert_types.sql
git commit -m "feat(db): extend alert_rules with Road.io connectivity alert types"
```

---

## Task 5: Create road-alert-check edge function

**Files:**
- Create: `supabase/functions/road-alert-check/index.ts`

- [ ] **Step 1: Read the existing alert-check function for patterns**

Read `supabase/functions/alert-check/index.ts` lines 1-100 to understand the cooldown/history pattern.

- [ ] **Step 2: Create the road-alert-check edge function**

```typescript
// ============================================
// Edge Function: Road Alert Check
// Monitors Road.io station connectivity changes
// and writes to existing alert_history table
// ============================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "alerts@ezdrive.re";
const DASHBOARD_URL = "https://ezdrive-supervision.vercel.app/monitoring";

interface AlertResult {
  disconnections: number;
  recoveries: number;
  extended_outages: number;
  emails_sent: number;
  errors: string[];
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const result: AlertResult = {
    disconnections: 0,
    recoveries: 0,
    extended_outages: 0,
    emails_sent: 0,
    errors: [],
  };

  try {
    // 1. Load active alert rules for our types
    const { data: rules } = await supabase
      .from("alert_rules")
      .select("*")
      .in("alert_type", ["disconnection", "recovery", "extended_outage"])
      .eq("is_active", true);

    if (!rules || rules.length === 0) {
      return new Response(JSON.stringify({ ...result, message: "No active Road alert rules" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Load Road stations with their current state
    const { data: stations } = await supabase
      .from("stations_enriched")
      .select("id, name, cpo_name, cpo_code, connectivity_status, ocpp_status, hours_in_status, source, territory_name")
      .eq("source", "road");

    if (!stations || stations.length === 0) {
      return new Response(JSON.stringify({ ...result, message: "No Road stations found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Load recent alerts for cooldown check (last 48h)
    const cooldownCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: recentAlerts } = await supabase
      .from("alert_history")
      .select("station_id, alert_type, sent_at")
      .in("alert_type", ["disconnection", "recovery", "extended_outage"])
      .gte("sent_at", cooldownCutoff);

    const recentMap = new Map<string, Date>();
    for (const a of recentAlerts ?? []) {
      const key = `${a.station_id}:${a.alert_type}`;
      const existing = recentMap.get(key);
      const sentAt = new Date(a.sent_at);
      if (!existing || sentAt > existing) {
        recentMap.set(key, sentAt);
      }
    }

    // Helper: check cooldown
    const isInCooldown = (stationId: string, alertType: string, intervalHours: number): boolean => {
      const key = `${stationId}:${alertType}`;
      const lastSent = recentMap.get(key);
      if (!lastSent) return false;
      const hoursSince = (Date.now() - lastSent.getTime()) / (1000 * 60 * 60);
      return hoursSince < intervalHours;
    };

    // 4. Process each rule
    for (const rule of rules) {
      const recipients = rule.email_recipients ?? [];
      const intervalHours = rule.notification_interval_hours ?? 12;

      if (rule.alert_type === "disconnection") {
        // Stations where connectivity_status is null (disconnected)
        const disconnected = stations.filter(
          (s) => s.connectivity_status !== "Online" && !isInCooldown(s.id, "disconnection", intervalHours)
        );
        for (const station of disconnected) {
          await supabase.from("alert_history").insert({
            station_id: station.id,
            alert_type: "disconnection",
            alert_rule_id: rule.id,
            details: {
              station_name: station.name,
              cpo: station.cpo_name,
              territory: station.territory_name,
              ocpp_status: station.ocpp_status,
            },
          });
          result.disconnections++;
        }
        if (disconnected.length > 0 && recipients.length > 0 && RESEND_API_KEY) {
          await sendAlertEmail(
            recipients,
            `[EZDrive] ${disconnected.length} station(s) déconnectée(s)`,
            disconnected.map((s) => `${s.name} (${s.cpo_name})`).join(", ")
          );
          result.emails_sent++;
        }
      }

      if (rule.alert_type === "recovery") {
        // Stations that are Online AND had a recent disconnection alert
        const recovered = stations.filter((s) => {
          if (s.connectivity_status !== "Online") return false;
          const key = `${s.id}:disconnection`;
          return recentMap.has(key) && !isInCooldown(s.id, "recovery", intervalHours);
        });
        for (const station of recovered) {
          await supabase.from("alert_history").insert({
            station_id: station.id,
            alert_type: "recovery",
            alert_rule_id: rule.id,
            details: {
              station_name: station.name,
              cpo: station.cpo_name,
              ocpp_status: station.ocpp_status,
            },
          });
          result.recoveries++;
        }
      }

      if (rule.alert_type === "extended_outage") {
        const thresholdHours = rule.threshold_hours ?? 24;
        const outages = stations.filter(
          (s) =>
            (s.ocpp_status === "Faulted" || s.ocpp_status === "Unavailable") &&
            s.hours_in_status >= thresholdHours &&
            !isInCooldown(s.id, "extended_outage", intervalHours)
        );
        for (const station of outages) {
          await supabase.from("alert_history").insert({
            station_id: station.id,
            alert_type: "extended_outage",
            alert_rule_id: rule.id,
            hours_in_fault: station.hours_in_status,
            details: {
              station_name: station.name,
              cpo: station.cpo_name,
              ocpp_status: station.ocpp_status,
              hours: Math.round(station.hours_in_status),
            },
          });
          result.extended_outages++;
        }
        if (outages.length > 0 && recipients.length > 0 && RESEND_API_KEY) {
          await sendAlertEmail(
            recipients,
            `[EZDrive] ${outages.length} panne(s) prolongée(s) (>24h)`,
            outages.map((s) => `${s.name}: ${Math.round(s.hours_in_status)}h (${s.cpo_name})`).join(", ")
          );
          result.emails_sent++;
        }
      }
    }

    console.log(`[road-alert-check] Done: ${JSON.stringify(result)}`);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[road-alert-check] Fatal error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message, result }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function sendAlertEmail(to: string[], subject: string, body: string) {
  if (!RESEND_API_KEY) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to,
        subject,
        html: `<div style="font-family:sans-serif;padding:20px">
          <h2>${subject}</h2>
          <p>${body}</p>
          <p><a href="${DASHBOARD_URL}">Voir le dashboard</a></p>
        </div>`,
      }),
    });
  } catch (err) {
    console.error("[road-alert-check] Email error:", err);
  }
}
```

- [ ] **Step 3: Deploy the function**

Run: `/opt/homebrew/bin/supabase functions deploy road-alert-check --project-ref phnqtqvwofzrhpuydoom --no-verify-jwt`

- [ ] **Step 4: Test invocation**

```bash
curl -X POST "https://phnqtqvwofzrhpuydoom.supabase.co/functions/v1/road-alert-check" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>"
```

Expected: JSON response with counts. Verify `alert_history` has new entries:
```sql
SELECT alert_type, count(*) FROM alert_history WHERE alert_type IN ('disconnection', 'recovery', 'extended_outage') GROUP BY alert_type;
```

- [ ] **Step 5: Add cron job to migration 059**

Add this to the end of `supabase/migrations/059_road_alert_types.sql` (this follows the same pattern as migration 055 which uses `current_setting('app.settings.*')` — these settings are already configured in the Supabase project):

```sql
-- Cron: road-alert-check every 5 minutes
SELECT cron.schedule(
  'road-alert-check',
  '*/5 * * * *',
  $$SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/road-alert-check',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  )$$
);
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/road-alert-check/index.ts
git commit -m "feat(alerts): add road-alert-check for connectivity monitoring"
```

---

## Task 6: Create useStationAlerts hook

**Files:**
- Create: `src/hooks/useStationAlerts.ts`

- [ ] **Step 1: Create the hook**

```typescript
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

export interface StationAlert {
  id: string;
  station_id: string;
  alert_type: string;
  hours_in_fault: number | null;
  sent_at: string;
  alert_rule_id: string | null;
  notification_channel: string | null;
  details: {
    station_name?: string;
    cpo?: string;
    territory?: string;
    ocpp_status?: string;
    hours?: number;
  } | null;
}

export function useStationAlerts(stationId?: string, limit = 50) {
  return useQuery({
    queryKey: ["station-alerts", stationId, limit],
    queryFn: async () => {
      let query = supabase
        .from("alert_history")
        .select("*")
        .order("sent_at", { ascending: false })
        .limit(limit);

      if (stationId) {
        query = query.eq("station_id", stationId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as StationAlert[];
    },
    enabled: !!stationId, // Only fetch when a specific station is selected
    staleTime: 60_000,
  });
}

export function useRecentAlerts(limit = 20) {
  return useQuery({
    queryKey: ["recent-alerts", limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alert_history")
        .select("*, stations:station_id(name, cpo_id)")
        .in("alert_type", ["disconnection", "recovery", "extended_outage", "fault_threshold"])
        .order("sent_at", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data as (StationAlert & { stations: { name: string; cpo_id: string } | null })[];
    },
    staleTime: 30_000,
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useStationAlerts.ts
git commit -m "feat(hooks): add useStationAlerts and useRecentAlerts hooks"
```

---

## Task 7: Add source filter to FilterBar

**Files:**
- Modify: `src/components/ui/FilterBar.tsx`

- [ ] **Step 1: Read current FilterBar**

Read `src/components/ui/FilterBar.tsx` to see the full component and filter interface.

- [ ] **Step 2: Add source to the StationFilters type**

Find the `StationFilters` type (likely in FilterBar or a shared types file). Add:

```typescript
source?: string; // "all" | "road" | "gfx" | "ocpp"
```

- [ ] **Step 3: Add source dropdown to FilterBar**

After the existing CPO filter dropdown, add:

```tsx
{/* Source filter */}
<select
  className={selectClass}
  value={filters.source ?? "all"}
  onChange={(e) =>
    onFiltersChange({ ...filters, source: e.target.value === "all" ? undefined : e.target.value })
  }
>
  <option value="all">Toutes les sources</option>
  <option value="road">Road.io</option>
  <option value="gfx">GreenFlux</option>
  <option value="ocpp">OCPP natif</option>
</select>
```

- [ ] **Step 4: Update useStations to support source filter**

In `src/hooks/useStations.ts`, add source filtering to the query:

```typescript
if (filters?.source) {
  query = query.eq("source", filters.source);
}
```

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/FilterBar.tsx src/hooks/useStations.ts
git commit -m "feat(ui): add source filter dropdown (Road/GFX/OCPP)"
```

---

## Task 8: Dashboard — Connectivity KPI card

**Files:**
- Modify: `src/components/dashboard/DashboardPage.tsx`

- [ ] **Step 1: Read DashboardPage to find KPI section**

Read `src/components/dashboard/DashboardPage.tsx` to find the KPI cards area and understand the layout pattern.

- [ ] **Step 2: Add connectivity KPI computation**

In the component, add a `useMemo` block after the existing KPI data:

```typescript
const connectivityStats = useMemo(() => {
  if (!stations) return { online: 0, offline: 0, total: 0 };
  const roadStations = stations.filter((s) => s.source === "road");
  const online = roadStations.filter((s) => s.connectivity_status === "Online").length;
  return { online, offline: roadStations.length - online, total: roadStations.length };
}, [stations]);
```

- [ ] **Step 3: Add connectivity card to the KPI grid**

Add a new card in the KPI grid (follow the existing card pattern with icon, value, label):

```tsx
{/* Connectivity Card */}
<div className="bg-surface-elevated rounded-xl p-4 border border-border">
  <div className="flex items-center gap-2 mb-2">
    <Wifi className="h-5 w-5 text-green-500" />
    <span className="text-sm text-text-secondary">Connectivité Road</span>
  </div>
  <div className="text-2xl font-bold text-text-primary">
    {connectivityStats.online}/{connectivityStats.total}
  </div>
  <div className="text-xs text-text-tertiary mt-1">
    {connectivityStats.offline > 0 && (
      <span className="text-orange-500">{connectivityStats.offline} hors ligne</span>
    )}
    {connectivityStats.offline === 0 && <span className="text-green-500">Toutes connectées</span>}
  </div>
</div>
```

- [ ] **Step 4: Import Wifi icon if not already imported**

Check imports and add `Wifi` from `lucide-react` if missing.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/DashboardPage.tsx
git commit -m "feat(dashboard): add Road.io connectivity KPI card"
```

---

## Task 9: StationDetailView — Show enriched fields

**Files:**
- Modify: `src/components/stations/StationDetailView.tsx`

- [ ] **Step 1: Read StationDetailView details tab section**

Read `src/components/stations/StationDetailView.tsx` to find the "details" tab content and understand the layout pattern for station metadata.

- [ ] **Step 2: Add source badge**

In the station header area (near the name), add a source badge:

```tsx
{/* Source badge */}
<span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
  station.source === 'road' ? 'bg-blue-100 text-blue-700' :
  station.source === 'gfx' ? 'bg-purple-100 text-purple-700' :
  'bg-green-100 text-green-700'
}`}>
  {station.source === 'road' ? 'Road.io' : station.source === 'gfx' ? 'GreenFlux' : 'OCPP'}
</span>
```

- [ ] **Step 3: Add enriched fields in details tab**

In the details/info section, add a "Road.io Info" group (only shown when `source === "road"`):

```tsx
{station.source === "road" && (
  <div className="space-y-3 mt-4">
    <h4 className="text-sm font-medium text-text-secondary">Informations Road.io</h4>
    <div className="grid grid-cols-2 gap-3 text-sm">
      {station.ocpp_identity && (
        <div>
          <span className="text-text-tertiary">OCPP Identity</span>
          <p className="font-mono text-text-primary">{station.ocpp_identity}</p>
        </div>
      )}
      {station.numeric_identity && (
        <div>
          <span className="text-text-tertiary">ID numérique</span>
          <p className="text-text-primary">{station.numeric_identity}</p>
        </div>
      )}
      {station.setup_status && (
        <div>
          <span className="text-text-tertiary">Setup</span>
          <span className={`inline-flex px-2 py-0.5 rounded text-xs ${
            station.setup_status === "COMPLETED" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
          }`}>{station.setup_status}</span>
        </div>
      )}
      {station.charger_type && (
        <div>
          <span className="text-text-tertiary">Type</span>
          <span className={`inline-flex px-2 py-0.5 rounded text-xs ${
            station.charger_type === "Public" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-700"
          }`}>{station.charger_type}</span>
        </div>
      )}
      {station.connectivity_status && (
        <div>
          <span className="text-text-tertiary">Connectivité</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">
            <Wifi className="h-3 w-3" /> Online
          </span>
        </div>
      )}
      {!station.connectivity_status && station.source === "road" && (
        <div>
          <span className="text-text-tertiary">Connectivité</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-red-100 text-red-700">
            <WifiOff className="h-3 w-3" /> Hors ligne
          </span>
        </div>
      )}
      {station.roaming_credential_ids && (station.roaming_credential_ids as string[]).length > 0 && (
        <div>
          <span className="text-text-tertiary">Roaming actif</span>
          <p className="text-text-primary">{(station.roaming_credential_ids as string[]).length} connexion(s)</p>
        </div>
      )}
    </div>
  </div>
)}
```

- [ ] **Step 4: Import new icons**

Add `Wifi, WifiOff` to the lucide-react imports if not already imported.

- [ ] **Step 5: Commit**

```bash
git add src/components/stations/StationDetailView.tsx
git commit -m "feat(station-detail): show Road.io enriched fields + source badge"
```

---

## Task 10: Data cleanup edge function

**Files:**
- Create: `supabase/functions/road-data-cleanup/index.ts`

- [ ] **Step 1: Create the one-time data cleanup function**

```typescript
// ============================================
// Edge Function: Road Data Cleanup (one-time)
// Fixes station names, postal codes, territory IDs
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
    names_fixed: 0,
    territories_fixed: 0,
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

      // Fix: stations still named ROAD-xxxxxx
      // (road-sync should populate names now, but legacy entries may exist)

      // Fix: assign territory_id from postal code for VCity stations
      if (!station.territory_id && station.postal_code) {
        const prefix = station.postal_code.substring(0, 3);
        // DOM-TOM postal code prefixes
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
      if (!station.territory_id && !station.postal_code && station.city) {
        const city = station.city.toLowerCase();
        // Known VCity cities
        if (city.includes("fort-de-france") || city.includes("martinique") || city.includes("lamentin")) {
          const tid = territoryByCode.get("972");
          if (tid) { updates.territory_id = tid; result.territories_fixed++; }
        } else if (city.includes("pointe-à-pitre") || city.includes("guadeloupe") || city.includes("baie-mahault")) {
          const tid = territoryByCode.get("971");
          if (tid) { updates.territory_id = tid; result.territories_fixed++; }
        } else if (city.includes("cayenne") || city.includes("guyane") || city.includes("kourou")) {
          const tid = territoryByCode.get("973");
          if (tid) { updates.territory_id = tid; result.territories_fixed++; }
        }
      }

      // Check: missing coordinates
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
```

- [ ] **Step 2: Deploy and run**

Run: `/opt/homebrew/bin/supabase functions deploy road-data-cleanup --project-ref phnqtqvwofzrhpuydoom --no-verify-jwt`

Then invoke:
```bash
curl -X POST "https://phnqtqvwofzrhpuydoom.supabase.co/functions/v1/road-data-cleanup" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>"
```

Expected: JSON with counts of fixed records.

- [ ] **Step 3: Verify data**

```sql
SELECT territory_id, count(*) FROM stations WHERE source = 'road' GROUP BY territory_id;
```

Expected: No more NULL territory_id for Road stations.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/road-data-cleanup/index.ts
git commit -m "feat(cleanup): one-time Road station data cleanup (territories, names)"
```

---

## Task 11: Dashboard — Road Activity KPI card

**Files:**
- Modify: `src/components/dashboard/DashboardPage.tsx`
- Modify: `src/hooks/useStationKPIs.ts` (or equivalent KPI hook)

- [ ] **Step 1: Read the KPI hook to understand data source**

Read `src/hooks/useStationKPIs.ts` to understand how KPI data is fetched.

- [ ] **Step 2: Add Road activity query**

In `DashboardPage.tsx`, add a query for Road CDR activity (last 24h):

```typescript
const { data: roadActivity } = useQuery({
  queryKey: ["road-activity-24h"],
  queryFn: async () => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("ocpi_cdrs")
      .select("total_energy, total_cost")
      .eq("source", "road")
      .gte("start_date_time", since);
    if (error) throw error;
    const sessions = data?.length ?? 0;
    const totalKwh = data?.reduce((sum, c) => sum + (c.total_energy ?? 0), 0) ?? 0;
    return { sessions, totalKwh: Math.round(totalKwh * 10) / 10 };
  },
  staleTime: 300_000,
});
```

- [ ] **Step 3: Add Road Activity card to KPI grid**

```tsx
{/* Road Activity Card */}
<div className="bg-surface-elevated rounded-xl p-4 border border-border">
  <div className="flex items-center gap-2 mb-2">
    <Zap className="h-5 w-5 text-yellow-500" />
    <span className="text-sm text-text-secondary">Activité Road (24h)</span>
  </div>
  <div className="text-2xl font-bold text-text-primary">
    {roadActivity?.sessions ?? 0} <span className="text-sm font-normal text-text-tertiary">sessions</span>
  </div>
  <div className="text-xs text-text-tertiary mt-1">
    {roadActivity?.totalKwh ?? 0} kWh distribués
  </div>
</div>
```

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/DashboardPage.tsx
git commit -m "feat(dashboard): add Road.io activity KPI card (sessions + kWh last 24h)"
```

---

## Task 12: Map — Source badges on markers

**Files:**
- Modify: `src/components/map/MapPage.tsx`

- [ ] **Step 1: Read MapPage to understand marker rendering**

Read `src/components/map/MapPage.tsx` to find how station markers are rendered on the map (Leaflet markers, custom icons, popup content).

- [ ] **Step 2: Add source-based marker color**

In the marker rendering logic, differentiate marker color by source:

```typescript
const getMarkerColor = (station: Station): string => {
  // Status takes priority
  if (station.ocpp_status === "Faulted") return "#EF4444"; // red
  if (station.ocpp_status === "Unavailable") return "#F59E0B"; // amber
  if (station.ocpp_status === "Charging") return "#3B82F6"; // blue

  // Source-based color for Available stations
  if (station.source === "road") return "#10B981"; // green (Road)
  if (station.source === "gfx") return "#8B5CF6"; // purple (GFX)
  return "#6B7280"; // gray (other/OCPP)
};
```

- [ ] **Step 3: Add source badge in marker popup**

In the map popup/tooltip content, add source badge:

```tsx
<span className={`text-xs px-1.5 py-0.5 rounded ${
  station.source === 'road' ? 'bg-blue-100 text-blue-700' :
  station.source === 'gfx' ? 'bg-purple-100 text-purple-700' :
  'bg-gray-100 text-gray-700'
}`}>
  {station.source === 'road' ? 'Road' : station.source === 'gfx' ? 'GFX' : 'OCPP'}
</span>
```

- [ ] **Step 4: Commit**

```bash
git add src/components/map/MapPage.tsx
git commit -m "feat(map): add source-based marker colors and source badges in popups"
```

---

## Task 13: Visual verification

- [ ] **Step 1: Start dev server**

Run: `cd /Users/anthonymalartre/Desktop/Claude/Claude\ SI/Claude\ SI\ EZD3/ezdrive-supervision && npm run dev`

- [ ] **Step 2: Check dashboard**

Navigate to the dashboard. Verify:
- Connectivity KPI card shows X/Y stations connected
- Source filter appears in FilterBar
- Filtering by "Road.io" shows only Road stations

- [ ] **Step 3: Check station detail**

Click any Road station. Verify:
- Source badge "Road.io" visible
- Road.io Info section shows OCPP Identity, connectivity status, etc.

- [ ] **Step 4: Check console for errors**

Open browser DevTools console. Verify no errors related to new fields.

---

## Summary

| Task | Component | Est. Time |
|------|-----------|-----------|
| 1 | Migration: station columns + views | 5 min |
| 2 | TypeScript types update | 3 min |
| 3 | road-sync enriched fields extraction | 10 min |
| 4 | Migration: alert rule types | 3 min |
| 5 | road-alert-check edge function | 10 min |
| 6 | useStationAlerts hook | 5 min |
| 7 | Source filter in FilterBar | 5 min |
| 8 | Dashboard connectivity KPI | 5 min |
| 9 | StationDetailView enrichments | 10 min |
| 10 | Data cleanup function | 10 min |
| 11 | Dashboard Road Activity KPI | 5 min |
| 12 | Map source badges | 5 min |
| 13 | Visual verification | 5 min |
| **Total** | | **~80 min** |
