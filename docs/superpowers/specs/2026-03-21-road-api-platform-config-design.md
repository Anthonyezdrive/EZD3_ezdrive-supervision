# Road.io API Platform Configuration — Design Spec

**Date**: 2026-03-21
**Scope**: EZDrive Reunion (974) + VCity AG (971/972/973) via Road.io API
**Horizon**: 6 mois (3 phases)
**Status**: Approved

---

## Context

EZDrive Supervision manages charging infrastructure across multiple CPOs. Two sub-CPOs — **EZDrive Reunion** (73 stations, Reunion 974) and **VCity AG** (22 stations, Martinique/Guadeloupe/Guyane) — are connected via the Road.io (E-Flux) API with full credentials.

Current state:
- Station sync working (95 stations, real-time statuses)
- CDR sync working (192 sessions, 111 linked to stations)
- Multi-account isolation implemented (`road-client.ts`)
- Crons active (road-sync 5min, road-cdr-sync 6h)
- VCity has 0 CPO sessions (pending Road.io support response)

Other CPOs (EZDrive AG, TotalEnergies, etc.) remain on GreenFlux. Long-term, stations will progressively migrate to EZDrive's native OCPP server.

## Architecture

```
Frontend (React)
  Dashboard | B2B Portal | Mobile API
         |
  Unified Supabase Layer
  stations | ocpi_cdrs | ocpi_tokens | consumer_profiles
  (source: gfx | road | ocpp)
         |
  +-------+-------+-------+
  |  GFX  | Road  | OCPP  |
  |  API  |  API  | natif |
  +-------+-------+-------+
```

Each sync writes to the same tables with `source` field for traceability. The frontend consumes the unified layer — it never calls Road/GFX directly. Road.io is exclusively for EZDrive Reunion and VCity AG.

---

## Phase 1 — Foundations (Weeks 1-3)

### 1.1 Enriched Station Sync

Add new columns to `stations` table and populate them from Road.io controller data:

| Road.io field | DB column | Type | Purpose |
|---|---|---|---|
| `ocppIdentity` | `ocpp_identity` | text | OCPP chargepoint ID |
| `connectivityState` | `connectivity_status` | text | "connected"/"disconnected" |
| `setupProgress.state` | `setup_status` | text | "COMPLETED"/"IN_PROGRESS" |
| `enablePublicCharging` | `is_public` | boolean | Public vs private |
| `accessGroupIds` | `access_group_ids` | jsonb | Road access group refs |
| `syncOcpiCredentialIds` | `roaming_credential_ids` | jsonb | Active roaming connections |
| `ocppChargingStationId` | `ocpp_charging_station_id` | text | Road internal UUID |
| `numericIdentity` | `numeric_identity` | integer | Road numeric ID |

**Files changed:**
- Migration SQL: add columns to `stations`
- `supabase/functions/road-sync/index.ts`: extract and store new fields
- `src/types/station.ts`: add new fields to Station type

### 1.2 Alert System

**New edge function: `road-alert-check`** (cron every 5 minutes)

Alert types:
- **Disconnection**: `connectivity_status` changes from "connected" to "disconnected"
- **Fault**: `ocpp_status` changes to "Faulted"
- **Recovery**: station returns to "Available"
- **Extended outage**: "Unavailable" or "Faulted" for > 24h

**New table: `station_alerts`**

| Column | Type | Description |
|---|---|---|
| id | uuid PK | |
| station_id | uuid FK | Reference to station |
| alert_type | text | "disconnection" / "fault" / "recovery" / "extended_outage" |
| severity | text | "info" / "warning" / "critical" |
| message | text | Human-readable description |
| metadata | jsonb | Previous/new status, duration, etc. |
| acknowledged | boolean | Has operator seen it |
| acknowledged_by | uuid FK | User who acknowledged |
| created_at | timestamptz | Alert timestamp |
| resolved_at | timestamptz | When resolved (null if active) |

**Files created:**
- Migration SQL: `station_alerts` table
- `supabase/functions/road-alert-check/index.ts`
- Cron: pg_cron schedule every 5 min

### 1.3 Dashboard Enrichments

**KPI additions (DashboardPage):**
- "Connectivity" card: X connected / Y disconnected (by CPO)
- "Road Activity" card: CPO sessions last 24h, total kWh
- Source badge on map markers (Road / GFX / OCPP icon/color)
- Source filter in FilterBar

**Station Detail View enrichments (StationDetailView):**
- Source badge (Road / GFX / OCPP)
- OCPP Identity + Numeric Identity
- Setup status (COMPLETED / IN_PROGRESS)
- Public/private badge
- Active roaming credentials count
- Last connection timestamp
- Alert history tab

**Files changed:**
- `src/components/dashboard/DashboardPage.tsx`
- `src/components/stations/StationDetailView.tsx`
- `src/components/ui/FilterBar.tsx`
- `src/components/map/MapPage.tsx`
- `src/hooks/useStations.ts`
- `src/hooks/useStationAlerts.ts` (new)

### 1.4 Data Cleanup

