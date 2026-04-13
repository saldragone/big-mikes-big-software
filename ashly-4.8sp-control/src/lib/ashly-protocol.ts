/**
 * Ashly Protea 4.8SP / 3.6SP Serial Control Protocol
 *
 * Frame format:
 *   [F0 00 01 2A 12 00] [CLASS] [MSG_TYPE] [...PAYLOAD] [F7]
 *
 * Exception: Meter Request is a single byte 0xD0.
 */

import {
  START_BYTES, END_BYTE, CLASS_CONTROL,
  MSG,
  GAIN_0DB, GAIN_MIN, GAIN_MAX,
  FREQ_HPF_OFF, FREQ_LPF_OFF,
  DELAY_SAMPLE_RATE, DELAY_MAX_SAMPLES,
  Q_TABLE, Q_BYTE_VALUES, closestQByte,
  LIMITER_THRESHOLD_MIN, LIMITER_THRESHOLD_MAX,
  PRESET_COUNT, PRESET_NAME_LEN,
} from './constants.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParsedMessage {
  type: number;
  classId: number;
  payload: Uint8Array;
}

export interface MeterLevel {
  level_dBu: number;
  clipped: boolean;
}

export interface EQFilter {
  filterNum: number;
  freq: number;       // Hz
  qByte: number;      // raw byte
  q: number;          // resolved Q value
  gainRaw: number;    // 14-bit gain word
  gain_dB: number;    // dB
  filterType: number; // 0-4
}

export interface CrossoverFilter {
  filterNum: number;
  freq: number;       // Hz (0 = OFF)
  freqValue: number;  // raw encoded value
  filterType: number; // 0-7
  isOff: boolean;
}

export interface DelayInfo {
  node: number;
  samples: number;
  ms: number;
}

export interface LimiterInfo {
  node: number;
  threshold_dBu: number;
  thresholdByte: number;
  ratio: number;      // index 0-8
  attack: number;     // index 0-6
  release: number;    // index 0-6
  enabled?: boolean;
}

export interface GainInfo {
  node: number;
  gainRaw: number;
  gain_dB: number;
}

export interface StatusInfo {
  // output source routing: outputIndex → bitmask of inputs (bits 0-3 = input A-D)
  routing: number[];       // length 8
  eqEnable: boolean[];     // length 12 (4 inputs + 8 outputs)
  limiterEnable: boolean[]; // length 8 (outputs)
  polarity: boolean[];     // length 8 (outputs, true = inverted)
  mute: boolean[];         // length 12 (4 inputs + 8 outputs)
}

export interface DeviceState {
  gains: GainInfo[];         // length 12
  eqFilters: EQFilter[];     // all filter numbers
  crossovers: CrossoverFilter[]; // 16 (HPF+LPF for each of 8 outputs)
  delays: DelayInfo[];       // length 12
  limiters: LimiterInfo[];   // length 8 (outputs only)
  status: StatusInfo;
}

// ─── Frame builder ────────────────────────────────────────────────────────────

export function buildMessage(type: number, payload: number[], classId = CLASS_CONTROL): Buffer {
  const body = [...START_BYTES, classId, type, ...payload, END_BYTE];
  return Buffer.from(body);
}

// ─── Frame parser ─────────────────────────────────────────────────────────────

/**
 * Attempt to parse one or more framed messages from a buffer.
 * Returns an array of ParsedMessages and the number of bytes consumed.
 */
export function parseBuffer(buf: Uint8Array): { messages: ParsedMessage[]; consumed: number } {
  const messages: ParsedMessage[] = [];
  let i = 0;

  while (i < buf.length) {
    // Look for start of frame
    if (buf[i] !== 0xf0) {
      // Could be a bare meter response (0xD0) or echo — skip unknown bytes
      i++;
      continue;
    }

    // Try to match start bytes
    let match = true;
    for (let j = 0; j < START_BYTES.length; j++) {
      if (buf[i + j] !== START_BYTES[j]) { match = false; break; }
    }
    if (!match) { i++; continue; }

    // Find end byte
    const startIdx = i;
    const endIdx   = buf.indexOf(END_BYTE, startIdx + START_BYTES.length + 2);
    if (endIdx === -1) break; // incomplete frame — wait for more data

    const classId  = buf[startIdx + START_BYTES.length];
    const type     = buf[startIdx + START_BYTES.length + 1];
    const payload  = buf.slice(startIdx + START_BYTES.length + 2, endIdx);

    messages.push({ type, classId, payload: new Uint8Array(payload) });
    i = endIdx + 1;
  }

  return { messages, consumed: i };
}

