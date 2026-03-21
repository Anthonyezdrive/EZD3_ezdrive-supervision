import { useState, useRef, useEffect } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Upload,
  Pencil,
  Check,
  X,
  User,
  Mail,
  Shield,
  Users,
  Loader2,
  ImageIcon,
  Lock,
  CreditCard,
  ShoppingCart,
  Bell,
  Nfc,
  Euro,
  ChevronDown,
  Wallet,
  FileText,
  Info,
  Save,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { useB2BClientUsers, useUpdateB2BClientSelf, useUploadB2BLogo } from "@/hooks/useB2BCompany";
import { useReimbursementRuns, useReimbursementLineItems, useDeleteReimbursementRun } from "@/hooks/useReimbursements";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/contexts/ToastContext";
import { PageHelp } from "@/components/ui/PageHelp";
import type { B2BClient } from "@/types/b2b";

// ── Company Page ──────────────────────────────────────────

export function B2BCompanyPage() {
  const { activeClient } =
    useOutletContext<{ activeClient: B2BClient | null; customerExternalIds: string[] }>();
  const { profile, user } = useAuth();

  const { data: teamUsers, isLoading: loadingUsers } = useB2BClientUsers(activeClient?.id);
  const updateClient = useUpdateB2BClientSelf();
  const uploadLogo = useUploadB2BLogo();

  // ── Inline edit state ──
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!activeClient) {
    return (
      <div className="flex flex-col items-center justify-center h-48 bg-surface border border-border rounded-2xl">
        <Building2 className="w-8 h-8 text-foreground-muted mb-3" />
        <p className="text-foreground-muted">Aucun client sélectionné</p>
      </div>
    );
  }

  // ── Handlers ──
  function startEditName() {
    setNameValue(activeClient!.name);
    setEditingName(true);
  }

  async function saveName() {
    if (!nameValue.trim() || nameValue.trim() === activeClient!.name) {
      setEditingName(false);
      return;
    }
    await updateClient.mutateAsync({
      clientId: activeClient!.id,
      name: nameValue.trim(),
    });
    setEditingName(false);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !activeClient) return;
    await uploadLogo.mutateAsync({ clientId: activeClient.id, file });
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const logoInitial = activeClient.name?.charAt(0)?.toUpperCase() ?? "B";

  return (
    <div className="space-y-6">
      <PageHelp
        summary="Gérez les informations de votre entreprise, votre logo et consultez les membres de votre équipe"
        items={[
          { label: "Logo", description: "Uploadez le logo de votre entreprise. Formats acceptés : JPG, PNG, WebP, SVG (max 2 Mo)." },
          { label: "Nom", description: "Le nom affiché dans l'en-tête du portail et sur vos rapports." },
          { label: "Équipe", description: "Liste des collaborateurs ayant accès à ce portail B2B." },
        ]}
      />

      {/* ── Card 1: Company Info ── */}
      <div className="bg-surface border border-border rounded-2xl p-6 space-y-6">
        <div className="flex items-center gap-3 mb-2">
          <Building2 className="w-5 h-5" style={{ color: "#9ACC0E" }} />
          <h3 className="text-base font-heading font-bold text-foreground">
            Informations de l'entreprise
          </h3>
        </div>

        {/* Logo + Upload */}
        <div className="flex items-center gap-6">
          <div className="relative group">
            {activeClient.logo_url ? (
              <img
                src={activeClient.logo_url}
                alt={activeClient.name}
                className="w-20 h-20 rounded-2xl object-contain bg-white border border-border p-2"
              />
            ) : (
              <div
                className="w-20 h-20 rounded-2xl border-2 border-dashed flex items-center justify-center"
                style={{ backgroundColor: "#9ACC0E10", borderColor: "#9ACC0E40" }}
              >
                <span className="text-2xl font-bold" style={{ color: "#9ACC0E" }}>
                  {logoInitial}
                </span>
              </div>
            )}
            {uploadLogo.isPending && (
              <div className="absolute inset-0 bg-black/50 rounded-2xl flex items-center justify-center">
                <Loader2 className="w-6 h-6 text-white animate-spin" />
              </div>
            )}
          </div>
          <div className="space-y-2">
            <p className="text-sm text-foreground-muted">
              {activeClient.logo_url ? "Logo de l'entreprise" : "Aucun logo configuré"}
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadLogo.isPending}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors disabled:opacity-50"
            >
              {activeClient.logo_url ? (
                <><Pencil className="w-3.5 h-3.5" /> Changer le logo</>
              ) : (
                <><Upload className="w-3.5 h-3.5" /> Ajouter un logo</>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/svg+xml"
              onChange={handleFileChange}
              className="hidden"
            />
            <p className="text-[11px] text-foreground-muted/60">
              JPG, PNG, WebP ou SVG — max 2 Mo
            </p>
          </div>
        </div>

        {/* Company details */}
        <div className="space-y-3 pt-2 border-t border-border">
          {/* Name (editable) */}
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-foreground-muted">Nom</span>
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={nameValue}
                  onChange={(e) => setNameValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setEditingName(false); }}
                  autoFocus
                  className="px-2 py-1 bg-surface-elevated border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary/50 w-48"
                />
                <button
                  onClick={saveName}
                  disabled={updateClient.isPending}
                  className="p-1 rounded hover:bg-emerald-500/10 text-emerald-400 transition-colors"
                >
                  {updateClient.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => setEditingName(false)}
                  className="p-1 rounded hover:bg-red-500/10 text-red-400 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">{activeClient.name}</span>
                <button
                  onClick={startEditName}
                  className="p-1 rounded hover:bg-surface-elevated text-foreground-muted hover:text-foreground transition-colors"
                  title="Modifier le nom"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Slug */}
          <div className="flex items-center justify-between py-2 border-t border-border/50">
            <span className="text-sm text-foreground-muted">Identifiant</span>
            <span className="inline-flex items-center bg-foreground-muted/10 text-foreground-muted border border-border rounded-md px-2 py-0.5 text-xs font-mono">
              {activeClient.slug}
            </span>
          </div>

          {/* Redevance rate */}
          <div className="flex items-center justify-between py-2 border-t border-border/50">
            <span className="text-sm text-foreground-muted">Taux redevance</span>
            <span className="text-sm font-medium text-foreground">
              {((activeClient.redevance_rate ?? 0) * 100).toFixed(0)} %
            </span>
          </div>

          {/* Status */}
          <div className="flex items-center justify-between py-2 border-t border-border/50">
            <span className="text-sm text-foreground-muted">Statut</span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold ${
                activeClient.is_active
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                  : "bg-red-500/10 text-red-400 border-red-500/25"
              }`}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: activeClient.is_active ? "#34D399" : "#F87171" }}
              />
              {activeClient.is_active ? "Actif" : "Inactif"}
            </span>
          </div>
        </div>
      </div>

      {/* ── Card 2: My Profile ── */}
      <div className="bg-surface border border-border rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <User className="w-5 h-5" style={{ color: "#00C3FF" }} />
          <h3 className="text-base font-heading font-bold text-foreground">
            Mon profil
          </h3>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-foreground-muted flex items-center gap-2">
              <User className="w-3.5 h-3.5" /> Nom
            </span>
            <span className="text-sm font-medium text-foreground">
              {profile?.full_name ?? "—"}
            </span>
          </div>
          <div className="flex items-center justify-between py-2 border-t border-border/50">
            <span className="text-sm text-foreground-muted flex items-center gap-2">
              <Mail className="w-3.5 h-3.5" /> Email
            </span>
            <span className="text-sm font-medium text-foreground">
              {user?.email ?? profile?.email ?? "—"}
            </span>
          </div>
          <div className="flex items-center justify-between py-2 border-t border-border/50">
            <span className="text-sm text-foreground-muted flex items-center gap-2">
              <Shield className="w-3.5 h-3.5" /> Rôle
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold bg-blue-500/10 text-blue-400 border-blue-500/25">
              Client B2B
            </span>
          </div>
        </div>
      </div>

      {/* ── Card 3: Team Members ── */}
      <div className="bg-surface border border-border rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <Users className="w-5 h-5" style={{ color: "#F39C12" }} />
            <h3 className="text-base font-heading font-bold text-foreground">
              Utilisateurs avec accès
            </h3>
          </div>
          {teamUsers && (
            <span className="text-xs text-foreground-muted bg-foreground-muted/10 rounded-full px-2.5 py-1">
              {teamUsers.length} membre{teamUsers.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {loadingUsers ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-surface-elevated rounded-xl animate-pulse" />
            ))}
          </div>
        ) : teamUsers && teamUsers.length > 0 ? (
          <div className="space-y-1">
            {teamUsers.map((u) => {
              const isMe = u.user_id === profile?.id;
              const initial = u.full_name?.charAt(0)?.toUpperCase() ?? u.email.charAt(0).toUpperCase();
              return (
                <div
                  key={u.user_id}
                  className={`flex items-center justify-between px-4 py-3 rounded-xl transition-colors ${
                    isMe ? "bg-surface-elevated border border-border" : "hover:bg-surface-elevated/50"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                      style={{ backgroundColor: "#9ACC0E20", color: "#9ACC0E" }}
                    >
                      {initial}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {u.full_name ?? u.email}
                        {isMe && (
                          <span className="ml-2 text-[10px] font-semibold bg-primary/10 text-primary border border-primary/25 rounded px-1.5 py-0.5">
                            vous
                          </span>
                        )}
                      </p>
                      {u.full_name && (
                        <p className="text-xs text-foreground-muted">{u.email}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-24 text-foreground-muted">
            <ImageIcon className="w-6 h-6 mb-2 opacity-40" />
            <p className="text-sm">Aucun utilisateur trouvé</p>
          </div>
        )}
      </div>

      {/* Story 55: Budget & Rapports */}
      <B2BBudgetReportsSection clientId={activeClient.id} activeClient={activeClient} />

      {/* Story 81: Change Password */}
      <B2BPasswordSection />

      {/* Story 82: Active Tokens */}
      <B2BTokensSection clientName={activeClient.name} />

      {/* Story 83: Order RFID Token */}
      <B2BOrderTokenSection clientName={activeClient.name} />

      {/* Story 84: Notifications */}
      <B2BNotificationsSection clientName={activeClient.name} />

      {/* Story 85: Reimbursements */}
      <B2BReimbursementSection clientId={activeClient.id} />
    </div>
  );
}

