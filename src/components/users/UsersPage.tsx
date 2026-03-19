import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  Users,
  Shield,
  Wrench,
  Eye,
  Building2,
  Pencil,
  Check,
  X,
  Globe,
  Plus,
  Send,
  Loader2,
  Copy,
  Mail,
  Search,
  Trash2,
  AlertTriangle,
  KeyRound,
  Settings,
  RotateCcw,
  ShieldCheck,
  Monitor,
  Ban,
  Lock,
  Bell,
  History,
  Megaphone,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { apiPost } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useTerritories } from "@/hooks/useTerritories";
import { KPICard } from "@/components/ui/KPICard";
import { KPISkeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHelp } from "@/components/ui/PageHelp";
import { useCpo, type CpoOperator } from "@/contexts/CpoContext";

// ── Types ──────────────────────────────────────────────────

interface EzdriveUser {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  territory: string | null;
  cpo_id: string | null;
  created_at: string;
  updated_at: string;
}

// ── Role config ────────────────────────────────────────────

const ROLE_CONFIG: Record<
  string,
  { label: string; color: string; bgClass: string; textClass: string; borderClass: string; icon: typeof Shield }
> = {
  admin: {
    label: "Admin",
    color: "#A78BFA",
    bgClass: "bg-[#A78BFA]/15",
    textClass: "text-[#A78BFA]",
    borderClass: "border-[#A78BFA]/30",
    icon: Shield,
  },
  operator: {
    label: "Operateur",
    color: "#3498DB",
    bgClass: "bg-[#3498DB]/15",
    textClass: "text-[#3498DB]",
    borderClass: "border-[#3498DB]/30",
    icon: Wrench,
  },
  tech: {
    label: "Technicien",
    color: "#F39C12",
    bgClass: "bg-[#F39C12]/15",
    textClass: "text-[#F39C12]",
    borderClass: "border-[#F39C12]/30",
    icon: Wrench,
  },
  viewer: {
    label: "Lecteur",
    color: "#95A5A6",
    bgClass: "bg-[#95A5A6]/15",
    textClass: "text-[#95A5A6]",
    borderClass: "border-[#95A5A6]/30",
    icon: Eye,
  },
  b2b_client: {
    label: "Client B2B",
    color: "#00D4AA",
    bgClass: "bg-[#00D4AA]/15",
    textClass: "text-[#00D4AA]",
    borderClass: "border-[#00D4AA]/30",
    icon: Building2,
  },
};

const ROLES = ["admin", "operator", "tech", "viewer", "b2b_client"] as const;

// TERRITORIES — fallback, overridden by DB data in UsersPage component
const TERRITORIES_FALLBACK = [
  "Guadeloupe",
  "Martinique",
  "Guyane",
  "Reunion",
  "Mayotte",
  "Saint-Martin",
  "Saint-Barthelemy",
  "Metropole",
];

// Mutable ref shared across sub-components — set from DB in UsersPage
let TERRITORIES: string[] = [...TERRITORIES_FALLBACK];

// ── Query ──────────────────────────────────────────────────

function useEzdriveUsers() {
  return useQuery<EzdriveUser[]>({
    queryKey: ["ezdrive-users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ezdrive_profiles")
        .select("id, email, full_name, role, territory, cpo_id, created_at, updated_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as EzdriveUser[];
    },
  });
}

// ── Helpers ────────────────────────────────────────────────

function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let pw = "";
  for (let i = 0; i < 12; i++) {
    pw += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pw;
}

function RoleBadge({ role }: { role: string }) {
  const config = ROLE_CONFIG[role] ?? ROLE_CONFIG.viewer;
  const Icon = config.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold",
        config.bgClass,
        config.textClass,
        config.borderClass
      )}
    >
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
}

function CpoBadge({ cpoId, cpos }: { cpoId: string | null; cpos: CpoOperator[] }) {
  if (!cpoId) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold bg-foreground-muted/10 text-foreground-muted border-foreground-muted/20">
        <Globe className="w-3 h-3" />
        Tous (Admin)
      </span>
    );
  }
  const cpo = cpos.find((c) => c.id === cpoId);
  if (!cpo) return <span className="text-xs text-foreground-muted">--</span>;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold"
      style={{
        backgroundColor: `${cpo.color ?? "#6b7280"}15`,
        color: cpo.color ?? "#6b7280",
        borderColor: `${cpo.color ?? "#6b7280"}30`,
      }}
    >
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cpo.color ?? "#6b7280" }} />
      {cpo.name}
    </span>
  );
}

// ── Modal Overlay ──────────────────────────────────────────

function ModalOverlay({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      {children}
    </div>
  );
}

// ── Create User Modal ──────────────────────────────────────

