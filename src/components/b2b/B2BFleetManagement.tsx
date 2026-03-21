// ============================================================
// EZDrive — B2B Fleet Management (Self-service)
// Add/remove drivers + RFID badge requests for B2B clients
// ============================================================

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  UserPlus, Nfc, X, Loader2, Clock, CheckCircle2, XCircle,
  ChevronDown, CheckCircle, Trash2,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, formatRelativeTime } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface B2BFleetManagementProps {
  clientId: string;
  clientName: string;
  drivers: FleetDriver[];
  onDriversChanged: () => void;
}

interface FleetDriver {
  id: string;
  driver_external_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  status: string;
}

interface TokenRequest {
  id: string;
  b2b_client_id: string;
  requested_by: string;
  driver_name: string;
  reason: string | null;
  status: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const inputClass =
  "w-full px-3 py-2 text-sm bg-surface border border-border rounded-xl text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary/40";

const thClass =
  "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-foreground-muted";
const tdClass = "px-4 py-3.5 text-sm text-foreground whitespace-nowrap";

function driverName(d: FleetDriver): string {
  if (d.full_name) return d.full_name;
  const parts = [d.first_name, d.last_name].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "—";
}

function requestStatusBadge(status: string) {
  const s = status?.toLowerCase() ?? "pending";
  if (s === "approved")
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400">
        <CheckCircle2 className="w-3 h-3" />
        Approuve
      </span>
    );
  if (s === "rejected")
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400">
        <XCircle className="w-3 h-3" />
        Refuse
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400">
      <Clock className="w-3 h-3" />
      En attente
    </span>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function B2BFleetManagement({
  clientId,
  clientName,
  drivers,
  onDriversChanged,
}: B2BFleetManagementProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { success: toastSuccess, error: toastError } = useToast();

  // Local state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBadgeModal, setShowBadgeModal] = useState(false);

  // -------------------------------------------------------------------------
  // Add driver mutation
  // -------------------------------------------------------------------------

  const addDriverMutation = useMutation({
    mutationFn: async (form: {
      first_name: string;
      last_name: string;
      email: string;
      vehicle: string;
    }) => {
      if (!form.first_name.trim() || !form.last_name.trim()) {
        throw new Error("Prenom et nom requis");
      }
      const driverExternalId = `b2b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const fullName = `${form.first_name.trim()} ${form.last_name.trim()}`;
      const { error } = await supabase.from("all_consumers").insert({
        id: crypto.randomUUID(),
        driver_external_id: driverExternalId,
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        full_name: fullName,
        email: form.email.trim() || null,
        customer_name: clientName,
        status: "active",
        total_sessions: 0,
        total_energy_kwh: 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toastSuccess("Conducteur ajoute a la flotte");
      queryClient.invalidateQueries({ queryKey: ["b2b-fleet-drivers"] });
      onDriversChanged();
      setShowAddModal(false);
    },
    onError: (err: Error) => {
      toastError(err.message || "Erreur lors de l'ajout du conducteur");
    },
  });

  // -------------------------------------------------------------------------
  // Request badge mutation
  // -------------------------------------------------------------------------

  const requestBadgeMutation = useMutation({
    mutationFn: async (form: { driver_name: string; reason: string }) => {
      const { error } = await supabase.from("token_requests").insert({
        b2b_client_id: clientId,
        requested_by: user?.id ?? "unknown",
        driver_name: form.driver_name,
        reason: form.reason.trim() || null,
        status: "pending",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toastSuccess("Demande de badge RFID envoyee");
      queryClient.invalidateQueries({ queryKey: ["b2b-token-requests"] });
      setShowBadgeModal(false);
    },
    onError: (err: Error) => {
      toastError(err.message || "Erreur lors de la demande de badge");
    },
  });

  // -------------------------------------------------------------------------
  // Render: Add driver button (exported for header area)
  // -------------------------------------------------------------------------

  return (
    <>
      {/* ================================================================= */}
      {/* Action buttons — placed in header area                            */}
      {/* ================================================================= */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors"
        >
          <UserPlus className="w-4 h-4" />
          Ajouter un conducteur
        </button>

        <button
          onClick={() => setShowBadgeModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-border rounded-xl text-foreground hover:bg-surface-elevated transition-colors"
        >
          <Nfc className="w-4 h-4" />
          Demander un badge RFID
        </button>
      </div>

      {/* ================================================================= */}
      {/* Add driver modal                                                  */}
      {/* ================================================================= */}
      {showAddModal && (
        <AddDriverModal
          onClose={() => setShowAddModal(false)}
          onSubmit={(form) => addDriverMutation.mutate(form)}
          loading={addDriverMutation.isPending}
        />
      )}

      {/* ================================================================= */}
      {/* Request badge modal                                               */}
      {/* ================================================================= */}
      {showBadgeModal && (
        <RequestBadgeModal
          drivers={drivers}
          onClose={() => setShowBadgeModal(false)}
          onSubmit={(form) => requestBadgeMutation.mutate(form)}
          loading={requestBadgeMutation.isPending}
        />
      )}

    </>
  );
}

// ---------------------------------------------------------------------------
// Add Driver Modal
// ---------------------------------------------------------------------------

function AddDriverModal({
  onClose,
  onSubmit,
  loading,
}: {
  onClose: () => void;
  onSubmit: (form: { first_name: string; last_name: string; email: string; vehicle: string }) => void;
  loading: boolean;
}) {
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    vehicle: "",
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(form);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Modal */}
      <div className="relative bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-heading font-semibold text-foreground">
            Ajouter un conducteur
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground-muted">
                Prenom *
              </label>
              <input
                type="text"
                required
                value={form.first_name}
                onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
                placeholder="Jean"
                className={inputClass}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground-muted">
                Nom *
              </label>
              <input
                type="text"
                required
                value={form.last_name}
                onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
                placeholder="Dupont"
                className={inputClass}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground-muted">
              Email
            </label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="jean.dupont@entreprise.com"
              className={inputClass}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground-muted">
              Vehicule (optionnel)
            </label>
            <input
              type="text"
              value={form.vehicle}
              onChange={(e) => setForm((f) => ({ ...f, vehicle: e.target.value }))}
              placeholder="Tesla Model 3, Renault Megane E-Tech..."
              className={inputClass}
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-foreground-muted hover:text-foreground transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={loading || !form.first_name.trim() || !form.last_name.trim()}
              className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Ajouter
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Request Badge Modal
// ---------------------------------------------------------------------------

function RequestBadgeModal({
  drivers,
  onClose,
  onSubmit,
  loading,
}: {
  drivers: FleetDriver[];
  onClose: () => void;
  onSubmit: (form: { driver_name: string; reason: string }) => void;
  loading: boolean;
}) {
  const [selectedDriver, setSelectedDriver] = useState("");
  const [reason, setReason] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedDriver) return;
    onSubmit({ driver_name: selectedDriver, reason });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Modal */}
      <div className="relative bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-heading font-semibold text-foreground">
            Demander un badge RFID
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground-muted">
              Conducteur *
            </label>
            <div className="relative">
              <select
                required
                value={selectedDriver}
                onChange={(e) => setSelectedDriver(e.target.value)}
                className={cn(inputClass, "appearance-none pr-8 cursor-pointer")}
              >
                <option value="">Selectionner un conducteur</option>
                {drivers.map((d) => (
                  <option key={d.id} value={driverName(d)}>
                    {driverName(d)}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground-muted pointer-events-none" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground-muted">
              Motif (optionnel)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Nouveau collaborateur, badge perdu..."
              rows={3}
              className={cn(inputClass, "resize-none")}
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-foreground-muted hover:text-foreground transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={loading || !selectedDriver}
              className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Envoyer la demande
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Token Requests Section
// ---------------------------------------------------------------------------

export function TokenRequestsSection({
  requests,
  loading,
}: {
  requests: TokenRequest[];
  loading: boolean;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { success: toastSuccess, error: toastError } = useToast();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabase
        .from("token_requests")
        .update({
          status: "approved",
          approved_by: user?.id ?? "unknown",
          resolved_at: new Date().toISOString(),
        })
        .eq("id", requestId);
      if (error) throw error;
    },
    onSuccess: () => {
      toastSuccess("Demande approuvee");
      queryClient.invalidateQueries({ queryKey: ["b2b-token-requests"] });
    },
    onError: (err: Error) => toastError(err.message || "Erreur lors de l'approbation"),
  });

  // Reject mutation
  const rejectMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabase
        .from("token_requests")
        .update({
          status: "rejected",
          resolved_at: new Date().toISOString(),
        })
        .eq("id", requestId);
      if (error) throw error;
    },
    onSuccess: () => {
      toastSuccess("Demande refusee");
      queryClient.invalidateQueries({ queryKey: ["b2b-token-requests"] });
    },
    onError: (err: Error) => toastError(err.message || "Erreur lors du refus"),
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabase
        .from("token_requests")
        .delete()
        .eq("id", requestId);
      if (error) throw error;
    },
    onSuccess: () => {
      toastSuccess("Demande supprimee");
      queryClient.invalidateQueries({ queryKey: ["b2b-token-requests"] });
      setConfirmDeleteId(null);
    },
    onError: (err: Error) => {
      toastError(err.message || "Erreur lors de la suppression");
      setConfirmDeleteId(null);
    },
  });

  if (loading) {
    return (
      <div className="bg-surface border border-border rounded-2xl p-6 h-[200px] animate-pulse" />
    );
  }

  const deleteRequest = requests.find((r) => r.id === confirmDeleteId);

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-foreground">
        Demandes de badges RFID ({requests.length})
      </h3>

      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className={thClass}>Conducteur</th>
                <th className={thClass}>Motif</th>
                <th className={thClass}>Statut</th>
                <th className={thClass}>Date</th>
                <th className={cn(thClass, "text-right")}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-12 text-center text-foreground-muted text-sm"
                  >
                    Aucune demande de badge
                  </td>
                </tr>
              ) : (
                requests.map((r) => {
                  const isPending = (r.status?.toLowerCase() ?? "pending") === "pending";
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-border/50 hover:bg-surface-elevated/50 transition-colors"
                    >
                      <td className={cn(tdClass, "font-medium")}>
                        {r.driver_name}
                      </td>
                      <td className={tdClass}>
                        {r.reason || "—"}
                      </td>
                      <td className={tdClass}>
                        {requestStatusBadge(r.status)}
                      </td>
                      <td className={tdClass}>
                        {r.created_at
                          ? formatRelativeTime(r.created_at)
                          : "—"}
                      </td>
                      <td className={cn(tdClass, "text-right")}>
                        <div className="flex items-center justify-end gap-1.5">
                          {isPending && (
                            <>
                              <button
                                onClick={() => approveMutation.mutate(r.id)}
                                disabled={approveMutation.isPending || rejectMutation.isPending}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                                title="Approuver"
                              >
                                <CheckCircle className="w-3.5 h-3.5" />
                                Approuver
                              </button>
                              <button
                                onClick={() => rejectMutation.mutate(r.id)}
                                disabled={approveMutation.isPending || rejectMutation.isPending}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                                title="Refuser"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                Refuser
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => setConfirmDeleteId(r.id)}
                            disabled={deleteMutation.isPending}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                            title="Supprimer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confirm delete dialog */}
      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Supprimer cette demande ?"
        description={
          deleteRequest
            ? `Supprimer la demande de badge pour ${deleteRequest.driver_name} ? Cette action est irreversible.`
            : ""
        }
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (confirmDeleteId) {
            deleteMutation.mutate(confirmDeleteId);
          }
        }}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}
