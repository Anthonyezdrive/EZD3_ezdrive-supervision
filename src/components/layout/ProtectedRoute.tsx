import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";

export function ProtectedRoute() {
  const { user, loading } = useAuth();
  const { isB2B } = usePermissions();
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
  if (isB2B && !location.pathname.startsWith("/b2b")) {
    return <Navigate to="/b2b/overview" replace />;
  }

  return <Outlet />;
}