- Rename auto-generated station names (`ROAD-xxxxxx`) with Road.io `name` field (already done in sync, but retroactive cleanup needed)
- Complete missing `postal_code` from Road.io location data
- Assign correct `territory_id` for VCity stations (972 Martinique, 971 Guadeloupe, 973 Guyane) based on postal codes and city names
- Verify all 95 stations have lat/lng coordinates

**Files:** One-time migration SQL + data fix edge function.

---

## Phase 2 — Exploitation (Month 1-2)

### 2.1 Token Sync

**New edge function: `road-token-sync`** (cron every 6h)

Endpoint: `POST /1/tokens/search` — ~1226 tokens VCity, ~200 Reunion.

Ingests into existing `ocpi_tokens` table:

| Road.io field | DB column | Notes |
|---|---|---|
| `uid` | `uid` | RFID identifier |
| `contractId` | `contract_id` | eMSP contract |
| `type` | `type` | RFID / APP_USER / AD_HOC |
| `status` | `status` | ACTIVE / BLOCKED / EXPIRED |
| `visualNumber` | `visual_number` | Printed number on card |
| `issuer` | `issuer` | EZDrive / VCity |
| `lastUpdated` | `last_updated` | Timestamp |

Deduplication with existing GFX tokens via `uid` match. `source: "road"`, `cpo_id` per account.

**Frontend (RfidPage):**
- Unified display of Road + GFX tokens
- Filter by source, CPO, status
- Block/Unblock action via Road API (`/1/tokens/{id}/block`)

**Files:**
- `supabase/functions/road-token-sync/index.ts` (new)
- Migration SQL: add `road_account_id`, `visual_number`, `issuer` to `ocpi_tokens`
- `src/components/rfid/RfidPage.tsx` (enhance)
- `src/hooks/useTokens.ts` (new or enhance)

### 2.2 Driver/Account Sync

**New edge function: `road-driver-sync`** (cron daily)

Endpoint: `POST /1/accounts/search` — 904 accounts VCity, ~50 Reunion.

Enriches `consumer_profiles` table:

| Road.io field | DB column | Notes |
|---|---|---|
| `firstName` + `lastName` | `full_name` | Full name |
| `email` | `email` | Contact |
| `_id` | `road_account_id` | New column |
| `status` | `status` | Active/inactive |
| `billingPlan.name` | `billing_plan` | New column |

Join path: `consumer_profiles` ↔ `ocpi_tokens` (via road_account_id) ↔ `ocpi_cdrs` (via token uid or driver_external_id) for full driver journey.

**Frontend (DriversPage + CustomerDetailPage):**
- Unified driver view (GFX + Road)
- Driver detail: associated tokens, charge history, billing plan
- CSV export by CPO

**Files:**
- `supabase/functions/road-driver-sync/index.ts` (new)
- Migration SQL: add columns to `consumer_profiles`
- `src/components/customers/DriversPage.tsx` (enhance)
- `src/components/customers/CustomerDetailPage.tsx` (enhance)
- `src/hooks/useDrivers.ts` (new or enhance)

### 2.3 Tariff Sync

**New edge function: `road-tariff-sync`** (cron daily)

Endpoints: `POST /1/tariff-profiles/search` + `POST /1/billing-plans/search`

Ingests into existing `ocpi_tariffs` table:
- Price per kWh, per session, per parking minute
- Tariff ↔ station link (via `accessGroupIds`)
- Tariff ↔ billing plan ↔ user chain

**Frontend (TariffsPage):**
- Road tariffs by CPO (Reunion / VCity)
- Station → applied tariff view
- Driver → billing plan → effective tariff
- Public vs B2B tariff comparison

**Files:**
- `supabase/functions/road-tariff-sync/index.ts` (new)
- `src/components/tariffs/TariffsPage.tsx` (enhance)
- `src/hooks/useTariffs.ts` (new or enhance)

### 2.4 B2B Portal Enrichments

With tokens + drivers + tariffs + station-linked CDRs:

- **B2BSessionsPage**: show exact station name, driver name, token used, tariff applied
- **B2BMonthlyPage**: breakdown by VCity station (VITO Cluny, VITO Versailles, etc.)
- **B2BDriversPage**: RUBIS driver list with individual consumption
- **New metrics**: utilization rate per station, peak hours, most active drivers

RUBIS billing (VCity AG):
- Once CPO sessions become available (pending Road.io response), generate detailed invoices via existing `InvoiceGenerationWizard`
- Until then, display available MSP session data and station utilization metrics

### 2.5 Consolidated Cron Schedule

| Cron | Frequency | Function | Scope |
|---|---|---|---|
| `road-sync` | 5 min | Stations + statuses | Reunion + VCity |
| `road-alert-check` | 5 min | Disconnect/fault alerts | Reunion + VCity |
| `road-cdr-sync` | 6h | Sessions/CDRs | Reunion + VCity |
| `road-token-sync` | 6h | RFID/APP tokens | Reunion + VCity |
| `road-driver-sync` | 24h | User accounts | Reunion + VCity |
| `road-tariff-sync` | 24h | Tariffs + billing plans | Reunion + VCity |

