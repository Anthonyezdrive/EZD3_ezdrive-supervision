// ============================================================
// EZDrive — useInterventions Hook
// Central hook for all intervention CRUD + assignment + time tracking
// ============================================================

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// ── Types ──────────────────────────────────────────────────

export interface Intervention {
  id: string;
  station_id: string | null;
  station_name: string | null;
  type: string;
  title: string;
  description: string | null;
  technician: string | null;
  status: "planned" | "in_progress" | "completed" | "cancelled";
  priority: "low" | "medium" | "high" | "critical";
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  report: string | null;
  parts_used: string | null;
  duration_minutes: number | null;
  created_at: string;
  // New columns (may not exist in DB yet — handled gracefully)
  assigned_to: string | null;
  started_work_at: string | null;
  completed_work_at: string | null;
  is_recurring: boolean | null;
  recurrence_interval: "weekly" | "monthly" | "quarterly" | null;
  next_occurrence: string | null;
}

export interface InterventionFilters {
  status?: string;
  assigned_to?: string;
  priority?: string;
  technician?: string;
}

export interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
}

// ── Queries ────────────────────────────────────────────────

export function useInterventions(filters?: InterventionFilters) {
  return useQuery<Intervention[]>({
    queryKey: ["interventions", filters],
    retry: false,
    queryFn: async () => {
      try {
        let query = supabase
          .from("interventions")
          .select("*")
          .order("created_at", { ascending: false });

        if (filters?.status && filters.status !== "all") {
          query = query.eq("status", filters.status);
        }
        if (filters?.priority && filters.priority !== "all") {
          query = query.eq("priority", filters.priority);
        }
        if (filters?.assigned_to) {
          query = query.eq("assigned_to", filters.assigned_to);
        }
        if (filters?.technician) {
          query = query.ilike("technician", `%${filters.technician}%`);
        }

        const { data, error } = await query;
        if (error) {
          console.warn("[useInterventions] query error:", error.message);
          return [];
        }
        return (data ?? []) as Intervention[];
      } catch {
        return [];
      }
    },
  });
}

export function useInterventionById(id: string | null) {
  return useQuery<Intervention | null>({
    queryKey: ["interventions", id],
    enabled: !!id,
    retry: false,
    queryFn: async () => {
      if (!id) return null;
      try {
        const { data, error } = await supabase
          .from("interventions")
          .select("*")
          .eq("id", id)
          .single();
        if (error) {
          console.warn("[useInterventionById] error:", error.message);
          return null;
        }
        return data as Intervention;
      } catch {
        return null;
      }
    },
  });
}

export function useAvailableTechnicians() {
  return useQuery<Profile[]>({
    queryKey: ["available-technicians"],
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .order("full_name");
        if (error) {
          console.warn("[useAvailableTechnicians] error:", error.message);
          return [];
        }
        return (data ?? []) as Profile[];
      } catch {
        return [];
      }
    },
  });
}

// ── Mutations ──────────────────────────────────────────────

export function useCreateIntervention() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      station_id?: string | null;
      station_name?: string | null;
      type: string;
      title: string;
      description?: string | null;
      technician?: string | null;
      priority: string;
      scheduled_at?: string | null;
      assigned_to?: string | null;
      is_recurring?: boolean;
      recurrence_interval?: string | null;
      next_occurrence?: string | null;
    }) => {
      const insertData: Record<string, unknown> = {
        station_id: payload.station_id || null,
        station_name: payload.station_name || null,
        type: payload.type,
        title: payload.title,
        description: payload.description || null,
        technician: payload.technician || null,
        priority: payload.priority,
        scheduled_at: payload.scheduled_at || null,
        status: "planned",
      };

      // New columns — only include if truthy to avoid errors if columns don't exist yet
      if (payload.assigned_to) insertData.assigned_to = payload.assigned_to;
      if (payload.is_recurring) {
        insertData.is_recurring = true;
        insertData.recurrence_interval = payload.recurrence_interval || null;
        insertData.next_occurrence = payload.next_occurrence || null;
      }

      const { error } = await supabase.from("interventions").insert(insertData);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["interventions"] });
    },
  });
}

export function useUpdateIntervention() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Record<string, unknown>) => {
      const patch: Record<string, unknown> = {};

      const fields = [
        "title", "description", "technician", "priority", "type",
        "scheduled_at", "report", "parts_used", "duration_minutes",
        "status", "assigned_to", "is_recurring", "recurrence_interval",
        "next_occurrence",
      ];

      for (const key of fields) {
        if (data[key] !== undefined) {
          patch[key] = data[key] === "" ? null : data[key];
        }
      }

      // Auto-set timestamp fields based on status changes
      if (data.status === "in_progress") {
        patch.started_at = new Date().toISOString();
      }
      if (data.status === "completed") {
        patch.completed_at = new Date().toISOString();
      }

      const { error } = await supabase.from("interventions").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["interventions"] });
    },
  });
}

export function useAssignIntervention() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, assigned_to, technician }: {
      id: string;
      assigned_to: string | null;
      technician?: string | null;
    }) => {
      const patch: Record<string, unknown> = { assigned_to };
      if (technician !== undefined) patch.technician = technician;

      const { error } = await supabase.from("interventions").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["interventions"] });
    },
  });
}

/** Archive (soft delete) an intervention */
export function useDeleteIntervention() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (interventionId: string) => {
      const { error } = await supabase
        .from("interventions")
        .update({ status: "archived" })
        .eq("id", interventionId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["interventions"] });
    },
  });
}

export function useStartWork() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const now = new Date().toISOString();
      const patch: Record<string, unknown> = {
        status: "in_progress",
        started_at: now,
      };
      // Try to set started_work_at — may fail if column doesn't exist
      try {
        const { error } = await supabase
          .from("interventions")
          .update({ ...patch, started_work_at: now })
          .eq("id", id);
        if (error) {
          // Fallback without started_work_at
          const { error: fallbackErr } = await supabase
            .from("interventions")
            .update(patch)
            .eq("id", id);
          if (fallbackErr) throw fallbackErr;
        }
      } catch (err) {
        const { error } = await supabase
          .from("interventions")
          .update(patch)
          .eq("id", id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["interventions"] });
    },
  });
}

export function useStopWork() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, report, parts_used, duration_minutes }: {
      id: string;
      report?: string | null;
      parts_used?: string | null;
      duration_minutes?: number | null;
    }) => {
      const now = new Date().toISOString();
      const patch: Record<string, unknown> = {
        status: "completed",
        completed_at: now,
      };
      if (report !== undefined) patch.report = report || null;
      if (parts_used !== undefined) patch.parts_used = parts_used || null;
      if (duration_minutes !== undefined) patch.duration_minutes = duration_minutes;

      // Try to set completed_work_at — may fail if column doesn't exist
      try {
        const { error } = await supabase
          .from("interventions")
          .update({ ...patch, completed_work_at: now })
          .eq("id", id);
        if (error) {
          const { error: fallbackErr } = await supabase
            .from("interventions")
            .update(patch)
            .eq("id", id);
          if (fallbackErr) throw fallbackErr;
        }
      } catch (err) {
        const { error } = await supabase
          .from("interventions")
          .update(patch)
          .eq("id", id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["interventions"] });
    },
  });
}
