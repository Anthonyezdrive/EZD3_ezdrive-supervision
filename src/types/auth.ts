export type UserRole = "admin" | "operator" | "tech" | "b2b_client";

export interface AdminRole {
  id: string;
  name: string;
  description: string;
  color: string;
  permissions: string[];
  is_system: boolean;
}

export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  territory: string | null;
  cpo_id: string | null;
  admin_role_id: string | null;
  admin_role: AdminRole | null;
  created_at: string;
}
