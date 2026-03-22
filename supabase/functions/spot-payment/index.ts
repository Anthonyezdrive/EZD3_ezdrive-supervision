// ============================================================
// EZDrive — Spot Payment Edge Function
// Supports 2 payment modes:
//
// MODE 1: CARD PRE-AUTH (CB — pré-autorisation par paliers de 20€)
// 1. POST /spot-payment/authorize → crée PaymentIntent 20€ (manual capture)
// 2. Charge démarre (RemoteStartTransaction)
// 3. Quand coût atteint ~18€:
//    POST /spot-payment/extend → nouvelle autorisation 20€
//    Si Stripe refuse → RemoteStopTransaction → finishing
// 4. Charge terminée:
//    POST /spot-payment/capture → capture montant réel
//    POST /spot-payment/finalize → génère facture
//
// MODE 2: SEPA POST-SESSION (prélèvement SEPA en fin de session)
// 1. POST /spot-payment/authorize-sepa → vérifie mandat SEPA actif
// 2. Charge démarre (token RFID + Authorize OCPP)
// 3. Charge terminée:
//    POST /spot-payment/charge-sepa → crée PaymentIntent SEPA confirmé
//    POST /spot-payment/finalize → génère facture
//
// SETUP SEPA:
// POST /spot-payment/setup-sepa → crée SetupIntent pour collecter IBAN
//
// STATUS:
// POST /spot-payment/status → état de la session
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from "../_shared/rate-limiter.ts";
import {
  createPaymentIntent,
  capturePaymentIntent,
  cancelPaymentIntent,
  getCustomerSepaPaymentMethod,
  createSepaPaymentIntent,
  createSepaSetupIntent,
} from "../_shared/stripe-client.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Singleton — réutilisé entre les requêtes (Deno edge runtime garde le module en mémoire)
const sb = createClient(supabaseUrl, supabaseServiceKey);

const TIER_AMOUNT_CENTS = 2000; // 20€ per authorization tier
const SAFETY_THRESHOLD_CENTS = 1800; // Trigger next tier at 18€ consumed
const DEFAULT_CURRENCY = "eur";

// ─── Types ────────────────────────────────────────────────

interface SpotSession {
  id: string;
  transaction_id: string;
  consumer_id: string | null;
  station_id: string;
  station_name: string;
  connector_id: number;
  stripe_customer_id: string;
  connected_account_id: string | null; // For Stripe Connect (V-CiTY etc.)
  application_fee_pct: number; // EZDrive commission %
  payment_intents: SpotPaymentIntent[];
  total_authorized_cents: number;
  total_consumed_cents: number;
  payment_mode: "card_preauth" | "sepa_post_session";
  sepa_payment_method_id: string | null;
  status: "pending" | "charging" | "finishing" | "completed" | "failed";
  coupon_code: string | null;
  coupon_discount_cents: number;
  created_at: string;
}

interface SpotPaymentIntent {
  id: string;
  stripe_pi_id: string;
  amount_cents: number;
  captured_cents: number | null;
  status: "authorized" | "captured" | "cancelled" | "failed";
  tier_number: number;
  created_at: string;
}

// ─── Main Handler ─────────────────────────────────────────

const spotCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: spotCorsHeaders });
  }

  // Rate limiting
  const rateResult = checkRateLimit(req, RATE_LIMITS.payment);
  if (!rateResult.allowed) {
    return rateLimitResponse(rateResult, spotCorsHeaders);
  }

  const url = new URL(req.url);
  const path = url.pathname.split("/").pop();

  try {
    const body = await req.json().catch(() => ({}));

    switch (path) {
      case "create-intent":
        return await handleCreateIntent(sb, body);
      case "authorize":
        return await handleAuthorize(sb, body);
      case "authorize-sepa":
        return await handleAuthorizeSepa(sb, body);
      case "charge-sepa":
        return await handleChargeSepa(sb, body);
      case "setup-sepa":
        return await handleSetupSepa(sb, body);
      case "extend":
        return await handleExtend(sb, body);
      case "capture":
        return await handleCapture(sb, body);
      case "finalize":
        return await handleFinalize(sb, body);
      case "status":
        return await handleStatus(sb, body);
      default:
        return json({ error: "Unknown action. Use: create-intent, authorize, authorize-sepa, charge-sepa, setup-sepa, extend, capture, finalize, status" }, 400);
    }
  } catch (err) {
    console.error("[spot-payment] Error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});

// ─── 0. CREATE-INTENT — Guest Direct Pay (no Stripe customer) ───

async function handleCreateIntent(
  sb: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
): Promise<Response> {
  const {
    station_id,
    connector_id = 1,
    email,
    amount = TIER_AMOUNT_CENTS,
  } = body as {
    station_id: string;
    connector_id?: number;
    email: string;
    amount?: number;
  };

  if (!station_id) return json({ error: "station_id required" }, 400);
  if (!email) return json({ error: "email required for receipt" }, 400);

  // Get station name
  const { data: station } = await sb
    .from("stations")
    .select("name, city, ocpp_identity")
    .eq("id", station_id)
    .single();
  const stationName = station?.name ?? "Borne EZDrive";

  // Find or create guest Stripe customer by email
  const stripe = (await import("../_shared/stripe-client.ts")).getStripe();
  let customerId: string;
  const existingCustomers = await stripe.customers.list({ email, limit: 1 });
  if (existingCustomers.data.length > 0) {
    customerId = existingCustomers.data[0].id;
  } else {
    const newCustomer = await stripe.customers.create({
      email,
      metadata: { source: "direct_pay", station_id },
    });
    customerId = newCustomer.id;
  }

  // Create PaymentIntent with manual capture (pre-authorization)
  const pi = await createPaymentIntent({
    amountCents: amount as number,
    currency: DEFAULT_CURRENCY,
    customerId,
    description: `Direct Pay — ${stationName} — Pré-autorisation`,
    captureMethod: "manual",
    metadata: {
      type: "direct_pay",
      station_id,
      connector_id: String(connector_id),
      email,
      guest: "true",
    },
  });

  // Create spot_sessions record
  const { data: session } = await sb
    .from("spot_sessions")
    .insert({
      station_id,
      station_name: stationName,
      connector_id,
      consumer_id: null,
      stripe_customer_id: customerId,
      connected_account_id: null,
      application_fee_pct: 0,
      total_authorized_cents: amount,
      total_consumed_cents: 0,
      payment_mode: "card_preauth",
      status: "pending",
      coupon_code: null,
      coupon_discount_cents: 0,
    })
    .select()
    .single();

  // Track PI
  if (session) {
    await sb.from("spot_payment_intents").insert({
      session_id: session.id,
      stripe_pi_id: pi.id,
      amount_cents: amount,
      tier_number: 1,
      status: "authorized",
    });
  }

  return json({
    success: true,
    session_id: session?.id,
    client_secret: pi.client_secret,
    payment_intent_id: pi.id,
    stripe_customer_id: customerId,
    authorized_cents: amount,
    station_name: stationName,
    ocpp_identity: station?.ocpp_identity,
    message: `Pré-autorisation de ${((amount as number) / 100).toFixed(2)}€ créée. Confirmez avec votre carte.`,
  });
}

// ─── 1. AUTHORIZE — Initial 20€ pre-authorization ────────

async function handleAuthorize(
  sb: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
): Promise<Response> {
  const {
    station_id,
    connector_id = 1,
    stripe_customer_id,
    consumer_id = null,
    connected_account_id = null,
    application_fee_pct = 0,
    coupon_code = null,
  } = body as {
    station_id: string;
    connector_id?: number;
    stripe_customer_id: string;
    consumer_id?: string;
    connected_account_id?: string;
    application_fee_pct?: number;
    coupon_code?: string;
  };

  if (!station_id || !stripe_customer_id) {
    return json({ error: "station_id and stripe_customer_id required" }, 400);
  }

  // Get station name
  const { data: station } = await sb
    .from("stations")
    .select("name, city")
    .eq("id", station_id)
    .single();
  const stationName = station?.name ?? "Borne EZDrive";

  // Validate coupon if provided
  let couponDiscountCents = 0;
  if (coupon_code) {
    const { data: couponResult } = await sb.rpc("validate_and_apply_coupon", {
      p_coupon_code: coupon_code,
      p_amount_cents: TIER_AMOUNT_CENTS,
      p_driver_id: consumer_id,
    });
    if (couponResult?.valid) {
      couponDiscountCents = couponResult.discount_cents ?? 0;
    }
  }

  // Calculate authorization amount (tier - coupon discount)
  const authAmount = Math.max(100, TIER_AMOUNT_CENTS - couponDiscountCents); // min 1€

  // Create PaymentIntent with manual capture
  const applicationFee = connected_account_id
    ? Math.round(authAmount * (application_fee_pct as number) / 100)
    : undefined;

  const pi = await createPaymentIntent({
    amountCents: authAmount,
    currency: DEFAULT_CURRENCY,
    customerId: stripe_customer_id,
    description: `Recharge SPOT — ${stationName} — Autorisation palier 1`,
    captureMethod: "manual",
    connectedAccountId: connected_account_id ?? undefined,
    applicationFeeAmount: applicationFee,
    metadata: {
      type: "spot_charging",
      station_id,
      connector_id: String(connector_id),
      tier: "1",
    },
  });

  // Create spot_sessions record
  const sessionData = {
    station_id,
    station_name: stationName,
    connector_id,
    consumer_id,
    stripe_customer_id,
    connected_account_id,
    application_fee_pct,
    total_authorized_cents: authAmount,
    total_consumed_cents: 0,
    status: "pending",
    coupon_code,
    coupon_discount_cents: couponDiscountCents,
  };

  const { data: session, error: sessionError } = await sb
    .from("spot_sessions")
    .insert(sessionData)
    .select()
    .single();

  if (sessionError) {
    console.error("[spot-payment] Session create error:", sessionError);
    // Still return PI info even if session tracking fails
  }

  // Track PI
  if (session) {
    await sb.from("spot_payment_intents").insert({
      session_id: session.id,
      stripe_pi_id: pi.id,
      amount_cents: authAmount,
      tier_number: 1,
      status: "authorized",
    });
  }

  return json({
    success: true,
    session_id: session?.id,
    payment_intent_id: pi.id,
    client_secret: pi.client_secret,
    authorized_cents: authAmount,
    coupon_applied: couponDiscountCents > 0,
    coupon_discount_cents: couponDiscountCents,
    message: `Autorisation de ${(authAmount / 100).toFixed(2)}€ créée. Confirmez le paiement pour démarrer la charge.`,
  });
}

// ─── 1b. AUTHORIZE-SEPA — Verify SEPA mandate, authorize charge ─

async function handleAuthorizeSepa(
  sb: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
): Promise<Response> {
  const {
    station_id,
    connector_id = 1,
    stripe_customer_id,
    consumer_id = null,
    connected_account_id = null,
    application_fee_pct = 0,
    token_uid = null,
    coupon_code = null,
  } = body as {
    station_id: string;
    connector_id?: number;
    stripe_customer_id: string;
    consumer_id?: string;
    connected_account_id?: string;
    application_fee_pct?: number;
    token_uid?: string;
    coupon_code?: string;
  };

  if (!station_id || !stripe_customer_id) {
    return json({ error: "station_id and stripe_customer_id required" }, 400);
  }

  // Verify customer has a valid SEPA mandate
  const sepaMethod = await getCustomerSepaPaymentMethod(
    stripe_customer_id,
    connected_account_id ?? undefined,
  );

  if (!sepaMethod) {
    return json({
      success: false,
      error: "no_sepa_mandate",
      message: "Aucun mandat SEPA actif trouvé pour ce client. Veuillez d'abord configurer un prélèvement SEPA.",
      action: "SETUP_SEPA_REQUIRED",
    }, 400);
  }

  // Get station name
  const { data: station } = await sb
    .from("stations")
    .select("name, city")
    .eq("id", station_id)
    .single();
  const stationName = station?.name ?? "Borne EZDrive";

  // Validate coupon
  let couponDiscountCents = 0;
  if (coupon_code) {
    const { data: couponResult } = await sb.rpc("validate_and_apply_coupon", {
      p_coupon_code: coupon_code,
      p_amount_cents: TIER_AMOUNT_CENTS,
      p_driver_id: consumer_id,
    });
    if (couponResult?.valid) {
      couponDiscountCents = couponResult.discount_cents ?? 0;
    }
  }

  // Create session (no PI yet — SEPA is charged post-session)
  const sessionData = {
    station_id,
    station_name: stationName,
    connector_id,
    consumer_id,
    stripe_customer_id,
    connected_account_id,
    application_fee_pct,
    total_authorized_cents: 0, // No pre-auth for SEPA
    total_consumed_cents: 0,
    payment_mode: "sepa_post_session",
    sepa_payment_method_id: sepaMethod.id,
    status: "pending",
    coupon_code,
    coupon_discount_cents: couponDiscountCents,
  };

  const { data: session, error: sessionError } = await sb
    .from("spot_sessions")
    .insert(sessionData)
    .select()
    .single();

  if (sessionError) {
    console.error("[spot-payment] SEPA session create error:", sessionError);
    return json({ error: "Session creation failed" }, 500);
  }

  return json({
    success: true,
    session_id: session.id,
    payment_mode: "sepa_post_session",
    sepa_last4: sepaMethod.sepa_debit?.last4 ?? "****",
    sepa_bank: sepaMethod.sepa_debit?.bank_code ?? "",
    token_uid,
    coupon_applied: couponDiscountCents > 0,
    coupon_discount_cents: couponDiscountCents,
    message: `Mandat SEPA vérifié (****${sepaMethod.sepa_debit?.last4}). La charge peut démarrer. Le prélèvement sera effectué en fin de session.`,
  });
}

// ─── 1c. CHARGE-SEPA — Debit SEPA after session ends ────

async function handleChargeSepa(
  sb: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
): Promise<Response> {
  const {
    session_id,
    final_amount_cents,
    energy_kwh = 0,
    duration_min = 0,
    finishing_min = 0,
    finishing_cost_cents = 0,
  } = body as {
    session_id: string;
    final_amount_cents: number;
    energy_kwh?: number;
    duration_min?: number;
    finishing_min?: number;
    finishing_cost_cents?: number;
  };

  if (!session_id || final_amount_cents === undefined) {
    return json({ error: "session_id and final_amount_cents required" }, 400);
  }

  // Get session
  const { data: session } = await sb
    .from("spot_sessions")
    .select("*")
    .eq("id", session_id)
    .single();

  if (!session) {
    return json({ error: "Session not found" }, 404);
  }

  if (session.payment_mode !== "sepa_post_session") {
    return json({ error: "This session is not in SEPA mode. Use /capture for card pre-auth sessions." }, 400);
  }

  if (!session.sepa_payment_method_id) {
    return json({ error: "No SEPA payment method on this session" }, 400);
  }

  // Calculate final amount after coupon
  const chargeAmount = Math.max(0, final_amount_cents - session.coupon_discount_cents);

  if (chargeAmount === 0) {
    // Fully covered by coupon
    await sb
      .from("spot_sessions")
      .update({ status: "completed", total_consumed_cents: final_amount_cents })
      .eq("id", session_id);

    return json({
      success: true,
      charged_cents: 0,
      coupon_discount_cents: session.coupon_discount_cents,
      message: "Session entièrement couverte par le coupon. Aucun prélèvement SEPA.",
    });
  }

  // Create and confirm SEPA PaymentIntent
  try {
    const applicationFee = session.connected_account_id
      ? Math.round(chargeAmount * session.application_fee_pct / 100)
      : undefined;

    const pi = await createSepaPaymentIntent({
      amountCents: chargeAmount,
      currency: DEFAULT_CURRENCY,
      customerId: session.stripe_customer_id,
      paymentMethodId: session.sepa_payment_method_id,
      description: `Recharge SPOT SEPA — ${session.station_name} — ${energy_kwh.toFixed(2)} kWh`,
      connectedAccountId: session.connected_account_id ?? undefined,
      applicationFeeAmount: applicationFee,
      metadata: {
        type: "spot_charging_sepa",
        station_id: session.station_id,
        session_id,
        energy_kwh: String(energy_kwh),
        duration_min: String(duration_min),
      },
    });

    // Track PI
    await sb.from("spot_payment_intents").insert({
      session_id,
      stripe_pi_id: pi.id,
      amount_cents: chargeAmount,
      captured_cents: chargeAmount,
      tier_number: 1,
      status: "captured",
    });

    // Update session
    await sb
      .from("spot_sessions")
      .update({
        status: "completed",
        total_consumed_cents: final_amount_cents,
        total_authorized_cents: chargeAmount,
      })
      .eq("id", session_id);

    return json({
      success: true,
      payment_intent_id: pi.id,
      payment_intent_status: pi.status, // "processing" for SEPA (takes 3-5 days)
      charged_cents: chargeAmount,
      coupon_discount_cents: session.coupon_discount_cents,
      total_session_cents: final_amount_cents,
      message: `Prélèvement SEPA de ${(chargeAmount / 100).toFixed(2)}€ initié. Confirmation sous 3-5 jours ouvrables.`,
    });
  } catch (err) {
    console.error("[spot-payment] SEPA charge failed:", (err as Error).message);

    await sb
      .from("spot_sessions")
      .update({ status: "failed", total_consumed_cents: final_amount_cents })
      .eq("id", session_id);

    return json({
      success: false,
      error: "sepa_charge_failed",
      message: `Échec du prélèvement SEPA: ${(err as Error).message}`,
    }, 402);
  }
}

// ─── 1d. SETUP-SEPA — Create SetupIntent for SEPA mandate ─

async function handleSetupSepa(
  sb: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
): Promise<Response> {
  const {
    stripe_customer_id,
    connected_account_id = null,
  } = body as {
    stripe_customer_id: string;
    connected_account_id?: string;
  };

  if (!stripe_customer_id) {
    return json({ error: "stripe_customer_id required" }, 400);
  }

  try {
    const setupIntent = await createSepaSetupIntent({
      customerId: stripe_customer_id,
      connectedAccountId: connected_account_id ?? undefined,
    });

    return json({
      success: true,
      setup_intent_id: setupIntent.id,
      client_secret: setupIntent.client_secret,
      message: "SetupIntent SEPA créé. Utilisez le client_secret côté app pour collecter l'IBAN du client.",
    });
  } catch (err) {
    return json({
      success: false,
      error: (err as Error).message,
      message: "Erreur lors de la création du SetupIntent SEPA.",
    }, 500);
  }
}

// ─── 2. EXTEND — Next 20€ tier when threshold reached ────

async function handleExtend(
  sb: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
): Promise<Response> {
  const { session_id, consumed_cents } = body as {
    session_id: string;
    consumed_cents: number;
  };

  if (!session_id) {
    return json({ error: "session_id required" }, 400);
  }

  // Atomically update consumed amount and fetch latest session state in one call
  const { data: session, error } = await sb
    .from("spot_sessions")
    .update({ total_consumed_cents: consumed_cents })
    .eq("id", session_id)
    .select("*, spot_payment_intents(*)")
    .maybeSingle();

  if (error || !session) {
    return json({ error: "Session not found" }, 404);
  }

  // Check if we need a new tier (using post-update data to avoid race)
  const currentTier = session.spot_payment_intents?.length ?? 1;
  const remainingAuthorized = session.total_authorized_cents - consumed_cents;

  if (remainingAuthorized > (TIER_AMOUNT_CENTS - SAFETY_THRESHOLD_CENTS)) {
    // Still enough headroom, no need to extend
    return json({
      success: true,
      extended: false,
      remaining_cents: remainingAuthorized,
      message: "Autorisation suffisante, pas besoin d'extension.",
    });
  }

  // Try to authorize next tier
  try {
    const applicationFee = session.connected_account_id
      ? Math.round(TIER_AMOUNT_CENTS * session.application_fee_pct / 100)
      : undefined;

    const pi = await createPaymentIntent({
      amountCents: TIER_AMOUNT_CENTS,
      currency: DEFAULT_CURRENCY,
      customerId: session.stripe_customer_id,
      description: `Recharge SPOT — ${session.station_name} — Autorisation palier ${currentTier + 1}`,
      captureMethod: "manual",
      connectedAccountId: session.connected_account_id ?? undefined,
      applicationFeeAmount: applicationFee,
      metadata: {
        type: "spot_charging",
        station_id: session.station_id,
        session_id,
        tier: String(currentTier + 1),
      },
    });

    // Track new PI
    await sb.from("spot_payment_intents").insert({
      session_id,
      stripe_pi_id: pi.id,
      amount_cents: TIER_AMOUNT_CENTS,
      tier_number: currentTier + 1,
      status: "authorized",
    });

    // Update total authorized
    await sb
      .from("spot_sessions")
      .update({
        total_authorized_cents: session.total_authorized_cents + TIER_AMOUNT_CENTS,
      })
      .eq("id", session_id);

    return json({
      success: true,
      extended: true,
      payment_intent_id: pi.id,
      client_secret: pi.client_secret,
      new_tier: currentTier + 1,
      total_authorized_cents: session.total_authorized_cents + TIER_AMOUNT_CENTS,
      message: `Nouvelle autorisation de ${(TIER_AMOUNT_CENTS / 100).toFixed(2)}€ (palier ${currentTier + 1}).`,
    });
  } catch (err) {
    // PAYMENT FAILED — Funds insufficient
    // → Stop the charge immediately
    console.warn("[spot-payment] Extend failed:", (err as Error).message);

    await sb
      .from("spot_sessions")
      .update({ status: "finishing" })
      .eq("id", session_id);

    return json({
      success: false,
      extended: false,
      reason: "insufficient_funds",
      message: "Fonds insuffisants. La charge va s'arrêter. Le véhicule passe en finishing.",
      action: "REMOTE_STOP",
    }, 402);
  }
}

// ─── 3. CAPTURE — Capture actual amounts on all PIs ──────

async function handleCapture(
  sb: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
): Promise<Response> {
  const { session_id, final_amount_cents } = body as {
    session_id: string;
    final_amount_cents: number;
  };

  if (!session_id || final_amount_cents === undefined) {
    return json({ error: "session_id and final_amount_cents required" }, 400);
  }

  // Get session with all PIs
  const { data: session } = await sb
    .from("spot_sessions")
    .select("*, spot_payment_intents(*)")
    .eq("id", session_id)
    .single();

  if (!session) {
    return json({ error: "Session not found" }, 404);
  }

  const pis = (session.spot_payment_intents ?? [])
    .filter((p: SpotPaymentIntent) => p.status === "authorized")
    .sort((a: SpotPaymentIntent, b: SpotPaymentIntent) => a.tier_number - b.tier_number);

  let remainingToCapture = final_amount_cents - session.coupon_discount_cents;
  remainingToCapture = Math.max(0, remainingToCapture);
  const results: Array<{ pi_id: string; captured: number; action: string }> = [];

  for (const pi of pis) {
    if (remainingToCapture <= 0) {
      // Cancel unused PI
      try {
        await cancelPaymentIntent(pi.stripe_pi_id, session.connected_account_id);
        await sb
          .from("spot_payment_intents")
          .update({ status: "cancelled", captured_cents: 0 })
          .eq("id", pi.id);
        results.push({ pi_id: pi.stripe_pi_id, captured: 0, action: "cancelled" });
      } catch (e) {
        console.warn("[spot-payment] Cancel PI failed:", (e as Error).message);
      }
    } else {
      // Capture actual amount (min of remaining and authorized)
      const captureAmount = Math.min(remainingToCapture, pi.amount_cents);
      try {
        await capturePaymentIntent(pi.stripe_pi_id, captureAmount, session.connected_account_id);
        await sb
          .from("spot_payment_intents")
          .update({ status: "captured", captured_cents: captureAmount })
          .eq("id", pi.id);
        results.push({ pi_id: pi.stripe_pi_id, captured: captureAmount, action: "captured" });
        remainingToCapture -= captureAmount;
      } catch (e) {
        console.warn("[spot-payment] Capture PI failed:", (e as Error).message);
        results.push({ pi_id: pi.stripe_pi_id, captured: 0, action: "error" });
      }
    }
  }

  // Update session
  const totalCaptured = results.reduce((sum, r) => sum + r.captured, 0);
  await sb
    .from("spot_sessions")
    .update({
      status: "completed",
      total_consumed_cents: totalCaptured + session.coupon_discount_cents,
    })
    .eq("id", session_id);

  return json({
    success: true,
    total_captured_cents: totalCaptured,
    coupon_discount_cents: session.coupon_discount_cents,
    total_charge_cents: totalCaptured + session.coupon_discount_cents,
    payment_intents: results,
    message: `Paiement capturé: ${(totalCaptured / 100).toFixed(2)}€ + coupon ${(session.coupon_discount_cents / 100).toFixed(2)}€`,
  });
}

// ─── 4. FINALIZE — Generate invoice after capture ────────

async function handleFinalize(
  sb: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
): Promise<Response> {
  const { session_id, transaction_id, energy_kwh, duration_min, finishing_min = 0, finishing_cost_cents = 0 } = body as {
    session_id: string;
    transaction_id?: string;
    energy_kwh?: number;
    duration_min?: number;
    finishing_min?: number;
    finishing_cost_cents?: number;
  };

  if (!session_id) {
    return json({ error: "session_id required" }, 400);
  }

  const { data: session } = await sb
    .from("spot_sessions")
    .select("*")
    .eq("id", session_id)
    .single();

  if (!session) {
    return json({ error: "Session not found" }, 404);
  }

  // Generate invoice number
  const { data: invoiceNum } = await sb.rpc("generate_invoice_number");

  // Create invoice
  const { data: invoice, error: invError } = await sb
    .from("invoices")
    .insert({
      invoice_number: invoiceNum ?? `SPOT-${Date.now()}`,
      consumer_id: session.consumer_id,
      type: "session",
      status: "paid",
      currency: DEFAULT_CURRENCY,
      subtotal_cents: session.total_consumed_cents,
      vat_rate: 8.5,
      vat_cents: Math.round(session.total_consumed_cents * 0.085),
      total_cents: session.total_consumed_cents + Math.round(session.total_consumed_cents * 0.085),
      line_items: [
        {
          description: `Recharge SPOT — ${session.station_name}`,
          energy_kwh: energy_kwh ?? 0,
          duration_min: duration_min ?? 0,
          amount_cents: session.total_consumed_cents - (finishing_cost_cents ?? 0),
        },
        ...(finishing_min > 0 ? [{
          description: `Stationnement finishing — ${finishing_min} min`,
          duration_min: finishing_min,
          amount_cents: finishing_cost_cents,
        }] : []),
        ...(session.coupon_discount_cents > 0 ? [{
          description: `Coupon ${session.coupon_code} appliqué`,
          amount_cents: -session.coupon_discount_cents,
        }] : []),
      ],
      metadata: {
        spot_session_id: session_id,
        transaction_id,
        connected_account_id: session.connected_account_id,
      },
    })
    .select()
    .single();

  if (invError) {
    console.error("[spot-payment] Invoice error:", invError);
    return json({ error: "Invoice creation failed" }, 500);
  }

  return json({
    success: true,
    invoice_id: invoice?.id,
    invoice_number: invoice?.invoice_number,
    total_cents: invoice?.total_cents,
    message: `Facture ${invoice?.invoice_number} générée.`,
  });
}

// ─── 5. STATUS — Get session status ─────────────────────

async function handleStatus(
  sb: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
): Promise<Response> {
  const { session_id } = body as { session_id: string };

  if (!session_id) {
    return json({ error: "session_id required" }, 400);
  }

  const { data: session } = await sb
    .from("spot_sessions")
    .select("*, spot_payment_intents(*)")
    .eq("id", session_id)
    .single();

  if (!session) {
    return json({ error: "Session not found" }, 404);
  }

  return json({
    success: true,
    session,
  });
}

// ─── Helpers ─────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
