import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { B2BClient } from "@/types/b2b";

// ── Types ────────────────────────────────────────────────

export interface B2BUserRow {
  user_id: string;
  email: string;
  full_name: string;
  client_id: string | null;
  client_name: string | null;
  client_slug: string | null;
  created_at: string;
}

// ── Queries ──────────────────────────────────────────────

/** All B2B clients (including inactive) with user count */
export function useB2BClientsAdmin() {
  return useQuery({
    queryKey: ["b2b-clients-admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("b2b_clients")
        .select("*")
        .order("name");
      if (error) throw error;

      // Count users per client
      const { data: accessData } = await supabase
        .from("b2b_client_access")
        .select("b2b_client_id");

      const countMap = new Map<string, number>();
      for (const a of accessData ?? []) {
        countMap.set(a.b2b_client_id, (countMap.get(a.b2b_client_id) ?? 0) + 1);
      }

      return (data ?? []).map((c: B2BClient) => ({
        ...c,
        userCount: countMap.get(c.id) ?? 0,
      }));
    },
    staleTime: 30_000,
  });
}

/** All B2B users via RPC */
export function useB2BUsersAdmin() {
  return useQuery({
    queryKey: ["b2b-users-admin"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_b2b_users");
      if (error) throw error;
      return (data ?? []) as B2BUserRow[];
    },
    staleTime: 30_000,
  });
}

// ── Mutations ────────────────────────────────────────────

/** Create a B2B user account */
export function useCreateB2BUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      email: string;
      password: string;
      clientId: string;
      fullName?: string;
    }) => {
      const { data, error } = await supabase.rpc("admin_create_b2b_user", {
        p_email: params.email,
        p_password: params.password,
        p_client_id: params.clientId,
        p_full_name: params.fullName || null,
      });
      if (error) throw error;
      return data as string; // user_id
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["b2b-users-admin"] });
      qc.invalidateQueries({ queryKey: ["b2b-clients-admin"] });
    },
  });
}

/** Delete a B2B user */
export function useDeleteB2BUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc("admin_delete_b2b_user", {
        p_user_id: userId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["b2b-users-admin"] });
      qc.invalidateQueries({ queryKey: ["b2b-clients-admin"] });
    },
  });
}

/** Update a B2B client */
export function useUpdateB2BClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      id: string;
      name?: string;
      slug?: string;
      customer_external_ids?: string[];
      redevance_rate?: number;
      is_active?: boolean;
    }) => {
      const { id, ...updates } = params;
      const { error } = await supabase
        .from("b2b_clients")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["b2b-clients-admin"] });
      qc.invalidateQueries({ queryKey: ["b2b-clients"] });
    },
  });
}

/** Create a new B2B client */
export function useCreateB2BClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      name: string;
      slug: string;
      customer_external_ids: string[];
      redevance_rate: number;
    }) => {
      const { data, error } = await supabase
        .from("b2b_clients")
        .insert(params)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["b2b-clients-admin"] });
      qc.invalidateQueries({ queryKey: ["b2b-clients"] });
    },
  });
}

/** Delete a B2B client */
export function useDeleteB2BClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (clientId: string) => {
      const { error } = await supabase
        .from("b2b_clients")
        .delete()
        .eq("id", clientId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["b2b-clients-admin"] });
      qc.invalidateQueries({ queryKey: ["b2b-clients"] });
    },
  });
}
