// ============================================================
// EZDrive — useTickets Hook
// Central hook for support tickets: CRUD, assignment, comments, SLA
// ============================================================

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// ── Types ──────────────────────────────────────────────────

export interface Ticket {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  station_id: string | null;
  created_by: string;
  assigned_to: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface TicketComment {
  id: string;
  ticket_id: string;
  user_id: string;
  content: string;
  created_at: string;
  // joined
  profiles?: { full_name: string | null; email: string | null } | null;
}

export interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
}

export interface TicketFilters {
  status?: string;
  assigned_to?: string;
}

// ── Queries ────────────────────────────────────────────────

/** Fetch all tickets with optional filters */
export function useTickets(filters?: TicketFilters) {
  return useQuery<Ticket[]>({
    queryKey: ["support-tickets", filters],
    queryFn: async () => {
      let query = supabase
        .from("support_tickets")
        .select("*")
        .order("created_at", { ascending: false });

      if (filters?.status && filters.status !== "all") {
        query = query.eq("status", filters.status);
      }
      if (filters?.assigned_to && filters.assigned_to !== "all") {
        query = query.eq("assigned_to", filters.assigned_to);
      }

      const { data, error } = await query;
      if (error) {
        console.warn("useTickets:", error.message);
        return [];
      }
      return (data ?? []) as Ticket[];
    },
  });
}

/** Fetch comments for a specific ticket */
export function useTicketComments(ticketId: string | null) {
  return useQuery<TicketComment[]>({
    queryKey: ["ticket-comments", ticketId],
    enabled: !!ticketId,
    queryFn: async () => {
      if (!ticketId) return [];
      const { data, error } = await supabase
        .from("ticket_comments")
        .select("*, profiles:user_id(full_name, email)")
        .eq("ticket_id", ticketId)
        .order("created_at", { ascending: true });

      if (error) {
        console.warn("useTicketComments:", error.message);
        return [];
      }
      return (data ?? []) as TicketComment[];
    },
  });
}

/** Fetch profiles for assignment dropdown */
export function useProfiles() {
  return useQuery<Profile[]>({
    queryKey: ["profiles-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .order("full_name");
      if (error) {
        console.warn("useProfiles:", error.message);
        return [];
      }
      return (data ?? []) as Profile[];
    },
    staleTime: 5 * 60 * 1000, // cache 5 min
  });
}

// ── Mutations ──────────────────────────────────────────────

/** Create a new ticket */
export function useCreateTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      data: {
        title: string;
        description: string;
        category: string;
        priority: string;
        station_id?: string;
        assigned_to?: string;
        created_by: string;
      }
    ) => {
      const { error } = await supabase.from("support_tickets").insert({
        title: data.title,
        description: data.description,
        category: data.category,
        priority: data.priority,
        station_id: data.station_id || null,
        assigned_to: data.assigned_to || null,
        created_by: data.created_by,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
    },
  });
}

/** Update a ticket (generic) */
export function useUpdateTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: Partial<Ticket> & { id: string }) => {
      const { error } = await supabase
        .from("support_tickets")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
    },
  });
}

/** Assign a ticket to a user */
export function useAssignTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      assigned_to,
    }: {
      id: string;
      assigned_to: string | null;
    }) => {
      const { error } = await supabase
        .from("support_tickets")
        .update({ assigned_to, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
    },
  });
}

/** Add a comment to a ticket */
export function useAddComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      ticket_id,
      user_id,
      content,
    }: {
      ticket_id: string;
      user_id: string;
      content: string;
    }) => {
      const { error } = await supabase.from("ticket_comments").insert({
        ticket_id,
        user_id,
        content,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["ticket-comments", variables.ticket_id],
      });
    },
  });
}

/** Archive (soft delete) a ticket */
export function useDeleteTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ticketId: string) => {
      const { error } = await supabase
        .from("support_tickets")
        .update({
          status: "archived",
          deleted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", ticketId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
    },
  });
}

/** Close a ticket */
export function useCloseTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      resolution_notes,
    }: {
      id: string;
      resolution_notes?: string;
    }) => {
      const { error } = await supabase
        .from("support_tickets")
        .update({
          status: "closed",
          resolved_at: new Date().toISOString(),
          resolution_notes: resolution_notes || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
    },
  });
}

// ── SLA Helpers (client-side) ──────────────────────────────

/** Calculate hours elapsed since a given ISO date */
export function hoursElapsed(isoDate: string): number {
  return (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60);
}

/** Get SLA badge info based on hours since creation */
export function getSLABadge(createdAt: string): {
  label: string;
  color: string;
  bg: string;
} {
  const h = hoursElapsed(createdAt);
  if (h < 4) {
    return {
      label: `${Math.floor(h * 60)}min`,
      color: "text-emerald-400",
      bg: "bg-emerald-500/10 border-emerald-500/20",
    };
  }
  if (h < 24) {
    return {
      label: `${Math.floor(h)}h`,
      color: "text-amber-400",
      bg: "bg-amber-500/10 border-amber-500/20",
    };
  }
  const days = Math.floor(h / 24);
  return {
    label: `${days}j ${Math.floor(h % 24)}h`,
    color: "text-red-400",
    bg: "bg-red-500/10 border-red-500/20",
  };
}

/** Calculate first response time (time between creation and first comment) */
export function getFirstResponseTime(
  createdAt: string,
  comments: TicketComment[]
): string | null {
  if (!comments || comments.length === 0) return null;
  const firstComment = comments[0]; // already sorted ascending
  const diffMs =
    new Date(firstComment.created_at).getTime() -
    new Date(createdAt).getTime();
  const diffH = diffMs / (1000 * 60 * 60);
  if (diffH < 1) return `${Math.floor(diffH * 60)}min`;
  if (diffH < 24) return `${Math.floor(diffH)}h`;
  return `${Math.floor(diffH / 24)}j ${Math.floor(diffH % 24)}h`;
}

/** Relative time label in French */
export function relativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `il y a ${days}j`;
  return new Date(isoDate).toLocaleDateString("fr-FR");
}
