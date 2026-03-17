import { useState } from "react";
import { KeyRound, CreditCard, Ticket } from "lucide-react";
import { cn } from "@/lib/utils";
import { RfidPage } from "@/components/rfid/RfidPage";
import { SubscriptionsPage } from "@/components/subscriptions/SubscriptionsPage";
import { CouponsPage } from "@/components/coupons/CouponsPage";

const TABS = [
  { key: "rfid", label: "Tokens RFID", icon: KeyRound },
  { key: "subscriptions", label: "Abonnements", icon: CreditCard },
  { key: "coupons", label: "Coupons", icon: Ticket },
] as const;

export function PaymentMethodsPage() {
  const [tab, setTab] = useState<"rfid" | "subscriptions" | "coupons">("rfid");
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-xl font-bold text-foreground">Moyens de paiement</h1>
        <p className="text-sm text-foreground-muted mt-0.5">Tokens RFID, abonnements et coupons</p>
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
      {tab === "rfid" && <RfidPage />}
      {tab === "subscriptions" && <SubscriptionsPage />}
      {tab === "coupons" && <CouponsPage />}
    </div>
  );
}
