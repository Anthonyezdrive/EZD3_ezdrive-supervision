import { createContext, useContext, useState, type ReactNode } from "react";
import type { B2BFilters } from "@/types/b2b";

interface B2BFilterState extends B2BFilters {
  setYear: (year: number) => void;
  setSites: (sites: string[]) => void;
  setBornes: (bornes: string[]) => void;
  setTokens: (tokens: string[]) => void;
  setSelectedClientId: (id: string | null) => void;
  resetFilters: () => void;
}

const currentYear = new Date().getFullYear();

const B2BFilterContext = createContext<B2BFilterState | undefined>(undefined);

export function B2BFilterProvider({ children }: { children: ReactNode }) {
  const [year, setYear] = useState(currentYear);
  const [sites, setSites] = useState<string[]>([]);
  const [bornes, setBornes] = useState<string[]>([]);
  const [tokens, setTokens] = useState<string[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  function resetFilters() {
    setYear(currentYear);
    setSites([]);
    setBornes([]);
    setTokens([]);
  }

  return (
    <B2BFilterContext.Provider
      value={{
        year,
        sites,
        bornes,
        tokens,
        selectedClientId,
        setYear,
        setSites,
        setBornes,
        setTokens,
        setSelectedClientId,
        resetFilters,
      }}
    >
      {children}
    </B2BFilterContext.Provider>
  );
}

export function useB2BFilters() {
  const ctx = useContext(B2BFilterContext);
  if (!ctx) throw new Error("useB2BFilters must be used within B2BFilterProvider");
  return ctx;
}
