import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface MultiSelectDropdownProps {
  label: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  maxDisplay?: number;
}

export function MultiSelectDropdown({
  label,
  options,
  selected,
  onChange,
  placeholder = "Tous",
  maxDisplay = 2,
}: MultiSelectDropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filtered = search
    ? options.filter((o) => o.toLowerCase().includes(search.toLowerCase()))
    : options;

  function toggle(option: string) {
    if (selected.includes(option)) {
      onChange(selected.filter((s) => s !== option));
    } else {
      onChange([...selected, option]);
    }
  }

  function selectAll() {
    onChange(selected.length === options.length ? [] : [...options]);
  }

  const displayText =
    selected.length === 0
      ? placeholder
      : selected.length <= maxDisplay
        ? selected.join(", ")
        : `${selected.length} sélectionnés`;

  return (
    <div ref={ref} className="relative">
      <label className="block text-[10px] text-foreground-muted uppercase tracking-wider mb-1">
        {label}
      </label>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center justify-between gap-2 w-full min-w-[160px] px-3 py-2",
          "bg-surface-elevated border border-border rounded-xl text-sm text-foreground",
          "hover:border-border-focus transition-colors",
          open && "border-border-focus"
        )}
      >
        <span className="truncate text-left">{displayText}</span>
        <ChevronDown
          className={cn("w-3.5 h-3.5 shrink-0 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[220px] bg-surface-elevated border border-border rounded-xl shadow-lg overflow-hidden">
          {/* Search */}
          {options.length > 8 && (
            <div className="p-2 border-b border-border">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher..."
                className="w-full px-2.5 py-1.5 text-sm bg-surface border border-border rounded-lg text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-border-focus"
                autoFocus
              />
            </div>
          )}

          {/* Select all */}
          <button
            onClick={selectAll}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-foreground-muted hover:bg-surface hover:text-foreground transition-colors border-b border-border"
          >
            <div
              className={cn(
                "w-4 h-4 rounded border flex items-center justify-center shrink-0",
                selected.length === options.length
                  ? "bg-primary border-primary"
                  : "border-border"
              )}
            >
              {selected.length === options.length && (
                <Check className="w-3 h-3 text-background" />
              )}
            </div>
            <span>{selected.length === options.length ? "Tout désélectionner" : "Tout sélectionner"}</span>
          </button>

          {/* Options */}
          <div className="max-h-[240px] overflow-y-auto custom-scrollbar">
            {filtered.map((option) => (
              <button
                key={option}
                onClick={() => toggle(option)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-surface transition-colors"
              >
                <div
                  className={cn(
                    "w-4 h-4 rounded border flex items-center justify-center shrink-0",
                    selected.includes(option)
                      ? "bg-primary border-primary"
                      : "border-border"
                  )}
                >
                  {selected.includes(option) && (
                    <Check className="w-3 h-3 text-background" />
                  )}
                </div>
                <span className="truncate">{option}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-sm text-foreground-muted">Aucun résultat</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
