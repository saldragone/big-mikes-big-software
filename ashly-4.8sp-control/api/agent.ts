/**
 * Vercel serverless function: /api/agent
 *
 * POST /api/agent — Send a message to Little Mike
 *   Body: { sessionId?: string, message: string, deviceState?: object }
 *   Returns: { sessionId, response, toolCalls }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const API_BASE = 'https://api.anthropic.com/v1';
const BETA_HEADER = 'managed-agents-2026-04-01';

let cachedAgentId: string | null = null;
let cachedEnvId: string | null = null;

// ── Custom tools ─────────────────────────────────────────────────────────────

const DEVICE_TOOLS = [
  {
    type: 'custom' as const,
    name: 'set_gain',
    description: 'Set the gain (volume) for an input or output channel on the Ashly 4.8SP. Inputs are nodes 0-3 (A-D), outputs are nodes 4-11 (1-8). Gain range is -40 to +12 dB.',
    input_schema: { type: 'object', properties: { node: { type: 'number' }, dB: { type: 'number' } }, required: ['node', 'dB'] },
  },
  {
    type: 'custom' as const,
    name: 'set_mute',
    description: 'Mute or unmute an input or output channel. Inputs 0-3, outputs 4-11.',
    input_schema: { type: 'object', properties: { node: { type: 'number' }, muted: { type: 'boolean' } }, required: ['node', 'muted'] },
  },
  {
    type: 'custom' as const,
    name: 'set_eq',
    description: 'Set a parametric EQ band. Filter types: 0=parametric, 1=low shelf 1st, 2=low shelf 2nd, 3=high shelf 1st, 4=high shelf 2nd. Freq 20-20000Hz, Q 0.25-64, gain -15 to +15 dB.',
    input_schema: { type: 'object', properties: { filter: { type: 'number' }, freq: { type: 'number' }, q: { type: 'number' }, gain: { type: 'number' }, filterType: { type: 'number' } }, required: ['filter', 'freq', 'q', 'gain', 'filterType'] },
  },
  {
    type: 'custom' as const,
    name: 'set_delay',
    description: 'Set delay in ms (0-682.64) for an input or output channel.',
    input_schema: { type: 'object', properties: { node: { type: 'number' }, ms: { type: 'number' } }, required: ['node', 'ms'] },
  },
  {
    type: 'custom' as const,
    name: 'set_crossover',
    description: 'Set crossover HPF/LPF on an output. Filter types: 0=BW12, 1=Bessel12, 2=LR12, 3=BW18, 4=Bessel18, 5=BW24, 6=Bessel24, 7=LR24. Use freq "off" to disable.',
    input_schema: { type: 'object', properties: { filter: { type: 'number' }, freq: { type: 'number' }, filterType: { type: 'number' } }, required: ['filter', 'freq', 'filterType'] },
  },
  {
    type: 'custom' as const,
    name: 'set_limiter',
    description: 'Set limiter on an output channel (nodes 4-11). Threshold -20 to +20 dBu, ratio index 0-8, attack index 0-6, release index 0-6.',
    input_schema: { type: 'object', properties: { node: { type: 'number' }, threshold: { type: 'number' }, ratio: { type: 'number' }, attack: { type: 'number' }, release: { type: 'number' } }, required: ['node', 'threshold', 'ratio', 'attack', 'release'] },
  },
  {
    type: 'custom' as const,
    name: 'set_routing',
    description: 'Connect/disconnect an input to an output on the routing matrix.',
    input_schema: { type: 'object', properties: { output: { type: 'number' }, input: { type: 'number' }, enabled: { type: 'boolean' } }, required: ['output', 'input', 'enabled'] },
  },
  {
    type: 'custom' as const,
    name: 'recall_preset',
    description: 'Recall a stored preset by index (0-29).',
    input_schema: { type: 'object', properties: { index: { type: 'number' } }, required: ['index'] },
  },
  {
    type: 'custom' as const,
    name: 'save_preset',
    description: 'Save current state to a preset slot with a name.',
    input_schema: { type: 'object', properties: { index: { type: 'number' }, name: { type: 'string' } }, required: ['index', 'name'] },
  },
];

const TOOL_NAMES = new Set(DEVICE_TOOLS.map(t => t.name));

// ── API helpers ──────────────────────────────────────────────────────────────

async function apiFetch(path: string, method: string, body?: object) {
  const opts: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': BETA_HEADER,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Ensure agent exists ──────────────────────────────────────────────────────

async function ensureAgent(): Promise<string> {
  if (cachedAgentId) return cachedAgentId;

  try {
    const list = await apiFetch('/agents?limit=50', 'GET');
    const existing = list.data?.find((a: any) => a.name === 'Little Mike v2');
    if (existing) { cachedAgentId = existing.id; return existing.id; }
  } catch {}

  const agent = await apiFetch('/agents', 'POST', {
    name: 'Little Mike v2',
    model: 'claude-sonnet-4-6',
    description: 'Live audio engineering agent for the Ashly Protea 4.8SP.',
    system: `You are Little Mike, a live audio engineering assistant embedded in Big Mike's Big Software — a control application for the Ashly Protea 4.8SP speaker processor.

You have FULL control over the 4.8SP through custom tools. The processor has:
- 4 inputs (A, B, C, D) — nodes 0-3
- 8 outputs (1-8) — nodes 4-11
- Per-channel: gain (-40 to +12 dB), mute, delay (0-682ms)
- Input EQ: 6 parametric bands per input
- Output EQ: 4 parametric bands per output
- Output crossovers: HPF + LPF per output (BW/Bessel/LR, 12-24 dB/oct)
- Output limiters: threshold, ratio, attack, release
- 4x8 routing matrix
- 30 preset slots

When the user asks you to make changes, USE THE TOOLS. Don't just describe — do it. Be direct, fast, and confident like a seasoned live sound engineer.

The user will provide the current device state with each message, including custom channel names. Users can nickname channels (e.g. "Vocals", "Kick", "Subs") — when they refer to a channel by its nickname, match it to the correct node number using the channelNames/channelNamesSummary in the device state.

Be concise — you're working a live show.`,
    tools: [
      {
        type: 'agent_toolset_20260401',
        default_config: { enabled: false },
        configs: [],
      },
      ...DEVICE_TOOLS,
    ],
  });

  cachedAgentId = agent.id;
  return agent.id;
}

async function ensureEnvironment(): Promise<string> {
  if (cachedEnvId) return cachedEnvId;

  try {
    const list = await apiFetch('/environments?limit=50', 'GET');
    const existing = list.data?.find((e: any) => e.name === 'little-mike-env');
    if (existing) { cachedEnvId = existing.id; return existing.id; }
  } catch {}

  const env = await apiFetch('/environments', 'POST', {
    name: 'little-mike-env',
    description: 'Little Mike audio agent environment',
    config: {
      type: 'cloud',
      packages: { pip: [], npm: [], apt: [], cargo: [], gem: [], go: [] },
      networking: { type: 'unrestricted' },
    },
  });

  cachedEnvId = env.id;
  return env.id;
}

// ── Session + event loop ─────────────────────────────────────────────────────

async function createSession(agentId: string, envId: string): Promise<string> {
  const session = await apiFetch('/sessions', 'POST', {
    agent: agentId,
    environment_id: envId,
  });
  return session.id;
}

async function sendUserMessage(sessionId: string, text: string) {
  return apiFetch(`/sessions/${sessionId}/events`, 'POST', {
    events: [{
      type: 'user.message',
      content: [{ type: 'text', text }],
    }],
  });
}

async function sendToolResult(sessionId: string, toolUseEventId: string, resultText: string) {
  return apiFetch(`/sessions/${sessionId}/events`, 'POST', {
    events: [{
      type: 'user.custom_tool_result',
      custom_tool_use_id: toolUseEventId,
      content: [{ type: 'text', text: resultText }],
    }],
  });
}

/**
 * Poll session events until we get a final response.
 * Handles the custom tool call loop:
 *   1. Agent calls custom tool → session goes idle with requires_action
 *   2. We send tool result back
 *   3. Agent continues until end_turn
 */
