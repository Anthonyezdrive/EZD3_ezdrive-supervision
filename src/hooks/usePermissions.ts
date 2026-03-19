// ============================================================
// EZDrive — usePermissions hook
// Reads permissions from admin_roles via the user profile
// ============================================================

import { useMemo, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";

export function usePermissions() {
  const { profile } = useAuth();

  // All available permissions — granted automatically to admin role
  const ALL_PERMISSIONS = [
    "stations.view", "stations.edit", "stations.delete",
    "billing.view", "billing.edit", "billing.tariffs",
    "customers.view", "customers.edit",
    "ocpi.view", "ocpi.edit",
    "admin.users", "admin.roles", "admin.settings",
    "monitoring.view", "monitoring.edit",
    "b2b.view", "b2b.edit",
  ];

  const permissions: string[] = useMemo(() => {
    // Admin and operator roles get all permissions regardless of admin_role config
    if (profile?.role === "admin" || profile?.role === "operator") {
      return ALL_PERMISSIONS;
    }
    return profile?.admin_role?.permissions ?? [];
  }, [profile?.admin_role?.permissions, profile?.role]);

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
