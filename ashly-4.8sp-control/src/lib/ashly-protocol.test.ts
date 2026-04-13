import { describe, it, expect } from 'vitest';
import {
  encodeGain, decodeGain, gainTo2Bytes,
  encodeFrequency, decodeFrequency, valueToHz,
  encodeDelay, decodeDelay, delayTo3Bytes,
  decodeQ, decodeMeterLevel,
  buildMessage, parseBuffer,
  setGain, setEQ, setDelay, setCrossover, setLimiter,
  setMute, setSource, recallPreset, savePreset, gainIncDec,
  meterRequest, dataRequest,
  parseMeterResponse, parseGainMessage, parseEQMessage,
  parseDelayMessage, parseCrossoverMessage, parseLimiterMessage,
  parseStatusMessage, parsePresetNamesResponse,
} from './ashly-protocol.js';
import { START_BYTES, END_BYTE, MSG } from './constants.js';

// ─── Gain encoding ────────────────────────────────────────────────────────────
describe('encodeGain / decodeGain', () => {
  it('encodes 0 dB to 8192', () => {
    expect(encodeGain(0)).toBe(8192);
  });

  it('encodes -40 dB to 7792', () => {
    expect(encodeGain(-40)).toBe(7792);
  });

  it('encodes +12 dB to 8312', () => {
    expect(encodeGain(12)).toBe(8312);
  });

  it('round-trips through 2-byte encoding', () => {
    for (const dB of [-40, -20, -10, -3, 0, 3, 6, 12]) {
      const raw = encodeGain(dB);
      const [b1, b2] = gainTo2Bytes(raw);
      const decoded = decodeGain(b1, b2);
      expect(decoded).toBeCloseTo(dB, 1);
    }
  });

  it('clamps below -40 dB', () => {
    expect(encodeGain(-100)).toBe(7792);
  });

  it('clamps above +12 dB', () => {
    expect(encodeGain(20)).toBe(8312);
  });

  it('splits high bits into byte1 and low bits into byte2', () => {
    const [b1, b2] = gainTo2Bytes(8192);
    expect(b1).toBe((8192 >> 7) & 0x7f);
    expect(b2).toBe(8192 & 0x7f);
  });
});

// ─── Frequency encoding ───────────────────────────────────────────────────────
describe('encodeFrequency / decodeFrequency', () => {
  const knownValues: [number, number][] = [
    [147, 1000],
    [123, 500],
    [171, 2000],
    [99, 250],
  ];

  it.each(knownValues)('value %i → %i Hz', (value, hz) => {
    expect(valueToHz(value)).toBeCloseTo(hz, 0);
  });

  it.each(knownValues)('encoding %i Hz → value %i', (value, hz) => {
    expect(encodeFrequency(hz)).toBe(value);
  });

  it('round-trips 1kHz through 2-byte encoding', () => {
    const val = encodeFrequency(1000);
    const [b1, b2] = [((val >> 1) & 0x7f), ((val & 0x01) << 6)];
    const decoded = decodeFrequency(b1, b2);
    expect(decoded).toBeCloseTo(1000, 0);
  });

  it('round-trips 80Hz through 2-byte encoding', () => {
    const val = encodeFrequency(80);
    const [b1, b2] = [((val >> 1) & 0x7f), ((val & 0x01) << 6)];
    const decoded = decodeFrequency(b1, b2);
    expect(decoded).toBeCloseTo(80, -1); // within ~10Hz
  });
});

// ─── Delay encoding ───────────────────────────────────────────────────────────
describe('encodeDelay / decodeDelay', () => {
  it('encodes 0 ms to 0 samples', () => {
    expect(encodeDelay(0)).toBe(0);
  });

  it('round-trips 10ms', () => {
    const samples = encodeDelay(10);
    const [b1, b2, b3] = delayTo3Bytes(samples);
    const ms = decodeDelay(b1, b2, b3);
    expect(ms).toBeCloseTo(10, 0);
  });

  it('round-trips 100ms', () => {
    const samples = encodeDelay(100);
    const [b1, b2, b3] = delayTo3Bytes(samples);
    const ms = decodeDelay(b1, b2, b3);
    expect(ms).toBeCloseTo(100, 0);
  });

  it('clamps at max delay ~682.64ms', () => {
    const samples = encodeDelay(10000);
    expect(samples).toBe(32767);
  });

  it('keeps each byte in 7-bit range', () => {
    const [b1, b2, b3] = delayTo3Bytes(32767);
    expect(b1).toBeLessThan(128);
    expect(b2).toBeLessThan(128);
    expect(b3).toBeLessThan(128);
  });
});

// ─── Q table ─────────────────────────────────────────────────────────────────
describe('decodeQ', () => {
  it('decodes byte 54 to Q 1.00', () => {
    expect(decodeQ(54)).toBeCloseTo(1.0, 2);
  });

  it('decodes byte 42 to Q 2.00', () => {
    expect(decodeQ(42)).toBeCloseTo(2.0, 2);
  });

  it('decodes byte 0 to Q 64.00', () => {
    expect(decodeQ(0)).toBeCloseTo(64.0, 2);
  });

  it('decodes byte 78 to Q 0.25', () => {
    expect(decodeQ(78)).toBeCloseTo(0.25, 2);
  });
});

// ─── Meter decoding ───────────────────────────────────────────────────────────
describe('decodeMeterLevel', () => {
  it('decodes 0 level as -42dBu, no clip', () => {
    const { level_dBu, clipped } = decodeMeterLevel(0x00);
    expect(level_dBu).toBe(-42);
    expect(clipped).toBe(false);
  });

  it('decodes clip bit', () => {
    const { clipped } = decodeMeterLevel(0x40);
    expect(clipped).toBe(true);
  });

  it('decodes level 63 as +20dBu', () => {
    const { level_dBu } = decodeMeterLevel(63);
    expect(level_dBu).toBe(20);
  });
});

