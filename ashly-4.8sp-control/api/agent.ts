/**
 * Vercel serverless function: /api/agent
 *
 * POST /api/agent — Send a message to Little Mike
 *   Body: { sessionId?: string, message: string, deviceState?: object }
 *   Returns: { sessionId, response, toolCalls }
 *
 * Little Mike can:
 *   - Answer audio engineering questions
 *   - Suggest and return parameter changes as structured tool calls
 *   - Read/write presets from the database
 *   - Analyze the current device state
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const API_BASE = 'https://api.anthropic.com/v1';
const BETA_HEADER = 'managed-agents-2026-04-01';

// ── Agent & Environment IDs (cached after first creation) ────────────────────

let cachedAgentId: string | null = null;
let cachedEnvId: string | null = null;

// ── Custom tools for device control ──────────────────────────────────────────

const DEVICE_TOOLS = [
  {
    type: 'custom',
    name: 'set_gain',
    description: 'Set the gain (volume) for an input or output channel on the Ashly 4.8SP. Inputs are nodes 0-3 (A-D), outputs are nodes 4-11 (1-8). Gain range is -40 to +12 dB. Use this for level adjustments.',
    input_schema: {
      type: 'object',
      properties: {
        node: { type: 'number', description: 'Channel node: 0-3 for inputs (A-D), 4-11 for outputs (1-8)' },
        dB: { type: 'number', description: 'Gain in dB, range -40 to +12' },
      },
      required: ['node', 'dB'],
    },
  },
  {
    type: 'custom',
    name: 'set_mute',
    description: 'Mute or unmute an input or output channel. Inputs 0-3, outputs 4-11.',
    input_schema: {
      type: 'object',
      properties: {
        node: { type: 'number', description: 'Channel node: 0-3 for inputs, 4-11 for outputs' },
        muted: { type: 'boolean', description: 'true to mute, false to unmute' },
      },
      required: ['node', 'muted'],
    },
  },
  {
    type: 'custom',
    name: 'set_eq',
    description: 'Set a parametric EQ band. Inputs have 6 bands each (filter numbers 0-5 for input A, 6-11 for input B, etc). Outputs have 4 bands each. Filter types: 0=parametric, 1=low shelf 1st order, 2=low shelf 2nd order, 3=high shelf 1st order, 4=high shelf 2nd order.',
    input_schema: {
      type: 'object',
      properties: {
        filter: { type: 'number', description: 'Filter number (0-23 for inputs, 24-55 for outputs)' },
        freq: { type: 'number', description: 'Center frequency in Hz (20-20000)' },
        q: { type: 'number', description: 'Q factor (0.25-64)' },
        gain: { type: 'number', description: 'Gain in dB (-15 to +15)' },
        filterType: { type: 'number', description: '0=parametric, 1=lowShelf1, 2=lowShelf2, 3=highShelf1, 4=highShelf2' },
      },
      required: ['filter', 'freq', 'q', 'gain', 'filterType'],
    },
  },
  {
    type: 'custom',
    name: 'set_delay',
    description: 'Set the delay for an input or output channel in milliseconds. Range 0-682.64ms.',
    input_schema: {
      type: 'object',
      properties: {
        node: { type: 'number', description: 'Channel node: 0-3 for inputs, 4-11 for outputs' },
        ms: { type: 'number', description: 'Delay in milliseconds (0-682.64)' },
      },
      required: ['node', 'ms'],
    },
  },
  {
    type: 'custom',
    name: 'set_crossover',
    description: 'Set a crossover filter (HPF or LPF) on an output channel. Each output has a HPF (even filter num) and LPF (odd filter num). Filter types: 0=BW12, 1=Bessel12, 2=LR12, 3=BW18, 4=Bessel18, 5=BW24, 6=Bessel24, 7=LR24. Set freq to "off" to disable.',
    input_schema: {
      type: 'object',
      properties: {
        filter: { type: 'number', description: 'Crossover filter number (output_index*2 for HPF, output_index*2+1 for LPF)' },
        freq: { description: 'Frequency in Hz (20-20000) or "off" to disable', oneOf: [{ type: 'number' }, { type: 'string', enum: ['off'] }] },
        filterType: { type: 'number', description: '0-7 crossover filter type' },
      },
      required: ['filter', 'freq', 'filterType'],
    },
  },
  {
    type: 'custom',
    name: 'set_limiter',
    description: 'Set limiter parameters for an output channel (nodes 4-11).',
    input_schema: {
      type: 'object',
      properties: {
        node: { type: 'number', description: 'Output node (4-11)' },
        threshold: { type: 'number', description: 'Threshold in dBu (-20 to +20)' },
        ratio: { type: 'number', description: 'Ratio index (0-8): 1.2:1, 1.5:1, 2:1, 3:1, 4:1, 6:1, 10:1, 20:1, INF:1' },
        attack: { type: 'number', description: 'Attack index (0-6): 0.5, 1, 2, 5, 10, 20, 50 ms/dB' },
        release: { type: 'number', description: 'Release index (0-6): 10, 20, 50, 100, 200, 500, 1000 ms/dB' },
      },
      required: ['node', 'threshold', 'ratio', 'attack', 'release'],
    },
  },
  {
    type: 'custom',
    name: 'set_routing',
    description: 'Connect or disconnect an input to an output on the routing matrix.',
    input_schema: {
      type: 'object',
      properties: {
        output: { type: 'number', description: 'Output node (4-11)' },
        input: { type: 'number', description: 'Input index (0-3 for A-D)' },
        enabled: { type: 'boolean', description: 'true to connect, false to disconnect' },
      },
      required: ['output', 'input', 'enabled'],
    },
  },
  {
    type: 'custom',
    name: 'recall_preset',
    description: 'Recall a stored preset by index (0-29). This loads all parameters from that preset slot.',
    input_schema: {
      type: 'object',
      properties: {
        index: { type: 'number', description: 'Preset index (0-29)' },
      },
      required: ['index'],
    },
  },
  {
    type: 'custom',
    name: 'save_preset',
    description: 'Save the current device state to a preset slot with a name.',
    input_schema: {
      type: 'object',
      properties: {
        index: { type: 'number', description: 'Preset index (0-29)' },
        name: { type: 'string', description: 'Preset name (max 20 chars)' },
      },
      required: ['index', 'name'],
    },
  },
];

// ── Anthropic API helpers ────────────────────────────────────────────────────

async function anthropicFetch(path: string, body: object) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': BETA_HEADER,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${text}`);
  }
  return res.json();
}

async function anthropicGet(path: string) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'GET',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': BETA_HEADER,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Ensure agent exists with custom tools ────────────────────────────────────

async function ensureAgent(): Promise<string> {
  if (cachedAgentId) return cachedAgentId;

  // Try to find existing agent
  try {
    const list = await anthropicGet('/agents?limit=50');
    const existing = list.data?.find((a: any) => a.name === 'Little Mike');
    if (existing) {
      cachedAgentId = existing.id;
      return existing.id;
    }
  } catch {}

  // Create new agent with custom tools
  const agent = await anthropicFetch('/agents', {
    name: 'Little Mike',
    model: 'claude-sonnet-4-6',
    description: 'Live audio engineering agent for the Ashly Protea 4.8SP speaker processor.',
    system: `You are Little Mike, a live audio engineering assistant embedded in Big Mike's Big Software — a control application for the Ashly Protea 4.8SP speaker processor.

You have FULL control over the 4.8SP through custom tools. The processor has:
- 4 inputs (A, B, C, D) — nodes 0-3
- 8 outputs (1-8) — nodes 4-11
- Per-channel: gain (-40 to +12 dB), mute, delay (0-682ms)
- Input EQ: 6 parametric bands per input
- Output EQ: 4 parametric bands per output
- Output crossovers: HPF + LPF per output (BW/Bessel/LR, 12-24 dB/oct)
- Output limiters: threshold, ratio, attack, release
- 4×8 routing matrix
- 30 preset slots

When the user asks you to make changes, USE THE TOOLS to make them. Don't just describe what you'd do — actually do it. Be direct, fast, and confident like a seasoned audio engineer.

The user will provide the current device state with their message so you can see levels, EQ settings, routing, etc.

Common tasks:
- "Ring out" a frequency = cut a narrow EQ band at that frequency
- "Set up a 2-way crossover" = configure HPF/LPF on outputs
- "Gain stage" = set all inputs to reasonable levels, typically around 0 dB
- "Kill the feedback" = analyze and cut problematic frequencies
- "Save this as Sunday" = save current state to a preset

Be concise. You're working a live show — no time for essays.`,
    tools: [
      { type: 'agent_toolset_20260401' },
      ...DEVICE_TOOLS,
    ],
  });

  cachedAgentId = agent.id;
  return agent.id;
}

async function ensureEnvironment(): Promise<string> {
  if (cachedEnvId) return cachedEnvId;

  try {
    const list = await anthropicGet('/environments?limit=50');
    const existing = list.data?.find((e: any) => e.name === 'little-mike-env');
    if (existing) {
      cachedEnvId = existing.id;
      return existing.id;
    }
  } catch {}

  const env = await anthropicFetch('/environments', {
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

// ── Session management ───────────────────────────────────────────────────────

async function createSession(agentId: string, envId: string): Promise<string> {
  const session = await anthropicFetch('/sessions', {
    agent_id: agentId,
    environment_id: envId,
  });
  return session.id;
}

async function sendMessage(sessionId: string, message: string, deviceState?: any): Promise<any> {
  // Build the user message with device state context
  let fullMessage = message;
  if (deviceState) {
    fullMessage = `[Current Device State]\n${JSON.stringify(deviceState, null, 2)}\n\n[User Message]\n${message}`;
  }

  // Send user event
  const response = await anthropicFetch(`/sessions/${sessionId}/events`, {
    type: 'user',
    content: [{ type: 'text', text: fullMessage }],
  });

  return response;
}

// Collect events until the turn completes
async function collectResponse(sessionId: string): Promise<{ text: string; toolCalls: any[] }> {
  let text = '';
  const toolCalls: any[] = [];
  let attempts = 0;
  const maxAttempts = 30; // 30 seconds max

  while (attempts < maxAttempts) {
    attempts++;
    await new Promise(r => setTimeout(r, 1000));

    try {
      // Get session events
      const events = await anthropicGet(`/sessions/${sessionId}/events`);
      const allEvents = events.data || [];

      // Find the latest assistant events
      let foundEnd = false;
      for (const event of allEvents) {
        if (event.type === 'assistant') {
          // Extract text and tool calls from content blocks
          for (const block of (event.content || [])) {
            if (block.type === 'text') {
              text = block.text; // Take the latest text
            }
            if (block.type === 'tool_use' && !block.name?.startsWith('_')) {
              // Custom tool call — collect it
              const toolName = block.name;
              const toolInput = block.input;
              // Check if it's one of our device tools
              if (DEVICE_TOOLS.some(t => t.name === toolName)) {
                toolCalls.push({ name: toolName, input: toolInput, id: block.id });
              }
            }
          }
          if (event.stop_reason === 'end_turn' || event.stop_reason === 'tool_use') {
            foundEnd = true;
          }
        }
      }

      if (foundEnd) break;

      // Check session status
      const session = await anthropicGet(`/sessions/${sessionId}`);
      if (session.status === 'completed' || session.status === 'failed' || session.status === 'awaiting_input') {
        break;
      }
    } catch (err) {
      console.error('[agent] poll error:', err);
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

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  try {
    const { sessionId: existingSessionId, message, deviceState } = req.body as {
      sessionId?: string;
      message: string;
      deviceState?: any;
    };

    if (!message?.trim()) {
      return res.status(400).json({ error: 'message required' });
    }

    // Ensure agent and environment exist
    const [agentId, envId] = await Promise.all([
      ensureAgent(),
      ensureEnvironment(),
    ]);

    // Create or reuse session
    let sessionId = existingSessionId;
    if (!sessionId) {
      sessionId = await createSession(agentId, envId);
    }

    // Send the message
    await sendMessage(sessionId, message, deviceState);

    // Collect the response
    const { text, toolCalls } = await collectResponse(sessionId);

    // Send tool results back if there were custom tool calls
    // (The client will actually execute these and can report back)

    return res.json({
      sessionId,
      response: text || 'No response received. Try again.',
      toolCalls,
    });
  } catch (err: any) {
    console.error('[api/agent]', err);
    return res.status(500).json({ error: err.message || 'Agent error' });
  }
}