// ─── Gain encoding ────────────────────────────────────────────────────────────

/**
 * Convert dB float to 14-bit gain word.
 * Range: -40dB (7792) to +12dB (8312), 0dB = 8192.
 * Step: 0.1 dB per unit.
 */
export function encodeGain(dB: number): number {
  const clamped = Math.max(-40.0, Math.min(12.0, dB));
  return Math.round(GAIN_0DB + clamped * 10);
}

export function decodeGain(byte1: number, byte2: number): number {
  const raw = ((byte1 & 0x7f) << 7) | (byte2 & 0x7f);
  return (raw - GAIN_0DB) / 10;
}

export function gainTo2Bytes(raw: number): [number, number] {
  const clamped = Math.max(GAIN_MIN, Math.min(GAIN_MAX, raw));
  return [(clamped >> 7) & 0x7f, clamped & 0x7f];
}

// ─── Frequency encoding ───────────────────────────────────────────────────────

/**
 * Encode Hz to 8-bit frequency value using:
 *   Value = 147 + 24 * log2(freq / 1000)
 */
export function encodeFrequency(hz: number): number {
  const value = Math.round(147 + 24 * Math.log2(hz / 1000));
  return Math.max(11, Math.min(254, value));
}

/**
 * Decode 8-bit frequency value split across 2 bytes:
 *   byte1 bits 6-0 = value bits 7-1
 *   byte2 bit  6   = value bit  0
 */
export function decodeFrequency(byte1: number, byte2: number): number {
  const value = ((byte1 & 0x7f) << 1) | ((byte2 >> 6) & 0x01);
  return valueToHz(value);
}

export function valueToHz(value: number): number {
  return 1000 * Math.pow(2, (value - 147) / 24);
}

export function freqTo2Bytes(value: number): [number, number] {
  return [(value >> 1) & 0x7f, ((value & 0x01) << 6) & 0x7f];
}

// ─── Delay encoding ───────────────────────────────────────────────────────────

/**
 * Encode milliseconds to 20-bit sample count.
 * Split across 3 bytes: bits 20-14, 13-7, 6-0.
 */
export function encodeDelay(ms: number): number {
  const samples = Math.round((ms / 1000) * DELAY_SAMPLE_RATE);
  return Math.max(0, Math.min(DELAY_MAX_SAMPLES, samples));
}

export function decodeDelay(b1: number, b2: number, b3: number): number {
  const samples = ((b1 & 0x7f) << 14) | ((b2 & 0x7f) << 7) | (b3 & 0x7f);
  return (samples / DELAY_SAMPLE_RATE) * 1000;
}

export function delayTo3Bytes(samples: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(DELAY_MAX_SAMPLES, samples));
  return [
    (clamped >> 14) & 0x7f,
    (clamped >> 7)  & 0x7f,
    clamped         & 0x7f,
  ];
}

// ─── Q decoding ───────────────────────────────────────────────────────────────

export function decodeQ(byte: number): number {
  // Find closest entry in table
  let best = Q_BYTE_VALUES[0];
  let bestDiff = Math.abs(Q_BYTE_VALUES[0] - byte);
  for (const b of Q_BYTE_VALUES) {
    const diff = Math.abs(b - byte);
    if (diff < bestDiff) { bestDiff = diff; best = b; }
  }
  return Q_TABLE[best] ?? 1.0;
}

// ─── Meter decoding ───────────────────────────────────────────────────────────

/**
 * Decode meter level byte: `0CLLLLLL`
 *   bit 6 = clip flag
 *   bits 5-0 = level (0 = <-42dBu, 1-63 = -42 to +20dBu)
 */
export function decodeMeterLevel(byte: number): MeterLevel {
  const clipped = (byte & 0x40) !== 0;
  const level   = byte & 0x3f;
  const level_dBu = level === 0 ? -42 : -42 + (level - 1); // rough linear mapping
  return { level_dBu, clipped };
}

// ─── Message builders ─────────────────────────────────────────────────────────

export function meterRequest(): Buffer {
  return Buffer.from([MSG.METER_REQUEST]);
}

export function dataRequest(): Buffer {
  return buildMessage(MSG.DATA_REQUEST, []);
}

export function presetNamesRequest(): Buffer {
  return buildMessage(MSG.PRESET_NAMES_REQUEST, []);
}

