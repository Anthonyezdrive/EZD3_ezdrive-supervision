import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  Download,
  Terminal,
  ArrowDownUp,
  Eye,
  RefreshCw,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { downloadCSV, todayISO } from "@/lib/export";
import { SlideOver } from "@/components/ui/SlideOver";

// ── Types ──────────────────────────────────────────────────

interface OcppLogEntry {
  id: string;
  chargepoint_id: string;
  identity: string | null;
  direction: "incoming" | "outgoing";
  message_type: string;
  action: string | null;
  payload: Record<string, unknown> | null;
  error_code: string | null;
  error_description: string | null;
  received_at: string;
  processing_time_ms: number | null;
  connector_id: number | null;
  transaction_id: number | null;
}

// ── Hook ───────────────────────────────────────────────────

function useOcppLogs(filters: {
  chargepoint?: string;
  messageType?: string;
  action?: string;
  direction?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}) {
  return useQuery<OcppLogEntry[]>({
    queryKey: ["ocpp-logs", filters],
    retry: false,
    queryFn: async () => {
      try {
        let query = supabase
          .from("ocpp_message_log")
          .select("*")
          .order("received_at", { ascending: false })
          .limit(filters.limit ?? 200);

        if (filters.chargepoint) {
          query = query.ilike("chargepoint_id", `%${filters.chargepoint}%`);
        }
        if (filters.messageType && filters.messageType !== "all") {
          query = query.eq("message_type", filters.messageType);
        }
        if (filters.action) {
          query = query.eq("action", filters.action);
        }
        if (filters.direction && filters.direction !== "all") {
          query = query.eq("direction", filters.direction);
        }
        if (filters.dateFrom) {
          query = query.gte("received_at", `${filters.dateFrom}T00:00:00`);
        }
        if (filters.dateTo) {
          query = query.lte("received_at", `${filters.dateTo}T23:59:59`);
        }

        const { data, error } = await query;
        if (error) {
          console.warn("[OcppLogs] error:", error.message);
          return [];
        }
        return (data ?? []) as OcppLogEntry[];
      } catch {
        return [];
      }
    },
    refetchInterval: 30_000,
  });
}

// ── OCPP Action Types ─────────────────────────────────────

const OCPP_ACTION_TYPES = [
  { value: "", label: "Toutes les actions" },
  { value: "BootNotification", label: "BootNotification" },
  { value: "StatusNotification", label: "StatusNotification" },
  { value: "Heartbeat", label: "Heartbeat" },
  { value: "StartTransaction", label: "StartTransaction" },
  { value: "StopTransaction", label: "StopTransaction" },
  { value: "MeterValues", label: "MeterValues" },
  { value: "Authorize", label: "Authorize" },
  { value: "RemoteStartTransaction", label: "RemoteStartTransaction" },
  { value: "RemoteStopTransaction", label: "RemoteStopTransaction" },
  { value: "Reset", label: "Reset" },
  { value: "ChangeConfiguration", label: "ChangeConfiguration" },
  { value: "GetConfiguration", label: "GetConfiguration" },
];

// ── Component ──────────────────────────────────────────────

