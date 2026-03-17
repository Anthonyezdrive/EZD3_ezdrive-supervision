import { useState } from "react";
import { Tag, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { AdminPage } from "@/components/admin/AdminPage";
import { SettingsPage } from "@/components/settings/SettingsPage";

const TABS = [
  { key: "admin", label: "Gestion CPO", icon: Tag },
  { key: "settings", label: "Param\u00e8tres & Alertes", icon: Settings },
] as const;

export function AdminConfigPage() {
  const [tab, setTab] = useState<"admin" | "settings">("admin");
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-xl font-bold text-foreground">Administration</h1>
        <p className="text-sm text-foreground-muted mt-0.5">Gestion CPO et configuration</p>
      </div>
      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors relative",
              tab === t.key ? "text-primary" : "text-foreground-muted hover:text-foreground"
            )}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
            {tab === t.key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />}
          </button>
        ))}
      </div>
      {tab === "admin" && <AdminPage />}
      {tab === "settings" && <SettingsPage />}
    </div>
  );
}
