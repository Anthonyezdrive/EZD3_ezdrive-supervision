import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Zap, ArrowLeft, Mail, CheckCircle } from "lucide-react";

type Mode = "login" | "forgot" | "sent";

export function LoginPage() {
  const { user, loading, signIn, resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<Mode>("login");

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse-dot text-primary text-lg">
          Chargement...
        </div>
      </div>
    );
  }

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: err } = await signIn(email, password);
    if (err) setError(err);
    setSubmitting(false);
  }

  async function handleForgot(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: err } = await resetPassword(email);
    if (err) {
      setError(err);
    } else {
      setMode("sent");
    }
    setSubmitting(false);
  }

  function switchMode(newMode: Mode) {
    setMode(newMode);
    setError(null);
    setPassword("");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/15 border-2 border-primary mb-4">
            <Zap className="w-8 h-8 text-primary" />
          </div>
          <h1 className="font-heading text-2xl font-bold text-foreground">
            EZDrive
          </h1>
          <p className="text-foreground-muted text-sm mt-1">
            Supervision Dashboard
          </p>
        </div>

        {/* Mode: Sent — Success message */}
        {mode === "sent" && (
          <div className="bg-surface border border-border rounded-2xl p-6 space-y-4">
            <div className="text-center space-y-3">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-success/15 mx-auto">
                <CheckCircle className="w-6 h-6 text-success" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">
                Email envoyé !
              </h2>
              <p className="text-foreground-muted text-sm">
                Si un compte existe avec l'adresse <strong className="text-foreground">{email}</strong>, vous recevrez un lien de réinitialisation dans quelques instants.
              </p>
              <p className="text-foreground-muted text-xs">
                Pensez à vérifier vos spams.
              </p>
            </div>
            <button
              type="button"
              onClick={() => switchMode("login")}
              className="w-full py-2.5 bg-primary hover:bg-primary-hover text-foreground-inverse font-semibold rounded-xl transition-colors"
            >
              Retour à la connexion
            </button>
          </div>
        )}

        {/* Mode: Forgot — Email form */}
        {mode === "forgot" && (
          <form
            onSubmit={handleForgot}
            className="bg-surface border border-border rounded-2xl p-6 space-y-4"
          >
            <div className="text-center space-y-1 mb-2">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/15 mx-auto">
                <Mail className="w-6 h-6 text-primary" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">
                Mot de passe oublié
              </h2>
              <p className="text-foreground-muted text-sm">
                Entrez votre email pour recevoir un lien de réinitialisation.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground-muted mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                className="w-full px-3 py-2.5 bg-surface-elevated border border-border rounded-xl text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-border-focus transition-colors"
                placeholder="vous@ezdrive.fr"
              />
            </div>

            {error && (
              <div className="text-danger text-sm bg-danger/10 border border-danger/30 rounded-xl px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 bg-primary hover:bg-primary-hover text-foreground-inverse font-semibold rounded-xl transition-colors disabled:opacity-50"
            >
              {submitting ? "Envoi en cours..." : "Envoyer le lien"}
            </button>

            <button
              type="button"
              onClick={() => switchMode("login")}
              className="w-full flex items-center justify-center gap-1.5 text-sm text-foreground-muted hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Retour à la connexion
            </button>
          </form>
        )}

        {/* Mode: Login — Standard form */}
        {mode === "login" && (
          <form
            onSubmit={handleLogin}
            className="bg-surface border border-border rounded-2xl p-6 space-y-4"
          >
            <div>
              <label className="block text-sm font-medium text-foreground-muted mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-3 py-2.5 bg-surface-elevated border border-border rounded-xl text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-border-focus transition-colors"
                placeholder="vous@ezdrive.fr"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-medium text-foreground-muted">
                  Mot de passe
                </label>
                <button
                  type="button"
                  onClick={() => switchMode("forgot")}
                  className="text-xs text-primary hover:text-primary-hover transition-colors"
                >
                  Mot de passe oublié ?
                </button>
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-3 py-2.5 bg-surface-elevated border border-border rounded-xl text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-border-focus transition-colors"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="text-danger text-sm bg-danger/10 border border-danger/30 rounded-xl px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 bg-primary hover:bg-primary-hover text-foreground-inverse font-semibold rounded-xl transition-colors disabled:opacity-50"
            >
              {submitting ? "Connexion..." : "Se connecter"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
