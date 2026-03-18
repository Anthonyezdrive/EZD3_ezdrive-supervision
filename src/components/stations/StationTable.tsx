// ============================================================
// EZDrive — Station Table (GreenFlux-style)
// Columns: Connexion, Identifiant, Adresse, Ville, Etat, Chargement, Connecteurs, Fabricant
// ============================================================

import { useState, useMemo } from "react";
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { cn } from "@/lib/utils";
import type { Station, OCPPStatus } from "@/types/station";

type SortKey =
  | "connectivity_status"
  | "name"
  | "address"
  | "city"
  | "ocpp_status"
  | "charge_point_vendor";
type SortDir = "asc" | "desc";

const PAGE_SIZE = 50;

// -- Connection badge (En Ligne / Hors Ligne / Inconnu) -------

function ConnectionBadge({ status }: { status: string | null }) {
  if (status === "Online") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold bg-emerald-500/10 text-emerald-400 border-emerald-500/25">
        <span className="w-2 h-2 rounded-full bg-emerald-400" />
        En Ligne
      </span>
    );
  }
  if (status === "Offline") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold bg-red-500/10 text-red-400 border-red-500/25">
        <span className="w-2 h-2 rounded-full bg-red-400" />
        Hors Ligne
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold bg-gray-500/10 text-gray-400 border-gray-500/25">
      Inconnu
    </span>
  );
}

// -- EVSE state badge (Active / Inconnu) ----------------------

function StateBadge({ station }: { station: Station }) {
  // Derive "Active" if station has any connector with a known status
  const hasActive = station.ocpp_status === "Available" || station.ocpp_status === "Charging" || station.ocpp_status === "Preparing" || station.ocpp_status === "Finishing";
  if (hasActive) {
    return (
      <span className="inline-flex items-center rounded-lg border px-2 py-0.5 text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border-emerald-500/25">
        Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-lg border px-2 py-0.5 text-[11px] font-medium bg-gray-500/10 text-gray-400 border-gray-500/25">
      Inconnu
    </span>
  );
}

// -- Connector dots (green = Available, blue = Charging, etc.) -

function ConnectorDots({ station }: { station: Station }) {
  const connectors = (() => {
    if (!station.connectors) return [];
    if (Array.isArray(station.connectors)) return station.connectors;
    if (typeof station.connectors === "string") {
      try { return JSON.parse(station.connectors); } catch { return []; }
    }
    return [];
  })();

  if (connectors.length === 0) return <span className="text-xs text-foreground-muted">{"\u2014"}</span>;

  const statusColors: Record<string, string> = {
    Available: "#00D4AA",
    Charging: "#4ECDC4",
    Preparing: "#F39C12",
    Finishing: "#3498DB",
    SuspendedEVSE: "#E67E22",
    SuspendedEV: "#E67E22",
    Unavailable: "#BDC3C7",
    Faulted: "#FF6B6B",
    Unknown: "#6B7280",
  };

  return (
    <div className="flex items-center gap-1">
      {connectors.map((c: { status?: string }, i: number) => (
        <span
          key={i}
          className="w-3.5 h-3.5 rounded-full border border-white/10"
          style={{ backgroundColor: statusColors[c.status ?? "Unknown"] ?? "#6B7280" }}
          title={c.status ?? "Unknown"}
        />
      ))}
    </div>
  );
}

// -- Main table -----------------------------------------------

interface StationTableProps {
  stations: Station[];
  onSelect: (station: Station) => void;
}

export function StationTable({ stations, onSelect }: StationTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(1);
  }

  const sorted = useMemo(() => {
    return [...stations].sort((a, b) => {
      const av = a[sortKey] ?? "";
      const bv = b[sortKey] ?? "";
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [stations, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const paginated = sorted.slice(start, start + PAGE_SIZE);

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (col !== sortKey) return null;
    return sortDir === "asc" ? (
      <ChevronUp className="w-3.5 h-3.5 inline ml-1" />
    ) : (
      <ChevronDown className="w-3.5 h-3.5 inline ml-1" />
    );
  };

  const thClass =
    "px-4 py-3 text-left text-xs font-semibold text-foreground-muted uppercase tracking-wider cursor-pointer hover:text-foreground transition-colors select-none whitespace-nowrap";

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-border">
            <tr>
              <th className={thClass} onClick={() => handleSort("connectivity_status")}>
                Connexion <SortIcon col="connectivity_status" />
              </th>
              <th className={thClass} onClick={() => handleSort("name")}>
                Identifiant <SortIcon col="name" />
              </th>
              <th className={thClass} onClick={() => handleSort("address")}>
                Adresse <SortIcon col="address" />
              </th>
              <th className={thClass} onClick={() => handleSort("city")}>
                Ville <SortIcon col="city" />
              </th>
              <th className={thClass} onClick={() => handleSort("ocpp_status")}>
                Etat <SortIcon col="ocpp_status" />
              </th>
              <th className={cn(thClass, "cursor-default hover:text-foreground-muted")}>
                Chargement
              </th>
              <th className={cn(thClass, "cursor-default hover:text-foreground-muted")}>
                Connecteurs
              </th>
              <th className={thClass} onClick={() => handleSort("charge_point_vendor")}>
                Fabricant <SortIcon col="charge_point_vendor" />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {paginated.map((station) => (
              <tr
                key={station.id}
                onClick={() => onSelect(station)}
                className="hover:bg-surface-elevated/50 cursor-pointer transition-colors"
              >
                <td className="px-4 py-3">
                  <ConnectionBadge status={station.connectivity_status} />
                </td>
                <td className="px-4 py-3">
                  <p className="text-sm font-medium text-foreground hover:text-primary transition-colors">
                    {station.gfx_id ?? station.name}
                  </p>
                </td>
                <td className="px-4 py-3 text-sm text-foreground-muted truncate max-w-[200px]">
                  {station.name ?? "\u2014"}
                </td>
                <td className="px-4 py-3 text-sm text-foreground-muted">
                  {station.city ?? "\u2014"}
                </td>
                <td className="px-4 py-3">
                  <StateBadge station={station} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={station.ocpp_status as OCPPStatus} />
                </td>
                <td className="px-4 py-3">
                  <ConnectorDots station={station} />
                </td>
                <td className="px-4 py-3 text-sm text-foreground-muted">
                  {station.charge_point_vendor ?? "\u2014"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination footer */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <span className="text-xs text-foreground-muted">
            0 enregistrements selectionne | montrer {PAGE_SIZE} of {sorted.length} enregistrements
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
              className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
              .reduce<(number | "\u2026")[]>((acc, p, idx, arr) => {
                if (idx > 0 && (p as number) - (arr[idx - 1] as number) > 1) acc.push("\u2026");
                acc.push(p);
                return acc;
              }, [])
              .map((p, i) =>
                p === "\u2026" ? (
                  <span key={"e" + i} className="px-1.5 text-xs text-foreground-muted">{"\u2026"}</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p as number)}
                    className={`min-w-[2rem] h-8 px-2 rounded-lg text-xs font-medium transition-colors ${
                      safePage === p
                        ? "bg-primary/15 text-primary border border-primary/30"
                        : "text-foreground-muted hover:text-foreground hover:bg-surface-elevated"
                    }`}
                  >
                    {p}
                  </button>
                )
              )}

            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
