/**
 * Ashly 4.8SP Control — Node.js backend
 * Serves the React client and bridges WebSocket ↔ serial port.
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { SerialManager } from '../lib/serial-manager.js';
import {
  setGain, setEQ, setDelay, setCrossover, setLimiter,
  setMute, setSource, recallPreset, savePreset, gainIncDec,
  dataRequest, presetNamesRequest, deviceNameRequest,
} from '../lib/ashly-protocol.js';
import { MSG } from '../lib/constants.js';
import { initSchema, getAllPresets, upsertPreset } from '../db/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const CLIENT_DIST = path.resolve(__dirname, '../../dist/client');

// ─── App setup ────────────────────────────────────────────────────────────────

const app  = express();
const http = createServer(app);
const wss  = new WebSocketServer({ server: http, path: '/ws' });
const mgr  = new SerialManager();

app.use(express.json());

// Serve built React client (production)
app.use(express.static(CLIENT_DIST));

// ─── REST endpoints ───────────────────────────────────────────────────────────

app.get('/api/ports', async (_req, res) => {
  try {
    const ports = await mgr.listPorts();
    res.json(ports);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/status', (_req, res) => {
  res.json({ connected: mgr.isConnected(), port: mgr.getPort() });
});

// ─── Preset DB API (mirrors the Vercel serverless function) ───────────────────
app.get('/api/presets', async (_req, res) => {
  try {
    const presets = await getAllPresets();
    res.json(presets);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.put('/api/presets', async (req, res) => {
  try {
    const { id, name, state } = req.body as { id: number; name: string; state?: any };
    if (typeof id !== 'number' || id < 0 || id > 29) {
      res.status(400).json({ error: 'id must be 0–29' }); return;
    }
    const row = await upsertPreset(id, String(name ?? '').slice(0, 20), state);
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// SPA fallback
app.get('*', (_req, res) => {
  const indexPath = path.join(CLIENT_DIST, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) res.status(404).send('Not found — run `npm run build` first or use the Vite dev server.');
  });
});

// ─── WebSocket broadcast ──────────────────────────────────────────────────────

function broadcast(obj: object): void {
  const payload = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

// ─── Serial event → WebSocket ─────────────────────────────────────────────────

mgr.on('connected', (port) => {
  broadcast({ type: 'connectionStatus', connected: true, port });
  // Request initial state and preset names
  mgr.send(dataRequest()).catch(console.error);
  mgr.send(presetNamesRequest()).catch(console.error);
  mgr.send(deviceNameRequest()).catch(console.error);
});

mgr.on('disconnected', (reason) => {
  broadcast({ type: 'connectionStatus', connected: false, port: '', reason });
});

mgr.on('meterUpdate', (data) => {
  broadcast({ type: 'meters', ...data });
});

mgr.on('stateUpdate', (state) => {
  broadcast({ type: 'state', ...state });
});

mgr.on('localChange', (msg) => {
  broadcast({ type: 'localChange', msgType: msg.type, payload: Array.from(msg.payload) });
});

mgr.on('error', (err) => {
  console.error('[serial]', err);
  broadcast({ type: 'error', message: err.message });
});

// ─── WebSocket → Serial ───────────────────────────────────────────────────────

wss.on('connection', (ws) => {
  console.log('[ws] client connected');

  // Send current connection status on connect
  ws.send(JSON.stringify({
    type: 'connectionStatus',
    connected: mgr.isConnected(),
    port: mgr.getPort(),
  }));

  ws.on('message', async (raw) => {
    let msg: Record<string, any>;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }

    try {
      await handleClientMessage(msg, ws);
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: String(err) }));
    }
  });

  ws.on('close', () => console.log('[ws] client disconnected'));
  ws.on('error', (e) => console.error('[ws] error', e));
});

async function handleClientMessage(msg: Record<string, any>, ws: WebSocket): Promise<void> {
  switch (msg.type) {

    case 'connect': {
      const port = String(msg.port ?? '');
      if (!port) throw new Error('port required');
      await mgr.connect(port);
      break;
    }

    case 'disconnect':
      await mgr.disconnect();
      break;

    case 'requestState':
      if (!mgr.isConnected()) throw new Error('Not connected');
      await mgr.send(dataRequest());
      await mgr.send(presetNamesRequest());
      break;

    case 'setGain': {
      const { node, dB } = assertFields(msg, ['node', 'dB']);
      await mgr.send(setGain(Number(node), Number(dB)), true);
      break;
    }

    case 'setEQ': {
      const { filter, freq, q, gain, filterType } = assertFields(msg, ['filter', 'freq', 'q', 'gain', 'filterType']);
      await mgr.send(setEQ(Number(filter), Number(freq), Number(q), Number(gain), Number(filterType)), true);
      break;
    }

    case 'setDelay': {
      const { node, ms } = assertFields(msg, ['node', 'ms']);
      await mgr.send(setDelay(Number(node), Number(ms)), true);
      break;
    }

    case 'setCrossover': {
      const { filter, freq, filterType } = assertFields(msg, ['filter', 'freq', 'filterType']);
      const isLPF = (Number(filter) % 2) === 1;
      await mgr.send(setCrossover(Number(filter), freq === 'off' ? 'off' : Number(freq), Number(filterType), isLPF), true);
      break;
    }

    case 'setLimiter': {
      const { node, threshold, ratio, attack, release } = assertFields(msg, ['node', 'threshold', 'ratio', 'attack', 'release']);
      await mgr.send(setLimiter(Number(node), Number(threshold), Number(ratio), Number(attack), Number(release)), true);
      break;
    }

    case 'mute': {
      const { node, muted } = assertFields(msg, ['node', 'muted']);
      await mgr.send(setMute(Number(node), Boolean(muted)), true);
      break;
    }

    case 'setSource': {
      const { output, input, enabled } = assertFields(msg, ['output', 'input', 'enabled']);
      await mgr.send(setSource(Number(output), Number(input), Boolean(enabled)), true);
      break;
    }

    case 'recallPreset': {
      const { index } = assertFields(msg, ['index']);
      await mgr.send(recallPreset(Number(index), Boolean(msg.muteOutputs ?? false)), true);
      break;
    }

    case 'savePreset': {
      const { index, name } = assertFields(msg, ['index', 'name']);
      await mgr.send(savePreset(Number(index), String(name)), true);
      // Mirror to DB (non-blocking, best-effort)
      upsertPreset(Number(index), String(name), msg.state ?? null).catch(console.error);
      break;
    }

    case 'gainIncDec': {
      const { node, increment, amount } = assertFields(msg, ['node', 'increment', 'amount']);
      await mgr.send(gainIncDec(Number(node), Boolean(increment), Number(amount)), true);
      break;
    }

    case 'getPorts': {
      const ports = await mgr.listPorts();
      ws.send(JSON.stringify({ type: 'portList', ports }));
      break;
    }

    default:
      throw new Error(`Unknown message type: ${msg.type}`);
  }
}

function assertFields<T extends Record<string, any>>(msg: T, fields: string[]): T {
  for (const f of fields) {
    if (!(f in msg)) throw new Error(`Missing field: ${f}`);
  }
  return msg;
}

// ─── Start ────────────────────────────────────────────────────────────────────

http.listen(PORT, async () => {
  console.log(`\n  Ashly 4.8SP Control Server`);
  console.log(`  → http://localhost:${PORT}`);
  console.log(`  → WebSocket: ws://localhost:${PORT}/ws\n`);

  // Init DB schema (non-fatal if DATABASE_URL not set locally)
  if (process.env.DATABASE_URL) {
    try {
      await initSchema();
      console.log('  → DB: schema ready');
    } catch (err) {
      console.warn('  → DB: schema init failed (continuing without DB)', err);
    }
  } else {
    console.log('  → DB: DATABASE_URL not set, running without DB');
  }
});

process.on('SIGINT', async () => {
  await mgr.disconnect();
  process.exit(0);
});
