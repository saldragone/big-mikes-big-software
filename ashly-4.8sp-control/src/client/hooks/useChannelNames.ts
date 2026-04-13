/**
 * useChannelNames — Fetch and update custom channel nicknames from the DB.
 *
 * Returns an object mapping node index → display name.
 * Falls back to default labels if DB is unavailable.
 */

import { useState, useEffect, useCallback } from 'react';

const DEFAULT_NAMES: Record<number, string> = {
  0: 'A', 1: 'B', 2: 'C', 3: 'D',
  4: '1', 5: '2', 6: '3', 7: '4',
  8: '5', 9: '6', 10: '7', 11: '8',
};

export function useChannelNames() {
  const [names, setNames] = useState<Record<number, string>>({ ...DEFAULT_NAMES });

  useEffect(() => {
    fetch('/api/channel-names')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((rows: { node: number; name: string }[]) => {
        const map: Record<number, string> = { ...DEFAULT_NAMES };
        for (const row of rows) {
          map[row.node] = row.name;
        }
        setNames(map);
      })
      .catch(() => {}); // graceful fallback
  }, []);

  const renameChannel = useCallback(async (node: number, name: string) => {
    const trimmed = name.trim().slice(0, 20);
    if (!trimmed) return;

    // Optimistic update
    setNames(prev => ({ ...prev, [node]: trimmed }));

    try {
      const res = await fetch('/api/channel-names', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node, name: trimmed }),
      });
      if (res.ok) {
        const row = await res.json();
        setNames(prev => ({ ...prev, [row.node]: row.name }));
      }
    } catch {
      // DB save failure doesn't block the UI
    }
  }, []);

  // Convenience: get input labels (nodes 0-3) and output labels (nodes 4-11)
  const inputLabels = [names[0], names[1], names[2], names[3]];
  const outputLabels = [names[4], names[5], names[6], names[7], names[8], names[9], names[10], names[11]];

  return { names, inputLabels, outputLabels, renameChannel };
}