export function deviceNameRequest(): Buffer {
  return buildMessage(MSG.DEVICE_NAME_REQUEST, []);
}

/**
 * Gain message (type 0x06)
 * Payload: [node, byte1, byte2]
 */
export function setGain(node: number, dB: number): Buffer {
  const raw = encodeGain(dB);
  const [b1, b2] = gainTo2Bytes(raw);
  return buildMessage(MSG.GAIN, [node, b1, b2]);
}

/**
 * EQ Filter message (type 0x07)
 * Payload: [filterNum, freqByte1, freqByte2, qByte, gainByte1, gainByte2, filterType]
 */
export function setEQ(
  filterNum: number,
  freq: number,
  q: number,
  gain_dB: number,
  filterType: number,
): Buffer {
  const freqVal = encodeFrequency(freq);
  const [fb1, fb2] = freqTo2Bytes(freqVal);
  const qByte = closestQByte(q);
  const gainRaw = encodeGain(gain_dB);
  const [gb1, gb2] = gainTo2Bytes(gainRaw);
  return buildMessage(MSG.EQ_FILTER, [filterNum, fb1, fb2, qByte, gb1, gb2, filterType]);
}

/**
 * Delay message (type 0x08)
 * Payload: [node, b1, b2, b3]
 */
export function setDelay(node: number, ms: number): Buffer {
  const samples = encodeDelay(ms);
  const [b1, b2, b3] = delayTo3Bytes(samples);
  return buildMessage(MSG.DELAY, [node, b1, b2, b3]);
}

/**
 * Crossover filter message (type 0x09)
 * Payload: [filterNum, freqByte1, freqByte2, filterType]
 * For HPF OFF: freqValue = 10; for LPF OFF: freqValue = 255
 */
export function setCrossover(filterNum: number, freq: number | 'off', filterType: number, isLPF = false): Buffer {
  let freqVal: number;
  if (freq === 'off') {
    freqVal = isLPF ? FREQ_LPF_OFF : FREQ_HPF_OFF;
  } else {
    freqVal = encodeFrequency(freq);
  }
  const [fb1, fb2] = freqTo2Bytes(freqVal);
  return buildMessage(MSG.CROSSOVER, [filterNum, fb1, fb2, filterType]);
}

/**
 * Limiter message (type 0x0A)
 * Payload: [node, threshold, ratio, attack, release]
 */
export function setLimiter(
  node: number,
  threshold_dBu: number,
  ratio: number,
  attack: number,
  release: number,
): Buffer {
  const threshold = Math.max(
    LIMITER_THRESHOLD_MIN,
    Math.min(LIMITER_THRESHOLD_MAX, Math.round(threshold_dBu) + 0x40),
  );
  return buildMessage(MSG.LIMITER, [node, threshold, ratio & 0x7f, attack & 0x7f, release & 0x7f]);
}

/**
 * Channel mute (type 0x1D)
 * Payload: [node, muted (0/1)]
 */
export function setMute(node: number, muted: boolean): Buffer {
  return buildMessage(MSG.CHANNEL_MUTE, [node, muted ? 1 : 0]);
}

/**
 * Source selection (type 0x1E)
 * Payload: [outputNode (4-11), inputNode (0-3), enabled (0/1)]
 */
export function setSource(outputNode: number, inputNode: number, enabled: boolean): Buffer {
  return buildMessage(MSG.SOURCE_SELECT, [outputNode, inputNode, enabled ? 1 : 0]);
}

/**
 * Preset recall (type 0x15)
 * Payload: [presetIndex, muteOutputs (0/1)]
 */
export function recallPreset(index: number, muteOutputs = false): Buffer {
  if (index < 0 || index >= PRESET_COUNT) throw new RangeError(`Preset index ${index} out of range`);
  return buildMessage(MSG.PRESET_RECALL, [index, muteOutputs ? 1 : 0]);
}

/**
 * Preset save (type 0x0C)
 * Payload: [presetIndex, ...nameBytes (20 ASCII bytes)]
 */
export function savePreset(index: number, name: string): Buffer {
  if (index < 0 || index >= PRESET_COUNT) throw new RangeError(`Preset index ${index} out of range`);
  const nameBytes = encodePresetName(name);
  return buildMessage(MSG.PRESET_SAVE, [index, ...nameBytes]);
}

