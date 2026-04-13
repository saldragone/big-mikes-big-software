import { useRef, useEffect, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EQFilter {
  filterNum: number;
  freq: number;       // Hz
  q: number;
  gain_dB: number;
  filterType: number; // 0=parametric, 1=low shelf 1st, 2=low shelf 2nd, 3=high shelf 1st, 4=high shelf 2nd
}

interface Props {
  filters: EQFilter[];
  className?: string;
  height?: number;
}

// ── DSP constants ─────────────────────────────────────────────────────────────

const SAMPLE_RATE = 48000;
const FREQ_MIN = 20;
const FREQ_MAX = 20000;
const DB_RANGE = 18;           // ±18 dB axis
const NUM_POINTS = 512;        // frequency samples for curve drawing

// ── DSP helpers ───────────────────────────────────────────────────────────────

/**
 * Evaluate |H(e^jw)|^2 for a biquad with coefficients [b0,b1,b2] / [a0,a1,a2]
 * at normalized angular frequency w = 2*pi*f/sampleRate.
 *
 * Uses the exact complex-polynomial form:
 *   H(z) = (b0 + b1*z^-1 + b2*z^-2) / (a0 + a1*z^-1 + a2*z^-2)
 * at z = e^(jw).
 */
function biquadMagnitude(
  b0: number, b1: number, b2: number,
  a0: number, a1: number, a2: number,
  w: number
): number {
  const cosW  = Math.cos(w);
  const cos2W = Math.cos(2 * w);
  const sinW  = Math.sin(w);
  const sin2W = Math.sin(2 * w);

  // Numerator: B(e^jw) = b0 + b1*e^-jw + b2*e^-2jw
  const bRe = b0 + b1 * cosW + b2 * cos2W;
  const bIm =    - b1 * sinW - b2 * sin2W;
  const bMag2 = bRe * bRe + bIm * bIm;

  // Denominator: A(e^jw)
  const aRe = a0 + a1 * cosW + a2 * cos2W;
  const aIm =    - a1 * sinW - a2 * sin2W;
  const aMag2 = aRe * aRe + aIm * aIm;

  if (aMag2 === 0) return 1;
  return Math.sqrt(bMag2 / aMag2);
}

/**
 * Returns a function freq→magnitudeLinear for a single EQ filter.
 */
function makeFilterResponse(filter: EQFilter): (freq: number) => number {
  const { freq: fc, q, gain_dB, filterType } = filter;
  const G = Math.pow(10, gain_dB / 20); // linear gain

  // Protect against degenerate params
  const safeQ  = Math.max(0.01, q);
  const safeFc = Math.max(1, Math.min(fc, SAMPLE_RATE / 2 - 1));

  const w0    = (2 * Math.PI * safeFc) / SAMPLE_RATE;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha  = sinW0 / (2 * safeQ);

  switch (filterType) {
    // ── Parametric (peaking EQ) ──────────────────────────────────────────────
    case 0: {
      const A      = Math.sqrt(G);
      const alphaA = alpha * A;
      const alphaD = alpha / A;
      const b0 = 1 + alphaA;
      const b1 = -2 * cosW0;
      const b2 = 1 - alphaA;
      const a0 = 1 + alphaD;
      const a1 = -2 * cosW0;
      const a2 = 1 - alphaD;
      return (freq: number) => {
        const w = (2 * Math.PI * freq) / SAMPLE_RATE;
        return biquadMagnitude(b0, b1, b2, a0, a1, a2, w);
      };
    }

    // ── Low shelf 1st order ──────────────────────────────────────────────────
    case 1: {
      // First-order low shelf: bilinear transform of analog s-domain shelf.
      // Approximate using first-order difference equation.
      // H(s) = G * (s/wc + 1/G) / (s/wc + 1)  for boost (G>1); gain at 0 = G, at inf = 1.
      // We use a matched 2nd-order biquad with a2=0, b2=0 for "1st order":
      //   Using Audio EQ Cookbook 1st-order low shelf (Q ignored, treated as 1st order slope).
      const A   = Math.sqrt(G);
      const t   = Math.tan((w0) / 2);  // bilinear pre-warp
      // Simple 1st-order bilinear low shelf (A = sqrt(G)):
      //   H(z) = (A*t + 1) / (t/A + 1) evaluated more explicitly:
      const num0 = A * t + 1;   // b0+b1 expanded
      const den0 = t / A + 1;   // a0+a1

      return (freq: number) => {
        const wf = (2 * Math.PI * freq) / SAMPLE_RATE;
        const tf = Math.tan(wf / 2);
        // H(jw) = (A*tf + 1) / (tf/A + 1)  — complex substitution
        // With bilinear z→(1+t)/(1-t), evaluate at z=e^jw:
        // Numerator:   b0 + b1*z^-1 = (A*t+1) + (A*t-1)*z^-1 → complex at z=e^jwf
        const b0f = A * t + 1;   const b1f = A * t - 1;
        const a0f = t / A + 1;   const a1f = t / A - 1;
        // Evaluate b0f + b1f*e^-jwf
        const bRe = b0f + b1f * Math.cos(wf);
        const bIm =     - b1f * Math.sin(wf);
        const aRe = a0f + a1f * Math.cos(wf);
        const aIm =     - a1f * Math.sin(wf);
        const bM = Math.sqrt(bRe * bRe + bIm * bIm);
        const aM = Math.sqrt(aRe * aRe + aIm * aIm);
        return aM === 0 ? 1 : bM / aM;
        void num0; void den0; // suppress unused
      };
    }

    // ── Low shelf 2nd order ──────────────────────────────────────────────────
    case 2: {
      // Audio EQ Cookbook lowShelf with Q controlling shelf slope
      const A      = Math.sqrt(G);
      const sqrtA  = Math.sqrt(A);
      const b0 = A * ((A + 1) - (A - 1) * cosW0 + 2 * sqrtA * alpha);
      const b1 = 2 * A * ((A - 1) - (A + 1) * cosW0);
      const b2 = A * ((A + 1) - (A - 1) * cosW0 - 2 * sqrtA * alpha);
      const a0 =      (A + 1) + (A - 1) * cosW0 + 2 * sqrtA * alpha;
      const a1 = -2 *          ((A - 1) + (A + 1) * cosW0);
      const a2 =      (A + 1) + (A - 1) * cosW0 - 2 * sqrtA * alpha;
      return (freq: number) => {
        const w = (2 * Math.PI * freq) / SAMPLE_RATE;
        return biquadMagnitude(b0, b1, b2, a0, a1, a2, w);
      };
    }

    // ── High shelf 1st order ─────────────────────────────────────────────────
    case 3: {
      const A  = Math.sqrt(G);
      const t  = Math.tan(w0 / 2);
      return (freq: number) => {
        const wf = (2 * Math.PI * freq) / SAMPLE_RATE;
        const tf = Math.tan(wf / 2);
        // High shelf 1st order: gain at high freq = A^2, at DC = 1
        //   b0 = A+tf*A^2, b1 = A - tf*A^2; a0 = A+tf, a1 = A-tf  (normalized by A)
        //   Simpler: swap role of s and 1/s from low shelf
        const b0f = 1 + A * tf;   const b1f = 1 - A * tf;
        const a0f = A + tf;       const a1f = A - tf;
        const bRe = b0f + b1f * Math.cos(wf);
        const bIm =     - b1f * Math.sin(wf);
        const aRe = a0f + a1f * Math.cos(wf);
        const aIm =     - a1f * Math.sin(wf);
        const bM = Math.sqrt(bRe * bRe + bIm * bIm);
        const aM = Math.sqrt(aRe * aRe + aIm * aIm);
        return aM === 0 ? 1 : bM / aM;
        void t;
      };
    }

    // ── High shelf 2nd order ─────────────────────────────────────────────────
    case 4: {
      const A     = Math.sqrt(G);
      const sqrtA = Math.sqrt(A);
      const b0 = A * ((A + 1) + (A - 1) * cosW0 + 2 * sqrtA * alpha);
      const b1 = -2 * A * ((A - 1) + (A + 1) * cosW0);
      const b2 = A * ((A + 1) + (A - 1) * cosW0 - 2 * sqrtA * alpha);
      const a0 =      (A + 1) - (A - 1) * cosW0 + 2 * sqrtA * alpha;
      const a1 =  2 *          ((A - 1) - (A + 1) * cosW0);
      const a2 =      (A + 1) - (A - 1) * cosW0 - 2 * sqrtA * alpha;
      return (freq: number) => {
        const w = (2 * Math.PI * freq) / SAMPLE_RATE;
        return biquadMagnitude(b0, b1, b2, a0, a1, a2, w);
      };
    }

    // ── Unknown — passthrough ────────────────────────────────────────────────
    default:
      return () => 1;
  }
}

/**
 * Compute the composite magnitude response (in dB) across NUM_POINTS
 * log-spaced frequency samples.
 */
function computeCompositeResponse(filters: EQFilter[]): Float32Array {
  const responses = filters.map(makeFilterResponse);
  const result = new Float32Array(NUM_POINTS);

  for (let i = 0; i < NUM_POINTS; i++) {
    const t    = i / (NUM_POINTS - 1);
    const freq = FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, t);
    let magLin = 1;
    for (const resp of responses) {
      magLin *= resp(freq);
    }
    result[i] = 20 * Math.log10(Math.max(1e-10, magLin));
  }

  return result;
}

