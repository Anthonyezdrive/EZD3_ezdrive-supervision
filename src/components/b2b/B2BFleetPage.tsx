// ============================================================
// EZDrive — B2B Fleet Management Page
// Drivers & tokens management for B2B clients
// ============================================================

import { useState, useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import {
  Users, CreditCard, Zap, Activity, Search, Shield, ShieldOff,
  Nfc, Download, ChevronDown, Loader2, User, UserMinus, Pencil, X,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { cn, formatRelativeTime } from "@/lib/utils";
import { downloadCSV, todayISO } from "@/lib/export";
import { SlideOver } from "@/components/ui/SlideOver";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { KPICard } from "@/components/ui/KPICard";
import { PageHelp } from "@/components/ui/PageHelp";
import { useToast } from "@/contexts/ToastContext";
import { B2BFleetManagement, TokenRequestsSection } from "@/components/b2b/B2BFleetManagement";
import type { B2BClient } from "@/types/b2b";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Driver {
  id: string;
  driver_external_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  city: string | null;
  billing_mode: string | null;
  total_sessions: number | null;
  total_energy_kwh: number | null;
  last_session_at: string | null;
  created_at: string;
}

interface Token {
  id: string;
  token_uid: string;
  driver_external_id: string | null;
  driver_name: string | null;
  status: string;
  total_sessions: number | null;
  total_energy_kwh: number | null;
  last_used_at: string | null;
  created_at: string;
}

type StatusFilter = "all" | "active" | "inactive" | "suspended";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const thClass =
  "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-foreground-muted";
const tdClass = "px-4 py-3.5 text-sm text-foreground whitespace-nowrap";

function statusBadge(status: string) {
  const s = status?.toLowerCase() ?? "inactive";
  if (s === "active")
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        Actif
      </span>
    );
  if (s === "suspended" || s === "blocked")
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
        {s === "blocked" ? "Bloque" : "Suspendu"}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-500/10 text-gray-400">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
      Inactif
    </span>
  );
}

function formatEnergy(kwh: number | null): string {
  if (kwh == null) return "0";
  return kwh.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
}

function driverDisplayName(d: Driver): string {
  if (d.full_name) return d.full_name;
  const parts = [d.first_name, d.last_name].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "—";
}

