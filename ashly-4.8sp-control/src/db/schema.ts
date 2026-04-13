/**
 * Database schema init — idempotent, safe to run on every cold start.
 */

import { query } from './client.js';

export async function initSchema(): Promise<void> {
  // Presets table: mirrors the 30 slots on the 4.8SP.
  // `state` column stores a JSON backup of the full DSP parameters for that slot.
  await query(`
    CREATE TABLE IF NOT EXISTS presets (
      id          INTEGER PRIMARY KEY CHECK (id >= 0 AND id <= 29),
      name        VARCHAR(20)  NOT NULL DEFAULT '',
      state       JSONB,
      updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

  // Seed empty rows for all 30 slots if the table is fresh
  await query(`
    INSERT INTO presets (id, name)
    SELECT g.n, 'Preset ' || (g.n + 1)
    FROM   generate_series(0, 29) AS g(n)
    ON CONFLICT (id) DO NOTHING
  `);
}

export interface PresetRow {
  id: number;
  name: string;
  state: Record<string, any> | null;
  updated_at: string;
}

export async function getAllPresets(): Promise<PresetRow[]> {
  const res = await query<PresetRow>(
    'SELECT id, name, state, updated_at FROM presets ORDER BY id',
  );
  return res.rows;
}

export async function upsertPreset(
  id: number,
  name: string,
  state?: Record<string, any> | null,
): Promise<PresetRow> {
  const res = await query<PresetRow>(
    `INSERT INTO presets (id, name, state, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE
       SET name       = EXCLUDED.name,
           state      = COALESCE(EXCLUDED.state, presets.state),
           updated_at = NOW()
     RETURNING id, name, state, updated_at`,
    [id, name.slice(0, 20), state ?? null],
  );
  return res.rows[0];
}
