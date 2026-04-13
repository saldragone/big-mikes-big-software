/**
 * Vercel serverless function: /api/channel-names
 *
 * GET  → all 12 channel names
 * PUT  → upsert { node, name }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import pg from 'pg';

const { Pool } = pg;

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

let schemaReady = false;

async function ensureSchema() {
  await q(`
    CREATE TABLE IF NOT EXISTS channel_names (
      node       INTEGER PRIMARY KEY CHECK (node >= 0 AND node <= 11),
      name       VARCHAR(20) NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await q(`
    INSERT INTO channel_names (node, name) VALUES
      (0, 'A'), (1, 'B'), (2, 'C'), (3, 'D'),
      (4, '1'), (5, '2'), (6, '3'), (7, '4'),
      (8, '5'), (9, '6'), (10, '7'), (11, '8')
    ON CONFLICT (node) DO NOTHING
  `);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  try {
    if (!schemaReady) { await ensureSchema(); schemaReady = true; }

    if (req.method === 'GET') {
      const result = await q('SELECT node, name, updated_at FROM channel_names ORDER BY node');
      return res.json(result.rows);
    }

    if (req.method === 'PUT') {
      const { node, name } = req.body as { node: number; name: string };
      if (typeof node !== 'number' || node < 0 || node > 11) {
        return res.status(400).json({ error: 'node must be 0–11' });
      }
      const result = await q(
        `INSERT INTO channel_names (node, name, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (node) DO UPDATE
           SET name = EXCLUDED.name, updated_at = NOW()
         RETURNING node, name, updated_at`,
        [node, String(name ?? '').slice(0, 20)],
      );
      return res.json(result.rows[0]);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    console.error('[api/channel-names]', err);
    return res.status(500).json({ error: err.message });
  }
}
