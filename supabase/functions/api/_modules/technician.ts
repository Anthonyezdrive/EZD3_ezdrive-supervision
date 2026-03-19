// ============================================================
// EZDrive API — Technician Module
// Interventions CRUD, diagnostics, firmware updates
//
// Endpoints:
//   GET    /api/technician/interventions          — List interventions
//   POST   /api/technician/interventions          — Create intervention
//   GET    /api/technician/interventions/:id       — Detail
//   PUT    /api/technician/interventions/:id       — Update (status, notes, photos)
//   POST   /api/technician/diagnostics            — Request OCPP GetDiagnostics
//   POST   /api/technician/firmware               — Request OCPP UpdateFirmware
//   GET    /api/technician/kpis                   — Technician KPIs
// ============================================================

import {
  apiSuccess,
  apiCreated,
  apiBadRequest,
  apiForbidden,
  apiNotFound,
  apiServerError,
  apiPaginated,
  parsePagination,
} from "../../_shared/api-response.ts";
import { getServiceClient } from "../../_shared/auth-middleware.ts";
import type { RouteContext } from "../index.ts";

export async function handleTechnician(ctx: RouteContext): Promise<Response> {
  const { method, segments, auth } = ctx;
  if (!auth) return apiForbidden("Authentication required");

  const db = getServiceClient();
  const action = segments[0] ?? "";

  // ── KPIs ──
  if (action === "kpis" && method === "GET") {
    try {
      const [total, assigned, inProgress, completed, faulted] = await Promise.all([
        db.from("interventions").select("id", { count: "exact", head: true }),
        db.from("interventions").select("id", { count: "exact", head: true }).eq("status", "assigned"),
        db.from("interventions").select("id", { count: "exact", head: true }).eq("status", "in_progress"),
        db.from("interventions").select("id", { count: "exact", head: true }).eq("status", "completed"),
        db.from("stations").select("id", { count: "exact", head: true }).eq("ocpp_status", "Faulted"),
      ]);
      return apiSuccess({
        total: total.count ?? 0,
        assigned: assigned.count ?? 0,
        in_progress: inProgress.count ?? 0,
        completed: completed.count ?? 0,
        faulted_stations: faulted.count ?? 0,
      });
    } catch (err) {
      return apiServerError("Failed to fetch KPIs");
    }
  }

  // ── Diagnostics ──
  if (action === "diagnostics" && method === "POST") {
    try {
      const body = await ctx.req.json();
      const { chargepoint_identity } = body;
      if (!chargepoint_identity) return apiBadRequest("chargepoint_identity required");

      const commandId = crypto.randomUUID();
      const { error } = await db.from("ocpp_command_queue").insert({
        id: commandId,
        chargepoint_identity,
        command: "GetDiagnostics",
        payload: { location: "https://ezdrive-ocpp.fly.dev/diagnostics/" },
        status: "PENDING",
        requested_by: auth.user.id,
      });
      if (error) throw error;
      return apiCreated({ command_id: commandId, command: "GetDiagnostics", status: "PENDING" });
    } catch (err) {
      return apiServerError("Failed to request diagnostics");
    }
  }

  // ── Firmware Update ──
  if (action === "firmware" && method === "POST") {
    try {
      const body = await ctx.req.json();
      const { chargepoint_identity, firmware_url } = body;
      if (!chargepoint_identity) return apiBadRequest("chargepoint_identity required");
      if (!firmware_url) return apiBadRequest("firmware_url required");

      const commandId = crypto.randomUUID();
      const { error } = await db.from("ocpp_command_queue").insert({
        id: commandId,
        chargepoint_identity,
        command: "UpdateFirmware",
        payload: {
          location: firmware_url,
          retrieveDate: new Date().toISOString(),
          retries: 3,
          retryInterval: 60,
        },
        status: "PENDING",
        requested_by: auth.user.id,
      });
      if (error) throw error;
      return apiCreated({ command_id: commandId, command: "UpdateFirmware", status: "PENDING" });
    } catch (err) {
      return apiServerError("Failed to request firmware update");
    }
  }

  // ── Interventions CRUD ──
  if (action === "interventions" || action === "") {
    const interventionId = segments[1] ?? "";

    // LIST
    if (!interventionId && method === "GET") {
      try {
        const { offset, limit } = parsePagination(ctx.url);
        const status = ctx.url.searchParams.get("status");
        const assignedTo = ctx.url.searchParams.get("assigned_to");

        let query = db
          .from("interventions")
          .select("*, stations(name, city, ocpp_identity)")
          .order("created_at", { ascending: false })
          .range(offset, offset + limit - 1);

        if (status) query = query.eq("status", status);
        if (assignedTo) query = query.eq("assigned_to", assignedTo);

        const { data, error } = await query;
        if (error) throw error;
        return apiSuccess(data ?? []);
      } catch (err) {
        return apiServerError("Failed to list interventions");
      }
    }

    // CREATE
    if (!interventionId && method === "POST") {
      try {
        const body = await ctx.req.json();
        if (!body.title) return apiBadRequest("title required");

        const { data, error } = await db.from("interventions").insert({
          title: body.title,
          description: body.description ?? null,
          station_id: body.station_id ?? null,
          assigned_to: body.assigned_to ?? auth.user.id,
          category: body.category ?? "maintenance",
          priority: body.priority ?? "medium",
          status: "assigned",
          scheduled_at: body.scheduled_at ?? null,
          created_by: auth.user.id,
        }).select().single();

        if (error) throw error;
        return apiCreated(data);
      } catch (err) {
        return apiServerError("Failed to create intervention");
      }
    }

    // DETAIL
    if (interventionId && method === "GET") {
      const { data, error } = await db
        .from("interventions")
        .select("*, stations(name, city, address, ocpp_identity, latitude, longitude)")
        .eq("id", interventionId)
        .maybeSingle();
      if (error || !data) return apiNotFound("Intervention not found");
      return apiSuccess(data);
    }

    // UPDATE
    if (interventionId && method === "PUT") {
      try {
        const body = await ctx.req.json();
        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

        const allowed = ["title", "description", "category", "priority", "status", "actions_performed", "resolution_notes", "photos", "duration_minutes"];
        for (const f of allowed) {
          if (body[f] !== undefined) updates[f] = body[f];
        }

        if (body.status === "in_progress" && !updates.started_at) {
          updates.started_at = new Date().toISOString();
        }
        if (body.status === "completed") {
          updates.completed_at = new Date().toISOString();
        }

        const { data, error } = await db
          .from("interventions")
          .update(updates)
          .eq("id", interventionId)
          .select()
          .single();

        if (error) throw error;
        return apiSuccess(data);
      } catch (err) {
        return apiServerError("Failed to update intervention");
      }
    }
  }

  return apiBadRequest("Unknown technician endpoint");
}
