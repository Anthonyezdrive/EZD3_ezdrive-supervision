import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

export function ProtectedRoute() {
  const { user, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse-dot text-primary text-lg">
          Chargement...
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // B2B clients can only access /b2b/* routes
  if (
    profile?.role === "b2b_client" &&
    !location.pathname.startsWith("/b2b")
  ) {
    return <Navigate to="/b2b/overview" replace />;
  }

  return <Outlet />;
}
