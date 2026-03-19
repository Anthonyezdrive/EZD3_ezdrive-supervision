// ============================================================
// EZDrive — Stripe Webhook Handler
// Separate edge function for Stripe event processing
// Improvement over Resonovia: signature verification enforced,
// actual business logic on events (not empty handlers)
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { constructWebhookEvent } from "../_shared/stripe-client.ts";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function getDb() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

Deno.serve(async (req: Request): Promise<Response> => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  try {
    // 1. Get raw body and signature
    const body = await req.text();
    const signature = req.headers.get("stripe-signature");

    if (!signature) {
      console.error("[Stripe Webhook] Missing stripe-signature header");
      return jsonResponse(400, { error: "Missing signature" });
    }

    // 2. Verify webhook signature (throws if invalid)
    let event;
    try {
      event = constructWebhookEvent(body, signature);
    } catch (err) {
      console.error("[Stripe Webhook] Signature verification failed:", err);
      return jsonResponse(400, { error: "Invalid signature" });
    }

    console.log(`[Stripe Webhook] Received event: ${event.type} (${event.id})`);

    // 3. Handle event types
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object);
        break;

      case "invoice.paid":
        await handleInvoicePaid(event.data.object);
        break;

      case "invoice.payment_failed":
        await handleInvoiceFailed(event.data.object);
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object);
        break;

      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event.data.object);
        break;

      case "payment_intent.succeeded":
        await handlePaymentIntentSucceeded(event.data.object);
        break;

      case "payment_intent.payment_failed":
        await handlePaymentIntentFailed(event.data.object);
        break;

      case "charge.refunded":
        await handleChargeRefunded(event.data.object);
        break;

      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
    }

    return jsonResponse(200, { received: true });
  } catch (err) {
    console.error("[Stripe Webhook] Error:", err);
    return jsonResponse(500, { error: "Webhook processing failed" });
  }
});

// ─── Event Handlers ─────────────────────────────────────────

async function handleCheckoutCompleted(session: Record<string, unknown>): Promise<void> {
  const db = getDb();
  const checkoutId = session.id as string;
  const userId = (session.metadata as Record<string, string>)?.ezdrive_user_id;
  const offerId = (session.metadata as Record<string, string>)?.offer_id;
  const stripeSubId = session.subscription as string | null;

  console.log(`[Stripe] Checkout completed: ${checkoutId}, user: ${userId}`);

  if (!userId) {
    console.warn("[Stripe] No ezdrive_user_id in session metadata");
    return;
  }

  // Update subscription status
  const { data: sub, error } = await db
    .from("user_subscriptions")
    .update({
      status: "ACTIVE",
      stripe_subscription_id: stripeSubId ?? null,
      started_at: new Date().toISOString(),
    })
    .eq("stripe_checkout_id", checkoutId)
    .select()
    .maybeSingle();

  if (error) {
    console.error("[Stripe] Failed to update subscription:", error);
    return;
  }

  if (!sub) {
    // Create subscription if checkout was created outside our API
    await db
      .from("user_subscriptions")
      .insert({
        user_id: userId,
        offer_id: offerId,
        stripe_checkout_id: checkoutId,
        stripe_subscription_id: stripeSubId ?? null,
        status: "ACTIVE",
        started_at: new Date().toISOString(),
      });
  }

  console.log(`[Stripe] Subscription activated for user ${userId}`);
}

async function handleInvoicePaid(invoice: Record<string, unknown>): Promise<void> {
  const db = getDb();
  const subId = invoice.subscription as string;

  if (!subId) return;

  console.log(`[Stripe] Invoice paid for subscription: ${subId}`);

  // Ensure subscription is marked active
  await db
    .from("user_subscriptions")
    .update({ status: "ACTIVE" })
    .eq("stripe_subscription_id", subId)
    .eq("status", "PAST_DUE");
}

async function handleInvoiceFailed(invoice: Record<string, unknown>): Promise<void> {
  const db = getDb();
  const subId = invoice.subscription as string;

  if (!subId) return;

  console.log(`[Stripe] Invoice payment failed for subscription: ${subId}`);

  // Mark as past due
  await db
    .from("user_subscriptions")
    .update({ status: "PAST_DUE" })
    .eq("stripe_subscription_id", subId);
}