async function runUntilComplete(
  sessionId: string,
  maxIterations = 30,
): Promise<{ text: string; toolCalls: { name: string; input: any }[] }> {
  let text = '';
  const toolCalls: { name: string; input: any }[] = [];
  const processedEvents = new Set<string>();

  for (let i = 0; i < maxIterations; i++) {
    await new Promise(r => setTimeout(r, 1500));

    // Get all events
    const eventsRes = await apiFetch(`/sessions/${sessionId}/events?order=asc`, 'GET');
    const events = eventsRes.data || [];

    // Process new events
    const pendingToolResults: { eventId: string; name: string; input: any }[] = [];

    for (const evt of events) {
      if (processedEvents.has(evt.id)) continue;
      processedEvents.add(evt.id);

      if (evt.type === 'agent.message') {
        for (const block of (evt.content || [])) {
          if (block.type === 'text') {
            text = block.text; // Take latest text
          }
        }
      }

      if (evt.type === 'agent.custom_tool_use') {
        const toolName = evt.name;
        const toolInput = evt.input;
        if (TOOL_NAMES.has(toolName)) {
          toolCalls.push({ name: toolName, input: toolInput });
          pendingToolResults.push({ eventId: evt.id, name: toolName, input: toolInput });
        }
      }
    }

    // Send tool results for any custom tool calls
    for (const tr of pendingToolResults) {
      // We acknowledge the tool call — the CLIENT will actually execute it
      const resultText = JSON.stringify({
        success: true,
        message: `${tr.name} executed with params: ${JSON.stringify(tr.input)}. Applied to device.`,
      });
      await sendToolResult(sessionId, tr.eventId, resultText);
    }

    // Check if session is idle with end_turn
    const lastSessionEvent = [...events].reverse().find(
      (e: any) => e.type === 'session.status_idle'
    );
    if (lastSessionEvent) {
      const stopReason = lastSessionEvent.stop_reason;
      if (stopReason === 'end_turn' || stopReason?.type === 'end_turn') {
        break;
      }
      // If requires_action, we already sent tool results above, keep looping
      if (stopReason === 'requires_action' || stopReason?.type === 'requires_action') {
        continue;
      }
    }

    // Check for terminal states
    const terminated = events.find((e: any) => e.type === 'session.status_terminated');
    if (terminated) {
      text = text || 'Session terminated unexpectedly.';
      break;
    }
  }

  return { text, toolCalls };
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  try {
    const { sessionId: existingSessionId, message, deviceState } = req.body as {
      sessionId?: string; message: string; deviceState?: any;
    };

    if (!message?.trim()) return res.status(400).json({ error: 'message required' });

    // Ensure agent + environment
    const [agentId, envId] = await Promise.all([ensureAgent(), ensureEnvironment()]);

    // Create or reuse session
    let sessionId = existingSessionId;
    if (!sessionId) {
      sessionId = await createSession(agentId, envId);
    }

    // Build message with device state context
    let fullMessage = message;
    if (deviceState) {
      fullMessage = `[Current Device State]\n${JSON.stringify(deviceState, null, 2)}\n\n[User]\n${message}`;
    }

    // Send user message
    await sendUserMessage(sessionId, fullMessage);

    // Run until complete (handles tool call loop)
    const { text, toolCalls } = await runUntilComplete(sessionId);

    return res.json({
      sessionId,
      response: text || 'Processing... try sending another message.',
      toolCalls,
    });
  } catch (err: any) {
    console.error('[api/agent]', err);
    return res.status(500).json({ error: err.message || 'Agent error' });
  }
}