All crons use the multi-account pattern from `road-client.ts` with hermetic CPO isolation.

---

## Phase 3 — Complete Platform (Month 2-6)

### 3.1 Progressive OCPP Migration

Stations currently managed via Road.io will progressively migrate to EZDrive's native OCPP server (Fly.io Paris CDG).

**Migration steps per station:**
1. Inventory: identify migrable stations via `ocpp_identity` from road-sync
2. Dual-listen: configure station to send OCPP to both Road.io AND EZDrive server
3. Switchover: change OCPP URL in station config (via Road API ChangeConfiguration or manual)
4. Completion: station becomes `source: "ocpp"`, Road.io data becomes historical

**New DB fields:**
- `stations.migration_status`: `null | "planned" | "dual" | "migrated"`

**New admin page: "OCPP Migration"**
- List of stations with migration status
- "Start migration" button per station
- Post-migration health comparison (Road vs OCPP data)

### 3.2 Access Groups

**New edge function: `road-access-group-sync`** (cron daily)

Endpoint: `POST /1/access-groups/search`

**New tables:**

`access_group_members`:
| Column | Type |
|---|---|
| access_group_id | uuid FK |
| token_id | uuid FK |
| account_id | uuid FK |

`access_group_stations`:
| Column | Type |
|---|---|
| access_group_id | uuid FK |
| station_id | uuid FK |

`access_group_rules`:
| Column | Type |
|---|---|
| access_group_id | uuid FK |
| rule_type | text |
| rule_config | jsonb |

**Frontend (AccessGroupsPage):**
- View Road access groups by CPO
- Edit members (add/remove token)
- Edit station assignments
- Write-back via Road API: `PUT /1/access-groups/{id}`

### 3.3 Smart Charging

Road API: `POST /1/evse-controllers/{id}/smart-charging`

**Features:**
- Power limitation per station (site load balancing)
- Scheduled charging profiles (off-peak/peak)
- Priority by access group (e.g., RUBIS fleet first)

**Frontend (SmartChargingPage):**
- Active profiles per site
- Configuration: site max power, distribution across stations
- Time-based scheduling
- Real-time distributed charge monitoring

### 3.4 Mobile API for End Users

Expose edge functions consumed by the existing React Native mobile app. No direct Road/GFX calls — all through unified Supabase layer.

| Endpoint | Method | Description |
|---|---|---|
| `/api/me/sessions` | GET | Driver's charge history |
| `/api/me/tokens` | GET | My RFID tokens |
| `/api/me/tokens/{id}/block` | POST | Report lost token |
| `/api/me/invoices` | GET | My invoices |
| `/api/stations/nearby` | GET | Nearby stations (lat/lng/radius) |
| `/api/stations/{id}/availability` | GET | Real-time availability |

Data source: unified Supabase tables, filtered by authenticated user's `consumer_profile`.

### 3.5 Energy Mix & CSR Reporting

Combine Road.io meter values with local energy mix data:

| Territory | Renewable % | Source |
|---|---|---|
| Reunion (974) | ~35% | Solar, hydro |
| Martinique (972) | ~25% | Wind, solar |
| Guadeloupe (971) | ~30% | Geothermal, solar |
| Guyane (973) | ~65% | Hydro |

**Features:**
- CO2 avoided per session (vs thermal vehicle)
- "Green charge" badge when mix > 50% renewable
- Exportable CSR report for B2B clients (RUBIS)
- EnergyMixPage with real consumption data

### 3.6 Monitoring & Observability

**Operational dashboard:**
- Uptime per station: % Available over 30 days (SLA)
- Mean time to resolution: average fault duration
- Usage heatmap: which stations, which hours, which days
- Escalated alerts: Faulted > 4h → notify Frantz. > 24h → notify Jean-Luc.
- CPO comparison: Reunion vs VCity side-by-side metrics

**Sync health:**
- Admin page showing each cron's status (last run, result, errors)
- Alert if sync fails 3 consecutive times
- Watermark dashboard (offset, last date, remaining sessions)

---

## Constraints & Decisions

1. **Road.io = EZDrive Reunion + VCity AG only.** Other CPOs stay on GreenFlux.
2. **Hermetic CPO isolation** maintained at every level (DB, edge functions, frontend filters).
3. **GFX coexistence** — both APIs active. No GFX deprecation. Unified via `source` field.
4. **Progressive OCPP migration** — stations move from Road → OCPP natif over time, not big-bang.
5. **VCity CPO sessions** — 0 available currently. Plan accounts for this data gap; facturation features degrade gracefully.
6. **Mobile app** — consumes unified Supabase layer, never calls Road/GFX directly.
7. **All new edge functions** follow the multi-account pattern from `road-client.ts` with `getRoadAccounts()`.

## Success Criteria

- **Phase 1**: 95 stations with real statuses, alerts firing on disconnections, dashboard shows source badges
- **Phase 2**: 1400+ tokens synced, 950+ drivers imported, tariffs visible, B2B portal shows per-station metrics
- **Phase 3**: First station migrated to OCPP natif, mobile API serving driver history, SLA dashboard operational
