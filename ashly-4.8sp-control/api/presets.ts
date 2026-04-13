/**
 * Vercel serverless function: /api/presets
 *
 * GET  /api/presets        → all 30 presets
 * PUT  /api/presets        → upsert { id, name, state? }
 * POST /api/presets/init   → run schema init (call once on first deploy)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import pg from 'pg';

const { Pool } = pg;

// Lazy pool — one instance per serverless container lifetime
let pool: InstanceType<typeof Pool> | null = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 3,
    });
  }
  return pool;
}

async function q(text: string, params?: any[]) {
  const client = await getPool().connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

async function ensureSchema() {
  await q(`
    CREATE TABLE IF NOT EXISTS presets (
      id         INTEGER PRIMARY KEY CHECK (id >= 0 AND id <= 29),
      name       VARCHAR(20) NOT NULL DEFAULT '',
      state      JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await q(`
    INSERT INTO presets (id, name)
    SELECT g.n, 'Preset ' || (g.n + 1)
    FROM   generate_series(0, 29) AS g(n)
    ON CONFLICT (id) DO NOTHING
  `);
}

let schemaReady = false;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS for local dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  try {
    if (!schemaReady) { await ensureSchema(); schemaReady = true; }

    if (req.method === 'GET') {
      const result = await q('SELECT id, name, state, updated_at FROM presets ORDER BY id');
      return res.json(result.rows);
    }

    if (req.method === 'PUT') {
      const { id, name, state } = req.body as { id: number; name: string; state?: any };
      if (typeof id !== 'number' || id < 0 || id > 29) {
        return res.status(400).json({ error: 'id must be 0–29' });
      }
      const safeName = String(name ?? '').slice(0, 20);
      const result = await q(
        `INSERT INTO presets (id, name, state, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (id) DO UPDATE
           SET name       = EXCLUDED.name,
               state      = COALESCE(EXCLUDED.state, presets.state),
               updated_at = NOW()
         RETURNING id, name, state, updated_at`,
        [id, safeName, state ?? null],
      );
      return res.json(result.rows[0]);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    console.error('[api/presets]', err);
    return res.status(500).json({ error: err.message });
  }
}
