// ============================================================
// EZDrive — Station Create/Edit Modal
// Uses admin-stations API (POST / PUT)
// ============================================================

import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Station, CPOOperator, Territory } from "@/types/station";

interface Props {
  station?: Station;
  cpos: CPOOperator[];
  territories: Territory[];
  onClose: () => void;
  onSaved: () => void;
}

export function StationFormModal({ station, cpos, territories, onClose, onSaved }: Props) {
  const isEdit = !!station;

  const [form, setForm] = useState({
    name: station?.name ?? "",
    address: station?.address ?? "",
    city: station?.city ?? "",
    postal_code: station?.postal_code ?? "",
    latitude: station?.latitude?.toString() ?? "",
    longitude: station?.longitude?.toString() ?? "",
    max_power_kw: station?.max_power_kw?.toString() ?? "",
    cpo_id: station?.cpo_id ?? "",
    territory_id: station?.territory_id ?? "",
    ocpp_identity: (station as any)?.ocpp_identity ?? "",
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateField(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Le nom est obligatoire"); return; }
    if (!form.city.trim()) { setError("La ville est obligatoire"); return; }

    setLoading(true);
    setError(null);

    const body: Record<string, unknown> = {
      name: form.name.trim(),
      city: form.city.trim(),
      address: form.address.trim() || null,
      postal_code: form.postal_code.trim() || null,
      latitude: form.latitude ? parseFloat(form.latitude) : null,
      longitude: form.longitude ? parseFloat(form.longitude) : null,
      max_power_kw: form.max_power_kw ? parseFloat(form.max_power_kw) : null,
      cpo_id: form.cpo_id || null,
      territory_id: form.territory_id || null,
      ocpp_identity: form.ocpp_identity.trim() || null,
    };

    try {
      if (isEdit) {
        const { error: updateError } = await supabase
          .from("stations")
          .update(body)
          .eq("id", station.id);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from("stations")
          .insert({
            ...body,
            source: "manual",
            ocpp_status: "Unknown",
            is_online: false,
            connectors: [],
          });
        if (insertError) {
          if (insertError.code === "23505") throw new Error("Une borne avec cet identifiant OCPP existe déjà");
          throw insertError;
        }
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }

  const inputClass = "w-full px-3 py-2 bg-surface-elevated border border-border rounded-xl text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-primary/50 transition-colors";

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-surface border border-border rounded-2xl w-full max-w-lg shadow-2xl">
          <div className="flex items-center justify-between p-5 border-b border-border">
            <h2 className="font-heading font-bold text-lg">
              {isEdit ? "Modifier la borne" : "Nouvelle borne"}
            </h2>
            <button onClick={onClose} className="p-1.5 hover:bg-surface-elevated rounded-lg transition-colors">
              <X className="w-5 h-5 text-foreground-muted" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto max-h-[70vh]">
            {/* Name */}
            <div>
              <label className="block text-xs text-foreground-muted mb-1.5">Nom *</label>
              <input type="text" value={form.name} onChange={(e) => updateField("name", e.target.value)}
                placeholder="Station EZDrive Guadeloupe" className={inputClass} />
            </div>

            {/* Address */}
            <div>
              <label className="block text-xs text-foreground-muted mb-1.5">Adresse</label>
              <input type="text" value={form.address} onChange={(e) => updateField("address", e.target.value)}
                placeholder="12 rue de la Paix" className={inputClass} />
            </div>

            {/* City + Postal */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-foreground-muted mb-1.5">Ville *</label>
                <input type="text" value={form.city} onChange={(e) => updateField("city", e.target.value)}
                  placeholder="Pointe-à-Pitre" className={inputClass} />
              </div>
              <div>
                <label className="block text-xs text-foreground-muted mb-1.5">Code postal</label>
                <input type="text" value={form.postal_code} onChange={(e) => updateField("postal_code", e.target.value)}
                  placeholder="97110" className={inputClass} />
              </div>
            </div>

            {/* GPS */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-foreground-muted mb-1.5">Latitude</label>
                <input type="number" step="any" value={form.latitude} onChange={(e) => updateField("latitude", e.target.value)}
                  placeholder="16.2650" className={inputClass} />
              </div>
              <div>
                <label className="block text-xs text-foreground-muted mb-1.5">Longitude</label>
                <input type="number" step="any" value={form.longitude} onChange={(e) => updateField("longitude", e.target.value)}
                  placeholder="-61.5510" className={inputClass} />
              </div>
            </div>

            {/* Power */}
            <div>
              <label className="block text-xs text-foreground-muted mb-1.5">Puissance max (kW)</label>
              <input type="number" step="any" value={form.max_power_kw} onChange={(e) => updateField("max_power_kw", e.target.value)}
                placeholder="22" className={inputClass} />
            </div>

            {/* CPO */}
            <div>
              <label className="block text-xs text-foreground-muted mb-1.5">CPO</label>
              <select value={form.cpo_id} onChange={(e) => updateField("cpo_id", e.target.value)} className={inputClass}>
                <option value="">— Non assigné —</option>
                {cpos.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {/* Territory */}
            <div>
              <label className="block text-xs text-foreground-muted mb-1.5">Territoire</label>
              <select value={form.territory_id} onChange={(e) => updateField("territory_id", e.target.value)} className={inputClass}>
                <option value="">— Non assigné —</option>
                {territories.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            {/* OCPP Identity */}
            <div>
              <label className="block text-xs text-foreground-muted mb-1.5">Identifiant OCPP</label>
              <input type="text" value={form.ocpp_identity} onChange={(e) => updateField("ocpp_identity", e.target.value)}
                placeholder="CP001" className={inputClass} />
            </div>

            {/* Error */}
            {error && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose}
                className="flex-1 py-2.5 border border-border rounded-xl text-sm text-foreground-muted hover:text-foreground transition-colors">
                Annuler
              </button>
              <button type="submit" disabled={loading}
                className="flex-1 py-2.5 bg-primary text-background rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {isEdit ? "Enregistrer" : "Créer la borne"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
