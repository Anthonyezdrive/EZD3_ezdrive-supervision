import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { PageHelp } from "@/components/ui/PageHelp";
import { useToast } from "@/contexts/ToastContext";
import {
  CreditCard,
  Users,
  TrendingUp,
  ShieldCheck,
  Search,
  ChevronLeft,
  ChevronRight,
  Star,
  Check,
  Plus,
  X,
  Loader2,
  Link2,
  Unlink,
  Ban,
  Pencil,
  Trash2,
} from "lucide-react";

// ============================================================
// Types
// ============================================================

type SubscriptionStatus = "ACTIVE" | "PENDING" | "PAST_DUE" | "CANCELLED" | "EXPIRED";

interface SubscriptionOffer {
  id: string;
  name: string;
  price_cents: number;
  billing_period: string;
  discount_percent: number | null;
  is_active: boolean;
  features: string[] | null;
  benefits: string[] | null;
  description: string | null;
  stripe_price_id: string | null;
  stripe_product_id: string | null;
}

interface UserSubscription {
  id: string;
  user_id: string;
  offer_id: string;
  status: SubscriptionStatus;
  started_at: string;
  ends_at: string | null;
  created_at: string;
  subscription_offers: {
    name: string;
    price_cents: number;
    billing_period: string;
    discount_percent: number | null;
  } | null;
  all_consumers: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  } | null;
}

// ============================================================
// Status config
// ============================================================

const STATUS_CONFIG: Record<
  SubscriptionStatus,
  { label: string; color: string; bgClass: string; textClass: string; borderClass: string }
> = {
  ACTIVE: {
    label: "Actif",
    color: "#00D4AA",
    bgClass: "bg-green-500/10",
    textClass: "text-green-400",
    borderClass: "border-green-500/30",
  },
  PENDING: {
    label: "En attente",
    color: "#F39C12",
    bgClass: "bg-yellow-500/10",
    textClass: "text-yellow-400",
    borderClass: "border-yellow-500/30",
  },
  PAST_DUE: {
    label: "Impayé",
    color: "#FF9500",
    bgClass: "bg-orange-500/10",
    textClass: "text-orange-400",
    borderClass: "border-orange-500/30",
  },
  CANCELLED: {
    label: "Annulé",
    color: "#FF6B6B",
    bgClass: "bg-red-500/10",
    textClass: "text-red-400",
    borderClass: "border-red-500/30",
  },
  EXPIRED: {
    label: "Expiré",
    color: "#8892B0",
    bgClass: "bg-gray-500/10",
    textClass: "text-gray-400",
    borderClass: "border-gray-500/30",
  },
};

const STATUS_TABS: { key: SubscriptionStatus | "ALL"; label: string }[] = [
  { key: "ALL", label: "Tous" },
  { key: "ACTIVE", label: "Actifs" },
  { key: "PENDING", label: "En attente" },
  { key: "PAST_DUE", label: "Impayés" },
  { key: "CANCELLED", label: "Annulés" },
];

const PAGE_SIZE = 15;

// ============================================================
// Helpers
// ============================================================

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function billingLabel(period: string): string {
  switch (period) {
    case "monthly":
      return "/mois";
    case "yearly":
      return "/an";
    case "weekly":
      return "/sem";
    default:
      return "";
  }
}

// ============================================================
// Component
// ============================================================