export default function OcppLogsTab() {
  const [cpFilter, setCpFilter] = useState("");
  const [msgTypeFilter, setMsgTypeFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("");
  const [dirFilter, setDirFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedLog, setSelectedLog] = useState<OcppLogEntry | null>(null);

  const { data: logs, isLoading, refetch } = useOcppLogs({
    chargepoint: cpFilter,
    messageType: msgTypeFilter,
    action: actionFilter,
    direction: dirFilter,
    dateFrom,
    dateTo,
  });

  const messageTypes = useMemo(() => {
    if (!logs) return [];
    const types = new Set(logs.map((l) => l.message_type));
    return Array.from(types).sort();
  }, [logs]);

  function handleExportCSV() {
    if (!logs) return;
    const rows = logs.map((l) => ({
      Date: new Date(l.received_at).toLocaleString("fr-FR"),
      Chargepoint: l.chargepoint_id,
      Direction: l.direction,
      Type: l.message_type,
      Action: l.action ?? "",
      "Connecteur": l.connector_id ?? "",
      "Temps (ms)": l.processing_time_ms ?? "",
      "Erreur": l.error_code ?? "",
    }));
    downloadCSV(rows, `ezdrive-ocpp-logs-${todayISO()}.csv`);
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[180px] max-w-xs">
          <label className="block text-xs text-foreground-muted mb-1">Chargepoint</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
            <input
              type="text"
              placeholder="ID ou identité..."
              value={cpFilter}
              onChange={(e) => setCpFilter(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50 transition-colors"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs text-foreground-muted mb-1">Type de message</label>
          <select
            value={msgTypeFilter}
            onChange={(e) => setMsgTypeFilter(e.target.value)}
            className="px-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors"
          >
            <option value="all">Tous les types</option>
            {messageTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-foreground-muted mb-1">Action OCPP</label>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="px-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors"
          >
            {OCPP_ACTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-foreground-muted mb-1">Direction</label>
          <select
            value={dirFilter}
            onChange={(e) => setDirFilter(e.target.value)}
            className="px-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors"
          >
            <option value="all">Toutes</option>
            <option value="incoming">Entrante</option>
            <option value="outgoing">Sortante</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-foreground-muted mb-1">Du</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors"
          />
        </div>
        <div>
          <label className="block text-xs text-foreground-muted mb-1">Au</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors"
          />
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 px-3 py-2 bg-surface border border-border rounded-xl text-sm text-foreground-muted hover:text-foreground transition-colors"
          title="Rafraîchir"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
        <button
          onClick={handleExportCSV}
          disabled={!logs || logs.length === 0}
          className="flex items-center gap-2 px-3 py-2 bg-surface border border-border rounded-xl text-sm text-foreground-muted hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download className="w-4 h-4" />
          CSV
        </button>
      </div>

      {/* Stats */}
      <div className="flex gap-4 text-xs text-foreground-muted">
        <span>{logs?.length ?? 0} message{(logs?.length ?? 0) !== 1 ? "s" : ""}</span>
        <span className="text-foreground-muted/50">Auto-refresh 30s</span>
      </div>

      {/* Logs table */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-12 bg-surface border border-border rounded-xl animate-pulse" />
          ))}
        </div>
      ) : !logs || logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 bg-surface border border-border rounded-2xl">
          <Terminal className="w-8 h-8 text-foreground-muted/40 mb-2" />
          <p className="text-foreground-muted">Aucun message OCPP</p>
          <p className="text-xs text-foreground-muted/60 mt-1">Les logs apparaîtront ici au fur et à mesure des échanges OCPP.</p>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-foreground-muted border-b border-border bg-surface-elevated">
                  <th className="text-left font-medium px-4 py-3">Heure</th>
                  <th className="text-left font-medium px-4 py-3">Chargepoint</th>
                  <th className="text-left font-medium px-4 py-3">Direction</th>
                  <th className="text-left font-medium px-4 py-3">Type</th>
                  <th className="text-left font-medium px-4 py-3">Action</th>
                  <th className="text-left font-medium px-4 py-3">Connecteur</th>
                  <th className="text-left font-medium px-4 py-3">Temps</th>
                  <th className="text-right font-medium px-4 py-3">Détail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono text-xs">
                {logs.map((log) => (
                  <tr
                    key={log.id}
                    className={cn(
                      "hover:bg-surface-elevated/50 transition-colors cursor-pointer",
                      log.error_code && "bg-red-500/5"
                    )}
                    onClick={() => setSelectedLog(log)}
                  >
                    <td className="px-4 py-2.5 text-foreground-muted whitespace-nowrap">
                      {new Date(log.received_at).toLocaleString("fr-FR", {
                        day: "2-digit", month: "2-digit",
                        hour: "2-digit", minute: "2-digit", second: "2-digit",
                      })}
                    </td>
                    <td className="px-4 py-2.5 text-foreground font-medium truncate max-w-[160px]">
                      {log.identity ?? log.chargepoint_id}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={cn(
                        "inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium",
                        log.direction === "incoming"
                          ? "bg-blue-500/10 text-blue-400"
                          : "bg-amber-500/10 text-amber-400"
                      )}>
                        <ArrowDownUp className="w-3 h-3" />
                        {log.direction === "incoming" ? "IN" : "OUT"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="px-2 py-0.5 bg-primary/10 text-primary text-xs font-medium rounded-lg">
                        {log.message_type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-foreground-muted">
                      {log.action ?? "--"}
                    </td>
                    <td className="px-4 py-2.5 text-foreground-muted text-center">
                      {log.connector_id ?? "--"}
                    </td>
                    <td className="px-4 py-2.5 text-foreground-muted">
                      {log.processing_time_ms != null ? `${log.processing_time_ms}ms` : "--"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button className="p-1 text-foreground-muted hover:text-primary transition-colors">
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detail drawer */}
      <SlideOver
        open={selectedLog !== null}
        onClose={() => setSelectedLog(null)}
        title="Détail du message OCPP"
      >
        {selectedLog && (
          <div className="space-y-6 p-1">
            {/* Metadata */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-foreground-muted mb-0.5">Chargepoint</p>
                <p className="text-sm font-medium text-foreground">{selectedLog.chargepoint_id}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted mb-0.5">Identité</p>
                <p className="text-sm font-medium text-foreground">{selectedLog.identity ?? "--"}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted mb-0.5">Direction</p>
                <span className={cn(
                  "inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium",
                  selectedLog.direction === "incoming"
                    ? "bg-blue-500/10 text-blue-400"
                    : "bg-amber-500/10 text-amber-400"
                )}>
                  {selectedLog.direction === "incoming" ? "Entrante" : "Sortante"}
                </span>
              </div>
              <div>
                <p className="text-xs text-foreground-muted mb-0.5">Type</p>
                <p className="text-sm font-medium text-foreground">{selectedLog.message_type}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted mb-0.5">Action</p>
                <p className="text-sm text-foreground">{selectedLog.action ?? "--"}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted mb-0.5">Connecteur</p>
                <p className="text-sm text-foreground">{selectedLog.connector_id ?? "--"}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted mb-0.5">Transaction</p>
                <p className="text-sm text-foreground">{selectedLog.transaction_id ?? "--"}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted mb-0.5">Temps de traitement</p>
                <p className="text-sm text-foreground">
                  {selectedLog.processing_time_ms != null ? `${selectedLog.processing_time_ms}ms` : "--"}
                </p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-foreground-muted mb-0.5">Reçu le</p>
                <p className="text-sm text-foreground">
                  {new Date(selectedLog.received_at).toLocaleString("fr-FR", {
                    day: "2-digit", month: "long", year: "numeric",
                    hour: "2-digit", minute: "2-digit", second: "2-digit",
                  })}
                </p>
              </div>
            </div>

            {/* Error */}
            {selectedLog.error_code && (
              <div className="bg-red-500/10 border border-red-500/25 rounded-xl p-4">
                <p className="text-xs font-semibold text-red-400 mb-1">Erreur OCPP</p>
                <p className="text-sm text-red-300 font-mono">{selectedLog.error_code}</p>
                {selectedLog.error_description && (
                  <p className="text-xs text-red-400/80 mt-1">{selectedLog.error_description}</p>
                )}
              </div>
            )}

            {/* Payload JSON */}
            <div>
              <p className="text-xs font-semibold text-foreground-muted mb-2">Payload (JSON)</p>
              <pre className="bg-surface-elevated border border-border rounded-xl p-4 text-xs text-foreground font-mono overflow-x-auto max-h-[400px] overflow-y-auto whitespace-pre-wrap break-all">
                {selectedLog.payload
                  ? JSON.stringify(selectedLog.payload, null, 2)
                  : "Aucun payload"}
              </pre>
            </div>
          </div>
        )}
      </SlideOver>
    </div>
  );
}
