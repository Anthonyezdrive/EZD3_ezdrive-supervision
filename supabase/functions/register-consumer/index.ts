// ============================================================
// EZDrive — Consumer Registration Edge Function
// Complete onboarding flow: email → phone verify → T&C → payment → account
//
// Endpoints:
//   POST /register-consumer/start          — Start registration (email + phone)
//   POST /register-consumer/verify-phone   — Verify phone with 6-digit code
//   POST /register-consumer/complete       — Complete registration (T&C + payment + create account)
//   POST /register-consumer/setup-payment  — Setup payment method (CB or SEPA)
//
// Creates: Supabase Auth user + consumer_profiles + gfx_consumers + Stripe Customer
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.14.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" }) : null;

// ─── CORS ────────────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400) {
  return jsonResponse({ error: message }, status);
}

// ─── Phone verification code store (in-memory, TTL 10 min) ──
const verificationCodes = new Map<string, { code: string; expiresAt: number; phone: string }>();

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ─── Main handler ────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const action = pathParts[pathParts.length - 1]; // last segment

  try {
    const body = await req.json();

    switch (action) {
      case "start":
        return await handleStart(body);
      case "verify-phone":
        return await handleVerifyPhone(body);
      case "complete":
        return await handleComplete(body);
      case "setup-payment":
        return await handleSetupPayment(body);
      default:
        // If called without action, treat as "start"
        if (action === "register-consumer") {
          return await handleStart(body);
        }
        return errorResponse(`Unknown action: ${action}`, 404);
    }
  } catch (err) {
    console.error("[register-consumer] Error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});

// ═══════════════════════════════════════════════════════════
// STEP 1: START — Validate email + send phone verification
// Body: { email, phone, first_name?, last_name?, country? }
// ═══════════════════════════════════════════════════════════

async function handleStart(body: Record<string, unknown>): Promise<Response> {
  const { email, phone, first_name, last_name, country } = body as {
    email: string;
    phone: string;
    first_name?: string;
    last_name?: string;
    country?: string;
  };

  if (!email || !phone) {
    return errorResponse("email and phone are required");
  }

  // Validate email format
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return errorResponse("Invalid email format");
  }

  // Validate phone format (international)
  const cleanPhone = phone.replace(/\s+/g, "");
  if (!/^\+?\d{10,15}$/.test(cleanPhone)) {
    return errorResponse("Invalid phone format. Use international format: +590690XXXXXX");
  }

  // Check if email already exists
  const { data: existingUser } = await supabase
    .from("consumer_profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existingUser) {
    return errorResponse("An account with this email already exists. Please log in.");
  }

  // Generate 6-digit verification code
  const code = generateCode();
  const sessionId = crypto.randomUUID();

  // Store verification code (TTL 10 minutes)
  verificationCodes.set(sessionId, {
    code,
    phone: cleanPhone,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  // Store registration data temporarily
  await supabase.from("registration_sessions").upsert({
    id: sessionId,
    email,
    phone: cleanPhone,
    first_name: first_name ?? null,
    last_name: last_name ?? null,
    country: country ?? "FR",
    verification_code: code,
    verified: false,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min session
  });

  // TODO: Send SMS with verification code via Twilio/Vonage/etc.
  // For now, log the code (dev mode)
  console.log(`[register-consumer] Verification code for ${cleanPhone}: ${code}`);

  return jsonResponse({
    session_id: sessionId,
    message: "Verification code sent to your phone",
    phone_last4: cleanPhone.slice(-4),
    // In dev mode, include code for testing
    ...(Deno.env.get("ENV") !== "production" ? { dev_code: code } : {}),
  });
}

// ═══════════════════════════════════════════════════════════
// STEP 2: VERIFY PHONE — Check 6-digit code
// Body: { session_id, code }
// ═══════════════════════════════════════════════════════════

async function handleVerifyPhone(body: Record<string, unknown>): Promise<Response> {
  const { session_id, code } = body as { session_id: string; code: string };

  if (!session_id || !code) {
    return errorResponse("session_id and code are required");
  }

  // Check in-memory store first
  const stored = verificationCodes.get(session_id);
  if (stored) {
    if (Date.now() > stored.expiresAt) {
      verificationCodes.delete(session_id);
      return errorResponse("Verification code expired. Please request a new one.");
    }
    if (stored.code !== code) {
      return errorResponse("Invalid verification code");
    }
    verificationCodes.delete(session_id);
  } else {
    // Fallback: check DB
    const { data: session } = await supabase
      .from("registration_sessions")
      .select("verification_code, expires_at")
      .eq("id", session_id)
      .maybeSingle();

    if (!session) return errorResponse("Session not found or expired");
    if (new Date(session.expires_at) < new Date()) return errorResponse("Session expired");
    if (session.verification_code !== code) return errorResponse("Invalid verification code");
  }

  // Mark session as verified
  await supabase
    .from("registration_sessions")
    .update({ verified: true })
    .eq("id", session_id);

  return jsonResponse({
    verified: true,
    session_id,
    message: "Phone verified successfully",
    next_step: "Accept T&C then complete registration",
  });
}

// ═══════════════════════════════════════════════════════════
// STEP 3: COMPLETE — Create account after T&C acceptance
// Body: { session_id, terms_accepted, offer_id?, qr_station_id? }
// ═══════════════════════════════════════════════════════════

async function handleComplete(body: Record<string, unknown>): Promise<Response> {
  const { session_id, terms_accepted, offer_id, qr_station_id } = body as {
    session_id: string;
    terms_accepted: boolean;
    offer_id?: string;
    qr_station_id?: string;
  };

  if (!session_id) return errorResponse("session_id is required");
  if (!terms_accepted) return errorResponse("You must accept the Terms & Conditions");

  // Fetch registration session
  const { data: session, error: sessionError } = await supabase
    .from("registration_sessions")
    .select("*")
    .eq("id", session_id)
    .maybeSingle();

  if (sessionError || !session) return errorResponse("Session not found or expired");
  if (!session.verified) return errorResponse("Phone not verified. Complete step 2 first.");
  if (new Date(session.expires_at) < new Date()) return errorResponse("Session expired. Please restart registration.");

  // 1. Create Supabase Auth user
  const tempPassword = crypto.randomUUID().slice(0, 16) + "Aa1!";
  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email: session.email,
    phone: session.phone,
    password: tempPassword,
    email_confirm: true,
    phone_confirm: true,
    user_metadata: {
      first_name: session.first_name,
      last_name: session.last_name,
      country: session.country,
      registered_via: qr_station_id ? "qr_scan" : "app",
    },
  });

  if (authError) {
    if (authError.message?.includes("already been registered")) {
      return errorResponse("An account with this email already exists. Please log in.");
    }
    console.error("[register-consumer] Auth error:", authError);
    return errorResponse("Failed to create account: " + authError.message);
  }

  const userId = authUser.user.id;

  // 2. Create consumer profile
  await supabase.from("consumer_profiles").upsert({
    id: userId,
    email: session.email,
    phone: session.phone,
    first_name: session.first_name,
    last_name: session.last_name,
    country: session.country,
    terms_accepted_at: new Date().toISOString(),
    registered_at: new Date().toISOString(),
    registration_source: qr_station_id ? "qr_scan" : "app",
    qr_station_id: qr_station_id ?? null,
  });

  // 3. Also create in gfx_consumers for unified view
  const fullName = [session.first_name, session.last_name].filter(Boolean).join(" ") || session.email;
  await supabase.from("gfx_consumers").insert({
    id: crypto.randomUUID(),
    driver_external_id: userId,
    full_name: fullName,
    first_name: session.first_name,
    last_name: session.last_name,
    email: session.email,
    phone: session.phone,
    country: session.country,
    status: "active",
    source: "app_registration",
    total_sessions: 0,
    total_energy_kwh: 0,
  });

  // 4. Create Stripe Customer
  let stripeCustomerId: string | null = null;
  if (stripe) {
    try {
      const customer = await stripe.customers.create({
        email: session.email,
        phone: session.phone,
        name: fullName,
        metadata: {
          user_id: userId,
          country: session.country ?? "FR",
          registration_source: qr_station_id ? "qr_scan" : "app",
        },
      });
      stripeCustomerId = customer.id;

      // Save Stripe customer ID to profile
      await supabase.from("consumer_profiles")
        .update({ stripe_customer_id: customer.id })
        .eq("id", userId);
    } catch (stripeErr) {
      console.error("[register-consumer] Stripe customer creation error:", stripeErr);
      // Non-blocking: account is created even if Stripe fails
    }
  }

  // 5. If offer selected, create subscription record
  if (offer_id) {
    await supabase.from("user_subscriptions").insert({
      user_id: userId,
      offer_id,
      status: "PENDING",
      started_at: new Date().toISOString(),
      stripe_customer_id: stripeCustomerId,
    });
  }

  // 6. Clean up registration session
  await supabase.from("registration_sessions").delete().eq("id", session_id);

  console.log(`[register-consumer] Account created: ${session.email} (${userId})`);

  return jsonResponse({
    success: true,
    user_id: userId,
    email: session.email,
    stripe_customer_id: stripeCustomerId,
    message: "Account created successfully",
    next_step: stripeCustomerId ? "Setup payment method" : "Account ready",
  }, 201);
}

// ═══════════════════════════════════════════════════════════
// STEP 4: SETUP PAYMENT — Create Stripe SetupIntent for CB or SEPA
// Body: { user_id, payment_type: "card" | "sepa" }
// Returns: client_secret for Stripe PaymentSheet / SetupIntent
// ═══════════════════════════════════════════════════════════

async function handleSetupPayment(body: Record<string, unknown>): Promise<Response> {
  const { user_id, payment_type } = body as {
    user_id: string;
    payment_type: "card" | "sepa";
  };

  if (!user_id) return errorResponse("user_id is required");
  if (!stripe) return errorResponse("Stripe not configured", 500);

  // Get Stripe customer ID
  const { data: profile } = await supabase
    .from("consumer_profiles")
    .select("stripe_customer_id, email")
    .eq("id", user_id)
    .maybeSingle();

  if (!profile) return errorResponse("User not found");

  let customerId = profile.stripe_customer_id;

  // Create Stripe customer if not exists
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: profile.email,
      metadata: { user_id },
    });
    customerId = customer.id;
    await supabase.from("consumer_profiles")
      .update({ stripe_customer_id: customerId })
      .eq("id", user_id);
  }

  // Create SetupIntent
  const paymentMethodTypes = payment_type === "sepa"
    ? ["sepa_debit"]
    : ["card"];

  const setupIntent = await stripe.setupIntents.create({
    customer: customerId,
    payment_method_types: paymentMethodTypes,
    metadata: {
      user_id,
      payment_type,
    },
  });

  // For Stripe PaymentSheet (mobile), we also need an ephemeral key
  const ephemeralKey = await stripe.ephemeralKeys.create(
    { customer: customerId },
    { apiVersion: "2023-10-16" }
  );

  return jsonResponse({
    setup_intent_client_secret: setupIntent.client_secret,
    ephemeral_key: ephemeralKey.secret,
    customer_id: customerId,
    payment_type,
    message: `Setup ${payment_type === "sepa" ? "SEPA mandate" : "card"} for future payments`,
  });
}