function tokenShort(uid: string): string {
  if (!uid) return "—";
  return uid.length > 12 ? uid.slice(-12) : uid;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function B2BFleetPage() {
  const { activeClient } = useOutletContext<{
    activeClient: B2BClient | null;
    customerExternalIds: string[];
  }>();
  const queryClient = useQueryClient();
  const { success: toastSuccess, error: toastError } = useToast();

  // Local state
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState<{
    tokenId: string;
    action: "block" | "unblock";
  } | null>(null);
  const [confirmRemoveDriver, setConfirmRemoveDriver] = useState<Driver | null>(null);
  const [editingDriver, setEditingDriver] = useState<Driver | null>(null);

  // Fleet management ref for callback
  const handleDriversChanged = () => {
    queryClient.invalidateQueries({ queryKey: ["b2b-fleet-drivers"] });
  };

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  const clientName = activeClient?.name ?? "";

  const {
    data: drivers = [],
    isLoading: driversLoading,
  } = useQuery({
    queryKey: ["b2b-fleet-drivers", clientName],
    queryFn: async () => {
      if (!clientName) return [];
      const { data, error } = await supabase
        .from("gfx_consumers")
        .select(
          "id, driver_external_id, first_name, last_name, full_name, email, phone, status, city, billing_mode, total_sessions, total_energy_kwh, last_session_at, created_at"
        )
        .eq("customer_name", clientName);
      if (error) throw error;
      return (data ?? []) as Driver[];
    },
    enabled: !!clientName,
  });

  const {
    data: tokens = [],
    isLoading: tokensLoading,
  } = useQuery({
    queryKey: ["b2b-fleet-tokens", clientName],
    queryFn: async () => {
      if (!clientName) return [];
      const { data, error } = await supabase
        .from("gfx_tokens")
        .select(
          "id, token_uid, driver_external_id, driver_name, status, total_sessions, total_energy_kwh, last_used_at, created_at"
        )
        .eq("customer_group", clientName);
      if (error) throw error;
      return (data ?? []) as Token[];
    },
    enabled: !!clientName,
  });

  const {
    data: tokenRequests = [],
    isLoading: tokenRequestsLoading,
  } = useQuery({
    queryKey: ["b2b-token-requests", activeClient?.id],
    queryFn: async () => {
      if (!activeClient?.id) return [];
      const { data, error } = await supabase
        .from("token_requests")
        .select("*")
        .eq("b2b_client_id", activeClient.id)
        .order("created_at", { ascending: false });
      if (error) {
        // Table may not exist yet — gracefully return empty
        console.warn("token_requests query error:", error.message);
        return [];
      }
      return data ?? [];
    },
    enabled: !!activeClient?.id,
  });

  const isLoading = driversLoading || tokensLoading;

  // -----------------------------------------------------------------------
  // Block / unblock mutation
  // -----------------------------------------------------------------------

  const blockMutation = useMutation({
    mutationFn: async ({
      tokenId,
      action,
    }: {
      tokenId: string;
      action: "block" | "unblock";
    }) => {
      const { error } = await supabase
        .from("gfx_tokens")
        .update({ status: action === "block" ? "blocked" : "active" })
        .eq("id", tokenId);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["b2b-fleet-tokens"] });
      toastSuccess(
        variables.action === "block" ? "Token bloque" : "Token debloque"
      );
    },
    onError: () => {
      toastError("Erreur lors de la mise a jour du token");
    },
  });

  // -----------------------------------------------------------------------
  // Remove driver mutation
  // -----------------------------------------------------------------------

  const removeDriverMutation = useMutation({
    mutationFn: async (driverExternalId: string) => {
      const { error } = await supabase
        .from("all_consumers")
        .update({ customer_name: null, status: "inactive" })
        .eq("driver_external_id", driverExternalId);
      if (error) throw error;
    },
    onSuccess: () => {
      toastSuccess("Conducteur retire de la flotte");
      queryClient.invalidateQueries({ queryKey: ["b2b-fleet-drivers"] });
      setConfirmRemoveDriver(null);
    },
    onError: () => {
      toastError("Erreur lors du retrait du conducteur");
      setConfirmRemoveDriver(null);
    },
  });

  // -----------------------------------------------------------------------
  // Edit driver mutation
  // -----------------------------------------------------------------------

  const editDriverMutation = useMutation({
    mutationFn: async (form: {
      driver_external_id: string;
      first_name: string;
      last_name: string;
      email: string;
      phone: string;
      city: string;
    }) => {
      const fullName = `${form.first_name.trim()} ${form.last_name.trim()}`;
      const { error } = await supabase
        .from("all_consumers")
        .update({
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          full_name: fullName,
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          city: form.city.trim() || null,
        })
        .eq("driver_external_id", form.driver_external_id);
      if (error) throw error;
    },
    onSuccess: () => {
      toastSuccess("Conducteur mis a jour");
      queryClient.invalidateQueries({ queryKey: ["b2b-fleet-drivers"] });
      setEditingDriver(null);
    },
    onError: (err: Error) => {
      toastError(err.message || "Erreur lors de la mise a jour du conducteur");
    },
  });

  // -----------------------------------------------------------------------
  // KPIs
  // -----------------------------------------------------------------------

  const activeDrivers = useMemo(
    () => drivers.filter((d) => d.status?.toLowerCase() === "active").length,
    [drivers]
  );

  const activeTokens = useMemo(
    () => tokens.filter((t) => t.status?.toLowerCase() === "active").length,
    [tokens]
  );

  const totalSessions = useMemo(
    () => drivers.reduce((sum, d) => sum + (d.total_sessions ?? 0), 0),
    [drivers]
  );

  const totalEnergy = useMemo(
    () => drivers.reduce((sum, d) => sum + (d.total_energy_kwh ?? 0), 0),
    [drivers]
  );

  // -----------------------------------------------------------------------
  // Filtered drivers
  // -----------------------------------------------------------------------

  const filteredDrivers = useMemo(() => {
    let list = drivers;

    if (statusFilter !== "all") {
      list = list.filter(
        (d) => d.status?.toLowerCase() === statusFilter
      );
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (d) =>
          driverDisplayName(d).toLowerCase().includes(q) ||
          (d.email ?? "").toLowerCase().includes(q) ||
          (d.city ?? "").toLowerCase().includes(q)
      );
    }

    return list;
  }, [drivers, statusFilter, search]);

  // -----------------------------------------------------------------------
  // Tokens for selected driver
  // -----------------------------------------------------------------------

  const driverTokens = useMemo(() => {
    if (!selectedDriver) return [];
    return tokens.filter(
      (t) => t.driver_external_id === selectedDriver.driver_external_id
    );
  }, [tokens, selectedDriver]);

  // -----------------------------------------------------------------------
  // CSV export
  // -----------------------------------------------------------------------

  function handleExportCSV() {
    const rows = filteredDrivers.map((d) => ({
      Nom: driverDisplayName(d),
      Email: d.email ?? "",
      Ville: d.city ?? "",
      Statut: d.status ?? "",
      Sessions: d.total_sessions ?? 0,
      "Energie (kWh)": d.total_energy_kwh ?? 0,
      "Derniere session": d.last_session_at ?? "",
    }));
    downloadCSV(
      rows,
      `b2b-flotte-conducteurs-${activeClient?.slug ?? "client"}-${todayISO()}.csv`
    );
  }

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  function openDriverDrawer(driver: Driver) {
    setSelectedDriver(driver);
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setTimeout(() => setSelectedDriver(null), 350);
  }

  function handleBlockConfirm() {
    if (!confirmBlock) return;
    blockMutation.mutate(confirmBlock, {
      onSettled: () => setConfirmBlock(null),
    });
  }

  // -----------------------------------------------------------------------
  // Loading state
  // -----------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="bg-surface border border-border rounded-2xl p-5 h-[88px] animate-pulse"
            />
          ))}
        </div>
        <div className="bg-surface border border-border rounded-2xl p-6 h-[400px] animate-pulse" />
        <div className="bg-surface border border-border rounded-2xl p-6 h-[300px] animate-pulse" />
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Empty state (no client)
  // -----------------------------------------------------------------------

  if (!activeClient) {
    return (
      <div className="flex items-center justify-center h-64 text-foreground-muted text-sm">
        Selectionnez un client pour afficher la flotte.
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Help */}
      <PageHelp
        summary="Gestion de la flotte — visualisez vos conducteurs et leurs tokens RFID"
        items={[
          {
            label: "Conducteur",
            description:
              "Un collaborateur enregistre dans le systeme de charge.",
          },
          {
            label: "Token",
            description:
              "Badge RFID ou identifiant numerique associe a un conducteur.",
          },
          {
            label: "Bloquer un token",
            description:
              "Empeche le token d'initier de nouvelles sessions de charge.",
          },
        ]}
        tips={[
          "Vous pouvez bloquer un token depuis le detail d'un conducteur ou depuis la liste des tokens.",
          "Ajoutez ou retirez des conducteurs de votre flotte en self-service.",
        ]}
      />

      {/* Fleet Management Actions */}
      <B2BFleetManagement
        clientId={activeClient.id}
        clientName={clientName}
        drivers={drivers}
        onDriversChanged={handleDriversChanged}
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="Conducteurs actifs"
          value={String(activeDrivers)}
          icon={Users}
          color="#9ACC0E"
        />
        <KPICard
          label="Tokens actifs"
          value={String(activeTokens)}
          icon={CreditCard}
          color="#00C3FF"
        />
        <KPICard
          label="Sessions totales"
          value={totalSessions.toLocaleString("fr-FR")}
          icon={Activity}
          color="#F39C12"
        />
        <KPICard
          label="Energie totale"
          value={`${formatEnergy(totalEnergy)} kWh`}
          icon={Zap}
          color="#9ACC0E"
        />
      </div>

      {/* ================================================================= */}
      {/* Drivers section                                                    */}
      {/* ================================================================= */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h3 className="text-base font-semibold text-foreground">
            Conducteurs ({filteredDrivers.length})
          </h3>

          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
              <input
                type="text"
                placeholder="Rechercher..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 pr-4 py-2 text-sm bg-surface border border-border rounded-xl text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary/40 w-56"
              />
            </div>

            {/* Status filter */}
            <div className="relative">
              <select
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as StatusFilter)
                }
                className="appearance-none pl-3 pr-8 py-2 text-sm bg-surface border border-border rounded-xl text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
              >
                <option value="all">Tous</option>
                <option value="active">Actif</option>
                <option value="inactive">Inactif</option>
                <option value="suspended">Suspendu</option>
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground-muted pointer-events-none" />
            </div>

            {/* Export */}
            <button
              onClick={handleExportCSV}
              disabled={filteredDrivers.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-border rounded-xl text-foreground hover:bg-surface-elevated transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4" />
              CSV
            </button>
          </div>
        </div>

        {/* Drivers table */}
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className={thClass}>Nom</th>
                  <th className={thClass}>Email</th>
                  <th className={thClass}>Ville</th>
                  <th className={thClass}>Statut</th>
                  <th className={cn(thClass, "text-right")}>Sessions</th>
                  <th className={cn(thClass, "text-right")}>Energie</th>
                  <th className={thClass}>Derniere session</th>
                  <th className={cn(thClass, "text-right")}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredDrivers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-12 text-center text-foreground-muted text-sm"
                    >
                      Aucun conducteur trouve
                    </td>
                  </tr>
                ) : (
                  filteredDrivers.map((d) => (
                    <tr
                      key={d.id}
                      onClick={() => openDriverDrawer(d)}
                      className="border-b border-border/50 hover:bg-surface-elevated/50 transition-colors cursor-pointer"
                    >
                      <td className={cn(tdClass, "font-medium")}>
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-foreground-muted shrink-0" />
                          {driverDisplayName(d)}
                        </div>
                      </td>
                      <td className={tdClass}>{d.email ?? "—"}</td>
                      <td className={tdClass}>{d.city ?? "—"}</td>
                      <td className={tdClass}>{statusBadge(d.status)}</td>
                      <td className={cn(tdClass, "text-right tabular-nums")}>
                        {d.total_sessions ?? 0}
                      </td>
                      <td className={cn(tdClass, "text-right tabular-nums")}>
                        {formatEnergy(d.total_energy_kwh)} kWh
                      </td>
                      <td className={tdClass}>
                        {d.last_session_at
                          ? formatRelativeTime(d.last_session_at)
                          : "—"}
                      </td>
                      <td className={cn(tdClass, "text-right")}>
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingDriver(d);
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-surface-elevated border border-border text-foreground hover:bg-surface transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            Modifier
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmRemoveDriver(d);
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                          >
                            <UserMinus className="w-3.5 h-3.5" />
                            Retirer
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ================================================================= */}
      {/* Tokens section                                                     */}
      {/* ================================================================= */}
      <div className="space-y-4">
        <h3 className="text-base font-semibold text-foreground">
          Tokens ({tokens.length})
        </h3>

        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className={thClass}>Token UID</th>
                  <th className={thClass}>Conducteur</th>
                  <th className={thClass}>Statut</th>
                  <th className={cn(thClass, "text-right")}>Sessions</th>
                  <th className={cn(thClass, "text-right")}>Energie</th>
                  <th className={thClass}>Derniere utilisation</th>
                  <th className={cn(thClass, "text-right")}>Action</th>
                </tr>
              </thead>
              <tbody>
                {tokens.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-12 text-center text-foreground-muted text-sm"
                    >
                      Aucun token
                    </td>
                  </tr>
                ) : (
                  tokens.map((t) => (
                    <tr
                      key={t.id}
                      className="border-b border-border/50 hover:bg-surface-elevated/50 transition-colors"
                    >
                      <td className={cn(tdClass, "font-mono text-xs")}>
                        <div className="flex items-center gap-2">
                          <Nfc className="w-4 h-4 text-foreground-muted shrink-0" />
                          {tokenShort(t.token_uid)}
                        </div>
                      </td>
                      <td className={tdClass}>{t.driver_name ?? "—"}</td>
                      <td className={tdClass}>{statusBadge(t.status)}</td>
                      <td className={cn(tdClass, "text-right tabular-nums")}>
                        {t.total_sessions ?? 0}
                      </td>
                      <td className={cn(tdClass, "text-right tabular-nums")}>
                        {formatEnergy(t.total_energy_kwh)} kWh
                      </td>
                      <td className={tdClass}>
                        {t.last_used_at
                          ? formatRelativeTime(t.last_used_at)
                          : "—"}
                      </td>
                      <td className={cn(tdClass, "text-right")}>
                        {t.status?.toLowerCase() === "blocked" ? (
                          <button
                            onClick={() =>
                              setConfirmBlock({
                                tokenId: t.id,
                                action: "unblock",
                              })
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                          >
                            <ShieldOff className="w-3.5 h-3.5" />
                            Debloquer
                          </button>
                        ) : (
                          <button
                            onClick={() =>
                              setConfirmBlock({
                                tokenId: t.id,
                                action: "block",
                              })
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                          >
                            <Shield className="w-3.5 h-3.5" />
                            Bloquer
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ================================================================= */}
      {/* Token requests section                                             */}
      {/* ================================================================= */}
      <TokenRequestsSection
        requests={tokenRequests}
        loading={tokenRequestsLoading}
      />

      {/* ================================================================= */}
      {/* Edit driver modal                                                  */}
      {/* ================================================================= */}
      {editingDriver && (
        <EditDriverModal
          driver={editingDriver}
          onClose={() => setEditingDriver(null)}
          onSubmit={(form) =>
            editDriverMutation.mutate({
              driver_external_id: editingDriver.driver_external_id,
              ...form,
            })
          }
          loading={editDriverMutation.isPending}
        />
      )}

      {/* ================================================================= */}
      {/* Driver detail drawer                                               */}
      {/* ================================================================= */}
      <SlideOver
        open={drawerOpen}
        onClose={closeDrawer}
        title={selectedDriver ? driverDisplayName(selectedDriver) : ""}
        subtitle="Detail du conducteur"
      >
        {selectedDriver && (
          <div className="p-6 space-y-6">
            {/* Driver info */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-foreground-muted uppercase tracking-wider">
                Informations
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <InfoCell label="Email" value={selectedDriver.email} />
                <InfoCell label="Telephone" value={selectedDriver.phone} />
                <InfoCell label="Ville" value={selectedDriver.city} />
                <InfoCell
                  label="Mode de facturation"
                  value={selectedDriver.billing_mode}
                />
                <InfoCell
                  label="Statut"
                  value={null}
                  custom={statusBadge(selectedDriver.status)}
                />
                <InfoCell
                  label="Sessions"
                  value={String(selectedDriver.total_sessions ?? 0)}
                />
                <InfoCell
                  label="Energie"
                  value={`${formatEnergy(selectedDriver.total_energy_kwh)} kWh`}
                />
                <InfoCell
                  label="Derniere session"
                  value={
                    selectedDriver.last_session_at
                      ? formatRelativeTime(selectedDriver.last_session_at)
                      : null
                  }
                />
              </div>
            </div>

            {/* Associated tokens */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-foreground-muted uppercase tracking-wider">
                Tokens associes ({driverTokens.length})
              </h4>

              {driverTokens.length === 0 ? (
                <p className="text-sm text-foreground-muted py-4">
                  Aucun token associe a ce conducteur.
                </p>
              ) : (
                <div className="space-y-2">
                  {driverTokens.map((t) => (
                    <div
                      key={t.id}
                      className="bg-surface-elevated/50 border border-border rounded-xl p-4 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Nfc className="w-4 h-4 text-foreground-muted" />
                          <span className="text-sm font-mono font-medium text-foreground">
                            {tokenShort(t.token_uid)}
                          </span>
                        </div>
                        {statusBadge(t.status)}
                      </div>

                      <div className="flex items-center justify-between text-xs text-foreground-muted">
                        <span>
                          {t.total_sessions ?? 0} sessions
                        </span>
                        <span>
                          {t.last_used_at
                            ? formatRelativeTime(t.last_used_at)
                            : "Jamais utilise"}
                        </span>
                      </div>

                      <div className="pt-1">
                        {t.status?.toLowerCase() === "blocked" ? (
                          <button
                            onClick={() =>
                              setConfirmBlock({
                                tokenId: t.id,
                                action: "unblock",
                              })
                            }
                            disabled={blockMutation.isPending}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                          >
                            <ShieldOff className="w-3.5 h-3.5" />
                            Debloquer
                          </button>
                        ) : (
                          <button
                            onClick={() =>
                              setConfirmBlock({
                                tokenId: t.id,
                                action: "block",
                              })
                            }
                            disabled={blockMutation.isPending}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                          >
                            <Shield className="w-3.5 h-3.5" />
                            Bloquer
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </SlideOver>

      {/* ================================================================= */}
      {/* Confirm dialog for block/unblock                                   */}
      {/* ================================================================= */}
      {/* ================================================================= */}
      {/* Confirm dialog for remove driver                                  */}
      {/* ================================================================= */}
      <ConfirmDialog
        open={confirmRemoveDriver !== null}
        title="Retirer ce conducteur ?"
        description={
          confirmRemoveDriver
            ? `Retirer ${driverDisplayName(confirmRemoveDriver)} de la flotte ? Le conducteur ne sera pas supprime, mais sera dissocie du client B2B.`
            : ""
        }
        confirmLabel="Retirer"
        cancelLabel="Annuler"
        variant="warning"
        loading={removeDriverMutation.isPending}
        onConfirm={() => {
          if (confirmRemoveDriver) {
            removeDriverMutation.mutate(confirmRemoveDriver.driver_external_id);
          }
        }}
        onCancel={() => setConfirmRemoveDriver(null)}
      />

      <ConfirmDialog
        open={confirmBlock !== null}
        title={
          confirmBlock?.action === "block"
            ? "Bloquer ce token ?"
            : "Debloquer ce token ?"
        }
        description={
          confirmBlock?.action === "block"
            ? "Le token ne pourra plus initier de sessions de charge. Vous pourrez le debloquer a tout moment."
            : "Le token pourra de nouveau initier des sessions de charge."
        }
        confirmLabel={
          confirmBlock?.action === "block" ? "Bloquer" : "Debloquer"
        }
        cancelLabel="Annuler"
        variant={confirmBlock?.action === "block" ? "danger" : "warning"}
        loading={blockMutation.isPending}
        onConfirm={handleBlockConfirm}
        onCancel={() => setConfirmBlock(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit Driver Modal
// ---------------------------------------------------------------------------

function EditDriverModal({
  driver,
  onClose,
  onSubmit,
  loading,
}: {
  driver: Driver;
  onClose: () => void;
  onSubmit: (form: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    city: string;
  }) => void;
  loading: boolean;
}) {
  const [form, setForm] = useState({
    first_name: driver.first_name ?? "",
    last_name: driver.last_name ?? "",
    email: driver.email ?? "",
    phone: driver.phone ?? "",
    city: driver.city ?? "",
  });

  const inputClass =
    "w-full px-3 py-2 text-sm bg-surface border border-border rounded-xl text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary/40";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(form);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-heading font-semibold text-foreground">
            Modifier le conducteur
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
              Telephone
            </label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="+33 6 12 34 56 78"
              className={inputClass}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground-muted">
              Ville
            </label>
            <input
              type="text"
              value={form.city}
              onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
              placeholder="Paris"
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
              Enregistrer
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Info cell sub-component for the drawer
// ---------------------------------------------------------------------------

function InfoCell({
  label,
  value,
  custom,
}: {
  label: string;
  value: string | null;
  custom?: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-foreground-muted">{label}</p>
      {custom ?? (
        <p className="text-sm font-medium text-foreground">
          {value || "—"}
        </p>
      )}
    </div>
  );
}
