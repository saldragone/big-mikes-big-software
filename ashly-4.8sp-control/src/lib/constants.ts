// ─── Frame bytes ────────────────────────────────────────────────────────────
export const START_BYTES = [0xf0, 0x00, 0x01, 0x2a, 0x12, 0x00];
export const END_BYTE = 0xf7;
export const CLASS_CONTROL = 0x00;
export const CLASS_BULK = 0x7f;

// ─── Message types ───────────────────────────────────────────────────────────
export const MSG = {
  METER_REQUEST:         0xd0, // single byte, not framed
  METER_RESPONSE:        0x00,
  DATA_REQUEST:          0x01,
  DATA_RESPONSE:         0x02,
  PRESET_NAMES_REQUEST:  0x03,
  PRESET_NAMES_RESPONSE: 0x04,
  PRESET_DOWNLOAD:       0x05,
  GAIN:                  0x06,
  EQ_FILTER:             0x07,
  DELAY:                 0x08,
  CROSSOVER:             0x09,
  LIMITER:               0x0a,
  STATUS:                0x0b,
  PRESET_SAVE:           0x0c,
  WORKING_PRESET_NAME:   0x0d,
  BULK_PRESET_REQUEST:   0x0e,
  // Local change updates (from unit only, after first DATA_REQUEST)
  LOCAL_GAIN:            0x0f,
  LOCAL_EQ:              0x10,
  LOCAL_DELAY:           0x11,
  LOCAL_CROSSOVER:       0x12,
  LOCAL_LIMITER:         0x13,
  LOCAL_STATUS:          0x14,
  PRESET_RECALL:         0x15,
  DEVICE_NAME_REQUEST:   0x16,
  DEVICE_NAME_RESPONSE:  0x17,
  DEVICE_NAME_DOWNLOAD:  0x18,
  GROUP_NAME_REQUEST:    0x19,
  GROUP_NAME_RESPONSE:   0x1a,
  GROUP_NAME_DOWNLOAD:   0x1b,
  GAIN_INC_DEC:          0x1c,
  CHANNEL_MUTE:          0x1d,
  SOURCE_SELECT:         0x1e,
  BULK_PRESET_DATA:      0x7f,
} as const;

// Messages echoed back by unit as confirmation
export const ECHOED_TYPES = new Set([
  MSG.PRESET_DOWNLOAD, MSG.GAIN, MSG.EQ_FILTER, MSG.DELAY,
  MSG.CROSSOVER, MSG.LIMITER, MSG.STATUS, MSG.PRESET_SAVE,
  MSG.WORKING_PRESET_NAME, MSG.PRESET_RECALL, MSG.DEVICE_NAME_DOWNLOAD,
  MSG.GROUP_NAME_DOWNLOAD, MSG.GAIN_INC_DEC, MSG.CHANNEL_MUTE,
  MSG.SOURCE_SELECT,
]);

// ─── Node indices ────────────────────────────────────────────────────────────
export const NODE = {
  INPUT_A: 0,
  INPUT_B: 1,
  INPUT_C: 2,
  INPUT_D: 3,
  OUTPUT_1: 4,
  OUTPUT_2: 5,
  OUTPUT_3: 6,
  OUTPUT_4: 7,
  OUTPUT_5: 8,
  OUTPUT_6: 9,
  OUTPUT_7: 10,
  OUTPUT_8: 11,
} as const;

export const INPUT_NODES  = [0, 1, 2, 3] as const;
export const OUTPUT_NODES = [4, 5, 6, 7, 8, 9, 10, 11] as const;
export const ALL_NODES    = [...INPUT_NODES, ...OUTPUT_NODES] as const;

export const INPUT_LABELS  = ['A', 'B', 'C', 'D'] as const;
export const OUTPUT_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const;

// ─── Gain encoding ───────────────────────────────────────────────────────────
export const GAIN_0DB   = 8192;
export const GAIN_MIN   = 7792; // -40 dB
export const GAIN_MAX   = 8312; // +12 dB
export const GAIN_DB_MIN = -40.0;
export const GAIN_DB_MAX = +12.0;

// ─── EQ filter numbers ───────────────────────────────────────────────────────
// Input A: 0-5, B: 6-11, C: 12-17, D: 18-23
// Output 1: 24-27, Output 2: 28-31 ... Output 8: 52-55
export function inputEqFilterBase(inputIndex: number): number {
  return inputIndex * 6; // 0-3 → 0,6,12,18
}
export function outputEqFilterBase(outputIndex: number): number {
  return 24 + outputIndex * 4; // 0-7 → 24,28,32,36,40,44,48,52
}

