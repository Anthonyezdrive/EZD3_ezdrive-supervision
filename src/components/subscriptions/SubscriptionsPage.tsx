import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { PageHelp } from "@/components/ui/PageHelp";
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
  description: string | null;
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
  const [statusFilter, setStatusFilter] = useState<SubscriptionStatus | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-heading text-xl font-bold text-foreground">Abonnements</h1>
        <p className="text-sm text-foreground-muted mt-1">
          Gestion des abonnements clients
        </p>
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
              <div className="flex items-center gap-2 mb-3">
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

              {/* Subscriber count */}
              {subscriptions && (
                <div className="mt-3 pt-3 border-t border-border">
                  <span className="text-[11px] text-foreground-muted">
                    {subscriptions.filter(
                      (s) => s.offer_id === offer.id && s.status === "ACTIVE"
                    ).length}{" "}
                    abonné{subscriptions.filter(
                      (s) => s.offer_id === offer.id && s.status === "ACTIVE"
                    ).length > 1
                      ? "s"
                      : ""}{" "}
                    actif
                    {subscriptions.filter(
                      (s) => s.offer_id === offer.id && s.status === "ACTIVE"
                    ).length > 1
                      ? "s"
                      : ""}
                  </span>
                </div>
              )}
            </div>
          ))}
          {(offers ?? []).length === 0 && (
            <div className="bg-surface border border-border rounded-2xl p-5 text-center">
              <p className="text-sm text-foreground-muted">Aucune offre active</p>
            </div>
          )}
        </div>
      </div>
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
