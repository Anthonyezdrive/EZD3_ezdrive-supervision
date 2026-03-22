CREATE TABLE IF NOT EXISTS xdrive_stripe_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID REFERENCES xdrive_partners(id) ON DELETE CASCADE,
  period_month DATE NOT NULL,
  total_charges NUMERIC DEFAULT 0,
  total_fees NUMERIC DEFAULT 0,
  total_net NUMERIC DEFAULT 0,
  total_refunds NUMERIC DEFAULT 0,
  charge_count INTEGER DEFAULT 0,
  payout_details JSONB DEFAULT '[]',
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(partner_id, period_month)
);

ALTER TABLE xdrive_stripe_payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY xdrive_stripe_admin ON xdrive_stripe_payouts FOR ALL
  USING (EXISTS (SELECT 1 FROM ezdrive_profiles WHERE id = auth.uid() AND role IN ('admin', 'operator')));

-- eMSP settlements (GreenFlux roaming CDRs)
CREATE TABLE IF NOT EXISTS xdrive_emsp_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID REFERENCES xdrive_partners(id) ON DELETE CASCADE,
  period_month DATE NOT NULL,
  emsp_party_id TEXT NOT NULL,
  emsp_name TEXT,
  sessions_count INTEGER DEFAULT 0,
  total_energy_kwh NUMERIC DEFAULT 0,
  gross_amount NUMERIC DEFAULT 0,
  commission NUMERIC DEFAULT 0,
  net_amount NUMERIC DEFAULT 0,
  source TEXT DEFAULT 'auto',
  invoice_reference TEXT,
  payment_status TEXT DEFAULT 'pending',
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(partner_id, period_month, emsp_party_id)
);

ALTER TABLE xdrive_emsp_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY xdrive_emsp_admin ON xdrive_emsp_settlements FOR ALL
  USING (EXISTS (SELECT 1 FROM ezdrive_profiles WHERE id = auth.uid() AND role IN ('admin', 'operator')));
CREATE POLICY xdrive_emsp_b2b ON xdrive_emsp_settlements FOR SELECT
  USING (partner_id IN (
    SELECT xp.id FROM xdrive_partners xp
    JOIN b2b_client_access bca ON bca.b2b_client_id = xp.b2b_client_id
    WHERE bca.user_id = auth.uid()
  ));

-- Add cpo_id to invoices and user_subscriptions for CPO-level filtering
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cpo_id UUID REFERENCES cpo_operators(id);
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS cpo_id UUID REFERENCES cpo_operators(id);
CREATE INDEX IF NOT EXISTS idx_invoices_cpo ON invoices(cpo_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_cpo ON user_subscriptions(cpo_id);
