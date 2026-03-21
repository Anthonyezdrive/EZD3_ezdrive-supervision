import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { UserProfile } from "@/types/auth";
import { setSentryUser, clearSentryUser } from "@/lib/sentry";

interface AuthState {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  loading: boolean;
  isRecovery: boolean;
  clearRecovery: () => void;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signInWithApple: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRecovery, setIsRecovery] = useState(false);

  async function fetchProfile(userId: string) {
    const { data } = await supabase
      .from("ezdrive_profiles")
      .select("*, admin_role:admin_roles(*)")
      .eq("id", userId)
      .maybeSingle();

    if (data) {
      const p = data as UserProfile;
      setProfile(p);
      setSentryUser({ id: userId, email: p.email, role: p.role });
    } else {
      // Profile doesn't exist yet (trigger may not have fired)
      // Provide a fallback profile from auth metadata — default to "user" (least privilege)
      const currentUser = (await supabase.auth.getUser()).data.user;
      if (currentUser) {
        const fallbackProfile: UserProfile = {
          id: currentUser.id,
          email: currentUser.email ?? "",
          full_name:
            currentUser.user_metadata?.full_name ?? currentUser.email ?? "",
          role: currentUser.user_metadata?.role ?? "user",
          territory: null,
          cpo_id: null,
          admin_role_id: null,
          admin_role: null,
          created_at: currentUser.created_at,
        };
        setProfile(fallbackProfile);
        setSentryUser({
          id: currentUser.id,
          email: currentUser.email,
          role: fallbackProfile.role,
        });
      }
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) fetchProfile(s.user.id);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (event === "PASSWORD_RECOVERY") {
        setIsRecovery(true);
      }
      if (s?.user) {
        fetchProfile(s.user.id);
      } else {
        setProfile(null);
        clearSentryUser();
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error: error?.message ?? null };
  }

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/dashboard`,
      },
    });
    return { error: error?.message ?? null };
  }

  async function signInWithApple() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "apple",
      options: {
        redirectTo: `${window.location.origin}/dashboard`,
      },
    });
    return { error: error?.message ?? null };
  }

  async function signOut() {
    await supabase.auth.signOut();
    setProfile(null);
  }

  async function resetPassword(email: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    return { error: error?.message ?? null };
  }

  async function updatePassword(newPassword: string) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (!error) setIsRecovery(false);
    return { error: error?.message ?? null };
  }

  function clearRecovery() {
    setIsRecovery(false);
  }

  return (
    <AuthContext.Provider
      value={{ user, session, profile, loading, isRecovery, clearRecovery, signIn, signInWithGoogle, signInWithApple, signOut, resetPassword, updatePassword }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
