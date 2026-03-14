#!/usr/bin/env node
/**
 * GFX CDR Bulk Import Script
 * Imports all CDRs from GreenFlux API into Supabase (ocpi_cdrs table)
 * Run: node scripts/gfx-cdr-bulk-import.js [--offset=0] [--limit=10000]
 */

const { Client } = require("pg");

const GFX_API_KEY = "bVQchVh1l2x9gKyTuDIYE3laHtFmr1JZV9Dn44TOk";
const GFX_BASE_URL = "https://platform.greenflux.com/api/1.0";
const DATABASE_URL = "postgresql://postgres:s3bZiWKGAsqcMpjT@db.phnqtqvwofzrhpuydoom.supabase.co:5432/postgres";

const PAGE_SIZE = 1000;
const BATCH_SIZE = 50;

// Parse CLI args
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [k, v] = arg.replace("--", "").split("=");
  acc[k] = v;
  return acc;
}, {});

const START_OFFSET = parseInt(args.offset ?? "0");
const MAX_CDRS = parseInt(args.limit ?? "999999");

async function gfxFetch(path) {
  const res = await fetch(`${GFX_BASE_URL}${path}`, {
    headers: {
      Authorization: `Token ${GFX_API_KEY}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`GFX API ${res.status}: ${await res.text()}`);
  return res.json();
}

function mapCdr(cdr, stationLookup) {
  const gfxCdrId = cdr.id;
  if (!gfxCdrId) return null;

  const location = cdr.location;
  let stationId = null;
  if (location?.id) {
    stationId = stationLookup.get(location.id) ?? null;
  }

  const authId = cdr.auth_id;
  const authMethod = cdr.auth_method;

  return {
    country_code: cdr.emsp_country_code ?? "FR",
    party_id: "EZD",
    cdr_id: gfxCdrId,
    gfx_cdr_id: gfxCdrId,
    source: "gfx",
    start_date_time: cdr.start_date_time,
    end_date_time: cdr.stop_date_time,
    cdr_token: authId
      ? JSON.stringify({
          uid: authId,
          type: authMethod === "WHITELIST" ? "RFID" : (authMethod ?? "OTHER"),
          contract_id: authId,
        })
      : null,
    cdr_location: location
      ? JSON.stringify({
          id: location.id,
          name: location.name,
          address: location.address,
          city: location.city,
          postal_code: location.postal_code,
          country: location.country ?? "FRA",
          coordinates: location.coordinates,
          evses: location.evses,
        })
      : null,
    total_energy: cdr.total_energy ?? 0,
    total_time: cdr.total_time ?? 0,
    total_parking_time: cdr.total_parking_time ?? 0,
    currency: cdr.currency ?? "EUR",
    total_cost: cdr.total_cost ?? 0,
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
  };
}

function buildUpsertSQL(rows) {
  const columns = [
    "country_code", "party_id", "cdr_id", "gfx_cdr_id", "source",
    "start_date_time", "end_date_time", "cdr_token", "cdr_location",
    "total_energy", "total_time", "total_parking_time", "currency",
    "total_cost", "total_cost_incl_vat", "total_vat", "vat_rate",
    "total_retail_cost", "total_retail_cost_incl_vat", "total_retail_vat", "retail_vat_rate",
    "customer_external_id", "retail_package_id", "custom_groups", "charger_type",
    "driver_external_id", "emsp_country_code", "emsp_party_id", "emsp_external_id",
    "charging_periods", "station_id",
  ];

  const values = [];
  const params = [];
  let paramIdx = 1;

  for (const row of rows) {
    const rowParams = [];
    for (const col of columns) {
      let val = row[col];
      if (col === "custom_groups" && Array.isArray(val)) {
        rowParams.push(`$${paramIdx}::text[]`);
      } else if (col === "cdr_token" || col === "cdr_location") {
        rowParams.push(`$${paramIdx}::jsonb`);
      } else if (col === "charging_periods") {
        rowParams.push(`$${paramIdx}::jsonb`);
      } else {
        rowParams.push(`$${paramIdx}`);
      }
      params.push(val);
      paramIdx++;
    }
    values.push(`(${rowParams.join(", ")})`);
  }

  const updateCols = columns
    .filter((c) => !["country_code", "party_id", "cdr_id"].includes(c))
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(", ");

  return {
    text: `INSERT INTO ocpi_cdrs (${columns.join(", ")}) VALUES ${values.join(", ")}
           ON CONFLICT (country_code, party_id, cdr_id)
           DO UPDATE SET ${updateCols}, last_updated = now()`,
    values: params,
  };
}

async function main() {
  const pg = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await pg.connect();
  console.log("Connected to Supabase PostgreSQL");

  // Build station lookup
  const { rows: stations } = await pg.query(
    "SELECT id, gfx_location_id FROM stations WHERE source = 'gfx' AND gfx_location_id IS NOT NULL"
  );
  const stationLookup = new Map();
  for (const s of stations) {
    stationLookup.set(s.gfx_location_id, s.id);
  }
  console.log(`Station lookup: ${stationLookup.size} entries`);

  // Check existing CDR count
  const { rows: [{ cnt: existingCount }] } = await pg.query(
    "SELECT count(*) as cnt FROM ocpi_cdrs WHERE source = 'gfx'"
  );
  console.log(`Existing GFX CDRs in DB: ${existingCount}`);

  let offset = START_OFFSET;
  let totalFetched = 0;
  let totalUpserted = 0;
  let totalErrors = 0;
  const startTime = Date.now();

  console.log(`\nStarting bulk import from offset ${offset}...`);

  while (totalFetched < MAX_CDRS) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    process.stdout.write(`\r[${elapsed}s] Fetching offset ${offset}...`);

    let data;
    try {
      data = await gfxFetch(`/cdrs?offset=${offset}&limit=${PAGE_SIZE}`);
    } catch (err) {
      console.error(`\nFetch error at offset ${offset}: ${err.message}`);
      totalErrors++;
      break;
    }

    const cdrs = data?.data ?? [];
    if (cdrs.length === 0) {
      console.log(`\nNo more CDRs at offset ${offset}. Done!`);
      break;
    }

    totalFetched += cdrs.length;

    // Map CDRs
    const rows = cdrs.map((c) => mapCdr(c, stationLookup)).filter(Boolean);

    // Batch upsert
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      try {
        const { text, values } = buildUpsertSQL(batch);
        await pg.query(text, values);
        totalUpserted += batch.length;
      } catch (err) {
        console.error(`\nUpsert error at offset ${offset}+${i}: ${err.message}`);
        totalErrors++;
      }
    }

    const rate = (totalFetched / ((Date.now() - startTime) / 1000)).toFixed(0);
    process.stdout.write(
      `\r[${elapsed}s] Fetched: ${totalFetched} | Upserted: ${totalUpserted} | Errors: ${totalErrors} | Rate: ${rate}/s    `
    );

    offset += cdrs.length;

    if (cdrs.length < PAGE_SIZE) {
      console.log(`\nReached end of CDRs (got ${cdrs.length} < ${PAGE_SIZE}).`);
      break;
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  // Update watermark
  await pg.query(
    `UPDATE sync_watermarks SET last_offset = $1, last_synced_at = now(),
     metadata = jsonb_build_object('bulk_import_total', $2, 'bulk_import_upserted', $3, 'bulk_import_duration_s', $4)
     WHERE id = 'gfx-cdr-sync'`,
    [offset, totalFetched, totalUpserted, parseFloat(totalTime)]
  );

  // Final count
  const { rows: [{ cnt: finalCount }] } = await pg.query(
    "SELECT count(*) as cnt FROM ocpi_cdrs WHERE source = 'gfx'"
  );

  console.log(`\n\n========== BULK IMPORT COMPLETE ==========`);
  console.log(`Duration:     ${totalTime}s`);
  console.log(`Fetched:      ${totalFetched}`);
  console.log(`Upserted:     ${totalUpserted}`);
  console.log(`Errors:       ${totalErrors}`);
  console.log(`Final offset: ${offset}`);
  console.log(`GFX CDRs in DB: ${finalCount}`);
  console.log(`==========================================`);

  await pg.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
