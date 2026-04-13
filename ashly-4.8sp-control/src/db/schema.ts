/**
 * Database schema init — idempotent, safe to run on every cold start.
 */

import { query } from './client.js';

export async function initSchema(): Promise<void> {
  // Presets table: mirrors the 30 slots on the 4.8SP.
  await query(`
    CREATE TABLE IF NOT EXISTS presets (
      id          INTEGER PRIMARY KEY CHECK (id >= 0 AND id <= 29),
      name        VARCHAR(20)  NOT NULL DEFAULT '',
      state       JSONB,
      updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    INSERT INTO presets (id, name)
    SELECT g.n, 'Preset ' || (g.n + 1)
    FROM   generate_series(0, 29) AS g(n)
    ON CONFLICT (id) DO NOTHING
  `);

  // Channel names table: custom nicknames for inputs (0-3) and outputs (4-11).
  await query(`
    CREATE TABLE IF NOT EXISTS channel_names (
      node        INTEGER PRIMARY KEY CHECK (node >= 0 AND node <= 11),
      name        VARCHAR(20)  NOT NULL DEFAULT '',
      updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

  // Seed with default names
  await query(`
    INSERT INTO channel_names (node, name) VALUES
      (0, 'A'), (1, 'B'), (2, 'C'), (3, 'D'),
      (4, '1'), (5, '2'), (6, '3'), (7, '4'),
      (8, '5'), (9, '6'), (10, '7'), (11, '8')
    ON CONFLICT (node) DO NOTHING
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

// ── Channel names ────────────────────────────────────────────────────────────

export interface ChannelNameRow {
  node: number;
  name: string;
  updated_at: string;
}

export async function getAllChannelNames(): Promise<ChannelNameRow[]> {
  const res = await query<ChannelNameRow>(
    'SELECT node, name, updated_at FROM channel_names ORDER BY node',
  );
  return res.rows;
}

export async function upsertChannelName(
  node: number,
  name: string,
): Promise<ChannelNameRow> {
  const res = await query<ChannelNameRow>(
    `INSERT INTO channel_names (node, name, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (node) DO UPDATE
       SET name = EXCLUDED.name, updated_at = NOW()
     RETURNING node, name, updated_at`,
    [node, name.slice(0, 20)],
  );
  return res.rows[0];
}

// ── Presets ───────────────────────────────────────────────────────────────────

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
