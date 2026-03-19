// ============================================================
// EZDrive — usePermissions hook
// Reads permissions from admin_roles via the user profile
// ============================================================

import { useMemo, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";

export function usePermissions() {
  const { profile } = useAuth();

  const permissions: string[] = useMemo(() => {
    return profile?.admin_role?.permissions ?? [];
  }, [profile?.admin_role?.permissions]);

  const roleName: string = useMemo(() => {
    return profile?.admin_role?.name ?? profile?.role ?? "";
  }, [profile?.admin_role?.name, profile?.role]);

  const roleColor: string = useMemo(() => {
    return profile?.admin_role?.color ?? "#8892B0";
  }, [profile?.admin_role?.color]);

  const hasPermission = useCallback(
    (permission: string): boolean => {
      return permissions.includes(permission);
    },
    [permissions],
  );

  const hasAnyPermission = useCallback(
    (...perms: string[]): boolean => {
      return perms.some((p) => permissions.includes(p));
    },
    [permissions],
  );

  const hasAllPermissions = useCallback(
    (...perms: string[]): boolean => {
      return perms.every((p) => permissions.includes(p));
    },
    [permissions],
  );

  const isAdmin = useMemo(() => {
    return (
      hasPermission("admin.users") &&
      hasPermission("admin.roles") &&
      hasPermission("admin.settings")
    );
  }, [hasPermission]);

  const isB2B = useMemo(() => {
    return profile?.role === "b2b_client";
  }, [profile?.role]);

  return {
    permissions,
    roleName,
    roleColor,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    isAdmin,
    isB2B,
  };
}
