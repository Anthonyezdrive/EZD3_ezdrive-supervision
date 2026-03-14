-- ============================================
-- Migration 026: B2B Admin RPC Functions
-- Server-side functions for creating/deleting B2B users
-- ============================================

-- Ensure pgcrypto is available for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Create B2B User ──────────────────────────────────────
-- Creates auth user + ezdrive_profile + b2b_client_access in one transaction
CREATE OR REPLACE FUNCTION admin_create_b2b_user(
  p_email text,
  p_password text,
  p_client_id uuid,
  p_full_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_caller_role text;
BEGIN
  -- Verify caller is admin
  SELECT role INTO v_caller_role FROM ezdrive_profiles WHERE id = auth.uid();
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only admins can create B2B users';
  END IF;

  -- Verify client exists
  IF NOT EXISTS (SELECT 1 FROM b2b_clients WHERE id = p_client_id) THEN
    RAISE EXCEPTION 'Client B2B not found: %', p_client_id;
  END IF;

  -- Check email not already used
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = p_email) THEN
    RAISE EXCEPTION 'Email already exists: %', p_email;
  END IF;

  -- Create auth user
  v_user_id := gen_random_uuid();
  INSERT INTO auth.users (
    instance_id, id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_user_meta_data, raw_app_meta_data,
    created_at, updated_at, confirmation_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_user_id, 'authenticated', 'authenticated', p_email,
    crypt(p_password, gen_salt('bf')), now(),
    jsonb_build_object('created_by_admin', 'true', 'full_name', COALESCE(p_full_name, p_email)),
    '{}'::jsonb,
    now(), now(), ''
  );

  -- Create identity (required for email/password login)
  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    v_user_id, v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', p_email),
    'email', v_user_id::text,
    now(), now(), now()
  );

  -- Create ezdrive_profile with b2b_client role
  INSERT INTO ezdrive_profiles (id, email, full_name, role)
  VALUES (v_user_id, p_email, COALESCE(p_full_name, p_email), 'b2b_client');

  -- Create b2b_client_access
  INSERT INTO b2b_client_access (user_id, b2b_client_id)
  VALUES (v_user_id, p_client_id);

  RETURN v_user_id;
END;
$$;

-- ── Delete B2B User ──────────────────────────────────────
-- Removes auth user + profile + access
CREATE OR REPLACE FUNCTION admin_delete_b2b_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  v_target_role text;
BEGIN
  -- Verify caller is admin
  SELECT role INTO v_caller_role FROM ezdrive_profiles WHERE id = auth.uid();
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only admins can delete B2B users';
  END IF;

  -- Verify target is a b2b_client
  SELECT role INTO v_target_role FROM ezdrive_profiles WHERE id = p_user_id;
  IF v_target_role IS DISTINCT FROM 'b2b_client' THEN
    RAISE EXCEPTION 'User is not a B2B client';
  END IF;

  -- Delete access entries
  DELETE FROM b2b_client_access WHERE user_id = p_user_id;

  -- Delete profile
  DELETE FROM ezdrive_profiles WHERE id = p_user_id;

  -- Delete auth user (cascades identities, sessions, etc.)
  DELETE FROM auth.users WHERE id = p_user_id;
END;
$$;

-- ── List B2B Users (admin view) ──────────────────────────
-- Returns all B2B users with their associated client info
CREATE OR REPLACE FUNCTION admin_list_b2b_users()
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  client_id uuid,
  client_name text,
  client_slug text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
BEGIN
  SELECT role INTO v_caller_role FROM ezdrive_profiles WHERE id = auth.uid();
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only admins can list B2B users';
  END IF;

  RETURN QUERY
  SELECT
    ep.id AS user_id,
    ep.email,
    ep.full_name,
    bc.id AS client_id,
    bc.name AS client_name,
    bc.slug AS client_slug,
    ep.created_at
  FROM ezdrive_profiles ep
  LEFT JOIN b2b_client_access bca ON bca.user_id = ep.id
  LEFT JOIN b2b_clients bc ON bc.id = bca.b2b_client_id
  WHERE ep.role = 'b2b_client'
  ORDER BY bc.name, ep.email;
END;
$$;
