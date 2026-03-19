-- ============================================================
-- Migration 045: Token Billing Management
-- Manages billing type (prepaid/postpaid), prepaid balance,
-- roaming settings, and auto-disable on zero balance
-- ============================================================

CREATE TABLE IF NOT EXISTS token_billing (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  token_uid text NOT NULL UNIQUE,
  billing_type text NOT NULL DEFAULT 'postpaid' CHECK (billing_type IN ('prepaid', 'postpaid')),
  prepaid_amount numeric(10,2) DEFAULT 0,
  prepaid_balance numeric(10,2) DEFAULT 0,
  roaming_enabled boolean DEFAULT false,
  roaming_fee numeric(10,2) DEFAULT 0,
  roaming_interval text CHECK (roaming_interval IN ('monthly', 'yearly')),
  expires_at timestamptz,
  remarks text,
  cpo_id text,
  stripe_customer_id text,
  stripe_payment_method_id text,
  auto_disabled_at timestamptz,
  auto_reactivated_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_token_billing_uid ON token_billing (token_uid);
CREATE INDEX IF NOT EXISTS idx_token_billing_stripe ON token_billing (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_token_billing_prepaid ON token_billing (billing_type, prepaid_balance) WHERE billing_type = 'prepaid';

-- RLS
ALTER TABLE token_billing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated" ON token_billing
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Function: deduct prepaid balance after a charging session
CREATE OR REPLACE FUNCTION deduct_prepaid_balance(
  p_token_uid text,
  p_session_cost numeric
) RETURNS json AS $$
DECLARE
  v_billing record;
  v_new_balance numeric;
  v_result json;
BEGIN
  -- Get billing info
  SELECT * INTO v_billing FROM token_billing
  WHERE token_uid = p_token_uid AND billing_type = 'prepaid'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('status', 'not_prepaid', 'message', 'Token is not prepaid');
  END IF;

  -- Calculate new balance
  v_new_balance := GREATEST(0, v_billing.prepaid_balance - p_session_cost);

  -- Update balance
  UPDATE token_billing
  SET prepaid_balance = v_new_balance,
      updated_at = now()
  WHERE token_uid = p_token_uid;

  -- If balance reaches 0, disable the token
  IF v_new_balance <= 0 THEN
    -- Disable in gfx_tokens
    UPDATE gfx_tokens SET status = 'inactive' WHERE token_uid = p_token_uid;
    -- Mark auto-disabled
    UPDATE token_billing SET auto_disabled_at = now() WHERE token_uid = p_token_uid;

    RETURN json_build_object(
      'status', 'disabled',
      'message', 'Solde épuisé, token désactivé',
      'previous_balance', v_billing.prepaid_balance,
      'session_cost', p_session_cost,
      'new_balance', 0
    );
  END IF;

  RETURN json_build_object(
    'status', 'ok',
    'previous_balance', v_billing.prepaid_balance,
    'session_cost', p_session_cost,
    'new_balance', v_new_balance
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: reactivate token when prepaid is recharged
CREATE OR REPLACE FUNCTION reactivate_prepaid_token(
  p_token_uid text,
  p_recharge_amount numeric
) RETURNS json AS $$
DECLARE
  v_billing record;
  v_new_balance numeric;
BEGIN
  SELECT * INTO v_billing FROM token_billing
  WHERE token_uid = p_token_uid AND billing_type = 'prepaid'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('status', 'not_found', 'message', 'Token billing not found');
  END IF;

  -- Add recharge amount
  v_new_balance := v_billing.prepaid_balance + p_recharge_amount;

  -- Update balance
  UPDATE token_billing
  SET prepaid_balance = v_new_balance,
      auto_reactivated_at = now(),
      updated_at = now()
  WHERE token_uid = p_token_uid;

  -- Reactivate token if it was disabled
  UPDATE gfx_tokens SET status = 'active' WHERE token_uid = p_token_uid AND status = 'inactive';

  RETURN json_build_object(
    'status', 'reactivated',
    'previous_balance', v_billing.prepaid_balance,
    'recharge_amount', p_recharge_amount,
    'new_balance', v_new_balance
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: check if prepaid token can charge (called by OCPP Authorize)
CREATE OR REPLACE FUNCTION check_prepaid_authorization(
  p_token_uid text
) RETURNS json AS $$
DECLARE
  v_billing record;
  v_token record;
BEGIN
  -- Check if token exists and is active
  SELECT * INTO v_token FROM gfx_tokens WHERE token_uid = p_token_uid;
  IF NOT FOUND THEN
    RETURN json_build_object('authorized', false, 'reason', 'Token not found');
  END IF;
  IF v_token.status = 'inactive' THEN
    RETURN json_build_object('authorized', false, 'reason', 'Token inactive');
  END IF;

  -- Check billing
  SELECT * INTO v_billing FROM token_billing WHERE token_uid = p_token_uid;

  -- No billing record = postpaid = always authorized
  IF NOT FOUND THEN
    RETURN json_build_object('authorized', true, 'billing_type', 'postpaid');
  END IF;

  -- Check expiration
  IF v_billing.expires_at IS NOT NULL AND v_billing.expires_at < now() THEN
    RETURN json_build_object('authorized', false, 'reason', 'Token expired');
  END IF;

  -- Postpaid = always authorized
  IF v_billing.billing_type = 'postpaid' THEN
    RETURN json_build_object('authorized', true, 'billing_type', 'postpaid');
  END IF;

  -- Prepaid = check balance
  IF v_billing.prepaid_balance <= 0 THEN
    RETURN json_build_object(
      'authorized', false,
      'reason', 'Insufficient prepaid balance',
      'balance', v_billing.prepaid_balance
    );
  END IF;

  RETURN json_build_object(
    'authorized', true,
    'billing_type', 'prepaid',
    'balance', v_billing.prepaid_balance
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
