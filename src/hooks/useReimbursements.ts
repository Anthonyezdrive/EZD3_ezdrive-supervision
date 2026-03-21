import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

export interface ReimbursementConfig {
  id: string;
  b2b_client_id: string;
  enabled: boolean;
  rate_per_kwh: number;
  charging_types: string[];
  max_monthly_amount: number | null;
  payment_method: string;
  iban: string | null;
  billing_day: number;
}

export interface ReimbursementRun {
  id: string;
  b2b_client_id: string;
  period_start: string;
  period_end: string;
  status: "pending" | "calculated" | "approved" | "paid" | "rejected";
  total_drivers: number;
  total_kwh: number;
  total_amount_cents: number;
  invoice_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface ReimbursementLineItem {
  id: string;
  run_id: string;
  driver_id: string;
  driver_name: string | null;
  driver_email: string | null;
  session_count: number;
  total_kwh: number;
  rate_per_kwh: number;
  amount_cents: number;
  charging_type: string;
  capped: boolean;
}

export function useReimbursementConfig(clientId: string | null) {
  return useQuery({
    queryKey: ["reimbursement-config", clientId],
    queryFn: async () => {
      if (!clientId) return null;
      const { data, error } = await supabase
        .from("reimbursement_config")
        .select("*")
        .eq("b2b_client_id", clientId)
        .maybeSingle();
      if (error) throw error;
      return data as ReimbursementConfig | null;
    },
    enabled: !!clientId,
  });
}

export function useReimbursementRuns(clientId?: string) {
  return useQuery({
    queryKey: ["reimbursement-runs", clientId],
    queryFn: async () => {
      let query = supabase
        .from("reimbursement_runs")
        .select("*")
        .order("period_start", { ascending: false });
      if (clientId) query = query.eq("b2b_client_id", clientId);
      const { data, error } = await query;
      if (error) throw error;
      return data as ReimbursementRun[];
    },
  });
}

export function useReimbursementLineItems(runId: string | null) {
  return useQuery({
    queryKey: ["reimbursement-items", runId],
    queryFn: async () => {
      if (!runId) return [];
      const { data, error } = await supabase
        .from("reimbursement_line_items")
        .select("*")
        .eq("run_id", runId)
        .order("amount_cents", { ascending: false });
      if (error) throw error;
      return data as ReimbursementLineItem[];
    },
    enabled: !!runId,
  });
}

export function useAllReimbursementConfigs() {
  return useQuery({
    queryKey: ["reimbursement-configs-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reimbursement_config")
        .select("*")
        .order("b2b_client_id");
      if (error) throw error;
      return data as ReimbursementConfig[];
    },
  });
}

/** Cancel a reimbursement run (pending → hard delete, otherwise → soft cancel) */
export function useDeleteReimbursementRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      if (status === "pending") {
        // Hard delete for pending runs
        const { error } = await supabase
          .from("reimbursement_runs")
          .delete()
          .eq("id", id);
        if (error) throw error;
      } else {
        // Soft cancel for other statuses
        const { error } = await supabase
          .from("reimbursement_runs")
          .update({ status: "cancelled" })
          .eq("id", id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reimbursement-runs"] });
    },
  });
}

export function useUpdateReimbursementConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (config: Partial<ReimbursementConfig> & { b2b_client_id: string }) => {
      const { data, error } = await supabase
        .from("reimbursement_config")
        .upsert(config, { onConflict: "b2b_client_id" })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["reimbursement-config", vars.b2b_client_id] });
      qc.invalidateQueries({ queryKey: ["reimbursement-configs-all"] });
    },
  });
}