/**
 * Gain increment/decrement (type 0x1C)
 * Payload: [node, type (0=dec/1=inc), amount (1-50 = 0.1-5.0 dB)]
 */
export function gainIncDec(node: number, increment: boolean, amountTenths: number): Buffer {
  const amount = Math.max(1, Math.min(50, amountTenths));
  return buildMessage(MSG.GAIN_INC_DEC, [node, increment ? 1 : 0, amount]);
}

// ─── Response parsers ─────────────────────────────────────────────────────────

/**
 * Parse meter response (type 0x00)
 * Layout: [level bytes for all channels...] [gain reduction bytes for outputs...]
 * 4 inputs + 8 outputs = 12 level bytes, then 8 GR bytes
 */
export function parseMeterResponse(data: Uint8Array): {
  levels: MeterLevel[];
  gainReduction: number[];
} {
  const levels: MeterLevel[] = [];
  for (let i = 0; i < 12 && i < data.length; i++) {
    levels.push(decodeMeterLevel(data[i]));
  }
  const gainReduction: number[] = [];
  for (let i = 12; i < 20 && i < data.length; i++) {
    gainReduction.push(data[i]);
  }
  return { levels, gainReduction };
}

/**
 * Parse a single gain payload [node, byte1, byte2]
 */
export function parseGainMessage(data: Uint8Array): GainInfo {
  const node    = data[0];
  const gainRaw = ((data[1] & 0x7f) << 7) | (data[2] & 0x7f);
  const gain_dB = (gainRaw - GAIN_0DB) / 10;
  return { node, gainRaw, gain_dB };
}

/**
 * Parse EQ filter message payload
 */
export function parseEQMessage(data: Uint8Array): EQFilter {
  const filterNum  = data[0];
  const freq       = decodeFrequency(data[1], data[2]);
  const qByte      = data[3];
  const q          = decodeQ(qByte);
  const gainRaw    = ((data[4] & 0x7f) << 7) | (data[5] & 0x7f);
  const gain_dB    = (gainRaw - GAIN_0DB) / 10;
  const filterType = data[6];
  return { filterNum, freq, qByte, q, gainRaw, gain_dB, filterType };
}

/**
 * Parse delay message payload [node, b1, b2, b3]
 */
export function parseDelayMessage(data: Uint8Array): DelayInfo {
  const node    = data[0];
  const ms      = decodeDelay(data[1], data[2], data[3]);
  const samples = encodeDelay(ms);
  return { node, samples, ms };
}

/**
 * Parse crossover filter payload [filterNum, freqByte1, freqByte2, filterType]
 */
export function parseCrossoverMessage(data: Uint8Array): CrossoverFilter {
  const filterNum  = data[0];
  const freqValue  = ((data[1] & 0x7f) << 1) | ((data[2] >> 6) & 0x01);
  const filterType = data[3];
  const isLPF      = (filterNum % 2) === 1;
  const isOff      = isLPF ? freqValue >= FREQ_LPF_OFF : freqValue <= FREQ_HPF_OFF;
  const freq       = isOff ? 0 : valueToHz(freqValue);
  return { filterNum, freq, freqValue, filterType, isOff };
}

/**
 * Parse limiter payload [node, threshold, ratio, attack, release]
 */
export function parseLimiterMessage(data: Uint8Array): LimiterInfo {
  const node           = data[0];
  const thresholdByte  = data[1];
  const threshold_dBu  = thresholdByte - 0x40;
  const ratio          = data[2];
  const attack         = data[3];
  const release        = data[4];
  return { node, threshold_dBu, thresholdByte, ratio, attack, release };
}

/**
 * Parse status message payload.
 * Layout (from spec):
 *   [routingOut1..8] [eqEnableLow, eqEnableHigh] [limEnable1, limEnable2]
 *   [polarity1, polarity2] [muteLow, muteHigh]
 */
export function parseStatusMessage(data: Uint8Array): StatusInfo {
  const routing: number[] = [];
  for (let i = 0; i < 8; i++) routing.push(data[i] & 0x0f);

  const eqWord   = ((data[9] & 0x7f) << 7) | (data[8] & 0x7f);
  const eqEnable: boolean[] = [];
  for (let i = 0; i < 12; i++) eqEnable.push((eqWord >> i & 1) === 1);

  const limWord  = ((data[11] & 0x7f) << 7) | (data[10] & 0x7f);
  const limiterEnable: boolean[] = [];
  for (let i = 0; i < 8; i++) limiterEnable.push((limWord >> i & 1) === 1);

  const polWord  = ((data[13] & 0x7f) << 7) | (data[12] & 0x7f);
  const polarity: boolean[] = [];
  for (let i = 0; i < 8; i++) polarity.push((polWord >> i & 1) === 1);

  const muteWord = ((data[15] & 0x7f) << 7) | (data[14] & 0x7f);
  const mute: boolean[] = [];
  for (let i = 0; i < 12; i++) mute.push((muteWord >> i & 1) === 1);

  return { routing, eqEnable, limiterEnable, polarity, mute };
}

