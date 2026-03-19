import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  FileText,
  CreditCard,
  RefreshCcw,
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  X,
  ExternalLink,
  Search,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SessionsPage } from "@/components/sessions/SessionsPage";
import { InvoicesPage } from "@/components/invoices/InvoicesPage";
import { supabase } from "@/lib/supabase";
import { apiPost } from "@/lib/api";
import { Skeleton } from "@/components/ui/Skeleton";

const TABS = [
  { key: "sessions", label: "Sessions CDR", icon: Activity },
  { key: "invoices", label: "Factures", icon: FileText },
  { key: "payments", label: "Paiements Stripe", icon: CreditCard },
  { key: "disputes", label: "Litiges", icon: AlertTriangle },
  { key: "methods", label: "Methodes de paiement", icon: Wallet },
  { key: "transfers", label: "Virements", icon: ArrowRightLeft },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function BillingPage() {
  const [tab, setTab] = useState<TabKey>("sessions");
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-xl font-bold text-foreground">CDRs & Factures</h1>
        <p className="text-sm text-foreground-muted mt-0.5">Sessions de charge et facturation</p>
      </div>
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors relative whitespace-nowrap",
              tab === t.key ? "text-primary" : "text-foreground-muted hover:text-foreground"
            )}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
            {tab === t.key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />}
          </button>
        ))}
      </div>
      {tab === "sessions" && <SessionsPage />}
      {tab === "invoices" && <InvoicesPage />}
      {tab === "payments" && <StripePaymentsSection />}
      {tab === "disputes" && <StripeDisputesSection />}
      {tab === "methods" && <PaymentMethodsConfigSection />}
      {tab === "transfers" && <TransfersSection />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Story 97: View Stripe payments in real-time
// ══════════════════════════════════════════════════════════════

interface StripePayment {
  id: string;
  created_at: string;
  amount: number;
  currency: string;
  customer_email: string | null;
  customer_name: string | null;
  status: string;
  payment_method: string | null;
  invoice_id: string | null;
}

function StripePaymentsSection() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [refundPayment, setRefundPayment] = useState<StripePayment | null>(null);

  const { data: payments, isLoading } = useQuery({
    queryKey: ["stripe-payments"],
    queryFn: async () => {
      // Query from invoices table with payment status, or a dedicated payments table
      const { data, error } = await supabase
        .from("invoices")
        .select("id, created_at, total_amount, currency, customer_email, customer_name, payment_status, payment_method, stripe_invoice_id")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []).map((inv: any) => ({
        id: inv.id,
        created_at: inv.created_at,
        amount: inv.total_amount ?? 0,
        currency: inv.currency ?? "EUR",
        customer_email: inv.customer_email,
        customer_name: inv.customer_name,
        status: inv.payment_status ?? "pending",
        payment_method: inv.payment_method ?? "card",
        invoice_id: inv.stripe_invoice_id,
      })) as StripePayment[];
    },
    refetchInterval: 30000, // Auto-refresh every 30s
  });

  const filtered = useMemo(() => {
    let result = payments ?? [];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((p) =>
        (p.customer_email ?? "").toLowerCase().includes(q) ||
        (p.customer_name ?? "").toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q)
      );
    }
    if (statusFilter) {
      result = result.filter((p) => p.status === statusFilter);
    }
    return result;
  }, [payments, search, statusFilter]);

  const statusConfig: Record<string, { label: string; bg: string; text: string; icon: typeof CheckCircle }> = {
    succeeded: { label: "Reussi", bg: "bg-emerald-500/15", text: "text-emerald-400", icon: CheckCircle },
    paid: { label: "Paye", bg: "bg-emerald-500/15", text: "text-emerald-400", icon: CheckCircle },
    failed: { label: "Echoue", bg: "bg-red-500/15", text: "text-red-400", icon: XCircle },
    pending: { label: "En attente", bg: "bg-yellow-500/15", text: "text-yellow-400", icon: Clock },
    refunded: { label: "Rembourse", bg: "bg-blue-500/15", text: "text-blue-400", icon: RefreshCcw },
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <CreditCard className="w-5 h-5 text-primary" />
        <div>
          <h2 className="text-base font-heading font-bold text-foreground">Paiements Stripe</h2>
          <p className="text-xs text-foreground-muted">Rafraichissement automatique toutes les 30s</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par client, email..."
            className="w-full pl-9 pr-4 py-2 text-sm bg-surface border border-border rounded-xl focus:outline-none focus:border-primary/50 placeholder:text-foreground-muted"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-surface border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
        >
          <option value="">Tous les statuts</option>
          <option value="succeeded">Reussi</option>
          <option value="paid">Paye</option>
          <option value="pending">En attente</option>
          <option value="failed">Echoue</option>
          <option value="refunded">Rembourse</option>
        </select>
        <span className="text-xs text-foreground-muted">{filtered.length} paiement(s)</span>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Client</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-muted uppercase">Montant</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Statut</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Methode</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-muted uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((payment) => {
                  const sc = statusConfig[payment.status] ?? statusConfig.pending;
                  const StatusIcon = sc.icon;
                  return (
                    <tr key={payment.id} className="hover:bg-surface-elevated/50 transition-colors">
                      <td className="px-4 py-3 text-sm text-foreground-muted whitespace-nowrap">
                        {new Date(payment.created_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" })}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-foreground">{payment.customer_name ?? "\u2014"}</p>
                        <p className="text-xs text-foreground-muted">{payment.customer_email ?? "\u2014"}</p>
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-foreground text-right">
                        {(payment.amount / 100).toFixed(2)} {payment.currency.toUpperCase()}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium", sc.bg, sc.text)}>
                          <StatusIcon className="w-3 h-3" />
                          {sc.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground-muted capitalize">{payment.payment_method ?? "\u2014"}</td>
                      <td className="px-4 py-3 text-right">
                        {(payment.status === "succeeded" || payment.status === "paid") && (
                          <button
                            onClick={() => setRefundPayment(payment)}
                            className="text-xs text-primary hover:text-primary/80 font-medium"
                          >
                            Rembourser
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-foreground-muted">Aucun paiement</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Story 98: Refund dialog */}
      {refundPayment && (
        <RefundDialog
          payment={refundPayment}
          onClose={() => setRefundPayment(null)}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Story 98: Refund a payment
// ══════════════════════════════════════════════════════════════

function RefundDialog({ payment, onClose }: { payment: StripePayment; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [refundType, setRefundType] = useState<"full" | "partial">("full");
  const [partialAmount, setPartialAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  async function handleRefund() {
    setLoading(true);
    setResult(null);
    try {
      const amount = refundType === "full" ? payment.amount : Math.round(parseFloat(partialAmount) * 100);
      await apiPost("stripe/refund", {
        payment_id: payment.id,
        invoice_id: payment.invoice_id,
        amount,
      });
      setResult({ success: true, message: "Remboursement effectue avec succes" });
      queryClient.invalidateQueries({ queryKey: ["stripe-payments"] });
    } catch (err) {
      setResult({ success: false, message: `Erreur: ${(err as Error).message}` });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-surface border border-border rounded-2xl w-full max-w-md mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-yellow-500/15 flex items-center justify-center">
              <RefreshCcw className="w-5 h-5 text-yellow-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Rembourser</h2>
              <p className="text-xs text-foreground-muted">{payment.customer_name ?? payment.customer_email ?? "Client"}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {result ? (
            <div className={cn(
              "rounded-xl px-4 py-3 text-sm font-medium border",
              result.success
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                : "bg-red-500/10 text-red-400 border-red-500/30"
            )}>
              {result.message}
            </div>
          ) : (
            <>
              <div className="bg-surface-elevated rounded-xl p-4">
                <p className="text-xs text-foreground-muted">Montant original</p>
                <p className="text-xl font-bold text-foreground">{(payment.amount / 100).toFixed(2)} {payment.currency.toUpperCase()}</p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setRefundType("full")}
                  className={cn(
                    "flex-1 px-4 py-2.5 rounded-xl text-sm font-medium border transition-all",
                    refundType === "full"
                      ? "bg-primary/15 text-primary border-primary/30"
                      : "text-foreground-muted border-border hover:border-foreground-muted"
                  )}
                >
                  Remboursement total
                </button>
                <button
                  onClick={() => setRefundType("partial")}
                  className={cn(
                    "flex-1 px-4 py-2.5 rounded-xl text-sm font-medium border transition-all",
                    refundType === "partial"
                      ? "bg-primary/15 text-primary border-primary/30"
                      : "text-foreground-muted border-border hover:border-foreground-muted"
                  )}
                >
                  Remboursement partiel
                </button>
              </div>

              {refundType === "partial" && (
                <div>
                  <label className="block text-xs font-medium text-foreground-muted mb-1.5">Montant a rembourser ({payment.currency.toUpperCase()})</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={(payment.amount / 100).toFixed(2)}
                    value={partialAmount}
                    onChange={(e) => setPartialAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-surface-elevated border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50"
                  />
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-foreground-muted/10 text-foreground-muted font-semibold text-sm hover:bg-foreground-muted/20">
                  Annuler
                </button>
                <button
                  onClick={handleRefund}
                  disabled={loading || (refundType === "partial" && (!partialAmount || parseFloat(partialAmount) <= 0))}
                  className="flex-1 py-2.5 rounded-xl bg-yellow-500 text-background font-semibold text-sm hover:bg-yellow-500/90 disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
                  Rembourser
                </button>
              </div>
            </>
          )}

          {result && (
            <button onClick={onClose} className="w-full py-2.5 rounded-xl bg-foreground-muted/10 text-foreground-muted font-semibold text-sm hover:bg-foreground-muted/20">
              Fermer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Story 99: View Stripe disputes
// ══════════════════════════════════════════════════════════════

function StripeDisputesSection() {
  const { data: disputes, isLoading } = useQuery({
    queryKey: ["stripe-disputes"],
    queryFn: async () => {
      // Query from a disputes table or fallback to invoices with disputed status
      const { data, error } = await supabase
        .from("stripe_disputes")
        .select("id, created_at, amount, currency, reason, status, payment_id, customer_email")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) {
        // If table doesn't exist, return empty
        return [];
      }
      return data ?? [];
    },
  });

  const statusColors: Record<string, string> = {
    needs_response: "bg-red-500/15 text-red-400",
    under_review: "bg-yellow-500/15 text-yellow-400",
    won: "bg-emerald-500/15 text-emerald-400",
    lost: "bg-foreground-muted/15 text-foreground-muted",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-yellow-400" />
          <div>
            <h2 className="text-base font-heading font-bold text-foreground">Litiges Stripe</h2>
            <p className="text-xs text-foreground-muted">Paiements contestes par les clients</p>
          </div>
        </div>
        <a
          href="https://dashboard.stripe.com/disputes"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-4 py-2 text-sm text-primary font-medium hover:bg-primary/10 rounded-xl transition-colors"
        >
          Stripe Dashboard <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : (disputes ?? []).length === 0 ? (
        <div className="bg-surface border border-border rounded-2xl p-8 text-center">
          <AlertTriangle className="w-8 h-8 text-foreground-muted mx-auto mb-3" />
          <p className="text-foreground font-medium">Aucun litige</p>
          <p className="text-sm text-foreground-muted mt-1">Les litiges Stripe apparaitront ici lorsqu'un client conteste un paiement.</p>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Client</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-muted uppercase">Montant</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Raison</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(disputes ?? []).map((d: any) => (
                <tr key={d.id} className="hover:bg-surface-elevated/50 transition-colors">
                  <td className="px-4 py-3 text-sm text-foreground-muted">{new Date(d.created_at).toLocaleDateString("fr-FR")}</td>
                  <td className="px-4 py-3 text-sm text-foreground">{d.customer_email ?? "\u2014"}</td>
                  <td className="px-4 py-3 text-sm font-semibold text-foreground text-right">{((d.amount ?? 0) / 100).toFixed(2)} {(d.currency ?? "EUR").toUpperCase()}</td>
                  <td className="px-4 py-3 text-sm text-foreground-muted capitalize">{(d.reason ?? "unknown").replace(/_/g, " ")}</td>
                  <td className="px-4 py-3">
                    <span className={cn("px-2 py-0.5 rounded text-xs font-medium", statusColors[d.status] ?? statusColors.needs_response)}>
                      {d.status?.replace(/_/g, " ") ?? "inconnu"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Story 100: Configure accepted payment methods
// ══════════════════════════════════════════════════════════════

const PAYMENT_METHODS = [
  { key: "card", label: "Carte bancaire (CB/Visa/MC)", description: "Paiement par carte de credit ou debit" },
  { key: "apple_pay", label: "Apple Pay", description: "Paiement via Apple Pay sur iOS/macOS" },
  { key: "google_pay", label: "Google Pay", description: "Paiement via Google Pay sur Android" },
  { key: "sepa_debit", label: "Prelevement SEPA", description: "Prelevement bancaire europeen" },
];

function PaymentMethodsConfigSection() {
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);

  const { data: config, isLoading } = useQuery({
    queryKey: ["payment-methods-config"],
    queryFn: async () => {
      const { data } = await supabase
        .from("platform_settings")
        .select("accepted_payment_methods")
        .eq("id", "default")
        .maybeSingle();
      return (data?.accepted_payment_methods as string[] | null) ?? ["card"];
    },
  });

  const [methods, setMethods] = useState<string[]>(["card"]);

  // Sync config -> state
  useState(() => {
    if (config) setMethods(config);
  });

  // Keep in sync
  useMemo(() => {
    if (config) setMethods(config);
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("platform_settings")
        .upsert({ id: "default", accepted_payment_methods: methods });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payment-methods-config"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  function toggleMethod(key: string) {
    setMethods((prev) =>
      prev.includes(key) ? prev.filter((m) => m !== key) : [...prev, key]
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Wallet className="w-5 h-5 text-primary" />
        <div>
          <h2 className="text-base font-heading font-bold text-foreground">Methodes de paiement acceptees</h2>
          <p className="text-xs text-foreground-muted">Configurez les moyens de paiement disponibles pour les conducteurs</p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : (
        <div className="bg-surface border border-border rounded-2xl divide-y divide-border">
          {PAYMENT_METHODS.map((pm) => (
            <label key={pm.key} className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-surface-elevated/30 transition-colors">
              <input
                type="checkbox"
                checked={methods.includes(pm.key)}
                onChange={() => toggleMethod(pm.key)}
                className="w-5 h-5 rounded border-border text-primary focus:ring-primary"
              />
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">{pm.label}</p>
                <p className="text-xs text-foreground-muted">{pm.description}</p>
              </div>
              {methods.includes(pm.key) && (
                <span className="px-2 py-0.5 bg-emerald-500/15 text-emerald-400 text-xs font-medium rounded">Actif</span>
              )}
            </label>
          ))}

          <div className="px-5 py-4">
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="flex items-center gap-2 px-5 py-2.5 bg-primary text-background font-semibold rounded-xl text-sm hover:bg-primary/90 disabled:opacity-50"
            >
              {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle className="w-4 h-4" /> : null}
              {saved ? "Sauvegarde !" : "Sauvegarder"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Story 101: View transfers to connected accounts
// ══════════════════════════════════════════════════════════════

function TransfersSection() {
  const { data: transfers, isLoading } = useQuery({
    queryKey: ["stripe-transfers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stripe_transfers")
        .select("id, created_at, amount, currency, destination_name, destination_account, status")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) {
        // Table may not exist yet — return empty
        return [];
      }
      return data ?? [];
    },
  });

  const statusBadge = (status: string) => {
    switch (status) {
      case "paid":
      case "succeeded":
        return <span className="px-2 py-0.5 bg-emerald-500/15 text-emerald-400 text-xs font-medium rounded">Effectue</span>;
      case "pending":
        return <span className="px-2 py-0.5 bg-yellow-500/15 text-yellow-400 text-xs font-medium rounded">En attente</span>;
      case "failed":
        return <span className="px-2 py-0.5 bg-red-500/15 text-red-400 text-xs font-medium rounded">Echoue</span>;
      default:
        return <span className="px-2 py-0.5 bg-foreground-muted/10 text-foreground-muted text-xs font-medium rounded">{status}</span>;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ArrowRightLeft className="w-5 h-5 text-primary" />
          <div>
            <h2 className="text-base font-heading font-bold text-foreground">Virements</h2>
            <p className="text-xs text-foreground-muted">Transferts vers les comptes connectes (CPOs)</p>
          </div>
        </div>
        <a
          href="https://dashboard.stripe.com/connect/transfers"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-4 py-2 text-sm text-primary font-medium hover:bg-primary/10 rounded-xl transition-colors"
        >
          Stripe Dashboard <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : (transfers ?? []).length === 0 ? (
        <div className="bg-surface border border-border rounded-2xl p-8 text-center">
          <ArrowRightLeft className="w-8 h-8 text-foreground-muted mx-auto mb-3" />
          <p className="text-foreground font-medium">Aucun virement</p>
          <p className="text-sm text-foreground-muted mt-1">Les virements vers les comptes connectes apparaitront ici.</p>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Destination</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-muted uppercase">Montant</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(transfers ?? []).map((t: any) => (
                <tr key={t.id} className="hover:bg-surface-elevated/50 transition-colors">
                  <td className="px-4 py-3 text-sm text-foreground-muted">{new Date(t.created_at).toLocaleDateString("fr-FR")}</td>
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-foreground">{t.destination_name ?? "\u2014"}</p>
                    <p className="text-xs text-foreground-muted font-mono">{t.destination_account ?? "\u2014"}</p>
                  </td>
                  <td className="px-4 py-3 text-sm font-semibold text-foreground text-right">
                    {((t.amount ?? 0) / 100).toFixed(2)} {(t.currency ?? "EUR").toUpperCase()}
                  </td>
                  <td className="px-4 py-3">{statusBadge(t.status ?? "pending")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
