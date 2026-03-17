import { useState } from "react";
import { Activity, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { SessionsPage } from "@/components/sessions/SessionsPage";
import { InvoicesPage } from "@/components/invoices/InvoicesPage";

const TABS = [
  { key: "sessions", label: "Sessions CDR", icon: Activity },
  { key: "invoices", label: "Factures", icon: FileText },
] as const;

export function BillingPage() {
  const [tab, setTab] = useState<"sessions" | "invoices">("sessions");
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-xl font-bold text-foreground">CDRs & Factures</h1>
        <p className="text-sm text-foreground-muted mt-0.5">Sessions de charge et facturation</p>
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
      {tab === "sessions" && <SessionsPage />}
      {tab === "invoices" && <InvoicesPage />}
    </div>
  );
}
