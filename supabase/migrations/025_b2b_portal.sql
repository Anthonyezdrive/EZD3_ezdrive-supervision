-- ============================================================
-- 025 – B2B Client Portal: tables, RLS, seed
-- ============================================================

-- 1a. Extend role constraint to include b2b_client
ALTER TABLE ezdrive_profiles DROP CONSTRAINT IF EXISTS ezdrive_profiles_role_check;
ALTER TABLE ezdrive_profiles ADD CONSTRAINT ezdrive_profiles_role_check
  CHECK (role IN ('admin', 'operator', 'tech', 'b2b_client'));

-- 1b. B2B Clients master table
CREATE TABLE IF NOT EXISTS b2b_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  customer_external_ids text[] NOT NULL,
  redevance_rate numeric(5,4) NOT NULL DEFAULT 0.33,
  logo_url text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 1c. B2B Client Access mapping (user → client)
CREATE TABLE IF NOT EXISTS b2b_client_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  b2b_client_id uuid NOT NULL REFERENCES b2b_clients(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, b2b_client_id)
);

-- 1d. RLS on b2b_clients
ALTER TABLE b2b_clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read all b2b_clients" ON b2b_clients
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ezdrive_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'operator', 'tech')
    )
  );

CREATE POLICY "B2B user reads own client" ON b2b_clients
  FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT b2b_client_id FROM b2b_client_access WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Admin manage b2b_clients" ON b2b_clients
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ezdrive_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- 1d bis. RLS on b2b_client_access
ALTER TABLE b2b_client_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read all b2b_client_access" ON b2b_client_access
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ezdrive_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'operator', 'tech')
    )
  );

CREATE POLICY "B2B user reads own access" ON b2b_client_access
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admin manage b2b_client_access" ON b2b_client_access
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ezdrive_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- 1e. Performance index for B2B portal queries
CREATE INDEX IF NOT EXISTS idx_ocpi_cdrs_customer_dates
  ON ocpi_cdrs (customer_external_id, start_date_time);

-- 1f. Seed B2B clients from known GFX customer_external_id values
INSERT INTO b2b_clients (name, slug, customer_external_ids, redevance_rate) VALUES
  ('Orange', 'orange', ARRAY['Employés Orange', 'ORANGE'], 0.33),
  ('CMA CGM', 'cma-cgm', ARRAY['Mobilité CMA CGM', 'Mobilité GMG'], 0.33),
  ('SFR', 'sfr', ARRAY['Mobilité SFR'], 0.33),
  ('Crystal Beach', 'crystal-beach', ARRAY['Mobilité Crystal Beach'], 0.33),
  ('Digicel', 'digicel', ARRAY['DIGICEL'], 0.33),
  ('FIMAR', 'fimar', ARRAY['Mobilité FIMAR'], 0.33),
  ('Fitness Park', 'fitness-park', ARRAY['Fitness Park 971', 'Mobilité Fitness Park Le Moule'], 0.33),
  ('GMG', 'gmg', ARRAY['Mobilité GMG'], 0.33),
  ('Parc National Guadeloupe', 'png', ARRAY['Mobilité Parc national'], 0.33),
  ('Pôle Emploi', 'pole-emploi', ARRAY['Pôle Emploi'], 0.33),
  ('B&B Hotel', 'b-and-b', ARRAY['Mobilité Hotel B&B'], 0.33),
  ('Crédit Agricole', 'credit-agricole', ARRAY['Clients P&C', 'CA'], 0.33),
  ('Madiana', 'madiana', ARRAY['Mobilité Madiana'], 0.33),
  ('ADEME', 'ademe', ARRAY['Mobilité ADEME'], 0.33),
  ('RUBIS', 'rubis', ARRAY['Mobilité RUBIS'], 0.33),
  ('Super U Rocade', 'super-u-rocade', ARRAY['Mobilité Super U Rocade'], 0.33),
  ('Le Professionnel', 'le-professionnel', ARRAY['Mobilité - Le Professionnel'], 0.33),
  ('SMHLM', 'smhlm', ARRAY['Mobilité SMHLM'], 0.33),
  ('CCAS Saint-Joseph', 'ccas-saint-joseph', ARRAY['Mobilité CCAS Saint-Joseph'], 0.33),
  ('Bureau Veritas Réunion', 'bureau-veritas-reunion', ARRAY['Bureau Veritas Réunion'], 0.33),
  ('Le Five Saint-Louis', 'le-five', ARRAY['Le Five Saint-Louis'], 0.33),
  ('Ville de Sainte Anne', 'ville-sainte-anne', ARRAY['VILLE DE SAINTE ANNE'], 0.33)
ON CONFLICT (name) DO NOTHING;
