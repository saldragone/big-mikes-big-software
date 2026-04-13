/**
 * Demo mode — realistic simulated device state for the Vercel preview.
 * No hardware required.
 */

import type { DeviceState, EQFilter, CrossoverFilter, DelayInfo, LimiterInfo } from '../hooks/useDeviceState';

// Build a realistic default device state

const gains = Array.from({ length: 12 }, (_, i) => ({
  node: i,
  gainRaw: 8192 + (i < 4 ? 0 : -20), // inputs at 0dB, outputs at -2dB
  gain_dB: i < 4 ? 0 : -2,
}));

// 6 EQ filters per input (0-23), 4 per output (24-55)
const eqFilters: EQFilter[] = [];
for (let i = 0; i < 4; i++) {
  for (let b = 0; b < 6; b++) {
    eqFilters.push({
      filterNum: i * 6 + b,
      freq: [80, 250, 1000, 3000, 8000, 16000][b],
      q: 1.0, qByte: 54,
      gain_dB: 0, gainRaw: 8192,
      filterType: 0,
    });
  }
}
for (let o = 0; o < 8; o++) {
  for (let b = 0; b < 4; b++) {
    eqFilters.push({
      filterNum: 24 + o * 4 + b,
      freq: [250, 1000, 4000, 10000][b],
      q: 1.0, qByte: 54,
      gain_dB: 0, gainRaw: 8192,
      filterType: 0,
    });
  }
}

// Crossovers: HPF at 80Hz, LPF off for all outputs
const crossovers: CrossoverFilter[] = [];
for (let o = 0; o < 8; o++) {
  crossovers.push({ filterNum: o * 2,     freq: 80, freqValue: 88,  filterType: 7, isOff: false }); // HPF
  crossovers.push({ filterNum: o * 2 + 1, freq: 0,  freqValue: 255, filterType: 7, isOff: true  }); // LPF off
}

const delays: DelayInfo[] = Array.from({ length: 12 }, (_, i) => ({
  node: i, ms: 0, samples: 0,
}));

const limiters: LimiterInfo[] = Array.from({ length: 8 }, (_, i) => ({
  node: i + 4,
  threshold_dBu: 0,
  thresholdByte: 0x40,
  ratio: 7,    // 20:1
  attack: 2,   // 2ms
  release: 3,  // 100ms
  enabled: false,
}));

export const demoInitialState: DeviceState = {
  connected: true,
  port: 'DEMO MODE',
  deviceName: 'Ashly 4.8SP (Demo)',
  gains,
  eqFilters,
  crossovers,
  delays,
  limiters,
  status: {
    routing: [
      0b0001, // Out1 ← In A
      0b0010, // Out2 ← In B
      0b0001, // Out3 ← In A
      0b0010, // Out4 ← In B
      0b0001, // Out5 ← In A
      0b0010, // Out6 ← In B
      0b0011, // Out7 ← In A+B
      0b0011, // Out8 ← In A+B
    ],
    eqEnable:      Array(12).fill(true),
    limiterEnable: Array(8).fill(false),
    polarity:      Array(8).fill(false),
    mute:          Array(12).fill(false),
  },
  presetNames: [
    'FOH Main', 'FOH Loud', 'Monitor Mix', 'Rehearsal', 'Church Sermon',
    'Church Music', 'Club Night', 'Acoustic Show', 'DJ Set', 'Podcast',
    ...Array(20).fill('').map((_, i) => `Preset ${i + 11}`),
  ],
  meters: { levels: [], gainReduction: [] },
};
