/**
 * Demo mode hook — provides a fake WebSocket-like interface that simulates
 * the Ashly 4.8SP device for Vercel preview deployments.
 *
 * Activated when VITE_DEMO_MODE=true or when the URL contains ?demo=1
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { demoInitialState } from './mockState';
import type { DeviceState } from '../hooks/useDeviceState';

export function isDemoMode(): boolean {
  if (typeof window === 'undefined') return false;
  if (import.meta.env.VITE_DEMO_MODE === 'true') return true;
  return new URLSearchParams(window.location.search).get('demo') === '1';
}

// Simulates meter data with musical-looking movement
function generateMeterLevels(tick: number): {
  levels: { level_dBu: number; clipped: boolean }[];
  gainReduction: number[];
} {
  const t = tick / 10;
  const levels = Array.from({ length: 12 }, (_, i) => {
    const base = i < 4 ? -12 : -18;
    const wobble =
      Math.sin(t * 1.3 + i * 0.7) * 6 +
      Math.sin(t * 2.7 + i * 1.1) * 3 +
      Math.sin(t * 0.4 + i * 2.3) * 4;
    const level_dBu = Math.max(-42, Math.min(20, base + wobble));
    return { level_dBu, clipped: level_dBu > 18 };
  });
  const gainReduction = Array.from({ length: 8 }, (_, i) => {
    const gr = Math.max(0, Math.sin(t * 1.1 + i * 0.9) * 3 + 1);
    return Math.round(gr);
  });
  return { levels, gainReduction };
}

export interface DemoReturn {
  state: DeviceState;
  send: (obj: object) => void;
  ports: { path: string; manufacturer?: string }[];
  readyState: 'open';
}

export function useDemoMode(): DemoReturn {
  const [state, setState] = useState<DeviceState>(demoInitialState);
  const tickRef = useRef(0);

  // Meter animation
  useEffect(() => {
    const id = setInterval(() => {
      tickRef.current++;
      const meters = generateMeterLevels(tickRef.current);
      setState(prev => ({ ...prev, meters }));
    }, 100);
    return () => clearInterval(id);
  }, []);

  const send = useCallback((obj: Record<string, any>) => {
    // Simulate optimistic updates for demo interactions
    setState(prev => applyDemoMessage(prev, obj));
  }, []);

  const ports = [
    { path: '/dev/tty.usbserial-DEMO', manufacturer: 'Ashly Audio (Demo)' },
  ];

  return { state, send: send as any, ports, readyState: 'open' };
}

function applyDemoMessage(state: DeviceState, msg: Record<string, any>): DeviceState {
  switch (msg.type) {
    case 'setGain': {
      const gains = state.gains.map(g =>
        g.node === msg.node ? { ...g, gain_dB: msg.dB, gainRaw: Math.round(8192 + msg.dB * 10) } : g,
      );
      return { ...state, gains };
    }
    case 'mute': {
      const mute = [...state.status.mute];
      mute[msg.node] = msg.muted;
      return { ...state, status: { ...state.status, mute } };
    }
    case 'setDelay': {
      const delays = state.delays.map(d =>
        d.node === msg.node ? { ...d, ms: msg.ms } : d,
      );
      return { ...state, delays };
    }
    case 'setEQ': {
      const eqFilters = state.eqFilters.map(f =>
        f.filterNum === msg.filter
          ? { ...f, freq: msg.freq, q: msg.q, gain_dB: msg.gain, filterType: msg.filterType }
          : f,
      );
      return { ...state, eqFilters };
    }
    case 'setCrossover': {
      const crossovers = state.crossovers.map(c =>
        c.filterNum === msg.filter
          ? { ...c, freq: msg.freq === 'off' ? 0 : msg.freq, filterType: msg.filterType, isOff: msg.freq === 'off' }
          : c,
      );
      return { ...state, crossovers };
    }
    case 'setLimiter': {
      const limiters = state.limiters.map(l =>
        l.node === msg.node
          ? { ...l, threshold_dBu: msg.threshold, ratio: msg.ratio, attack: msg.attack, release: msg.release }
          : l,
      );
      return { ...state, limiters };
    }
    case 'setSource': {
      const routing = [...state.status.routing];
      const outIdx = msg.output - 4;
      if (outIdx >= 0 && outIdx < 8) {
        const bit = 1 << msg.input;
        routing[outIdx] = msg.enabled ? routing[outIdx] | bit : routing[outIdx] & ~bit;
      }
      return { ...state, status: { ...state.status, routing } };
    }
    case 'recallPreset':
      return { ...state }; // no-op in demo
    case 'savePreset': {
      const presetNames = [...state.presetNames];
      presetNames[msg.index] = msg.name;
      return { ...state, presetNames };
    }
    default:
      return state;
  }
}
