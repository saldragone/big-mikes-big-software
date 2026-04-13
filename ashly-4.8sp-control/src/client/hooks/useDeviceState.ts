/**
 * Device state hook — builds and maintains the full device state
 * from WebSocket messages.
 */

import { useEffect, useReducer, useRef } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MeterData {
  levels: { level_dBu: number; clipped: boolean }[];
  gainReduction: number[];
}

export interface GainInfo { node: number; gain_dB: number; gainRaw: number; }
export interface EQFilter {
  filterNum: number; freq: number; q: number; qByte: number;
  gain_dB: number; gainRaw: number; filterType: number;
}
export interface CrossoverFilter {
  filterNum: number; freq: number; freqValue: number;
  filterType: number; isOff: boolean;
}
export interface DelayInfo { node: number; ms: number; samples: number; }
export interface LimiterInfo {
  node: number; threshold_dBu: number; thresholdByte: number;
  ratio: number; attack: number; release: number; enabled?: boolean;
}
export interface StatusInfo {
  routing: number[];
  eqEnable: boolean[];
  limiterEnable: boolean[];
  polarity: boolean[];
  mute: boolean[];
}

export interface DeviceState {
  connected: boolean;
  port: string;
  deviceName: string;
  gains: GainInfo[];        // [0-11]
  eqFilters: EQFilter[];    // up to 56
  crossovers: CrossoverFilter[];  // 16
  delays: DelayInfo[];      // [0-11]
  limiters: LimiterInfo[];  // [0-7] outputs
  status: StatusInfo;
  presetNames: string[];    // [0-29]
  meters: MeterData;
}

const defaultStatus: StatusInfo = {
  routing: Array(8).fill(0),
  eqEnable: Array(12).fill(true),
  limiterEnable: Array(8).fill(false),
  polarity: Array(8).fill(false),
  mute: Array(12).fill(false),
};

export const defaultDeviceState: DeviceState = {
  connected: false,
  port: '',
  deviceName: 'Ashly 4.8SP',
  gains: [],
  eqFilters: [],
  crossovers: [],
  delays: [],
  limiters: [],
  status: defaultStatus,
  presetNames: Array(30).fill('').map((_, i) => `Preset ${i + 1}`),
  meters: { levels: [], gainReduction: [] },
};

// ─── Reducer ──────────────────────────────────────────────────────────────────

type Action =
  | { type: 'WS_MESSAGE'; payload: any }
  | { type: 'OPTIMISTIC_GAIN'; node: number; gain_dB: number }
  | { type: 'OPTIMISTIC_MUTE'; node: number; muted: boolean }
  | { type: 'OPTIMISTIC_EQ'; filter: EQFilter }
  | { type: 'OPTIMISTIC_DELAY'; node: number; ms: number }
  | { type: 'OPTIMISTIC_SOURCE'; output: number; input: number; enabled: boolean }
  | { type: 'OPTIMISTIC_PRESET_NAME'; index: number; name: string };

function reducer(state: DeviceState, action: Action): DeviceState {
  switch (action.type) {

    case 'WS_MESSAGE': {
      const msg = action.payload;
      switch (msg.type) {

        case 'connectionStatus':
          return { ...state, connected: msg.connected, port: msg.port ?? '' };

        case 'state': {
          const next = { ...state };
          if (msg.gains)      next.gains      = msg.gains;
          if (msg.eqFilters)  next.eqFilters  = msg.eqFilters;
          if (msg.crossovers) next.crossovers = msg.crossovers;
          if (msg.delays)     next.delays     = msg.delays;
          if (msg.limiters)   next.limiters   = msg.limiters;
          if (msg.status)     next.status     = msg.status;
          if (msg.presetNames) next.presetNames = msg.presetNames;
          if (msg.deviceName)  next.deviceName  = msg.deviceName;
          return next;
        }

        case 'meters':
          return {
            ...state,
            meters: {
              levels:       msg.levels ?? state.meters.levels,
              gainReduction: msg.gainReduction ?? state.meters.gainReduction,
            },
          };

        case 'localChange':
          // Apply local changes from the front panel
          return applyLocalChange(state, msg);

        default:
          return state;
      }
    }

    case 'OPTIMISTIC_GAIN': {
      const gains = state.gains.map(g =>
        g.node === action.node
          ? { ...g, gain_dB: action.gain_dB, gainRaw: Math.round(8192 + action.gain_dB * 10) }
          : g,
      );
      return { ...state, gains };
    }

    case 'OPTIMISTIC_MUTE': {
      const mute = [...state.status.mute];
      mute[action.node] = action.muted;
      return { ...state, status: { ...state.status, mute } };
    }

    case 'OPTIMISTIC_EQ': {
      const idx = state.eqFilters.findIndex(f => f.filterNum === action.filter.filterNum);
      const eqFilters = idx >= 0
        ? state.eqFilters.map((f, i) => (i === idx ? action.filter : f))
        : [...state.eqFilters, action.filter];
      return { ...state, eqFilters };
    }

    case 'OPTIMISTIC_DELAY': {
      const delays = state.delays.map(d =>
        d.node === action.node ? { ...d, ms: action.ms } : d,
      );
      return { ...state, delays };
    }

    case 'OPTIMISTIC_SOURCE': {
      const routing = [...state.status.routing];
      const outIdx  = action.output - 4; // node 4-11 → index 0-7
      if (outIdx >= 0 && outIdx < 8) {
        const bit = 1 << action.input;
        routing[outIdx] = action.enabled
          ? routing[outIdx] | bit
          : routing[outIdx] & ~bit;
      }
      return { ...state, status: { ...state.status, routing } };
    }

    case 'OPTIMISTIC_PRESET_NAME': {
      const presetNames = [...state.presetNames];
      presetNames[action.index] = action.name;
      return { ...state, presetNames };
    }

    default:
      return state;
  }
}

function applyLocalChange(state: DeviceState, msg: any): DeviceState {
  // msg.msgType, msg.payload (array of bytes)
  // Delegate to protocol parsers via type mapping
  return state; // Local changes arrive via stateUpdate after data request refresh
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useDeviceState(lastMessage: MessageEvent | null) {
  const [state, dispatch] = useReducer(reducer, defaultDeviceState);
  const lastRef = useRef<MessageEvent | null>(null);

  useEffect(() => {
    if (!lastMessage || lastMessage === lastRef.current) return;
    lastRef.current = lastMessage;
    try {
      const parsed = JSON.parse(lastMessage.data);
      dispatch({ type: 'WS_MESSAGE', payload: parsed });
    } catch {
      // ignore malformed messages
    }
  }, [lastMessage]);

  const optimistic = {
    setGain:      (node: number, gain_dB: number) => dispatch({ type: 'OPTIMISTIC_GAIN', node, gain_dB }),
    setMute:      (node: number, muted: boolean)  => dispatch({ type: 'OPTIMISTIC_MUTE', node, muted }),
    setEQ:        (filter: EQFilter)              => dispatch({ type: 'OPTIMISTIC_EQ', filter }),
    setDelay:     (node: number, ms: number)      => dispatch({ type: 'OPTIMISTIC_DELAY', node, ms }),
    setSource:    (output: number, input: number, enabled: boolean) =>
                    dispatch({ type: 'OPTIMISTIC_SOURCE', output, input, enabled }),
    setPresetName:(index: number, name: string)   => dispatch({ type: 'OPTIMISTIC_PRESET_NAME', index, name }),
  };

  return { state, optimistic };
}