export function SubscriptionsPage() {
  const queryClient = useQueryClient();
  const { success: toastSuccess, error: toastError } = useToast();
  const [statusFilter, setStatusFilter] = useState<SubscriptionStatus | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [showCreateOffer, setShowCreateOffer] = useState(false);
  const [showCreateSub, setShowCreateSub] = useState(false);
  const [syncingOfferId, setSyncingOfferId] = useState<string | null>(null);
  const [cancellingSubId, setCancellingSubId] = useState<string | null>(null);
  const [editingOffer, setEditingOffer] = useState<SubscriptionOffer | null>(null);
  const [deleteOfferTarget, setDeleteOfferTarget] = useState<SubscriptionOffer | null>(null);

  // --- Subscriptions query ---
  const {
    data: subscriptions,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["subscriptions"],
    retry: false,
    queryFn: async () => {
      try {
        // Try with consumer_profiles join first (requires FK)
        const { data, error } = await supabase
          .from("user_subscriptions")
          .select(
            "*, subscription_offers(name, price_cents, billing_period, discount_percent), all_consumers(first_name, last_name, email)"
          )
          .order("created_at", { ascending: false });
        if (error) {
          // If join fails, try without all_consumers
          console.warn("[Subscriptions] join failed, trying without profiles:", error.message);
          const { data: fallback, error: err2 } = await supabase
            .from("user_subscriptions")
            .select("*, subscription_offers(name, price_cents, billing_period, discount_percent)")
            .order("created_at", { ascending: false });
          if (err2) { console.warn("[Subscriptions]:", err2.message); return []; }
          return (fallback ?? []).map((d) => ({ ...d, all_consumers: null })) as UserSubscription[];
        }
        return (data ?? []) as UserSubscription[];
      } catch { return []; }
    },
  });

  // --- Offers query ---
  const { data: offers } = useQuery({
    queryKey: ["subscription-offers"],
    retry: false,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("subscription_offers")
          .select("*")
          .eq("is_active", true)
          .order("price_cents");
        if (error) { console.warn("[Subscriptions] offers:", error.message); return []; }
        return (data ?? []) as SubscriptionOffer[];
      } catch { return []; }
    },
  });

  // --- Filtering ---
  const filtered = useMemo(() => {
    if (!subscriptions) return [];
    return subscriptions.filter((s) => {
      if (statusFilter !== "ALL" && s.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const name = [s.all_consumers?.first_name, s.all_consumers?.last_name].filter(Boolean).join(" ").toLowerCase();
        const email = s.all_consumers?.email?.toLowerCase() ?? "";
        const offer = s.subscription_offers?.name?.toLowerCase() ?? "";
        return name.includes(q) || email.includes(q) || offer.includes(q);
      }
      return true;
    });
  }, [subscriptions, statusFilter, search]);

  // --- KPIs ---
  const kpis = useMemo(() => {
    if (!subscriptions) return { total: 0, active: 0, monthlyRevenue: 0, retention: 0 };
    const total = subscriptions.length;
    const active = subscriptions.filter((s) => s.status === "ACTIVE").length;
    const monthlyRevenue = subscriptions
      .filter(
        (s) =>
          s.status === "ACTIVE" &&
          s.subscription_offers?.billing_period === "monthly"
      )
      .reduce((sum, s) => sum + (s.subscription_offers?.price_cents ?? 0), 0);
    const nonPending = subscriptions.filter((s) => s.status !== "PENDING").length;
    const retention = nonPending > 0 ? Math.round((active / nonPending) * 100) : 0;
    return { total, active, monthlyRevenue, retention };
  }, [subscriptions]);

  // --- Pagination ---
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Reset to page 0 when filters change
  useMemo(() => setPage(0), [statusFilter, search]);

  // --- Stripe Sync: Create Product + Price in Stripe for an offer ---
  async function syncOfferToStripe(offer: SubscriptionOffer) {
    if (offer.stripe_price_id) return; // Already synced
    setSyncingOfferId(offer.id);
    try {
      // Create Stripe Product
      const productRes = await fetch("https://api.stripe.com/v1/products", {
        method: "POST",
        headers: { "Authorization": `Bearer ${import.meta.env.VITE_STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ name: offer.name, description: offer.description || `Abonnement ${offer.name}`, "metadata[offer_id]": offer.id }),
      });
      // If no VITE_STRIPE_SECRET_KEY, use Supabase RPC instead
      if (!import.meta.env.VITE_STRIPE_SECRET_KEY) {
        // Fallback: just mark in DB that it needs manual Stripe sync
        await supabase.from("subscription_offers").update({ stripe_product_id: "PENDING_SYNC" }).eq("id", offer.id);
        queryClient.invalidateQueries({ queryKey: ["subscription-offers"] });
        setSyncingOfferId(null);
        return;
      }
      const product = await productRes.json();
      if (product.error) throw new Error(product.error.message);

      // Create Stripe Price
      const interval = offer.billing_period === "yearly" ? "year" : offer.billing_period === "weekly" ? "week" : "month";
      const priceRes = await fetch("https://api.stripe.com/v1/prices", {
        method: "POST",
        headers: { "Authorization": `Bearer ${import.meta.env.VITE_STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          product: product.id,
          "unit_amount": String(offer.price_cents),
          currency: "eur",
          "recurring[interval]": interval,
        }),
      });
      const price = await priceRes.json();
      if (price.error) throw new Error(price.error.message);

      // Save Stripe IDs back to DB
      await supabase.from("subscription_offers").update({
        stripe_product_id: product.id,
        stripe_price_id: price.id,
      }).eq("id", offer.id);

      queryClient.invalidateQueries({ queryKey: ["subscription-offers"] });
    } catch (err) {
      console.error("Stripe sync error:", err);
      alert(`Erreur Stripe: ${err instanceof Error ? err.message : "Erreur inconnue"}`);
    } finally {
      setSyncingOfferId(null);
    }
  }

  // --- Cancel subscription ---
  async function cancelSubscription(subId: string, stripeSubId: string | null) {
    setCancellingSubId(subId);
    try {
      // Cancel in Stripe if exists
      if (stripeSubId && import.meta.env.VITE_STRIPE_SECRET_KEY) {
        await fetch(`https://api.stripe.com/v1/subscriptions/${stripeSubId}`, {
          method: "DELETE",
          headers: { "Authorization": `Bearer ${import.meta.env.VITE_STRIPE_SECRET_KEY}` },
        });
      }
      // Update in DB
      await supabase.from("user_subscriptions").update({
        status: "CANCELLED",
        cancelled_at: new Date().toISOString(),
      }).eq("id", subId);

      queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
    } catch (err) {
      console.error("Cancel error:", err);
    } finally {
      setCancellingSubId(null);
    }
  }

  // --- Create offer mutation ---
  const createOfferMutation = useMutation({
    mutationFn: async (data: { name: string; description: string; price_cents: number; billing_period: string; discount_percent: number | null; features: string[] }) => {
      const { error } = await supabase.from("subscription_offers").insert({
        type: "subscription",
        name: data.name,
        description: data.description,
        price_cents: data.price_cents,
        currency: "EUR",
        billing_period: data.billing_period,
        discount_percent: data.discount_percent,
        benefits: data.features,
        is_active: true,
        sort_order: (offers?.length ?? 0) + 1,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subscription-offers"] });
      setShowCreateOffer(false);
    },
  });

  // --- Update offer mutation ---
  const updateOfferMutation = useMutation({
    mutationFn: async (data: { id: string; name: string; description: string; price_cents: number; billing_period: string; discount_percent: number | null; features: string[] }) => {
      const { error } = await supabase.from("subscription_offers").update({
        name: data.name,
        description: data.description,
        price_cents: data.price_cents,
        billing_period: data.billing_period,
        discount_percent: data.discount_percent,
        benefits: data.features,
      }).eq("id", data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subscription-offers"] });
      queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
      toastSuccess("Offre modifiée avec succès");
      setEditingOffer(null);
    },
    onError: (err: Error) => toastError(err.message),
  });

  // --- Delete offer mutation ---
  const deleteOfferMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("subscription_offers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subscription-offers"] });
      toastSuccess("Offre supprimée avec succès");
      setDeleteOfferTarget(null);
    },
    onError: (err: Error) => toastError(err.message),
  });

  // --- Create subscription mutation ---
  const createSubMutation = useMutation({
    mutationFn: async (data: { user_id: string; offer_id: string; started_at: string }) => {
      const { error } = await supabase.from("user_subscriptions").insert({
        user_id: data.user_id,
        offer_id: data.offer_id,
        status: "ACTIVE",
        started_at: data.started_at || new Date().toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
      setShowCreateSub(false);
    },
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-xl font-bold text-foreground">Abonnements</h1>
          <p className="text-sm text-foreground-muted mt-1">
            Gestion des abonnements clients
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreateSub(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary text-background rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Créer abonnement
          </button>
          <button
            onClick={() => setShowCreateOffer(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-surface-elevated text-foreground border border-border rounded-xl text-sm font-semibold hover:bg-surface-elevated/80 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Créer une offre
          </button>
        </div>
      </div>

      <PageHelp
        summary="Gestion des abonnements et forfaits proposés à vos clients"
        items={[
          { label: "Plans", description: "Les différentes formules d'abonnement (mensuel, annuel) avec leurs avantages." },
          { label: "Statut", description: "Active (en cours), Expired (expiré), Cancelled (annulé), Pending (en attente de paiement)." },
          { label: "Renouvellement", description: "Les abonnements se renouvellent automatiquement sauf annulation par le client." },
          { label: "Revenus récurrents", description: "MRR (Monthly Recurring Revenue) calculé à partir des abonnements actifs." },
        ]}
      />

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPIBox
          label="Total abonnements"
          value={kpis.total.toString()}
          icon={CreditCard}
          color="#8892B0"
        />
        <KPIBox
          label="Actifs"
          value={kpis.active.toString()}
          icon={Users}
          color="#00D4AA"
        />
        <KPIBox
          label="Revenus mensuels"
          value={formatCurrency(kpis.monthlyRevenue)}
          icon={TrendingUp}
          color="#4ECDC4"
        />
        <KPIBox
          label="Taux rétention"
          value={`${kpis.retention}%`}
          icon={ShieldCheck}
          color="#F39C12"
        />
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">
        {/* Left: Table area */}
        <div className="space-y-4">
          {/* Status filter tabs */}
          <div className="flex items-center gap-1 bg-surface border border-border rounded-xl p-1">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                  statusFilter === tab.key
                    ? "bg-primary/15 text-primary"
                    : "text-foreground-muted hover:text-foreground"
                )}
              >
                {tab.label}
                {tab.key !== "ALL" && subscriptions && (
                  <span className="ml-1.5 text-xs opacity-70">
                    {subscriptions.filter((s) =>
                      tab.key === "ALL" ? true : s.status === tab.key
                    ).length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
            <input
              type="text"
              placeholder="Rechercher par nom, email ou offre..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50 transition-colors"
            />
          </div>

          {/* Table */}
          {isLoading ? (
            <TableSkeleton />
          ) : isError ? (
            <div className="flex flex-col items-center justify-center h-48 bg-surface border border-border rounded-2xl gap-3">
              <p className="text-sm font-medium text-foreground">
                Impossible de charger les abonnements
              </p>
              <button
                onClick={() => refetch()}
                className="px-3 py-1.5 text-xs font-medium text-foreground-muted hover:text-foreground bg-surface-elevated border border-border rounded-lg transition-colors"
              >
                Réessayer
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 bg-surface border border-border rounded-2xl">
              <CreditCard className="w-8 h-8 text-foreground-muted/40 mb-2" />
              <p className="text-foreground-muted">Aucun abonnement trouvé</p>
              <p className="text-sm text-foreground-muted/60 mt-1">
                Ajustez vos filtres pour afficher des résultats.
              </p>
            </div>
          ) : (
            <div className="bg-surface border border-border rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-elevated border-b border-border">
                      <th className="text-left px-4 py-3 font-medium text-foreground-muted">
                        Client
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-foreground-muted">
                        Email
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-foreground-muted">
                        Offre
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-foreground-muted">
                        Prix
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-foreground-muted">
                        Statut
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-foreground-muted">
                        Début
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-foreground-muted">
                        Fin
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-foreground-muted">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((sub) => {
                      const statusCfg = STATUS_CONFIG[sub.status] ?? STATUS_CONFIG.EXPIRED;
                      return (
                        <tr
                          key={sub.id}
                          className="border-b border-border last:border-0 hover:bg-surface-elevated/50 transition-colors"
                        >
                          <td className="px-4 py-3 font-medium text-foreground">
                            {[sub.all_consumers?.first_name, sub.all_consumers?.last_name].filter(Boolean).join(" ") || "—"}
                          </td>
                          <td className="px-4 py-3 text-foreground-muted text-xs">
                            {sub.all_consumers?.email ?? "—"}
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-primary/10 text-primary text-xs font-semibold">
                              {sub.subscription_offers?.name ?? "—"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-foreground tabular-nums text-xs font-medium">
                            {sub.subscription_offers
                              ? `${formatCurrency(sub.subscription_offers.price_cents)}${billingLabel(sub.subscription_offers.billing_period)}`
                              : "—"}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold",
                                statusCfg.bgClass,
                                statusCfg.textClass,
                                statusCfg.borderClass
                              )}
                            >
                              <span
                                className="w-1.5 h-1.5 rounded-full"
                                style={{ backgroundColor: statusCfg.color }}
                              />
                              {statusCfg.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-foreground-muted">
                            {formatDate(sub.started_at)}
                          </td>
                          <td className="px-4 py-3 text-xs text-foreground-muted">
                            {formatDate(sub.ends_at)}
                          </td>
                          <td className="px-4 py-3">
                            {sub.status === "ACTIVE" && (
                              <button
                                onClick={() => cancelSubscription(sub.id, (sub as any).stripe_subscription_id)}
                                disabled={cancellingSubId === sub.id}
                                className="flex items-center gap-1 px-2 py-1 text-xs text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg transition-colors disabled:opacity-40"
                              >
                                {cancellingSubId === sub.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />}
                                Annuler
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                  <span className="text-xs text-foreground-muted">
                    {filtered.length} résultat{filtered.length > 1 ? "s" : ""} — Page{" "}
                    {page + 1} / {totalPages}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                      disabled={page >= totalPages - 1}
                      className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Offers panel */}
        <div className="space-y-4">
          <h2 className="font-heading text-sm font-semibold text-foreground-muted">
            Offres disponibles
          </h2>
          {(offers ?? []).map((offer) => (
            <div
              key={offer.id}
              className="bg-surface border border-border rounded-2xl p-5 hover:border-primary/30 transition-colors"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Star className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground text-sm">
                      {offer.name}
                    </p>
                    {offer.discount_percent && (
                      <span className="text-[10px] font-medium text-warning bg-warning/10 px-1.5 py-0.5 rounded">
                        -{offer.discount_percent}%
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setEditingOffer(offer)}
                    className="p-1.5 text-foreground-muted hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                    title="Modifier l'offre"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setDeleteOfferTarget(offer)}
                    className="p-1.5 text-foreground-muted hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                    title="Supprimer l'offre"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex items-baseline gap-1 mb-3">
                <span className="text-2xl font-bold font-heading text-foreground">
                  {formatCurrency(offer.price_cents)}
                </span>
                <span className="text-xs text-foreground-muted">
                  {billingLabel(offer.billing_period)}
                </span>
              </div>

              {offer.description && (
                <p className="text-xs text-foreground-muted mb-3">{offer.description}</p>
              )}

              {offer.features && offer.features.length > 0 && (
                <ul className="space-y-1.5">
                  {offer.features.map((feat, i) => (
                    <li
                      key={i}
                      className="flex items-center gap-2 text-xs text-foreground-muted"
                    >
                      <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                      {feat}
                    </li>
                  ))}
                </ul>
              )}

              {/* Stripe sync + Subscriber count */}
              <div className="mt-3 pt-3 border-t border-border space-y-2">
                {offer.stripe_price_id ? (
                  <div className="flex items-center gap-1.5">
                    <Link2 className="w-3 h-3 text-emerald-400" />
                    <span className="text-[10px] text-emerald-400 font-medium">Stripe sync</span>
                    <span className="text-[9px] text-foreground-muted font-mono">{offer.stripe_price_id.slice(0, 20)}...</span>
                  </div>
                ) : (
                  <button
                    onClick={() => syncOfferToStripe(offer)}
                    disabled={syncingOfferId === offer.id}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-foreground-muted hover:text-foreground bg-surface-elevated border border-border rounded-lg hover:border-primary/30 transition-colors disabled:opacity-40 w-full justify-center"
                  >
                    {syncingOfferId === offer.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Unlink className="w-3 h-3" />}
                    Sync vers Stripe
                  </button>
                )}
                {subscriptions && (
                  <span className="text-[11px] text-foreground-muted block">
                    {subscriptions.filter((s) => s.offer_id === offer.id && s.status === "ACTIVE").length} abonné(s) actif(s)
                  </span>
                )}
              </div>
            </div>
          ))}
          {(offers ?? []).length === 0 && (
            <div className="bg-surface border border-border rounded-2xl p-5 text-center">
              <p className="text-sm text-foreground-muted">Aucune offre active</p>
              <button onClick={() => setShowCreateOffer(true)} className="mt-2 text-xs text-primary hover:underline">
                + Créer une offre
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Create Offer Modal */}
      {showCreateOffer && (
        <CreateOfferModal
          onClose={() => setShowCreateOffer(false)}
          onSubmit={(data) => createOfferMutation.mutate(data)}
          isLoading={createOfferMutation.isPending}
          error={(createOfferMutation.error as Error | null)?.message ?? null}
        />
      )}

      {/* Create Subscription Modal */}
      {showCreateSub && (
        <CreateSubscriptionModal
          onClose={() => setShowCreateSub(false)}
          onSubmit={(data) => createSubMutation.mutate(data)}
          isLoading={createSubMutation.isPending}
          error={(createSubMutation.error as Error | null)?.message ?? null}
          offers={offers ?? []}
        />
      )}

      {/* Edit Offer Modal */}
      {editingOffer && (
        <CreateOfferModal
          onClose={() => setEditingOffer(null)}
          onSubmit={(data) => updateOfferMutation.mutate({ ...data, id: editingOffer.id })}
          isLoading={updateOfferMutation.isPending}
          error={(updateOfferMutation.error as Error | null)?.message ?? null}
          editMode
          initialData={editingOffer}
        />
      )}

      {/* Delete Offer Confirmation */}
      {deleteOfferTarget && (
        <DeleteOfferConfirmModal
          offer={deleteOfferTarget}
          onConfirm={() => deleteOfferMutation.mutate(deleteOfferTarget.id)}
          onCancel={() => setDeleteOfferTarget(null)}
          isLoading={deleteOfferMutation.isPending}
        />
      )}
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

function KPIBox({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
}) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-5 flex items-center gap-4 transition-all hover:border-opacity-80">
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
        style={{ backgroundColor: `${color}15` }}
      >
        <Icon className="w-6 h-6" style={{ color }} />
      </div>
      <div>
        <p className="text-2xl font-heading font-bold text-foreground">{value}</p>
        <p className="text-xs text-foreground-muted mt-0.5">{label}</p>
      </div>
    </div>
  );
}

function CreateOfferModal({ onClose, onSubmit, isLoading, error, editMode, initialData }: {
  onClose: () => void;
  onSubmit: (data: { name: string; description: string; price_cents: number; billing_period: string; discount_percent: number | null; features: string[] }) => void;
  isLoading: boolean;
  error: string | null;
  editMode?: boolean;
  initialData?: SubscriptionOffer | null;
}) {
  const [name, setName] = useState(initialData?.name ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [priceEur, setPriceEur] = useState(initialData ? (initialData.price_cents / 100).toFixed(2) : "9.99");
  const [billingPeriod, setBillingPeriod] = useState(initialData?.billing_period ?? "monthly");
  const [discount, setDiscount] = useState(initialData?.discount_percent?.toString() ?? "");
  const [featuresText, setFeaturesText] = useState(
    initialData?.benefits?.join("\n") ?? initialData?.features?.join("\n") ?? "Accès réseau EZDrive\nSupport prioritaire\nHistorique de charge illimité"
  );

  const inputClass = "w-full px-3 py-2.5 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50 transition-colors";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({
      name: name.trim(),
      description: description.trim(),
      price_cents: Math.round(parseFloat(priceEur) * 100),
      billing_period: billingPeriod,
      discount_percent: discount ? parseFloat(discount) : null,
      features: featuresText.split("\n").map((f) => f.trim()).filter(Boolean),
    });
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-surface border border-border rounded-2xl w-full max-w-lg shadow-2xl">
          <div className="flex items-center justify-between p-5 border-b border-border">
            <h2 className="font-heading font-bold text-lg">{editMode ? "Modifier l'offre" : "Créer une offre d'abonnement"}</h2>
            <button onClick={onClose} className="p-1.5 hover:bg-surface-elevated rounded-lg transition-colors">
              <X className="w-5 h-5 text-foreground-muted" />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
            <div>
              <label className="block text-xs text-foreground-muted mb-1.5">Nom de l'offre *</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Premium Mensuel" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-foreground-muted mb-1.5">Description</label>
              <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Abonnement premium avec accès illimité" className={inputClass} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-foreground-muted mb-1.5">Prix (€) *</label>
                <input type="number" step="0.01" min="0" value={priceEur} onChange={(e) => setPriceEur(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="block text-xs text-foreground-muted mb-1.5">Période</label>
                <select value={billingPeriod} onChange={(e) => setBillingPeriod(e.target.value)} className={inputClass}>
                  <option value="monthly">Mensuel</option>
                  <option value="yearly">Annuel</option>
                  <option value="weekly">Hebdomadaire</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-foreground-muted mb-1.5">Remise (%)</label>
                <input type="number" step="1" min="0" max="100" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" className={inputClass} />
              </div>
            </div>
            <div>
              <label className="block text-xs text-foreground-muted mb-1.5">Avantages (un par ligne)</label>
              <textarea value={featuresText} onChange={(e) => setFeaturesText(e.target.value)} rows={4} className={cn(inputClass, "resize-none")} />
            </div>
            {error && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
            )}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-xl text-sm text-foreground-muted hover:text-foreground transition-colors">
                Annuler
              </button>
              <button type="submit" disabled={isLoading || !name.trim()} className="flex-1 py-2.5 bg-primary text-background rounded-xl text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                {editMode ? "Enregistrer" : "Créer l'offre"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

function CreateSubscriptionModal({ onClose, onSubmit, isLoading, error, offers }: {
  onClose: () => void;
  onSubmit: (data: { user_id: string; offer_id: string; started_at: string }) => void;
  isLoading: boolean;
  error: string | null;
  offers: SubscriptionOffer[];
}) {
  const [userSearch, setUserSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedUserLabel, setSelectedUserLabel] = useState("");
  const [offerId, setOfferId] = useState(offers[0]?.id ?? "");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [userResults, setUserResults] = useState<{ id: string; label: string; email: string }[]>([]);
  const [searching, setSearching] = useState(false);

  const inputClass = "w-full px-3 py-2.5 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50 transition-colors";

  async function searchUsers(q: string) {
    if (q.length < 2) { setUserResults([]); return; }
    setSearching(true);
    try {
      // Try all_consumers first
      const { data, error } = await supabase
        .from("all_consumers")
        .select("id, first_name, last_name, email")
        .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`)
        .limit(10);
      if (error) {
        // Fallback to profiles
        const { data: pData } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
          .limit(10);
        setUserResults((pData ?? []).map((p: any) => ({
          id: p.id,
          label: p.full_name || p.email,
          email: p.email ?? "",
        })));
        return;
      }
      setUserResults((data ?? []).map((c: any) => ({
        id: c.id,
        label: [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email,
        email: c.email ?? "",
      })));
    } catch {
      setUserResults([]);
    } finally {
      setSearching(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedUserId || !offerId) return;
    onSubmit({ user_id: selectedUserId, offer_id: offerId, started_at: startDate });
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-surface border border-border rounded-2xl w-full max-w-lg shadow-2xl">
          <div className="flex items-center justify-between p-5 border-b border-border">
            <h2 className="font-heading font-bold text-lg">Créer un abonnement</h2>
            <button onClick={onClose} className="p-1.5 hover:bg-surface-elevated rounded-lg transition-colors">
              <X className="w-5 h-5 text-foreground-muted" />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
            {/* User search */}
            <div>
              <label className="block text-xs text-foreground-muted mb-1.5">Client *</label>
              {selectedUserId ? (
                <div className="flex items-center justify-between bg-surface-elevated border border-border rounded-xl px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-foreground">{selectedUserLabel}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setSelectedUserId(""); setSelectedUserLabel(""); setUserSearch(""); }}
                    className="p-1 text-foreground-muted hover:text-foreground"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
                  <input
                    type="text"
                    value={userSearch}
                    onChange={(e) => { setUserSearch(e.target.value); searchUsers(e.target.value); }}
                    placeholder="Rechercher par nom ou email..."
                    className={`${inputClass} pl-9`}
                  />
                  {searching && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted animate-spin" />
                  )}
                  {userResults.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-surface border border-border rounded-xl shadow-lg max-h-48 overflow-y-auto">
                      {userResults.map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => {
                            setSelectedUserId(u.id);
                            setSelectedUserLabel(`${u.label} (${u.email})`);
                            setUserSearch("");
                            setUserResults([]);
                          }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-surface-elevated transition-colors"
                        >
                          <p className="font-medium text-foreground">{u.label}</p>
                          <p className="text-xs text-foreground-muted">{u.email}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Offer select */}
            <div>
              <label className="block text-xs text-foreground-muted mb-1.5">Offre *</label>
              <select value={offerId} onChange={(e) => setOfferId(e.target.value)} className={inputClass}>
                <option value="">Sélectionner une offre...</option>
                {offers.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} — {formatCurrency(o.price_cents)}{billingLabel(o.billing_period)}
                  </option>
                ))}
              </select>
            </div>

            {/* Start date */}
            <div>
              <label className="block text-xs text-foreground-muted mb-1.5">Date de début</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={inputClass}
              />
            </div>

            {error && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
            )}

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-xl text-sm text-foreground-muted hover:text-foreground transition-colors">
                Annuler
              </button>
              <button
                type="submit"
                disabled={isLoading || !selectedUserId || !offerId}
                className="flex-1 py-2.5 bg-primary text-background rounded-xl text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                Créer l'abonnement
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

function DeleteOfferConfirmModal({
  offer,
  onConfirm,
  onCancel,
  isLoading,
}: {
  offer: SubscriptionOffer;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onCancel} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-surface border border-border rounded-2xl w-full max-w-sm shadow-2xl p-6">
          <h2 className="font-heading font-bold text-lg mb-2">Supprimer l'offre ?</h2>
          <p className="text-sm text-foreground-muted mb-6">
            Supprimer l'offre <strong className="text-foreground">{offer.name}</strong> ? Les abonnements existants ne seront pas affectés.
          </p>
          <div className="flex gap-3">
            <button onClick={onCancel} className="flex-1 py-2.5 border border-border rounded-xl text-sm text-foreground-muted hover:text-foreground transition-colors">
              Annuler
            </button>
            <button
              onClick={onConfirm}
              disabled={isLoading}
              className="flex-1 py-2.5 bg-red-500 text-white rounded-xl text-sm font-semibold hover:bg-red-600 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
              Supprimer
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function TableSkeleton() {
  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <div className="border-b border-border px-4 py-3 flex gap-6">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-3 w-16 rounded-lg bg-surface-elevated animate-pulse" />
        ))}
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="px-4 py-3.5 flex items-center gap-6">
            <div className="h-3.5 w-28 rounded-lg bg-surface-elevated animate-pulse" />
            <div className="h-3 w-36 rounded-lg bg-surface-elevated animate-pulse" />
            <div className="h-6 w-20 rounded-lg bg-surface-elevated animate-pulse" />
            <div className="h-3 w-16 rounded-lg bg-surface-elevated animate-pulse" />
            <div className="h-6 w-20 rounded-full bg-surface-elevated animate-pulse" />
            <div className="h-3 w-20 rounded-lg bg-surface-elevated animate-pulse" />
            <div className="h-3 w-20 rounded-lg bg-surface-elevated animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