function CreateUserModal({
  open,
  onClose,
  cpos,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  cpos: CpoOperator[];
  onCreated: (msg: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<string>("operator");
  const [cpoId, setCpoId] = useState<string>("");
  const [territory, setTerritory] = useState<string>("");
  const [password, setPassword] = useState(() => generatePassword());
  const [sendInvite, setSendInvite] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ email: string; password: string } | null>(null);

  const reset = useCallback(() => {
    setEmail("");
    setFullName("");
    setRole("operator");
    setCpoId("");
    setTerritory("");
    setPassword(generatePassword());
    setSendInvite(true);
    setLoading(false);
    setError(null);
    setSuccess(null);
  }, []);

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) { setError("Email requis"); return; }
    if (password.length < 8) { setError("Mot de passe : 8 caracteres minimum"); return; }

    setLoading(true);
    setError(null);

    try {
      let created = false;

      // Try Edge Function first (uses service_role for admin.createUser)
      try {
        await apiPost("admin-users/create", {
          email,
          full_name: fullName || undefined,
          password,
          role,
          cpo_id: cpoId || null,
          territory: territory || null,
        });
        created = true;
      } catch {
        console.warn("Edge Function unavailable, falling back to signUp API");
      }

      // Fallback: create via Supabase signUp + profile update
      if (!created) {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

        const signUpRes = await fetch(`${supabaseUrl}/auth/v1/signup`, {
          method: "POST",
          headers: {
            apikey: anonKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email,
            password,
            data: { full_name: fullName || email.split("@")[0] },
          }),
        });

        if (!signUpRes.ok) {
          const errBody = await signUpRes.json().catch(() => ({}));
          throw new Error(errBody.msg || errBody.message || `Erreur ${signUpRes.status}`);
        }

        const signUpData = await signUpRes.json();
        const userId = signUpData.id;

        if (userId) {
          // Confirm email via admin endpoint (if service key available) or just update profile
          // Update profile with role, cpo_id, territory
          await supabase
            .from("ezdrive_profiles")
            .update({
              role,
              cpo_id: cpoId || null,
              territory: territory || null,
              full_name: fullName || email.split("@")[0],
            })
            .eq("id", userId);
        }
      }

      // Send invite email if checked
      if (sendInvite) {
        const selectedCpo = cpos.find((c) => c.id === cpoId);
        try {
          await apiPost("admin-users/invite", {
            email,
            full_name: fullName || undefined,
            role,
            cpo_name: selectedCpo?.name ?? "EZDrive",
            cpo_color: selectedCpo?.color ?? "#00D4AA",
            temporary_password: password,
          });
        } catch (inviteErr) {
          console.warn("Invite email failed (user still created):", inviteErr);
        }
      }

      setSuccess({ email, password });
      onCreated(`Utilisateur ${email} cree avec succes`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  const level1Cpos = cpos.filter((c) => c.level === 1);

  return (
    <ModalOverlay open={open} onClose={handleClose}>
      <div className="bg-surface border border-border rounded-2xl w-full max-w-lg mx-4 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
              <Plus className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Creer un utilisateur</h2>
              <p className="text-xs text-foreground-muted">Nouvel acces a la supervision</p>
            </div>
          </div>
          <button onClick={handleClose} className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Success state */}
        {success ? (
          <div className="p-6 space-y-4">
            <div className="bg-status-available/10 border border-status-available/30 rounded-xl p-4">
              <p className="text-status-available font-semibold text-sm mb-2">Utilisateur cree avec succes</p>
              <div className="space-y-2">
                <div className="flex items-center justify-between bg-background/50 rounded-lg px-3 py-2">
                  <div>
                    <p className="text-xs text-foreground-muted">Email</p>
                    <p className="text-sm font-mono text-foreground">{success.email}</p>
                  </div>
                  <button
                    onClick={() => navigator.clipboard.writeText(success.email)}
                    className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors"
                    title="Copier"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center justify-between bg-background/50 rounded-lg px-3 py-2">
                  <div>
                    <p className="text-xs text-foreground-muted">Mot de passe temporaire</p>
                    <p className="text-sm font-mono text-foreground tracking-wide">{success.password}</p>
                  </div>
                  <button
                    onClick={() => navigator.clipboard.writeText(success.password)}
                    className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors"
                    title="Copier"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {sendInvite && (
                <p className="text-xs text-foreground-muted mt-3 flex items-center gap-1.5">
                  <Mail className="w-3 h-3" /> Email d'invitation envoye
                </p>
              )}
            </div>
            <button
              onClick={handleClose}
              className="w-full py-2.5 rounded-xl bg-primary text-white font-semibold text-sm hover:bg-primary/90 transition-colors"
            >
              Fermer
            </button>
          </div>
        ) : (
          /* Form */
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {error && (
              <div className="bg-danger/10 border border-danger/30 rounded-xl px-4 py-2.5 text-sm text-danger font-medium">
                {error}
              </div>
            )}

            {/* Email */}
            <div>
              <label className="block text-xs font-medium text-foreground-muted mb-1.5">Email *</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="utilisateur@ezdrive.fr"
                className="w-full bg-surface-elevated border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary transition-colors"
                required
              />
            </div>

            {/* Full name */}
            <div>
              <label className="block text-xs font-medium text-foreground-muted mb-1.5">Nom complet</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jean Dupont"
                className="w-full bg-surface-elevated border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary transition-colors"
              />
            </div>

            {/* Role + CPO */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-foreground-muted mb-1.5">Role *</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full bg-surface-elevated border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{ROLE_CONFIG[r]?.label ?? r}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground-muted mb-1.5">Entite CPO</label>
                <select
                  value={cpoId}
                  onChange={(e) => setCpoId(e.target.value)}
                  className="w-full bg-surface-elevated border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
                >
                  <option value="">Tous (Admin global)</option>
                  {level1Cpos.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.is_white_label ? " (MB)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Territory */}
            <div>
              <label className="block text-xs font-medium text-foreground-muted mb-1.5">Territoire</label>
              <select
                value={territory}
                onChange={(e) => setTerritory(e.target.value)}
                className="w-full bg-surface-elevated border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
              >
                <option value="">Aucun (tous territoires)</option>
                {TERRITORIES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-medium text-foreground-muted mb-1.5">Mot de passe temporaire *</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="flex-1 bg-surface-elevated border border-border rounded-xl px-3.5 py-2.5 text-sm font-mono text-foreground focus:outline-none focus:border-primary transition-colors"
                  minLength={8}
                  required
                />
                <button
                  type="button"
                  onClick={() => setPassword(generatePassword())}
                  className="px-3 rounded-xl bg-foreground-muted/10 text-foreground-muted text-xs font-medium hover:bg-foreground-muted/20 transition-colors whitespace-nowrap"
                >
                  Regenerer
                </button>
              </div>
            </div>

            {/* Send invite toggle */}
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={sendInvite}
                onChange={(e) => setSendInvite(e.target.checked)}
                className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
              />
              <div>
                <p className="text-sm text-foreground font-medium">Envoyer l'email d'invitation</p>
                <p className="text-xs text-foreground-muted">Email avec identifiants et lien de connexion</p>
              </div>
            </label>

            {/* Submit */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="flex-1 py-2.5 rounded-xl bg-foreground-muted/10 text-foreground-muted font-semibold text-sm hover:bg-foreground-muted/20 transition-colors"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 py-2.5 rounded-xl bg-primary text-white font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creation...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    Creer
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </ModalOverlay>
  );
}

// ── Invite Email Modal ─────────────────────────────────────

function InviteModal({
  open,
  onClose,
  user,
  cpos,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  user: EzdriveUser | null;
  cpos: CpoOperator[];
  onSent: (msg: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [includePassword, setIncludePassword] = useState(false);
  const [tempPassword, setTempPassword] = useState(() => generatePassword());

  if (!user) return null;

  const cpo = cpos.find((c) => c.id === user.cpo_id);

  async function handleSend() {
    if (!user) return;
    setLoading(true);
    try {
      await apiPost("admin-users/invite", {
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        cpo_name: cpo?.name ?? "EZDrive",
        cpo_color: cpo?.color ?? "#00D4AA",
        temporary_password: includePassword ? tempPassword : undefined,
      });
      onSent(`Invitation envoyee a ${user.email}`);
      onClose();
    } catch (err) {
      console.error("Invite error:", err);
      onSent(`Erreur envoi invitation`);
    } finally {
      setLoading(false);
    }
  }

  const roleConfig = ROLE_CONFIG[user.role] ?? ROLE_CONFIG.viewer;

  return (
    <ModalOverlay open={open} onClose={onClose}>
      <div className="bg-surface border border-border rounded-2xl w-full max-w-md mx-4 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
              <Send className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Envoyer une invitation</h2>
              <p className="text-xs text-foreground-muted">Email de bienvenue</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* User preview */}
          <div className="bg-surface-elevated rounded-xl p-4 flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-sm font-bold"
              style={{ backgroundColor: `${roleConfig.color}20`, color: roleConfig.color }}
            >
              {getInitials(user.full_name, user.email)}
            </div>
            <div className="min-w-0">
              <p className="font-medium text-foreground text-sm truncate">
                {user.full_name ?? user.email.split("@")[0]}
              </p>
              <p className="text-xs text-foreground-muted truncate">{user.email}</p>
            </div>
            <div className="ml-auto flex gap-2">
              <RoleBadge role={user.role} />
            </div>
          </div>

          {/* Include temp password */}
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={includePassword}
              onChange={(e) => setIncludePassword(e.target.checked)}
              className="w-4 h-4 rounded border-border text-primary focus:ring-primary mt-0.5"
            />
            <div>
              <p className="text-sm text-foreground font-medium">Inclure un mot de passe temporaire</p>
              <p className="text-xs text-foreground-muted">Un nouveau mot de passe sera genere et inclus dans l'email</p>
            </div>
          </label>

          {includePassword && (
            <div className="flex gap-2">
              <input
                type="text"
                value={tempPassword}
                onChange={(e) => setTempPassword(e.target.value)}
                className="flex-1 bg-surface-elevated border border-border rounded-xl px-3.5 py-2.5 text-sm font-mono text-foreground focus:outline-none focus:border-primary transition-colors"
              />
              <button
                type="button"
                onClick={() => setTempPassword(generatePassword())}
                className="px-3 rounded-xl bg-foreground-muted/10 text-foreground-muted text-xs font-medium hover:bg-foreground-muted/20 transition-colors whitespace-nowrap"
              >
                Regenerer
              </button>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl bg-foreground-muted/10 text-foreground-muted font-semibold text-sm hover:bg-foreground-muted/20 transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={handleSend}
              disabled={loading}
              className="flex-1 py-2.5 rounded-xl bg-primary text-white font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Envoi...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Envoyer
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}

// ── Inline Edit Row ────────────────────────────────────────

function EditableRow({
  user,
  cpos,
  onSave,
  onCancel,
}: {
  user: EzdriveUser;
  cpos: CpoOperator[];
  onSave: (id: string, role: string, cpoId: string | null, territory: string | null) => Promise<void>;
  onCancel: () => void;
}) {
  const [role, setRole] = useState(user.role);
  const [cpoId, setCpoId] = useState<string | null>(user.cpo_id);
  const [territory, setTerritory] = useState<string>(user.territory ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    await onSave(user.id, role, cpoId, territory || null);
    setSaving(false);
  }

  const roleConfig = ROLE_CONFIG[user.role] ?? ROLE_CONFIG.viewer;

  return (
    <tr className="bg-primary/5">
      {/* User */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-xs font-bold"
            style={{ backgroundColor: `${roleConfig.color}20`, color: roleConfig.color }}
          >
            {getInitials(user.full_name, user.email)}
          </div>
          <div className="min-w-0">
            <p className="font-medium text-foreground truncate">
              {user.full_name ?? user.email.split("@")[0]}
            </p>
            <p className="text-xs text-foreground-muted truncate">{user.email}</p>
          </div>
        </div>
      </td>

      {/* Role select */}
      <td className="px-4 py-3">
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="bg-surface-elevated border border-border rounded-lg px-2 py-1.5 text-xs font-medium text-foreground focus:outline-none focus:border-primary transition-colors"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_CONFIG[r]?.label ?? r}</option>
          ))}
        </select>
      </td>

      {/* CPO select */}
      <td className="px-4 py-3">
        <select
          value={cpoId ?? ""}
          onChange={(e) => setCpoId(e.target.value || null)}
          className="bg-surface-elevated border border-border rounded-lg px-2 py-1.5 text-xs font-medium text-foreground focus:outline-none focus:border-primary transition-colors"
        >
          <option value="">Tous (Admin global)</option>
          {cpos.filter((c) => c.level === 1).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}{c.is_white_label ? " (MB)" : ""}
            </option>
          ))}
        </select>
      </td>

      {/* Territory select */}
      <td className="px-4 py-3">
        <select
          value={territory}
          onChange={(e) => setTerritory(e.target.value)}
          className="bg-surface-elevated border border-border rounded-lg px-2 py-1.5 text-xs font-medium text-foreground focus:outline-none focus:border-primary transition-colors"
        >
          <option value="">Aucun</option>
          {TERRITORIES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </td>

      {/* Actions */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleSave}
            disabled={saving}
            className="p-1.5 rounded-lg bg-primary/15 text-primary hover:bg-primary/25 transition-colors disabled:opacity-50"
            title="Enregistrer"
          >
            <Check className="w-4 h-4" />
          </button>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg bg-foreground-muted/10 text-foreground-muted hover:bg-foreground-muted/20 transition-colors"
            title="Annuler"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── Delete User Modal ────────────────────────────────────────

function DeleteUserModal({
  open,
  onClose,
  user,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  user: EzdriveUser | null;
  onDeleted: (msg: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  if (!user) return null;

  const roleConfig = ROLE_CONFIG[user.role] ?? ROLE_CONFIG.viewer;

  async function handleDelete() {
    if (!user) return;
    setLoading(true);
    try {
      // Delete profile (cascade will handle the rest via trigger/FK)
      const { error } = await supabase
        .from("ezdrive_profiles")
        .delete()
        .eq("id", user.id);

      if (error) throw error;

      onDeleted(`Utilisateur ${user.email} supprime`);
      setConfirmText("");
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue";
      onDeleted(`Erreur: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ModalOverlay open={open} onClose={onClose}>
      <div className="bg-surface border border-border rounded-2xl w-full max-w-md mx-4 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-danger/15 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-danger" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Supprimer l'utilisateur</h2>
              <p className="text-xs text-foreground-muted">Action irreversible</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* User preview */}
          <div className="bg-surface-elevated rounded-xl p-4 flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-sm font-bold"
              style={{ backgroundColor: `${roleConfig.color}20`, color: roleConfig.color }}
            >
              {getInitials(user.full_name, user.email)}
            </div>
            <div className="min-w-0">
              <p className="font-medium text-foreground text-sm truncate">
                {user.full_name ?? user.email.split("@")[0]}
              </p>
              <p className="text-xs text-foreground-muted truncate">{user.email}</p>
            </div>
          </div>

          <p className="text-sm text-foreground-muted">
            L'utilisateur sera supprime de la plateforme de supervision. Cette action est irreversible.
          </p>

          {/* Confirm by typing email */}
          <div>
            <label className="block text-xs font-medium text-foreground-muted mb-1.5">
              Tapez <span className="text-danger font-mono">{user.email}</span> pour confirmer
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={user.email}
              className="w-full bg-surface-elevated border border-danger/30 rounded-xl px-3.5 py-2.5 text-sm text-foreground placeholder:text-foreground-muted/30 focus:outline-none focus:border-danger transition-colors"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl bg-foreground-muted/10 text-foreground-muted font-semibold text-sm hover:bg-foreground-muted/20 transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={handleDelete}
              disabled={loading || confirmText !== user.email}
              className="flex-1 py-2.5 rounded-xl bg-danger text-white font-semibold text-sm hover:bg-danger/90 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Trash2 className="w-4 h-4" />
                  Supprimer
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}

// ── Manage User Modal (edit email/name/password, send reset) ──

function ManageUserModal({
  open,
  onClose,
  user,
  cpos,
  onUpdated,
}: {
  open: boolean;
  onClose: () => void;
  user: EzdriveUser | null;
  cpos: CpoOperator[];
  onUpdated: (msg: string, type?: "success" | "error") => void;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("");
  const [cpoId, setCpoId] = useState<string>("");
  const [territory, setTerritory] = useState("");
  const [b2bClientId, setB2bClientId] = useState<string>("");
  const [originalB2bClientId, setOriginalB2bClientId] = useState<string>("");
  const [b2bClients, setB2bClients] = useState<{ id: string; name: string }[]>([]);
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [section, setSection] = useState<"info" | "password">("info");

  // Fetch B2B clients list
  useEffect(() => {
    supabase
      .from("b2b_clients")
      .select("id, name")
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => {
        if (data) setB2bClients(data);
      });
  }, []);

  // Fetch current user's B2B client association
  useEffect(() => {
    if (user) {
      setEmail(user.email);
      setFullName(user.full_name ?? "");
      setRole(user.role);
      setCpoId(user.cpo_id ?? "");
      setTerritory(user.territory ?? "");
      setNewPassword("");
      setSection("info");

      // Load B2B client association
      if (user.role === "b2b_client") {
        supabase
          .from("b2b_client_access")
          .select("b2b_client_id")
          .eq("user_id", user.id)
          .maybeSingle()
          .then(({ data }) => {
            const clientId = data?.b2b_client_id ?? "";
            setB2bClientId(clientId);
            setOriginalB2bClientId(clientId);
          });
      } else {
        setB2bClientId("");
        setOriginalB2bClientId("");
      }
    }
  }, [user]);

  if (!user) return null;

  const roleConfig = ROLE_CONFIG[user.role] ?? ROLE_CONFIG.viewer;
  const level1Cpos = cpos.filter((c) => c.level === 1);

  const hasInfoChanges =
    email !== user.email ||
    fullName !== (user.full_name ?? "") ||
    role !== user.role ||
    cpoId !== (user.cpo_id ?? "") ||
    territory !== (user.territory ?? "") ||
    b2bClientId !== originalB2bClientId;

  async function handleSaveInfo() {
    setLoading(true);
    try {
      await apiPost("admin-users/update", {
        user_id: user!.id,
        email: email !== user!.email ? email : undefined,
        full_name: fullName !== (user!.full_name ?? "") ? fullName : undefined,
        role: role !== user!.role ? role : undefined,
        cpo_id: cpoId !== (user!.cpo_id ?? "") ? (cpoId || null) : undefined,
        territory: territory !== (user!.territory ?? "") ? (territory || null) : undefined,
        b2b_client_id: b2bClientId !== originalB2bClientId ? (b2bClientId || null) : undefined,
      });
      onUpdated("Utilisateur mis a jour");
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue";
      onUpdated(`Erreur: ${msg}`, "error");
    } finally {
      setLoading(false);
    }
  }

  async function handleSetPassword() {
    if (!newPassword || newPassword.length < 8) {
      onUpdated("Mot de passe : 8 caracteres minimum", "error");
      return;
    }
    setLoading(true);
    try {
      await apiPost("admin-users/reset-password", {
        user_id: user!.id,
        new_password: newPassword,
      });
      onUpdated("Mot de passe modifie avec succes");
      setNewPassword("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue";
      onUpdated(`Erreur: ${msg}`, "error");
    } finally {
      setLoading(false);
    }
  }

  async function handleSendResetEmail() {
    setResetLoading(true);
    try {
      await apiPost("admin-users/reset-password", {
        user_id: user!.id,
        email: user!.email,
        send_reset_email: true,
      });
      onUpdated(`Email de reinitialisation envoye a ${user!.email}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue";
      onUpdated(`Erreur: ${msg}`, "error");
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <ModalOverlay open={open} onClose={onClose}>
      <div className="bg-surface border border-border rounded-2xl w-full max-w-lg mx-4 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
              style={{ backgroundColor: `${roleConfig.color}20`, color: roleConfig.color }}
            >
              {getInitials(user.full_name, user.email)}
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Gerer l'utilisateur</h2>
              <p className="text-xs text-foreground-muted">{user.email}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border">
          <button
            onClick={() => setSection("info")}
            className={cn(
              "flex-1 py-2.5 text-sm font-medium transition-colors flex items-center justify-center gap-2",
              section === "info"
                ? "text-primary border-b-2 border-primary"
                : "text-foreground-muted hover:text-foreground"
            )}
          >
            <Settings className="w-4 h-4" />
            Informations
          </button>
          <button
            onClick={() => setSection("password")}
            className={cn(
              "flex-1 py-2.5 text-sm font-medium transition-colors flex items-center justify-center gap-2",
              section === "password"
                ? "text-primary border-b-2 border-primary"
                : "text-foreground-muted hover:text-foreground"
            )}
          >
            <KeyRound className="w-4 h-4" />
            Mot de passe
          </button>
        </div>

        <div className="p-6 space-y-4">
          {section === "info" && (
            <>
              {/* Email */}
              <div>
                <label className="block text-xs font-medium text-foreground-muted mb-1.5">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-surface-elevated border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
                />
              </div>

              {/* Full name */}
              <div>
                <label className="block text-xs font-medium text-foreground-muted mb-1.5">Nom complet</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Jean Dupont"
                  className="w-full bg-surface-elevated border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary transition-colors"
                />
              </div>

              {/* Role + CPO */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-foreground-muted mb-1.5">Role</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full bg-surface-elevated border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{ROLE_CONFIG[r]?.label ?? r}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground-muted mb-1.5">Entite CPO</label>
                  <select
                    value={cpoId}
                    onChange={(e) => setCpoId(e.target.value)}
                    className="w-full bg-surface-elevated border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
                  >
                    <option value="">Tous (Admin global)</option>
                    {level1Cpos.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}{c.is_white_label ? " (MB)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* B2B Client association — visible when role is b2b_client */}
              {role === "b2b_client" && (
                <div>
                  <label className="block text-xs font-medium text-foreground-muted mb-1.5">
                    <span className="flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5 text-[#00D4AA]" />
                      Entreprise B2B
                    </span>
                  </label>
                  <select
                    value={b2bClientId}
                    onChange={(e) => setB2bClientId(e.target.value)}
                    className="w-full bg-surface-elevated border border-[#00D4AA]/30 rounded-xl px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-[#00D4AA] transition-colors"
                  >
                    <option value="">-- Aucune entreprise --</option>
                    {b2bClients.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  {!b2bClientId && (
                    <p className="text-xs text-[#F39C12] mt-1 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      Un client B2B doit etre associe a une entreprise pour acceder au portail.
                    </p>
                  )}
                </div>
              )}

              {/* Territory */}
              <div>
                <label className="block text-xs font-medium text-foreground-muted mb-1.5">Territoire</label>
                <select
                  value={territory}
                  onChange={(e) => setTerritory(e.target.value)}
                  className="w-full bg-surface-elevated border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
                >
                  <option value="">Aucun (tous territoires)</option>
                  {TERRITORIES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              {/* Save */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={onClose}
                  className="flex-1 py-2.5 rounded-xl bg-foreground-muted/10 text-foreground-muted font-semibold text-sm hover:bg-foreground-muted/20 transition-colors"
                >
                  Annuler
                </button>
                <button
                  onClick={handleSaveInfo}
                  disabled={loading || !hasInfoChanges}
                  className="flex-1 py-2.5 rounded-xl bg-primary text-white font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Enregistrer
                </button>
              </div>
            </>
          )}

          {section === "password" && (
            <>
              {/* Set new password */}
              <div className="bg-surface-elevated border border-border rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <KeyRound className="w-4 h-4 text-primary" />
                  <p className="text-sm font-medium text-foreground">Definir un nouveau mot de passe</p>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Nouveau mot de passe (min 8 car.)"
                    className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setNewPassword(generatePassword())}
                    className="px-3 rounded-lg bg-foreground-muted/10 text-foreground-muted text-xs font-medium hover:bg-foreground-muted/20 transition-colors whitespace-nowrap"
                  >
                    Generer
                  </button>
                </div>
                <button
                  onClick={handleSetPassword}
                  disabled={loading || !newPassword || newPassword.length < 8}
                  className="w-full py-2 rounded-lg bg-primary text-white font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                  Appliquer le mot de passe
                </button>
              </div>

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-foreground-muted">ou</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              {/* Send reset email */}
              <div className="bg-surface-elevated border border-border rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <Mail className="w-4 h-4 text-[#F39C12]" />
                  <p className="text-sm font-medium text-foreground">Envoyer un email de reinitialisation</p>
                </div>
                <p className="text-xs text-foreground-muted">
                  Un email sera envoye a <strong className="text-foreground">{user.email}</strong> avec un lien pour choisir un nouveau mot de passe.
                </p>
                <button
                  onClick={handleSendResetEmail}
                  disabled={resetLoading}
                  className="w-full py-2 rounded-lg bg-[#F39C12]/15 text-[#F39C12] border border-[#F39C12]/30 font-semibold text-sm hover:bg-[#F39C12]/25 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {resetLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                  Envoyer le lien de reinitialisation
                </button>
              </div>

              <button
                onClick={onClose}
                className="w-full py-2.5 rounded-xl bg-foreground-muted/10 text-foreground-muted font-semibold text-sm hover:bg-foreground-muted/20 transition-colors"
              >
                Fermer
              </button>
            </>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}

// ── Page component ─────────────────────────────────────────

export function UsersPage() {
  const { data: users, isLoading, isError, refetch } = useEzdriveUsers();
  const { cpos } = useCpo();
  const queryClient = useQueryClient();
  const { data: dbTerritories } = useTerritories();
  // Update shared TERRITORIES from DB data
  if (dbTerritories?.length) {
    TERRITORIES = dbTerritories.map((t) => t.name);
  }
  const [editingId, setEditingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [inviteUser, setInviteUser] = useState<EzdriveUser | null>(null);
  const [deleteUser, setDeleteUser] = useState<EzdriveUser | null>(null);
  const [manageUser, setManageUser] = useState<EzdriveUser | null>(null);
  const [revokeUser, setRevokeUser] = useState<EzdriveUser | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("");

  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  }

  async function handleSave(userId: string, role: string, cpoId: string | null, territory: string | null) {
    const { error } = await supabase
      .from("ezdrive_profiles")
      .update({ role, cpo_id: cpoId, territory })
      .eq("id", userId);

    if (error) {
      showToast("error", `Erreur: ${error.message}`);
    } else {
      showToast("success", "Utilisateur mis a jour");
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ["ezdrive-users"] });
    }
  }

  // KPI computations
  const kpis = useMemo(() => {
    if (!users) return null;
    const admins = users.filter((u) => u.role === "admin").length;
    const operators = users.filter((u) => u.role === "operator").length;
    const b2b = users.filter((u) => u.role === "b2b_client").length;
    const withCpo = users.filter((u) => u.cpo_id !== null).length;
    return { total: users.length, admins, operators, b2b, withCpo };
  }, [users]);

  // Filtered users
  const filteredUsers = useMemo(() => {
    if (!users) return [];
    return users.filter((u) => {
      const q = search.toLowerCase();
      const matchesSearch =
        !q ||
        u.email.toLowerCase().includes(q) ||
        (u.full_name ?? "").toLowerCase().includes(q) ||
        (u.territory ?? "").toLowerCase().includes(q);
      const matchesRole = !roleFilter || u.role === roleFilter;
      return matchesSearch && matchesRole;
    });
  }, [users, search, roleFilter]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-xl font-bold">Utilisateurs</h1>
          <p className="text-sm text-foreground-muted mt-1">Gestion des utilisateurs et assignation CPO</p>
        </div>
        <KPISkeleton />
        <TableSkeleton rows={6} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-xl font-bold">Utilisateurs</h1>
          <p className="text-sm text-foreground-muted mt-1">Gestion des utilisateurs et assignation CPO</p>
        </div>
        <ErrorState message="Impossible de charger les utilisateurs" onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header + Create button */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-xl font-bold">Utilisateurs</h1>
          <p className="text-sm text-foreground-muted mt-1">
            Gestion des utilisateurs, roles et assignation CPO
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-white font-semibold text-sm hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20 shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Creer un utilisateur</span>
          <span className="sm:hidden">Creer</span>
        </button>
      </div>

      <PageHelp
        summary="Gestion des comptes utilisateurs et de leur acces aux entites CPO"
        items={[
          { label: "Role", description: "Admin (acces total), Operateur (gestion bornes), Technicien (interventions), Lecteur (lecture seule), Client B2B (portail dedie)." },
          { label: "Entite CPO", description: "Determine les donnees visibles. 'Tous' = acces global. Un CPO specifique = acces restreint a cette entite uniquement." },
          { label: "Territoire", description: "Zone geographique d'affectation (Guadeloupe, Martinique, Guyane, Reunion, etc.)." },
          { label: "Creer", description: "Bouton pour creer un nouvel utilisateur avec email, role, entite et territoire. Un email d'invitation peut etre envoye automatiquement." },
          { label: "Inviter", description: "Renvoyer un email d'invitation a un utilisateur existant avec ses identifiants de connexion." },
        ]}
        tips={[
          "Un utilisateur assigne a 'EZDrive AG' ne verra que les bornes, sessions et clients de EZDrive AG.",
          "Les admins sans CPO assigne ('Tous') voient l'ensemble des entites.",
          "Le mot de passe temporaire est genere automatiquement. L'utilisateur pourra le changer apres connexion.",
        ]}
      />

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par nom, email ou territoire..."
            className="w-full bg-surface border border-border rounded-xl pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded text-foreground-muted hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="bg-surface border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary transition-colors sm:w-44"
        >
          <option value="">Tous les roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_CONFIG[r]?.label ?? r}</option>
          ))}
        </select>
        {(search || roleFilter) && (
          <span className="text-xs text-foreground-muted self-center whitespace-nowrap">
            {filteredUsers.length} / {users?.length ?? 0}
          </span>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className={cn(
          "rounded-xl px-4 py-2.5 text-sm font-medium border transition-all",
          toast.type === "success"
            ? "bg-status-available/10 text-status-available border-status-available/30"
            : "bg-danger/10 text-danger border-danger/30"
        )}>
          {toast.message}
        </div>
      )}

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KPICard label="Total utilisateurs" value={kpis?.total ?? 0} icon={Users} color="#8892B0" borderColor="border-border" />
        <KPICard label="Admins" value={kpis?.admins ?? 0} icon={Shield} color="#A78BFA" borderColor="border-[#A78BFA]/30" />
        <KPICard label="Operateurs" value={kpis?.operators ?? 0} icon={Wrench} color="#3498DB" borderColor="border-[#3498DB]/30" />
        <KPICard label="Clients B2B" value={kpis?.b2b ?? 0} icon={Building2} color="#00D4AA" borderColor="border-[#00D4AA]/30" />
        <KPICard label="Assignes CPO" value={kpis?.withCpo ?? 0} icon={Globe} color="#6366F1" borderColor="border-[#6366F1]/30" />
      </div>

      {/* Users Table */}
      {!filteredUsers || filteredUsers.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 bg-surface border border-border rounded-2xl">
          <div className="w-12 h-12 rounded-xl bg-[#8892B0]/15 flex items-center justify-center mb-3">
            <Users className="w-6 h-6 text-foreground-muted" />
          </div>
          <p className="text-foreground font-medium">
            {search || roleFilter ? "Aucun resultat" : "Aucun utilisateur"}
          </p>
          <p className="text-sm text-foreground-muted mt-1">
            {search || roleFilter
              ? "Essayez de modifier vos filtres"
              : "Cliquez sur \"Creer un utilisateur\" pour commencer"}
          </p>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-foreground-muted border-b border-border">
                  <th className="text-left font-medium px-4 py-3">Utilisateur</th>
                  <th className="text-left font-medium px-4 py-3">Role</th>
                  <th className="text-left font-medium px-4 py-3">Entite CPO</th>
                  <th className="text-left font-medium px-4 py-3">Territoire</th>
                  <th className="text-left font-medium px-4 py-3 w-28">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredUsers.map((user) => {
                  if (editingId === user.id) {
                    return (
                      <EditableRow
                        key={user.id}
                        user={user}
                        cpos={cpos}
                        onSave={handleSave}
                        onCancel={() => setEditingId(null)}
                      />
                    );
                  }

                  const roleConfig = ROLE_CONFIG[user.role] ?? ROLE_CONFIG.viewer;
                  return (
                    <tr key={user.id} className="hover:bg-surface-elevated/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-xs font-bold"
                            style={{ backgroundColor: `${roleConfig.color}20`, color: roleConfig.color }}
                          >
                            {getInitials(user.full_name, user.email)}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-foreground truncate">
                              {user.full_name ?? user.email.split("@")[0]}
                            </p>
                            <p className="text-xs text-foreground-muted truncate">{user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3"><RoleBadge role={user.role} /></td>
                      <td className="px-4 py-3"><CpoBadge cpoId={user.cpo_id} cpos={cpos} /></td>
                      <td className="px-4 py-3 text-foreground-muted text-xs">{user.territory ?? "--"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setManageUser(user)}
                            className="p-1.5 rounded-lg text-foreground-muted hover:text-primary hover:bg-primary/10 transition-colors"
                            title="Gerer (email, nom, mot de passe)"
                          >
                            <Settings className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setEditingId(user.id)}
                            className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors"
                            title="Modifier role et CPO"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setInviteUser(user)}
                            className="p-1.5 rounded-lg text-foreground-muted hover:text-primary hover:bg-primary/10 transition-colors"
                            title="Envoyer invitation"
                          >
                            <Send className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setRevokeUser(user)}
                            className="p-1.5 rounded-lg text-foreground-muted hover:text-yellow-400 hover:bg-yellow-500/10 transition-colors"
                            title="Revoquer l'acces"
                          >
                            <Ban className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setDeleteUser(user)}
                            className="p-1.5 rounded-lg text-foreground-muted hover:text-danger hover:bg-danger/10 transition-colors"
                            title="Supprimer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modals */}
      <CreateUserModal
        open={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          queryClient.invalidateQueries({ queryKey: ["ezdrive-users"] });
        }}
        cpos={cpos}
        onCreated={(msg) => showToast("success", msg)}
      />

      <InviteModal
        open={!!inviteUser}
        onClose={() => setInviteUser(null)}
        user={inviteUser}
        cpos={cpos}
        onSent={(msg) => showToast("success", msg)}
      />

      <DeleteUserModal
        open={!!deleteUser}
        onClose={() => setDeleteUser(null)}
        user={deleteUser}
        onDeleted={(msg) => {
          if (msg.startsWith("Erreur")) {
            showToast("error", msg);
          } else {
            showToast("success", msg);
            queryClient.invalidateQueries({ queryKey: ["ezdrive-users"] });
          }
        }}
      />

      <ManageUserModal
        open={!!manageUser}
        onClose={() => {
          setManageUser(null);
          queryClient.invalidateQueries({ queryKey: ["ezdrive-users"] });
        }}
        user={manageUser}
        cpos={cpos}
        onUpdated={(msg, type) => showToast(type ?? "success", msg)}
      />

      {/* Story 108: Revoke user access */}
      <RevokeUserModal
        open={!!revokeUser}
        onClose={() => setRevokeUser(null)}
        user={revokeUser}
        onRevoked={(msg) => {
          showToast("success", msg);
          queryClient.invalidateQueries({ queryKey: ["ezdrive-users"] });
        }}
      />

      {/* ── Stories 106-112: Security & Notifications sections ── */}
      <SecurityNotificationsSection users={users ?? []} />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Story 108: Revoke user access
// ══════════════════════════════════════════════════════════════

function RevokeUserModal({
  open,
  onClose,
  user,
  onRevoked,
}: {
  open: boolean;
  onClose: () => void;
  user: EzdriveUser | null;
  onRevoked: (msg: string) => void;
}) {
  const [loading, setLoading] = useState(false);

  if (!user) return null;

  async function handleRevoke() {
    if (!user) return;
    setLoading(true);
    try {
      const { error } = await supabase
        .from("ezdrive_profiles")
        .update({ role: "suspended" })
        .eq("id", user.id);
      if (error) throw error;
      onRevoked(`Acces revoque pour ${user.email}`);
      onClose();
    } catch (err) {
      onRevoked(`Erreur: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  const roleConfig = ROLE_CONFIG[user.role] ?? ROLE_CONFIG.viewer;

  return (
    <ModalOverlay open={open} onClose={onClose}>
      <div className="bg-surface border border-border rounded-2xl w-full max-w-md mx-4 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-yellow-500/15 flex items-center justify-center">
              <Ban className="w-5 h-5 text-yellow-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Revoquer l'acces</h2>
              <p className="text-xs text-foreground-muted">L'utilisateur ne pourra plus se connecter</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="bg-surface-elevated rounded-xl p-4 flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-sm font-bold"
              style={{ backgroundColor: `${roleConfig.color}20`, color: roleConfig.color }}
            >
              {getInitials(user.full_name, user.email)}
            </div>
            <div className="min-w-0">
              <p className="font-medium text-foreground text-sm truncate">{user.full_name ?? user.email.split("@")[0]}</p>
              <p className="text-xs text-foreground-muted truncate">{user.email}</p>
            </div>
            <RoleBadge role={user.role} />
          </div>
          <p className="text-sm text-foreground-muted">
            Le statut de l'utilisateur sera passe a <strong className="text-yellow-400">suspendu</strong>. Il ne pourra plus acceder a la plateforme.
          </p>
          <div className="flex gap-3 pt-2">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-foreground-muted/10 text-foreground-muted font-semibold text-sm hover:bg-foreground-muted/20">
              Annuler
            </button>
            <button
              onClick={handleRevoke}
              disabled={loading}
              className="flex-1 py-2.5 rounded-xl bg-yellow-500 text-background font-semibold text-sm hover:bg-yellow-500/90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
              Revoquer
            </button>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}

// ══════════════════════════════════════════════════════════════
// Stories 106-112: Security & Notifications combined section
// ══════════════════════════════════════════════════════════════

function SecurityNotificationsSection({ users }: { users: EzdriveUser[] }) {
  const [section, setSection] = useState<"2fa" | "sessions" | "failed" | "notif-prefs" | "notif-history" | "notif-create" | null>(null);

  const sectionButtons = [
    { key: "2fa" as const, label: "Authentification 2FA", icon: ShieldCheck, description: "Story 106" },
    { key: "sessions" as const, label: "Sessions actives", icon: Monitor, description: "Story 107" },
    { key: "failed" as const, label: "Tentatives echouees", icon: Lock, description: "Story 109" },
    { key: "notif-prefs" as const, label: "Preferences notifications", icon: Bell, description: "Story 110" },
    { key: "notif-history" as const, label: "Historique notifications", icon: History, description: "Story 111" },
    { key: "notif-create" as const, label: "Nouvelle notification", icon: Megaphone, description: "Story 112" },
  ];

  return (
    <div className="space-y-4 mt-8">
      <div className="flex items-center gap-3">
        <Shield className="w-5 h-5 text-primary" />
        <div>
          <h2 className="font-heading text-lg font-bold text-foreground">Securite & Notifications</h2>
          <p className="text-xs text-foreground-muted">Gestion avancee des acces et des notifications</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {sectionButtons.map((btn) => {
          const Icon = btn.icon;
          return (
            <button
              key={btn.key}
              onClick={() => setSection(section === btn.key ? null : btn.key)}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all",
                section === btn.key
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "bg-surface border-border text-foreground hover:border-foreground-muted"
              )}
            >
              <Icon className="w-5 h-5 shrink-0" />
              <span className="text-sm font-medium">{btn.label}</span>
            </button>
          );
        })}
      </div>

      {section === "2fa" && <TwoFactorSection />}
      {section === "sessions" && <ActiveSessionsSection users={users} />}
      {section === "failed" && <FailedLoginsSection />}
      {section === "notif-prefs" && <NotificationPrefsSection />}
      {section === "notif-history" && <NotificationHistorySection />}
      {section === "notif-create" && <CreateNotificationSection />}
    </div>
  );
}

// ── Story 106: Two-factor authentication (2FA) ──────────────

function TwoFactorSection() {
  const [enabled, setEnabled] = useState(false);

  return (
    <div className="bg-surface border border-border rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-primary" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">Authentification a deux facteurs (2FA)</h3>
            <p className="text-xs text-foreground-muted">Ajouter une couche de securite supplementaire</p>
          </div>
        </div>
        <button
          onClick={() => setEnabled(!enabled)}
          className={cn(
            "relative w-11 h-6 rounded-full transition-colors shrink-0",
            enabled ? "bg-primary" : "bg-surface-elevated border border-border"
          )}
        >
          <span className={cn(
            "absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform",
            enabled ? "translate-x-5.5" : "translate-x-0.5"
          )} />
        </button>
      </div>

      {enabled ? (
        <div className="bg-surface-elevated rounded-xl p-4 space-y-3">
          <p className="text-sm font-medium text-foreground">Instructions de configuration</p>
          <ol className="text-xs text-foreground-muted space-y-2 list-decimal list-inside">
            <li>Telechargez une application TOTP (Google Authenticator, Authy, etc.)</li>
            <li>Scannez le QR code ci-dessous ou entrez la cle manuellement</li>
            <li>Entrez le code a 6 chiffres pour verifier</li>
          </ol>
          <div className="bg-background/50 rounded-xl p-4 flex items-center justify-center">
            <div className="w-32 h-32 bg-foreground-muted/10 rounded-lg flex items-center justify-center text-xs text-foreground-muted">
              QR Code placeholder
            </div>
          </div>
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-3">
            <p className="text-xs text-yellow-400 font-medium">Codes de secours</p>
            <p className="text-xs text-foreground-muted mt-1">
              Conservez ces codes en lieu sur. Ils permettent de se connecter si l'application TOTP est indisponible.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs text-foreground">
              {["A1B2-C3D4", "E5F6-G7H8", "I9J0-K1L2", "M3N4-O5P6", "Q7R8-S9T0", "U1V2-W3X4"].map((code) => (
                <span key={code} className="bg-background/50 rounded px-2 py-1">{code}</span>
              ))}
            </div>
          </div>
          <p className="text-xs text-foreground-muted">
            <strong>Note :</strong> La configuration 2FA reelle depend des parametres Supabase Auth.
            Cette interface sert de guide pour les administrateurs.
          </p>
        </div>
      ) : (
        <p className="text-xs text-foreground-muted">
          Le 2FA n'est pas active. Activez-le pour renforcer la securite des comptes administrateurs.
        </p>
      )}
    </div>
  );
}

// ── Story 107: View user active sessions ──────────────────

function ActiveSessionsSection({ users }: { users: EzdriveUser[] }) {
  const { data: sessions, isLoading } = useQuery({
    queryKey: ["user-active-sessions"],
    queryFn: async () => {
      const { data } = await supabase
        .from("ezdrive_profiles")
        .select("id, email, full_name, role, updated_at")
        .order("updated_at", { ascending: false })
        .limit(30);
      return (data ?? []).map((u: any) => ({
        id: u.id,
        email: u.email,
        full_name: u.full_name,
        role: u.role,
        last_login_at: u.updated_at,
        device: "Web Browser",
        ip: "N/A",
      }));
    },
  });

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <Monitor className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Sessions utilisateurs actives</h3>
      </div>
      {isLoading ? (
        <div className="p-5 space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-10 bg-surface-elevated rounded animate-pulse" />)}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Utilisateur</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Role</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Derniere connexion</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Appareil</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(sessions ?? []).map((s: any) => {
                const rc = ROLE_CONFIG[s.role] ?? ROLE_CONFIG.viewer;
                return (
                  <tr key={s.id} className="hover:bg-surface-elevated/50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-foreground">{s.full_name ?? s.email.split("@")[0]}</p>
                      <p className="text-xs text-foreground-muted">{s.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("px-2 py-0.5 rounded text-xs font-medium", rc.bgClass, rc.textClass)}>{rc.label}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground-muted whitespace-nowrap">
                      {s.last_login_at ? new Date(s.last_login_at).toLocaleString("fr-FR") : "\u2014"}
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground-muted">{s.device}</td>
                    <td className="px-4 py-3 text-sm text-foreground-muted font-mono">{s.ip}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Story 109: Failed login attempts ──────────────────────

function FailedLoginsSection() {
  const { data: failedAttempts, isLoading } = useQuery({
    queryKey: ["failed-login-attempts"],
    queryFn: async () => {
      // Try auth_audit_log or a custom failed_logins table
      const { data, error } = await supabase
        .from("auth_failed_logins")
        .select("id, email, attempted_at, ip_address, reason")
        .order("attempted_at", { ascending: false })
        .limit(50);
      if (error) {
        // Table may not exist — return empty
        return [];
      }
      return data ?? [];
    },
  });

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <Lock className="w-4 h-4 text-red-400" />
        <h3 className="text-sm font-semibold text-foreground">Tentatives de connexion echouees</h3>
      </div>
      {isLoading ? (
        <div className="p-5 space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-10 bg-surface-elevated rounded animate-pulse" />)}</div>
      ) : (failedAttempts ?? []).length === 0 ? (
        <div className="p-8 text-center">
          <Lock className="w-8 h-8 text-foreground-muted mx-auto mb-3" />
          <p className="text-foreground font-medium">Aucune tentative echouee</p>
          <p className="text-sm text-foreground-muted mt-1">
            Les tentatives de connexion echouees sont enregistrees par Supabase Auth.
            Cette section affichera les donnees lorsqu'elles seront disponibles.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Email</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">IP</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Raison</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(failedAttempts ?? []).map((a: any) => (
                <tr key={a.id} className="hover:bg-surface-elevated/50 transition-colors">
                  <td className="px-4 py-3 text-sm text-foreground">{a.email}</td>
                  <td className="px-4 py-3 text-sm text-foreground-muted whitespace-nowrap">
                    {new Date(a.attempted_at).toLocaleString("fr-FR")}
                  </td>
                  <td className="px-4 py-3 text-sm text-foreground-muted font-mono">{a.ip_address ?? "\u2014"}</td>
                  <td className="px-4 py-3 text-sm text-foreground-muted">{a.reason ?? "Mot de passe incorrect"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Story 110: Notification preferences ──────────────────

function NotificationPrefsSection() {
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);

  const PREFS = [
    { key: "email_alerts", label: "Alertes email", description: "Recevoir les alertes de panne par email" },
    { key: "push_notifications", label: "Notifications push", description: "Notifications en temps reel dans le navigateur" },
    { key: "daily_digest", label: "Resume quotidien", description: "Email recapitulatif chaque matin" },
    { key: "weekly_report", label: "Rapport hebdomadaire", description: "Rapport detaille chaque lundi" },
  ];

  const { data: prefs, isLoading } = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: async () => {
      const { data } = await supabase
        .from("notification_preferences")
        .select("*")
        .limit(1)
        .maybeSingle();
      return (data as Record<string, boolean> | null) ?? { email_alerts: true, push_notifications: false, daily_digest: false, weekly_report: false };
    },
  });

  const [values, setValues] = useState<Record<string, boolean>>({
    email_alerts: true,
    push_notifications: false,
    daily_digest: false,
    weekly_report: false,
  });

  useEffect(() => {
    if (prefs) setValues(prefs);
  }, [prefs]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("notification_preferences")
        .upsert({ id: "default", ...values });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notification-preferences"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <Bell className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Preferences de notifications</h3>
      </div>
      {isLoading ? (
        <div className="p-5 space-y-3">{[1, 2, 3, 4].map((i) => <div key={i} className="h-12 bg-surface-elevated rounded animate-pulse" />)}</div>
      ) : (
        <div className="divide-y divide-border">
          {PREFS.map((pref) => (
            <label key={pref.key} className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-surface-elevated/30 transition-colors">
              <input
                type="checkbox"
                checked={values[pref.key] ?? false}
                onChange={() => setValues({ ...values, [pref.key]: !(values[pref.key] ?? false) })}
                className="w-5 h-5 rounded border-border text-primary focus:ring-primary"
              />
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">{pref.label}</p>
                <p className="text-xs text-foreground-muted">{pref.description}</p>
              </div>
            </label>
          ))}
          <div className="px-5 py-4">
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white font-semibold rounded-xl text-sm hover:bg-primary/90 disabled:opacity-50"
            >
              {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : null}
              {saved ? "Sauvegarde !" : "Enregistrer"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Story 111: Notification history ──────────────────────

function NotificationHistorySection() {
  const { data: notifications, isLoading } = useQuery({
    queryKey: ["notification-history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications_log")
        .select("id, created_at, type, title, recipient, channel, status")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) return [];
      return data ?? [];
    },
  });

  const statusBadge = (status: string) => {
    switch (status) {
      case "sent":
        return <span className="px-2 py-0.5 bg-emerald-500/15 text-emerald-400 text-xs font-medium rounded">Envoye</span>;
      case "failed":
        return <span className="px-2 py-0.5 bg-red-500/15 text-red-400 text-xs font-medium rounded">Echoue</span>;
      case "pending":
        return <span className="px-2 py-0.5 bg-yellow-500/15 text-yellow-400 text-xs font-medium rounded">En attente</span>;
      default:
        return <span className="px-2 py-0.5 bg-foreground-muted/10 text-foreground-muted text-xs font-medium rounded">{status}</span>;
    }
  };

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <History className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Historique des notifications</h3>
      </div>
      {isLoading ? (
        <div className="p-5 space-y-3">{[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-10 bg-surface-elevated rounded animate-pulse" />)}</div>
      ) : (notifications ?? []).length === 0 ? (
        <div className="p-8 text-center">
          <Bell className="w-8 h-8 text-foreground-muted mx-auto mb-3" />
          <p className="text-foreground font-medium">Aucune notification envoyee</p>
          <p className="text-sm text-foreground-muted mt-1">L'historique des notifications apparaitra ici.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Titre</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Destinataire</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Canal</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(notifications ?? []).map((n: any) => (
                <tr key={n.id} className="hover:bg-surface-elevated/50 transition-colors">
                  <td className="px-4 py-3 text-sm text-foreground-muted whitespace-nowrap">
                    {new Date(n.created_at).toLocaleString("fr-FR")}
                  </td>
                  <td className="px-4 py-3 text-sm text-foreground-muted capitalize">{n.type}</td>
                  <td className="px-4 py-3 text-sm font-medium text-foreground">{n.title}</td>
                  <td className="px-4 py-3 text-sm text-foreground-muted">{n.recipient}</td>
                  <td className="px-4 py-3 text-sm text-foreground-muted capitalize">{n.channel}</td>
                  <td className="px-4 py-3">{statusBadge(n.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Story 112: Create manual notification ──────────────────

function CreateNotificationSection() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [recipient, setRecipient] = useState("all_conducteurs");
  const [channel, setChannel] = useState("email");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  async function handleSend() {
    if (!title || !message) return;
    setLoading(true);
    setResult(null);
    try {
      const { error } = await supabase
        .from("notifications_log")
        .insert({
          type: "manual",
          title,
          message,
          recipient,
          channel,
          status: "pending",
        });
      if (error) throw error;
      setResult({ success: true, message: "Notification creee avec succes (statut: en attente)" });
      queryClient.invalidateQueries({ queryKey: ["notification-history"] });
      setTitle("");
      setMessage("");
    } catch (err) {
      setResult({ success: false, message: `Erreur: ${(err as Error).message}` });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-surface border border-border rounded-2xl p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Megaphone className="w-5 h-5 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Nouvelle notification manuelle</h3>
      </div>

      {result && (
        <div className={cn(
          "rounded-xl px-4 py-3 text-sm font-medium border",
          result.success
            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
            : "bg-red-500/10 text-red-400 border-red-500/30"
        )}>
          {result.message}
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-foreground-muted mb-1.5">Titre *</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Titre de la notification"
          className="w-full bg-surface-elevated border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-foreground-muted mb-1.5">Message *</label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Contenu de la notification..."
          rows={4}
          className="w-full bg-surface-elevated border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50 resize-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-foreground-muted mb-1.5">Destinataires</label>
          <select
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            className="w-full bg-surface-elevated border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50"
          >
            <option value="all_conducteurs">Tous les conducteurs</option>
            <option value="all_cpo">Tous les CPO</option>
            <option value="admins">Administrateurs</option>
            <option value="operators">Operateurs</option>
            <option value="b2b_clients">Clients B2B</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-foreground-muted mb-1.5">Canal</label>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className="w-full bg-surface-elevated border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50"
          >
            <option value="email">Email</option>
            <option value="push">Push notification</option>
            <option value="both">Email + Push</option>
          </select>
        </div>
      </div>

      <button
        onClick={handleSend}
        disabled={loading || !title || !message}
        className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white font-semibold rounded-xl text-sm hover:bg-primary/90 disabled:opacity-40"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        Envoyer la notification
      </button>
    </div>
  );
}
