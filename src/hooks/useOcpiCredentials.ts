// ============================================================
// EZDrive — OCPI Credentials Hooks
// Queries & mutations for OCPI credential wizard, endpoint testing, handshake
// ============================================================

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// ── Types ─────────────────────────────────────────────────────

export interface OcpiSubscriptionRow {
  id: string;
  name: string;
  country_code: string;
  party_id: string;
  role: "CPO" | "EMSP" | "HUB";
  versions_url: string | null;
  token_a: string | null;
  token_b: string | null;
  token_c: string | null;
  status: "PENDING" | "CONNECTED" | "SUSPENDED" | "BLOCKED";
  created_at: string;
  updated_at: string;
  cpo_id: string | null;
}

export interface EndpointTestResult {
  module: string;
  status_code: number;
  latency_ms: number;
  response_preview: string;
  success: boolean;
}

export interface HandshakeLog {
  step: string;
  status: "pending" | "running" | "success" | "error";
  message?: string;
}

// ── Queries ───────────────────────────────────────────────────

export function useOcpiSubscriptions(cpoId?: string | null) {
  return useQuery<OcpiSubscriptionRow[]>({
    queryKey: ["ocpi-subscriptions", cpoId ?? "all"],
    queryFn: async () => {
      let query = supabase.from("ocpi_credentials").select("*");
      if (cpoId) {
        query = query.eq("cpo_id", cpoId);
      }
      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as OcpiSubscriptionRow[];
    },
  });
}

// ── Mutations ─────────────────────────────────────────────────

/** Generate a random OCPI-compliant token (64 hex chars) */
export function generateOcpiToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Register a new OCPI partner */
export function useRegisterPartner() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      name: string;
      country_code: string;
      party_id: string;
      role: "CPO" | "EMSP" | "HUB";
      versions_url: string;
      token_a: string;
      token_b: string;
      cpo_id?: string | null;
    }) => {
      const { data, error } = await supabase
        .from("ocpi_credentials")
        .insert({
          role: params.role,
          country_code: params.country_code,
          party_id: params.party_id,
          versions_url: params.versions_url,
          token_a: params.token_a,
          token_b: params.token_b,
          status: "PENDING",
          platform: "PROD",
          cpo_id: params.cpo_id ?? null,
          gireve_country_code: params.country_code,
          gireve_party_id: params.party_id,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ocpi-subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["ocpi-credentials"] });
    },
  });
}

/** Trigger OCPI handshake via edge function */
export function useTriggerHandshake() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (subscriptionId: string) => {
      const { data, error } = await supabase.functions.invoke("api", {
        body: {
          action: "ocpi_handshake",
          subscription_id: subscriptionId,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ocpi-subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["ocpi-credentials"] });
    },
  });
}

/** Regenerate token_a for a subscription */
export function useRegenerateToken() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (subscriptionId: string) => {
      const newToken = generateOcpiToken();
      const { data, error } = await supabase
        .from("ocpi_credentials")
        .update({ token_a: newToken, updated_at: new Date().toISOString() })
        .eq("id", subscriptionId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ocpi-subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["ocpi-credentials"] });
    },
  });
}

/** Update an OCPI partner */
export function useUpdateOcpiPartner() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      id: string;
      party_id: string;
      country_code: string;
      role: "CPO" | "EMSP" | "HUB";
      versions_url: string;
      gireve_country_code?: string;
      gireve_party_id?: string;
    }) => {
      const { data, error } = await supabase
        .from("ocpi_credentials")
        .update({
          party_id: params.party_id,
          country_code: params.country_code,
          role: params.role,
          versions_url: params.versions_url,
          gireve_country_code: params.gireve_country_code ?? params.country_code,
          gireve_party_id: params.gireve_party_id ?? params.party_id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", params.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ocpi-subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["ocpi-credentials"] });
    },
  });
}

/** Delete an OCPI partner */
export function useDeleteOcpiPartner() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (partnerId: string) => {
      const { error } = await supabase
        .from("ocpi_credentials")
        .delete()
        .eq("id", partnerId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ocpi-subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["ocpi-credentials"] });
    },
  });
}

/** Test an OCPI endpoint (module) via edge function */
export function useTestEndpoint() {
  return useMutation({
    mutationFn: async (params: {
      module: string;
      url: string;
      token: string;
    }): Promise<EndpointTestResult> => {
      const start = performance.now();

      const { data, error } = await supabase.functions.invoke("api", {
        body: {
          action: "ocpi_test_endpoint",
          module: params.module,
          url: params.url,
          token: params.token,
        },
      });

      const latency = Math.round(performance.now() - start);

      if (error) {
        return {
          module: params.module,
          status_code: 0,
          latency_ms: latency,
          response_preview: error.message ?? "Erreur de connexion",
          success: false,
        };
      }

      const statusCode = data?.status_code ?? data?.statusCode ?? 200;
      const preview = JSON.stringify(data?.body ?? data ?? {}).slice(0, 200);

      return {
        module: params.module,
        status_code: statusCode,
        latency_ms: latency,
        response_preview: preview,
        success: statusCode >= 200 && statusCode < 300,
      };
    },
  });
}