// ── Story 55: Budget & Reports Section ──────────────────────────

function B2BBudgetReportsSection({ clientId, activeClient }: { clientId: string; activeClient: B2BClient }) {
  const qc = useQueryClient();

  const [monthlyBudget, setMonthlyBudget] = useState<number>(activeClient?.monthly_budget ?? 0);
  const [budgetAlertEnabled, setBudgetAlertEnabled] = useState<boolean>(activeClient?.budget_alert_enabled ?? false);
  const [budgetBlockEnabled, setBudgetBlockEnabled] = useState<boolean>(activeClient?.budget_block_enabled ?? false);
  const [monthlyReportEmail, setMonthlyReportEmail] = useState<boolean>(activeClient?.monthly_report_email ?? false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  // Sync local state when activeClient changes
  useEffect(() => {
    setMonthlyBudget(activeClient?.monthly_budget ?? 0);
    setBudgetAlertEnabled(activeClient?.budget_alert_enabled ?? false);
    setBudgetBlockEnabled(activeClient?.budget_block_enabled ?? false);
    setMonthlyReportEmail(activeClient?.monthly_report_email ?? false);
  }, [activeClient]);

  const saveBudgetSettings = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("b2b_clients")
        .update({
          monthly_budget: monthlyBudget,
          budget_alert_enabled: budgetAlertEnabled,
          budget_block_enabled: budgetBlockEnabled,
          monthly_report_email: monthlyReportEmail,
        })
        .eq("id", clientId);
      if (error) throw error;
    },
    onSuccess: () => {
      setSaveStatus("success");
      qc.invalidateQueries({ queryKey: ["b2b-client"] });
      setTimeout(() => setSaveStatus("idle"), 3000);
    },
    onError: () => {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    },
  });

  async function handleSave() {
    setSaveStatus("loading");
    await saveBudgetSettings.mutateAsync();
  }

  const toggleClass =
    "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none cursor-pointer";
  const toggleDotClass =
    "inline-block h-4 w-4 transform rounded-full bg-white transition-transform";

  return (
    <div className="bg-surface border border-border rounded-2xl p-6 space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <Wallet className="w-5 h-5" style={{ color: "#9ACC0E" }} />
        <h3 className="text-base font-heading font-bold text-foreground">
          Budget & Rapports
        </h3>
      </div>

      {/* Budget section */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-foreground-muted uppercase tracking-wider">
          Budget
        </h4>

        <div className="max-w-sm">
          <label className="text-xs text-foreground-muted mb-1 block">
            Plafond mensuel (&euro;)
          </label>
          <input
            type="number"
            min={0}
            step={100}
            value={monthlyBudget}
            onChange={(e) => setMonthlyBudget(Number(e.target.value))}
            className="w-full px-3 py-2.5 bg-surface-elevated border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-border-focus transition-colors"
            placeholder="0"
          />
        </div>

        <div className="flex items-center justify-between py-2">
          <span className="text-sm text-foreground">Alerte &agrave; 80% du budget</span>
          <button
            type="button"
            onClick={() => setBudgetAlertEnabled(!budgetAlertEnabled)}
            className={`${toggleClass} ${budgetAlertEnabled ? "bg-primary" : "bg-white/10"}`}
          >
            <span className={`${toggleDotClass} ${budgetAlertEnabled ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>

        <div className="flex items-center justify-between py-2 border-t border-border/50">
          <span className="text-sm text-foreground">Bloquer les sessions &agrave; 100%</span>
          <button
            type="button"
            onClick={() => setBudgetBlockEnabled(!budgetBlockEnabled)}
            className={`${toggleClass} ${budgetBlockEnabled ? "bg-primary" : "bg-white/10"}`}
          >
            <span className={`${toggleDotClass} ${budgetBlockEnabled ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>
      </div>

      {/* Separator */}
      <div className="border-t border-border" />

      {/* Monthly report section */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-foreground-muted uppercase tracking-wider">
          Rapport mensuel
        </h4>

        <div className="flex items-center justify-between py-2">
          <span className="text-sm text-foreground">Recevoir un rapport mensuel par email</span>
          <button
            type="button"
            onClick={() => setMonthlyReportEmail(!monthlyReportEmail)}
            className={`${toggleClass} ${monthlyReportEmail ? "bg-primary" : "bg-white/10"}`}
          >
            <span className={`${toggleDotClass} ${monthlyReportEmail ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>

        <div className="flex items-start gap-2 px-3 py-2.5 bg-surface-elevated/50 border border-border/50 rounded-xl">
          <Info className="w-4 h-4 text-foreground-muted shrink-0 mt-0.5" />
          <p className="text-xs text-foreground-muted">
            Un rapport PDF sera envoy&eacute; le 1er de chaque mois &agrave; l'adresse de votre compte.
          </p>
        </div>
      </div>

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={saveStatus === "loading"}
        className="flex items-center gap-2 px-4 py-2.5 bg-primary/10 text-primary border border-primary/20 rounded-xl text-sm font-medium hover:bg-primary/20 transition-colors disabled:opacity-50"
      >
        {saveStatus === "loading" ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Save className="w-4 h-4" />
        )}
        Enregistrer
      </button>
      {saveStatus === "success" && (
        <p className="text-xs text-emerald-400">Param&egrave;tres enregistr&eacute;s avec succ&egrave;s</p>
      )}
      {saveStatus === "error" && (
        <p className="text-xs text-red-400">Erreur lors de l'enregistrement</p>
      )}
    </div>
  );
}

// ── Story 81: Password Change Section ──────────────────────────

function B2BPasswordSection() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit() {
    if (newPassword !== confirmPassword) { setErrorMsg("Les mots de passe ne correspondent pas"); setStatus("error"); return; }
    if (newPassword.length < 8) { setErrorMsg("Le mot de passe doit contenir au moins 8 caractères"); setStatus("error"); return; }
    setStatus("loading");
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) { setErrorMsg(error.message); setStatus("error"); }
    else { setStatus("success"); setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); }
  }

  const inputClass = "w-full px-3 py-2.5 bg-surface-elevated border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-border-focus transition-colors";

  return (
    <div className="bg-surface border border-border rounded-2xl p-6 space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <Lock className="w-5 h-5" style={{ color: "#E74C3C" }} />
        <h3 className="text-base font-heading font-bold text-foreground">Sécurité</h3>
      </div>
      <div className="space-y-3 max-w-sm">
        <div>
          <label className="text-xs text-foreground-muted mb-1 block">Mot de passe actuel</label>
          <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="text-xs text-foreground-muted mb-1 block">Nouveau mot de passe</label>
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="text-xs text-foreground-muted mb-1 block">Confirmer</label>
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={inputClass} />
        </div>
        <button
          onClick={handleSubmit}
          disabled={status === "loading" || !newPassword}
          className="flex items-center gap-2 px-4 py-2.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl text-sm font-medium hover:bg-red-500/20 transition-colors disabled:opacity-50"
        >
          {status === "loading" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
          Changer le mot de passe
        </button>
        {status === "success" && <p className="text-xs text-emerald-400">Mot de passe modifié avec succès</p>}
        {status === "error" && <p className="text-xs text-red-400">{errorMsg}</p>}
      </div>
    </div>
  );
}

// ── Story 82: Active Tokens Section ────────────────────────────

function B2BTokensSection({ clientName }: { clientName: string }) {
  const { data: tokens, isLoading } = useQuery({
    queryKey: ["b2b-tokens", clientName],
    queryFn: async () => {
      const { data } = await supabase
        .from("gfx_tokens")
        .select("id, token_uid, driver_name, status, total_sessions, last_used_at")
        .eq("customer_group", clientName)
        .order("total_sessions", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });

  return (
    <div className="bg-surface border border-border rounded-2xl p-6 space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <Nfc className="w-5 h-5" style={{ color: "#6366F1" }} />
        <h3 className="text-base font-heading font-bold text-foreground">Mes tokens</h3>
        {tokens && <span className="text-xs text-foreground-muted bg-foreground-muted/10 rounded-full px-2.5 py-1">{tokens.length}</span>}
      </div>
      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-10 bg-surface-elevated rounded-xl animate-pulse" />)}</div>
      ) : tokens && tokens.length > 0 ? (
        <div className="space-y-1">
          {tokens.map((t) => (
            <div key={t.id as string} className="flex items-center justify-between px-4 py-2.5 rounded-xl hover:bg-surface-elevated/50 transition-colors">
              <div>
                <p className="text-sm font-mono text-foreground">{(t.token_uid as string).slice(-12)}</p>
                <p className="text-xs text-foreground-muted">{(t.driver_name as string) ?? "—"}</p>
              </div>
              <span className="text-xs text-foreground-muted">{(t.total_sessions as number)} sessions</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-foreground-muted">Aucun token associé</p>
      )}
    </div>
  );
}

// ── Story 83: Order RFID Token Section ─────────────────────────

function B2BOrderTokenSection({ clientName }: { clientName: string }) {
  const [quantity, setQuantity] = useState(1);
  const [address, setAddress] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  async function handleOrder() {
    setStatus("loading");
    const { error } = await supabase.from("token_orders").insert({
      client_name: clientName,
      quantity,
      shipping_address: address,
      status: "pending",
    });
    if (error) { setStatus("error"); console.warn(error.message); }
    else { setStatus("success"); }
  }

  const inputClass = "w-full px-3 py-2.5 bg-surface-elevated border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-border-focus transition-colors";

  return (
    <div className="bg-surface border border-border rounded-2xl p-6 space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <ShoppingCart className="w-5 h-5" style={{ color: "#2ECC71" }} />
        <h3 className="text-base font-heading font-bold text-foreground">Commander des tokens RFID</h3>
      </div>
      <div className="space-y-3 max-w-sm">
        <div>
          <label className="text-xs text-foreground-muted mb-1 block">Quantité</label>
          <input type="number" min={1} max={100} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} className={inputClass} />
        </div>
        <div>
          <label className="text-xs text-foreground-muted mb-1 block">Adresse de livraison</label>
          <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={3} className={`${inputClass} resize-none`} placeholder="Adresse complète..." />
        </div>
        <button
          onClick={handleOrder}
          disabled={status === "loading" || quantity < 1 || !address.trim()}
          className="flex items-center gap-2 px-4 py-2.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-xl text-sm font-medium hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
        >
          {status === "loading" ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />}
          Commander {quantity} token{quantity > 1 ? "s" : ""}
        </button>
        {status === "success" && <p className="text-xs text-emerald-400">Commande envoyée avec succès</p>}
        {status === "error" && <p className="text-xs text-red-400">Erreur lors de la commande</p>}
      </div>
    </div>
  );
}

// ── Story 84: Notifications Section ────────────────────────────

function B2BNotificationsSection({ clientName }: { clientName: string }) {
  const { data: notifications, isLoading } = useQuery({
    queryKey: ["b2b-notifications", clientName],
    queryFn: async () => {
      // Fetch recent CDRs as notification-like events
      const { data } = await supabase
        .from("ocpi_cdrs")
        .select("id, start_date_time, location_name, total_energy, driver_name, status")
        .eq("customer_name", clientName)
        .order("start_date_time", { ascending: false })
        .limit(15);
      return data ?? [];
    },
  });

  return (
    <div className="bg-surface border border-border rounded-2xl p-6 space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <Bell className="w-5 h-5" style={{ color: "#F39C12" }} />
        <h3 className="text-base font-heading font-bold text-foreground">Notifications</h3>
      </div>
      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-10 bg-surface-elevated rounded-xl animate-pulse" />)}</div>
      ) : notifications && notifications.length > 0 ? (
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {notifications.map((n) => (
            <div key={n.id as string} className="flex items-center justify-between px-4 py-2.5 rounded-xl hover:bg-surface-elevated/50 transition-colors">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground truncate">
                  Charge terminée - {(n.driver_name as string) ?? "Conducteur"}
                </p>
                <p className="text-xs text-foreground-muted">
                  {(n.location_name as string) ?? "Station"} - {Number(n.total_energy).toFixed(1)} kWh
                </p>
              </div>
              <span className="text-xs text-foreground-muted shrink-0 ml-3">
                {new Date(n.start_date_time as string).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-foreground-muted">Aucune notification récente</p>
      )}
    </div>
  );
}

// ── Story 85: Reimbursements Section ────────────────────────────

function B2BReimbursementSection({ clientId }: { clientId: string }) {
  const { data: runs, isLoading } = useReimbursementRuns(clientId);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [cancelRun, setCancelRun] = useState<{ id: string; status: string } | null>(null);
  const deleteRunMutation = useDeleteReimbursementRun();
  const { success: toastSuccess, error: toastError } = useToast();

  const statusConfig: Record<string, { label: string; bg: string; text: string; border: string }> = {
    pending: { label: "En attente", bg: "bg-yellow-500/10", text: "text-yellow-400", border: "border-yellow-500/25" },
    calculated: { label: "Calculé", bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/25" },
    approved: { label: "Approuvé", bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/25" },
    paid: { label: "Payé", bg: "bg-green-500/10", text: "text-green-400", border: "border-green-500/25" },
    rejected: { label: "Rejeté", bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/25" },
    cancelled: { label: "Annulé", bg: "bg-foreground-muted/10", text: "text-foreground-muted", border: "border-border" },
  };

  function toggleExpand(runId: string) {
    setExpandedRunId((prev) => (prev === runId ? null : runId));
  }

  return (
    <div className="bg-surface border border-border rounded-2xl p-6 space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <Euro className="w-5 h-5" style={{ color: "#2ECC71" }} />
        <h3 className="text-base font-heading font-bold text-foreground">Remboursements employés</h3>
        {runs && runs.length > 0 && (
          <span className="text-xs text-foreground-muted bg-foreground-muted/10 rounded-full px-2.5 py-1">
            {runs.length} période{runs.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 bg-surface-elevated rounded-xl animate-pulse" />
          ))}
        </div>
      ) : runs && runs.length > 0 ? (
        <div className="space-y-2">
          {runs.map((run) => {
            const sc = statusConfig[run.status] ?? statusConfig.pending;
            const isExpanded = expandedRunId === run.id;
            return (
              <div key={run.id} className="border border-border/50 rounded-xl overflow-hidden">
                <button
                  onClick={() => toggleExpand(run.id)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-elevated/50 transition-colors text-left"
                >
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {new Date(run.period_start).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
                        {" — "}
                        {new Date(run.period_end).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
                      </p>
                      <p className="text-xs text-foreground-muted">
                        {run.total_drivers} conducteur{run.total_drivers !== 1 ? "s" : ""} · {run.total_kwh.toFixed(1)} kWh
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-sm font-semibold text-foreground">
                      {(run.total_amount_cents / 100).toFixed(2)} EUR
                    </span>
                    <span className={`inline-flex items-center rounded-lg border px-2 py-0.5 text-xs font-semibold ${sc.bg} ${sc.text} ${sc.border}`}>
                      {sc.label}
                    </span>
                    {(run.status === "pending" || run.status === "calculated") && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setCancelRun({ id: run.id, status: run.status });
                        }}
                        className="px-2 py-0.5 text-[10px] font-medium text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg hover:bg-red-500/20 transition-colors"
                      >
                        Annuler
                      </button>
                    )}
                    <ChevronDown className={`w-4 h-4 text-foreground-muted transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                  </div>
                </button>
                {isExpanded && <ReimbursementRunDetail runId={run.id} />}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-foreground-muted">Aucun remboursement pour cette période</p>
      )}

      {/* Cancel Confirm Dialog */}
      <ConfirmDialog
        open={!!cancelRun}
        title="Annuler ce remboursement ?"
        description={cancelRun?.status === "pending"
          ? "Ce remboursement en attente sera supprimé définitivement."
          : "Ce remboursement sera marqué comme annulé."
        }
        confirmLabel="Annuler le remboursement"
        loadingLabel="Annulation..."
        variant="danger"
        loading={deleteRunMutation.isPending}
        onConfirm={() => {
          if (cancelRun) {
            deleteRunMutation.mutate(
              { id: cancelRun.id, status: cancelRun.status },
              {
                onSuccess: () => {
                  toastSuccess("Remboursement annulé");
                  setCancelRun(null);
                },
                onError: (err: Error) => {
                  toastError("Erreur", err.message);
                  setCancelRun(null);
                },
              }
            );
          }
        }}
        onCancel={() => setCancelRun(null)}
      />
    </div>
  );
}

function ReimbursementRunDetail({ runId }: { runId: string }) {
  const { data: items, isLoading } = useReimbursementLineItems(runId);

  if (isLoading) {
    return (
      <div className="px-4 pb-4 space-y-2">
        {[1, 2].map((i) => (
          <div key={i} className="h-10 bg-surface-elevated rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <div className="px-4 pb-4">
        <p className="text-xs text-foreground-muted">Aucun détail disponible</p>
      </div>
    );
  }

  return (
    <div className="px-4 pb-4 border-t border-border/50">
      <div className="overflow-x-auto">
        <table className="w-full mt-2">
          <thead>
            <tr className="text-left">
              <th className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-muted">Conducteur</th>
              <th className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-muted text-right">Sessions</th>
              <th className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-muted text-right">kWh</th>
              <th className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-muted text-right">Montant</th>
              <th className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-muted">Type</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-t border-border/30">
                <td className="px-2 py-2 text-sm text-foreground">{item.driver_name ?? item.driver_email ?? "—"}</td>
                <td className="px-2 py-2 text-sm text-foreground text-right font-mono">{item.session_count}</td>
                <td className="px-2 py-2 text-sm text-foreground text-right font-mono">{item.total_kwh.toFixed(1)}</td>
                <td className="px-2 py-2 text-sm text-foreground text-right font-mono">
                  {(item.amount_cents / 100).toFixed(2)} EUR
                  {item.capped && (
                    <span className="ml-1 text-[10px] text-yellow-400 font-semibold">CAP</span>
                  )}
                </td>
                <td className="px-2 py-2">
                  <span className="text-xs text-foreground-muted bg-foreground-muted/10 rounded px-1.5 py-0.5">
                    {item.charging_type}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