async function handleSubscriptionDeleted(subscription: Record<string, unknown>): Promise<void> {
  const db = getDb();
  const subId = subscription.id as string;

  console.log(`[Stripe] Subscription deleted: ${subId}`);

  await db
    .from("user_subscriptions")
    .update({
      status: "CANCELLED",
      cancelled_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", subId);
}

async function handleSubscriptionUpdated(subscription: Record<string, unknown>): Promise<void> {
  const db = getDb();
  const subId = subscription.id as string;
  const stripeStatus = subscription.status as string;

  console.log(`[Stripe] Subscription updated: ${subId}, status: ${stripeStatus}`);

  // Map Stripe status to our status
  const statusMap: Record<string, string> = {
    active: "ACTIVE",
    past_due: "PAST_DUE",
    canceled: "CANCELLED",
    unpaid: "PAST_DUE",
    trialing: "ACTIVE",
  };

  const newStatus = statusMap[stripeStatus];
  if (newStatus) {
    await db
      .from("user_subscriptions")
      .update({ status: newStatus })
      .eq("stripe_subscription_id", subId);
  }
}

// ─── Payment Intent Handlers (Pay-per-session) ──────────────

async function handlePaymentIntentSucceeded(paymentIntent: Record<string, unknown>): Promise<void> {
  const db = getDb();
  const piId = paymentIntent.id as string;
  const metadata = paymentIntent.metadata as Record<string, string> | undefined;
  const transactionId = metadata?.transaction_id;

  console.log(`[Stripe] PaymentIntent succeeded: ${piId}, transaction: ${transactionId}`);

  // Update invoice status to 'paid'
  const { data: invoice, error } = await db
    .from("invoices")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
    })
    .eq("stripe_payment_intent_id", piId)
    .select()
    .maybeSingle();

  if (error) {
    console.error("[Stripe] Failed to update invoice:", error);
  }

  if (invoice) {
    console.log(`[Stripe] Invoice ${invoice.invoice_number} marked as paid`);
  }

  // Update payment_status in CDRs and OCPP transactions
  if (transactionId) {
    await db.from("ocpp_transactions").update({
      payment_status: "paid",
      payment_intent_id: piId,
      paid_at: new Date().toISOString(),
    }).eq("id", transactionId);

    await db.from("ocpi_cdrs").update({
      payment_status: "paid",
      payment_intent_id: piId,
      paid_at: new Date().toISOString(),
    }).eq("id", transactionId);

    console.log(`[Stripe] CDR/Transaction ${transactionId} marked as paid`);
  }

  // Also try matching by metadata session_id (for spot payments)
  const sessionId = metadata?.session_id;
  if (sessionId) {
    await db.from("ocpi_cdrs").update({
      payment_status: "paid",
      payment_intent_id: piId,
      paid_at: new Date().toISOString(),
      payment_method: "stripe",
    }).eq("gfx_cdr_id", sessionId);
  }

  // ── Prepaid token recharge ──
  const tokenUid = metadata?.token_uid;
  const paymentType = metadata?.type;
  if (tokenUid && paymentType === "prepaid_recharge") {
    const amountReceived = (paymentIntent.amount_received as number) ?? (paymentIntent.amount as number) ?? 0;
    const rechargeAmount = amountReceived / 100; // Stripe amounts are in cents

    console.log(`[Stripe] Prepaid recharge for token ${tokenUid}: +${rechargeAmount}€`);

    const { data: result, error: rpcError } = await db.rpc("reactivate_prepaid_token", {
      p_token_uid: tokenUid,
      p_recharge_amount: rechargeAmount,
    });

    if (rpcError) {
      console.error(`[Stripe] Failed to reactivate prepaid token ${tokenUid}:`, rpcError);
    } else {
      console.log(`[Stripe] Prepaid token reactivated:`, result);
    }
  }
}

async function handlePaymentIntentFailed(paymentIntent: Record<string, unknown>): Promise<void> {
  const db = getDb();
  const piId = paymentIntent.id as string;
  const failureMessage = (paymentIntent.last_payment_error as Record<string, unknown>)?.message as string | undefined;

  console.log(`[Stripe] PaymentIntent failed: ${piId}, reason: ${failureMessage}`);

  // Keep invoice in draft status but log the failure
  const { data: invoice } = await db
    .from("invoices")
    .select("id, invoice_number, user_id")
    .eq("stripe_payment_intent_id", piId)
    .maybeSingle();

  if (invoice) {
    await db.from("invoices").update({
      notes: `Paiement échoué: ${failureMessage ?? "Erreur inconnue"} (${new Date().toISOString()})`,
    }).eq("id", invoice.id);
    console.log(`[Stripe] Invoice ${invoice.invoice_number} payment failed, user: ${invoice.user_id}`);
  }

  // Update payment_status in CDRs and OCPP transactions
  const metadata = paymentIntent.metadata as Record<string, string> | undefined;
  const transactionId = metadata?.transaction_id;
  if (transactionId) {
    await db.from("ocpp_transactions").update({
      payment_status: "failed",
      payment_intent_id: piId,
    }).eq("id", transactionId);

    await db.from("ocpi_cdrs").update({
      payment_status: "failed",
      payment_intent_id: piId,
    }).eq("id", transactionId);

    console.log(`[Stripe] CDR/Transaction ${transactionId} marked as failed`);
  }
}

// ─── Charge Refunded (Prepaid deduction) ────────────────────

async function handleChargeRefunded(charge: Record<string, unknown>): Promise<void> {
  const db = getDb();
  const chargeId = charge.id as string;
  const metadata = charge.metadata as Record<string, string> | undefined;
  const tokenUid = metadata?.token_uid;

  if (!tokenUid) {
    console.log(`[Stripe] Charge refunded ${chargeId} — no token_uid in metadata, skipping prepaid deduction`);
    return;
  }

  // Calculate refund amount (amount_refunded is in cents)
  const amountRefunded = (charge.amount_refunded as number) ?? 0;
  const refundAmount = amountRefunded / 100;

  console.log(`[Stripe] Charge refunded for token ${tokenUid}: -${refundAmount}€`);

  const { data: result, error: rpcError } = await db.rpc("deduct_prepaid_balance", {
    p_token_uid: tokenUid,
    p_session_cost: refundAmount,
  });

  if (rpcError) {
    console.error(`[Stripe] Failed to deduct prepaid balance for ${tokenUid}:`, rpcError);
  } else {
    console.log(`[Stripe] Prepaid balance deducted:`, result);
  }
}

// ─── Helper ─────────────────────────────────────────────────

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