/**
 * Compute individual filter response curves (in dB).
 */
function computeIndividualResponse(filter: EQFilter): Float32Array {
  const resp   = makeFilterResponse(filter);
  const result = new Float32Array(NUM_POINTS);
  for (let i = 0; i < NUM_POINTS; i++) {
    const t    = i / (NUM_POINTS - 1);
    const freq = FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, t);
    const mag  = resp(freq);
    result[i]  = 20 * Math.log10(Math.max(1e-10, mag));
  }
  return result;
}

// ── Canvas drawing helpers ────────────────────────────────────────────────────

/** Map a frequency to canvas X pixel (log scale). */
function freqToX(freq: number, width: number): number {
  const t = Math.log(freq / FREQ_MIN) / Math.log(FREQ_MAX / FREQ_MIN);
  return t * width;
}

/** Map dB value to canvas Y pixel. */
function dbToY(db: number, height: number, paddingTop: number, paddingBottom: number): number {
  const drawH = height - paddingTop - paddingBottom;
  const t = (DB_RANGE - db) / (2 * DB_RANGE); // 0 = top (+DB_RANGE), 1 = bottom (-DB_RANGE)
  return paddingTop + t * drawH;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function EQCurve({ filters, className = '', height = 120 }: Props) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W  = canvas.width;
    const H  = canvas.height;

    // ── Padding ──────────────────────────────────────────────────────────────
    const PAD_LEFT   = 36;   // room for dB labels
    const PAD_RIGHT  = 6;
    const PAD_TOP    = 6;
    const PAD_BOTTOM = 18;   // room for freq labels

    const drawW = W - PAD_LEFT - PAD_RIGHT;
    const drawH = H - PAD_TOP - PAD_BOTTOM;

    const xOf  = (freq: number) => PAD_LEFT + freqToX(freq, drawW);
    const yOf  = (db: number)   => dbToY(db, H, PAD_TOP, PAD_BOTTOM);

    // ── Clear ────────────────────────────────────────────────────────────────
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, 0, W, H);

    // ── Grid ─────────────────────────────────────────────────────────────────

    // Vertical frequency grid lines (octave intervals)
    const freqGridLines = [20, 40, 80, 160, 320, 640, 1250, 2500, 5000, 10000, 20000];
    ctx.strokeStyle = '#2c2c2c';
    ctx.lineWidth   = 1;
    for (const f of freqGridLines) {
      const x = xOf(f);
      ctx.beginPath();
      ctx.moveTo(x, PAD_TOP);
      ctx.lineTo(x, PAD_TOP + drawH);
      ctx.stroke();
    }

    // Horizontal dB grid lines
    const dbGridLines = [-12, -6, 0, 6, 12];
    for (const db of dbGridLines) {
      const y = yOf(db);
      ctx.strokeStyle = db === 0 ? '#444444' : '#2c2c2c';
      ctx.lineWidth   = db === 0 ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(PAD_LEFT, y);
      ctx.lineTo(PAD_LEFT + drawW, y);
      ctx.stroke();
    }

    // ── Axis labels ───────────────────────────────────────────────────────────

    ctx.fillStyle = '#6b7280';
    ctx.font      = '9px sans-serif';
    ctx.textAlign = 'center';

    // Frequency labels
    const freqLabels: [number, string][] = [
      [100, '100'],
      [1000, '1k'],
      [10000, '10k'],
    ];
    for (const [f, lbl] of freqLabels) {
      ctx.fillText(lbl, xOf(f), H - 4);
    }

    // dB labels
    ctx.textAlign = 'right';
    const dbLabels = [-12, -6, 0, 6, 12];
    for (const db of dbLabels) {
      ctx.fillStyle = db === 0 ? '#9ca3af' : '#6b7280';
      ctx.fillText(db === 0 ? '0' : `${db > 0 ? '+' : ''}${db}`, PAD_LEFT - 3, yOf(db) + 3);
    }

    // ── Individual filter curves (dim) ────────────────────────────────────────

    for (const filter of filters) {
      if (Math.abs(filter.gain_dB) < 0.1) continue; // skip near-unity filters
      const curve = computeIndividualResponse(filter);
      ctx.strokeStyle = 'rgba(249,115,22,0.2)';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      for (let i = 0; i < NUM_POINTS; i++) {
        const t    = i / (NUM_POINTS - 1);
        const freq = FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, t);
        const x    = xOf(freq);
        const y    = yOf(Math.max(-DB_RANGE, Math.min(DB_RANGE, curve[i])));
        if (i === 0) ctx.moveTo(x, y);
        else         ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // ── Composite response curve ──────────────────────────────────────────────

    const composite = computeCompositeResponse(filters);

    ctx.strokeStyle = '#f97316';
    ctx.lineWidth   = 2;
    ctx.lineJoin    = 'round';
    ctx.beginPath();
    for (let i = 0; i < NUM_POINTS; i++) {
      const t    = i / (NUM_POINTS - 1);
      const freq = FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, t);
      const x    = xOf(freq);
      const y    = yOf(Math.max(-DB_RANGE, Math.min(DB_RANGE, composite[i])));
      if (i === 0) ctx.moveTo(x, y);
      else         ctx.lineTo(x, y);
    }
    ctx.stroke();

    // ── Draw area fill under composite curve ──────────────────────────────────

    const zeroY = yOf(0);
    ctx.beginPath();
    for (let i = 0; i < NUM_POINTS; i++) {
      const t    = i / (NUM_POINTS - 1);
      const freq = FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, t);
      const x    = xOf(freq);
      const y    = yOf(Math.max(-DB_RANGE, Math.min(DB_RANGE, composite[i])));
      if (i === 0) ctx.moveTo(x, y);
      else         ctx.lineTo(x, y);
    }
    // Close back along zero line
    {
      const lastT    = 1;
      const lastFreq = FREQ_MAX;
      const lastX    = xOf(lastFreq);
      ctx.lineTo(lastX, zeroY);
      const firstX = xOf(FREQ_MIN);
      ctx.lineTo(firstX, zeroY);
    }
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, PAD_TOP, 0, PAD_TOP + drawH);
    grad.addColorStop(0,   'rgba(249,115,22,0.15)');
    grad.addColorStop(0.5, 'rgba(249,115,22,0.05)');
    grad.addColorStop(1,   'rgba(249,115,22,0.0)');
    ctx.fillStyle = grad;
    ctx.fill();

    // ── Clip the draw area ────────────────────────────────────────────────────
    // Draw a border rect to frame the plot area
    ctx.strokeStyle = '#333333';
    ctx.lineWidth   = 1;
    ctx.strokeRect(PAD_LEFT, PAD_TOP, drawW, drawH);

  }, [filters]);

  // ── Respond to container resize ───────────────────────────────────────────

  useEffect(() => {
    const canvas    = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        if (canvas.width !== Math.round(width)) {
          canvas.width  = Math.round(width);
          canvas.height = height;
          draw();
        }
      }
    });

    observer.observe(container);

    // Initial size
    const rect   = container.getBoundingClientRect();
    canvas.width  = Math.round(rect.width) || 300;
    canvas.height = height;
    draw();

    return () => observer.disconnect();
  }, [height, draw]);

  // ── Redraw whenever filters change ───────────────────────────────────────

  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <div ref={containerRef} className={`w-full bg-[#1e1e1e] rounded overflow-hidden ${className}`}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: `${height}px` }}
        aria-label="EQ frequency response curve"
      />
    </div>
  );
}