/**
 * Parse preset names response.
 * Payload: 30 × 20 ASCII bytes.
 */
export function parsePresetNamesResponse(data: Uint8Array): string[] {
  const names: string[] = [];
  for (let i = 0; i < PRESET_COUNT; i++) {
    const start = i * PRESET_NAME_LEN;
    const slice = data.slice(start, start + PRESET_NAME_LEN);
    names.push(new TextDecoder().decode(slice).replace(/\0/g, ' ').trimEnd());
  }
  return names;
}

/**
 * Parse device name response.
 */
export function parseDeviceNameResponse(data: Uint8Array): string {
  return new TextDecoder().decode(data).replace(/\0/g, '').trim();
}

/**
 * Parse a full Data Response (type 0x02).
 * The data response contains all parameter blocks in sequence.
 * This is a best-effort parse — the exact layout matches the 4.8SP spec.
 */
export function parseDataResponse(data: Uint8Array): Partial<DeviceState> {
  // Data response is a concatenation of all individual parameter messages.
  // We re-use parseBuffer to extract them from the payload since each block
  // is framed exactly as individual messages within the data response.
  // In practice, the unit sends them back-to-back unframed within the outer frame.
  // We parse them positionally based on the known fixed structure.

  const state: Partial<DeviceState> = {
    gains:      [],
    eqFilters:  [],
    crossovers: [],
    delays:     [],
    limiters:   [],
  };

  let offset = 0;

  // 12 gain entries (3 bytes each: node, b1, b2)
  const gains: GainInfo[] = [];
  for (let n = 0; n < 12; n++) {
    if (offset + 3 > data.length) break;
    const node    = data[offset];
    const gainRaw = ((data[offset + 1] & 0x7f) << 7) | (data[offset + 2] & 0x7f);
    gains.push({ node, gainRaw, gain_dB: (gainRaw - GAIN_0DB) / 10 });
    offset += 3;
  }
  state.gains = gains;

  // EQ filters: 56 filters × 7 bytes each (filterNum, fb1, fb2, qByte, gb1, gb2, type)
  const eqFilters: EQFilter[] = [];
  for (let f = 0; f < 56; f++) {
    if (offset + 7 > data.length) break;
    eqFilters.push(parseEQMessage(data.slice(offset, offset + 7)));
    offset += 7;
  }
  state.eqFilters = eqFilters;

  // Crossover filters: 16 × 4 bytes each
  const crossovers: CrossoverFilter[] = [];
  for (let f = 0; f < 16; f++) {
    if (offset + 4 > data.length) break;
    crossovers.push(parseCrossoverMessage(data.slice(offset, offset + 4)));
    offset += 4;
  }
  state.crossovers = crossovers;

  // Delay: 12 × 4 bytes (node, b1, b2, b3)
  const delays: DelayInfo[] = [];
  for (let n = 0; n < 12; n++) {
    if (offset + 4 > data.length) break;
    delays.push(parseDelayMessage(data.slice(offset, offset + 4)));
    offset += 4;
  }
  state.delays = delays;

  // Limiter: 8 outputs × 5 bytes
  const limiters: LimiterInfo[] = [];
  for (let n = 0; n < 8; n++) {
    if (offset + 5 > data.length) break;
    limiters.push(parseLimiterMessage(data.slice(offset, offset + 5)));
    offset += 5;
  }
  state.limiters = limiters;

  // Status: 16 bytes
  if (offset + 16 <= data.length) {
    state.status = parseStatusMessage(data.slice(offset, offset + 16));
  }

  return state;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function encodePresetName(name: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < PRESET_NAME_LEN; i++) {
    const ch = name.charCodeAt(i);
    if (i < name.length && ch >= 0x20 && ch <= 0x7a && ch !== 0x5c) {
      bytes.push(ch);
    } else {
      bytes.push(0x20); // space
    }
  }
  return bytes;
}