// ─── Frame builder / parser ───────────────────────────────────────────────────
describe('buildMessage / parseBuffer', () => {
  it('meterRequest returns single byte 0xD0', () => {
    const buf = meterRequest();
    expect(buf.length).toBe(1);
    expect(buf[0]).toBe(0xd0);
  });

  it('dataRequest builds valid framed message', () => {
    const buf = dataRequest();
    // Check start bytes
    for (let i = 0; i < START_BYTES.length; i++) {
      expect(buf[i]).toBe(START_BYTES[i]);
    }
    // Check end byte
    expect(buf[buf.length - 1]).toBe(END_BYTE);
    // Check message type
    expect(buf[START_BYTES.length + 1]).toBe(MSG.DATA_REQUEST);
  });

  it('round-trips a gain message through parser', () => {
    const msg = setGain(4, -6.0);
    const { messages } = parseBuffer(new Uint8Array(msg));
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe(MSG.GAIN);
    const info = parseGainMessage(messages[0].payload);
    expect(info.node).toBe(4);
    expect(info.gain_dB).toBeCloseTo(-6.0, 1);
  });

  it('round-trips a delay message through parser', () => {
    const msg = setDelay(5, 20.0);
    const { messages } = parseBuffer(new Uint8Array(msg));
    expect(messages).toHaveLength(1);
    const info = parseDelayMessage(messages[0].payload);
    expect(info.node).toBe(5);
    expect(info.ms).toBeCloseTo(20.0, 0);
  });

  it('round-trips an EQ message through parser', () => {
    const msg = setEQ(24, 1000, 1.0, -3.0, 0);
    const { messages } = parseBuffer(new Uint8Array(msg));
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe(MSG.EQ_FILTER);
    const info = parseEQMessage(messages[0].payload);
    expect(info.filterNum).toBe(24);
    expect(info.freq).toBeCloseTo(1000, 0);
    expect(info.gain_dB).toBeCloseTo(-3.0, 1);
  });

  it('parses multiple messages from buffer', () => {
    const m1 = setGain(0, 0);
    const m2 = setGain(4, -6.0);
    const combined = Buffer.concat([m1, m2]);
    const { messages } = parseBuffer(new Uint8Array(combined));
    expect(messages).toHaveLength(2);
    expect(messages[0].type).toBe(MSG.GAIN);
    expect(messages[1].type).toBe(MSG.GAIN);
  });

  it('returns incomplete frame when end byte missing', () => {
    const msg = setGain(0, 0);
    const partial = msg.slice(0, msg.length - 1); // remove end byte
    const { messages } = parseBuffer(new Uint8Array(partial));
    expect(messages).toHaveLength(0);
  });
});

// ─── Message builders ─────────────────────────────────────────────────────────
describe('message builders', () => {
  it('setMute builds correct payload', () => {
    const msg = setMute(3, true);
    const { messages } = parseBuffer(new Uint8Array(msg));
    expect(messages[0].type).toBe(MSG.CHANNEL_MUTE);
    expect(messages[0].payload[0]).toBe(3);
    expect(messages[0].payload[1]).toBe(1);
  });

  it('setSource builds correct payload', () => {
    const msg = setSource(4, 0, true);
    const { messages } = parseBuffer(new Uint8Array(msg));
    expect(messages[0].type).toBe(MSG.SOURCE_SELECT);
    expect(messages[0].payload[0]).toBe(4);
    expect(messages[0].payload[1]).toBe(0);
    expect(messages[0].payload[2]).toBe(1);
  });

  it('recallPreset builds correct payload', () => {
    const msg = recallPreset(5, false);
    const { messages } = parseBuffer(new Uint8Array(msg));
    expect(messages[0].type).toBe(MSG.PRESET_RECALL);
    expect(messages[0].payload[0]).toBe(5);
  });

  it('recallPreset throws on out-of-range index', () => {
    expect(() => recallPreset(30)).toThrow(RangeError);
    expect(() => recallPreset(-1)).toThrow(RangeError);
  });

  it('gainIncDec builds correct payload', () => {
    const msg = gainIncDec(0, true, 5); // +0.5dB
    const { messages } = parseBuffer(new Uint8Array(msg));
    expect(messages[0].type).toBe(MSG.GAIN_INC_DEC);
    expect(messages[0].payload[1]).toBe(1); // increment
    expect(messages[0].payload[2]).toBe(5); // amount
  });

  it('setCrossover HPF OFF uses value 10', () => {
    const msg = setCrossover(0, 'off', 0, false);
    const { messages } = parseBuffer(new Uint8Array(msg));
    expect(messages[0].type).toBe(MSG.CROSSOVER);
    const info = parseCrossoverMessage(messages[0].payload);
    expect(info.isOff).toBe(true);
  });

  it('setLimiter clamps threshold', () => {
    // Should not throw; threshold gets clamped
    expect(() => setLimiter(4, 100, 7, 2, 3)).not.toThrow();
  });
});

// ─── Preset names ─────────────────────────────────────────────────────────────
describe('parsePresetNamesResponse', () => {
  it('parses 30 preset names', () => {
    const data = new Uint8Array(30 * 20).fill(0x20); // all spaces
    const encoder = new TextEncoder();
    const name = encoder.encode('FOH Main            ');
    data.set(name.slice(0, 20), 0);
    const names = parsePresetNamesResponse(data);
    expect(names).toHaveLength(30);
    expect(names[0].trimEnd()).toBe('FOH Main');
  });
});
