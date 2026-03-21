-- ============================================================
-- Migration 060: Road.io Phase 2 Schema Extensions
-- Token sync: road_token_id on gfx_tokens
-- Driver sync: road_account_id + billing_plan on gfx_consumers
-- Tariff sync: source + road_tariff_id + cpo_id on ocpi_tariffs
-- ============================================================

-- 1. gfx_tokens: add Road-specific fields
ALTER TABLE gfx_tokens
  ADD COLUMN IF NOT EXISTS road_token_id text,
  ADD COLUMN IF NOT EXISTS issuer text;

CREATE INDEX IF NOT EXISTS idx_gfx_tokens_road_id
  ON gfx_tokens (road_token_id) WHERE road_token_id IS NOT NULL;

-- 2. gfx_consumers: add Road-specific fields
ALTER TABLE gfx_consumers
  ADD COLUMN IF NOT EXISTS road_account_id text,
  ADD COLUMN IF NOT EXISTS billing_plan text;

CREATE INDEX IF NOT EXISTS idx_gfx_consumers_road_id
  ON gfx_consumers (road_account_id) WHERE road_account_id IS NOT NULL;

-- 3. ocpi_tariffs: add source, road_tariff_id, cpo_id
ALTER TABLE ocpi_tariffs
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'gfx',
  ADD COLUMN IF NOT EXISTS road_tariff_id text,
  ADD COLUMN IF NOT EXISTS cpo_id uuid REFERENCES cpo_operators(id);

CREATE INDEX IF NOT EXISTS idx_ocpi_tariffs_source ON ocpi_tariffs (source);
CREATE INDEX IF NOT EXISTS idx_ocpi_tariffs_cpo ON ocpi_tariffs (cpo_id) WHERE cpo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ocpi_tariffs_road_id
  ON ocpi_tariffs (road_tariff_id) WHERE road_tariff_id IS NOT NULL;

-- 4. sync_watermarks for new sync functions
INSERT INTO sync_watermarks (id, last_offset, last_synced_at, last_record_date, metadata)
VALUES
  ('road-token-sync-reunion', 0, now(), now(), '{"type":"token-sync","account":"ezdrive-reunion"}'::jsonb),
  ('road-token-sync-vcity', 0, now(), now(), '{"type":"token-sync","account":"vcity-ag"}'::jsonb),
  ('road-driver-sync-reunion', 0, now(), now(), '{"type":"driver-sync","account":"ezdrive-reunion"}'::jsonb),
  ('road-driver-sync-vcity', 0, now(), now(), '{"type":"driver-sync","account":"vcity-ag"}'::jsonb),
  ('road-tariff-sync-reunion', 0, now(), now(), '{"type":"tariff-sync","account":"ezdrive-reunion"}'::jsonb),
  ('road-tariff-sync-vcity', 0, now(), now(), '{"type":"tariff-sync","account":"vcity-ag"}'::jsonb)
ON CONFLICT (id) DO NOTHING;
