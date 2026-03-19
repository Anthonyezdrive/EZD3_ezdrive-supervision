// ============================================================
// EZDrive Consumer API — Main Router
// Serves all mobile app endpoints from a single edge function
// Pattern: /functions/v1/api/{module}/{action}
//
// Port & improvement of Resonovia's 3 Python microservices
// into a unified TypeScript/Deno edge function
// ============================================================

import { apiCorsResponse, apiNotFound, apiServerError, apiUnauthorized, apiBadRequest } from "../_shared/api-response.ts";
import { requireAuth, optionalAuth, AuthError } from "../_shared/auth-middleware.ts";

// Module imports
import { handleStations } from "./_modules/stations.ts";
import { handleAuth } from "./_modules/auth.ts";
import { handleUser } from "./_modules/user.ts";
import { handleReviews } from "./_modules/reviews.ts";
import { handleReports } from "./_modules/reports.ts";
import { handleSubscriptions } from "./_modules/subscriptions.ts";
import { handleRfid } from "./_modules/rfid.ts";
import { handleCharging } from "./_modules/charging.ts";
import { handleMedia } from "./_modules/media.ts";
import { handleDevices } from "./_modules/devices.ts";
import { handleBusiness } from "./_modules/business.ts";
import { handleOcpp } from "./_modules/ocpp.ts";
import { handleCustomers } from "./_modules/customers.ts";
import { handleAdminStations } from "./_modules/admin-stations.ts";
import { handleInvoices } from "./_modules/invoices.ts";
import { handleCoupons } from "./_modules/coupons.ts";
import { handleRoles } from "./_modules/roles.ts";
import { handleEnergyMix } from "./_modules/energy-mix.ts";
import { handleExceptions } from "./_modules/exceptions.ts";
import { handleAdminUsers } from "./_modules/admin-users.ts";
import { handleTechnician } from "./_modules/technician.ts";

Deno.serve(async (req: Request): Promise<Response> => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return apiCorsResponse();
  }

  try {
    const url = new URL(req.url);
    // Path after /functions/v1/api/ (Supabase runtime may strip /functions/v1/)
    const fullPath = url.pathname
      .replace(/^\/functions\/v1\/api\/?/, "")
      .replace(/^\/api\/?/, "")
      .replace(/\/$/, "");
    const segments = fullPath.split("/").filter(Boolean);
    const module = segments[0] ?? "";
    const rest = segments.slice(1);

    // Route context passed to each module
    const ctx = { req, url, segments: rest, method: req.method };

    switch (module) {
      // ─── Public / Optional Auth ────────────────────────────
      case "stations":
        return await handleStations(ctx);

      case "networks":
        return await handleStations({ ...ctx, segments: ["_networks"] });

      // ─── Auth (no token required) ──────────────────────────
      case "auth":
        return await handleAuth(ctx);

      // ─── Business contact (no auth) ────────────────────────
      case "business":
        return await handleBusiness(ctx);

      // ─── Protected routes ──────────────────────────────────
      case "user":
        return await withAuth(req, (auth) => handleUser({ ...ctx, auth }));

      case "reviews":
        return await withAuth(req, (auth) => handleReviews({ ...ctx, auth }));

      case "reports":
        return await withAuth(req, (auth) => handleReports({ ...ctx, auth }));

      case "subscriptions":
        return await withAuth(req, (auth) => handleSubscriptions({ ...ctx, auth }));

      case "rfid":
        return await withAuth(req, (auth) => handleRfid({ ...ctx, auth }));

      case "sessions":
      case "charging":
        return await withAuth(req, (auth) => handleCharging({ ...ctx, auth, segments: [module, ...rest] }));

      case "greenflux":
        return await withAuth(req, (auth) => handleCharging({ ...ctx, auth, segments: ["greenflux", ...rest] }));

      case "devices":
        return await withAuth(req, (auth) => handleDevices({ ...ctx, auth }));

      case "media":
        return await withAuth(req, (auth) => handleMedia({ ...ctx, auth }));

      // ─── OCPP Dashboard (admin/operator only) ────────────
      case "ocpp":
        return await withAuth(req, (auth) => handleOcpp({ ...ctx, auth }));

      // ─── CRM Admin (admin/operator only) ────────────────
      case "customers":
        return await withAuth(req, (auth) => handleCustomers({ ...ctx, auth }));

      // ─── Invoices (consumer + admin) ─────────────────────
      case "invoices":
        return await withAuth(req, (auth) => handleInvoices({ ...ctx, auth }));

      // ─── Stations Admin (admin/operator only) ──────────
      case "admin-stations":
        return await withAuth(req, (auth) => handleAdminStations({ ...ctx, auth }));

      // ─── Coupons (admin/operator) ─────────────────────
      case "coupons":
        return await withAuth(req, (auth) => handleCoupons({ ...ctx, auth }));

      // ─── Roles & Groups RBAC (admin only) ──────────────
      case "roles":
        return await withAuth(req, (auth) => handleRoles({ ...ctx, auth }));

      // ─── Energy Mix Profiles (admin/operator) ──────────
      case "energy-mix":
        return await withAuth(req, (auth) => handleEnergyMix({ ...ctx, auth }));

      // ─── Exception Groups & Rules (admin/operator) ─────
      case "exceptions":
        return await withAuth(req, (auth) => handleExceptions({ ...ctx, auth }));

      // ─── Admin User Management (admin only) ──────────
      case "admin-users":
        return await withAuth(req, (auth) => handleAdminUsers({ ...ctx, auth }));

      // ─── Technician (interventions, diagnostics, firmware) ──
      case "technician":
        return await withAuth(req, (auth) => handleTechnician({ ...ctx, auth }));

      default:
        return apiNotFound(`Unknown endpoint: /api/${fullPath}`);
    }
  } catch (err) {
    console.error("[API] Unhandled error:", err);
    if (err instanceof AuthError) {
      return apiUnauthorized(err.message);
    }
    return apiServerError(err instanceof Error ? err.message : "Internal Server Error");
  }
});

// ─── Helper: Wrap handler with auth ─────────────────────────

interface AuthInfo {
  user: { id: string; email: string };
  token: string;
}

async function withAuth(
  req: Request,
  handler: (auth: AuthInfo) => Promise<Response>,
): Promise<Response> {
  const auth = await requireAuth(req);
  return handler(auth);
}

// ─── Exported types for modules ─────────────────────────────

export interface RouteContext {
  req: Request;
  url: URL;
  segments: string[];
  method: string;
  auth?: AuthInfo;
}
