/**
 * Fetches preset names from the /api/presets endpoint (works on both
 * the local Node.js server and the Vercel serverless function).
 * Returns the names array and a save function.
 */

import { useCallback, useEffect, useState } from 'react';

export interface PresetRecord {
  id: number;
  name: string;
  state: Record<string, any> | null;
}

export function usePresets() {
  const [presets, setPresets] = useState<PresetRecord[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/presets')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((rows: PresetRecord[]) => { setPresets(rows); setLoading(false); })
      .catch(() => { setLoading(false); }); // graceful no-DB fallback
  }, []);

  const savePreset = useCallback(async (
    id: number,
    name: string,
    state?: Record<string, any> | null,
  ) => {
    try {
      const res = await fetch('/api/presets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name, state }),
      });
      if (res.ok) {
        const row: PresetRecord = await res.json();
        setPresets(prev =>
          prev
            ? prev.map(p => p.id === id ? row : p)
            : [row],
        );
        return row;
      }
    } catch {
      // ignore — DB save failure doesn't block the serial write
    }
    return null;
  }, []);

  const presetNames = presets?.map(p => p.name) ?? null;
  return { presets, presetNames, loading, savePreset };
}