// ─── EQ filter types ─────────────────────────────────────────────────────────
export const EQ_TYPE = {
  PARAMETRIC:    0,
  LOW_SHELF_1:   1,
  LOW_SHELF_2:   2,
  HIGH_SHELF_1:  3,
  HIGH_SHELF_2:  4,
} as const;

export const EQ_TYPE_LABELS: Record<number, string> = {
  0: 'Parametric',
  1: 'Low Shelf 1st',
  2: 'Low Shelf 2nd',
  3: 'High Shelf 1st',
  4: 'High Shelf 2nd',
};

// ─── Q lookup table ──────────────────────────────────────────────────────────
// Byte value → Q
export const Q_TABLE: Record<number, number> = {
  0:  64.00, 6:  32.00, 12: 16.00, 18: 8.00, 24: 5.66,
  30: 4.00,  36: 2.83,  42: 2.00,  48: 1.41, 54: 1.00,
  60: 0.71,  66: 0.50,  72: 0.35,  78: 0.25,
};

export const Q_VALUES = Object.values(Q_TABLE).sort((a, b) => b - a);
export const Q_BYTE_VALUES = Object.keys(Q_TABLE).map(Number).sort((a, b) => a - b);

export function closestQByte(q: number): number {
  let best = Q_BYTE_VALUES[0];
  let bestDiff = Math.abs(Q_TABLE[best] - q);
  for (const byte of Q_BYTE_VALUES) {
    const diff = Math.abs(Q_TABLE[byte] - q);
    if (diff < bestDiff) { bestDiff = diff; best = byte; }
  }
  return best;
}

// ─── Crossover filter numbers ────────────────────────────────────────────────
// 0=Out1 HPF, 1=Out1 LPF, 2=Out2 HPF ... 15=Out8 LPF
export function xoverFilterNum(outputIndex: number, isLPF: boolean): number {
  return outputIndex * 2 + (isLPF ? 1 : 0);
}

// ─── Crossover filter types ──────────────────────────────────────────────────
export const XOVER_TYPE = {
  BUTTERWORTH_12: 0,
  BESSEL_12:      1,
  LR_12:          2,
  BUTTERWORTH_18: 3,
  BESSEL_18:      4,
  BUTTERWORTH_24: 5,
  BESSEL_24:      6,
  LR_24:          7,
} as const;

export const XOVER_TYPE_LABELS: Record<number, string> = {
  0: 'Butterworth 12dB',
  1: 'Bessel 12dB',
  2: 'Linkwitz-Riley 12dB',
  3: 'Butterworth 18dB',
  4: 'Bessel 18dB',
  5: 'Butterworth 24dB',
  6: 'Bessel 24dB',
  7: 'Linkwitz-Riley 24dB',
};

// ─── Frequency encoding ──────────────────────────────────────────────────────
export const FREQ_HPF_OFF    = 10;  // HPF off value
export const FREQ_LPF_OFF    = 255; // LPF off value
export const FREQ_MIN_VALUE  = 11;
export const FREQ_MAX_VALUE  = 254;

// ─── Delay ───────────────────────────────────────────────────────────────────
export const DELAY_SAMPLE_RATE = 48000;
export const DELAY_FIXED_LATENCY_MS = 1.46; // fixed hardware latency
export const DELAY_MAX_SAMPLES = 32767;
export const DELAY_MAX_MS = (DELAY_MAX_SAMPLES / DELAY_SAMPLE_RATE) * 1000; // ~682.64ms

// ─── Limiter ─────────────────────────────────────────────────────────────────
export const LIMITER_THRESHOLD_MIN = 0x2c; // -20 dBu
export const LIMITER_THRESHOLD_MAX = 0x54; // +20 dBu
export const LIMITER_THRESHOLD_0DBU = 0x40;

export const LIMITER_RATIO_LABELS = ['1.2:1','1.5:1','2:1','3:1','4:1','6:1','10:1','20:1','INF:1'];
export const LIMITER_ATTACK_LABELS = ['0.5','1','2','5','10','20','50'];
export const LIMITER_RELEASE_LABELS = ['10','20','50','100','200','500','1000'];

// ─── Preset ───────────────────────────────────────────────────────────────────
export const PRESET_COUNT    = 30;
export const PRESET_NAME_LEN = 20;

// ─── Serial ───────────────────────────────────────────────────────────────────
export const SERIAL_BAUD_RATE = 9600;
export const METER_POLL_INTERVAL_MS = 100;
