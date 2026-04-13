import { useRef, useEffect, useCallback, useState } from 'react';

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
  interactive?: boolean;
  onFilterChange?: (filter: EQFilter) => void;
}

// ── DSP constants ─────────────────────────────────────────────────────────────

const SAMPLE_RATE = 48000;
const FREQ_MIN = 20;
const FREQ_MAX = 20000;
const DB_RANGE = 18;           // ±18 dB axis
const NUM_POINTS = 512;        // frequency samples for curve drawing

// ── Band colors for individual filter curves & handles ────────────────────────
const BAND_COLORS = [
  '#f85149', // red
  '#f0883e', // orange
  '#d29922', // yellow
  '#3fb950', // green
  '#58a6ff', // blue
  '#bc8cff', // purple
  '#f778ba', // pink
  '#79c0ff', // light blue
];

// ── DSP helpers ───────────────────────────────────────────────────────────────

function biquadMagnitude(
  b0: number, b1: number, b2: number,
  a0: number, a1: number, a2: number,
  w: number
): number {
  const cosW  = Math.cos(w);
  const cos2W = Math.cos(2 * w);
  const sinW  = Math.sin(w);
  const sin2W = Math.sin(2 * w);

  const bRe = b0 + b1 * cosW + b2 * cos2W;
  const bIm =    - b1 * sinW - b2 * sin2W;
  const bMag2 = bRe * bRe + bIm * bIm;

  const aRe = a0 + a1 * cosW + a2 * cos2W;
  const aIm =    - a1 * sinW - a2 * sin2W;
  const aMag2 = aRe * aRe + aIm * aIm;

  if (aMag2 === 0) return 1;
  return Math.sqrt(bMag2 / aMag2);
}

function makeFilterResponse(filter: EQFilter): (freq: number) => number {
  const { freq: fc, q, gain_dB, filterType } = filter;
  const G = Math.pow(10, gain_dB / 20);

  const safeQ  = Math.max(0.01, q);
  const safeFc = Math.max(1, Math.min(fc, SAMPLE_RATE / 2 - 1));

  const w0    = (2 * Math.PI * safeFc) / SAMPLE_RATE;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha  = sinW0 / (2 * safeQ);

  switch (filterType) {
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
    case 1: {
      const A   = Math.sqrt(G);
      const t   = Math.tan((w0) / 2);
      const num0 = A * t + 1;
      const den0 = t / A + 1;
      return (freq: number) => {
        const wf = (2 * Math.PI * freq) / SAMPLE_RATE;
        const b0f = A * t + 1;   const b1f = A * t - 1;
        const a0f = t / A + 1;   const a1f = t / A - 1;
        const bRe = b0f + b1f * Math.cos(wf);
        const bIm =     - b1f * Math.sin(wf);
        const aRe = a0f + a1f * Math.cos(wf);
        const aIm =     - a1f * Math.sin(wf);
        const bM = Math.sqrt(bRe * bRe + bIm * bIm);
        const aM = Math.sqrt(aRe * aRe + aIm * aIm);
        return aM === 0 ? 1 : bM / aM;
        void num0; void den0;
      };
    }
    case 2: {
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
    case 3: {
      const A  = Math.sqrt(G);
      const t  = Math.tan(w0 / 2);
      return (freq: number) => {
        const wf = (2 * Math.PI * freq) / SAMPLE_RATE;
        const b0f = 1 + A * Math.tan(wf / 2);   const b1f = 1 - A * Math.tan(wf / 2);
        const a0f = A + Math.tan(wf / 2);       const a1f = A - Math.tan(wf / 2);
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
    default:
      return () => 1;
  }
}

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

function freqToX(freq: number, width: number): number {
  const t = Math.log(freq / FREQ_MIN) / Math.log(FREQ_MAX / FREQ_MIN);
  return t * width;
}

function xToFreq(x: number, width: number): number {
  const t = x / width;
  return FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, t);
}

function dbToY(db: number, height: number, paddingTop: number, paddingBottom: number): number {
  const drawH = height - paddingTop - paddingBottom;
  const t = (DB_RANGE - db) / (2 * DB_RANGE);
  return paddingTop + t * drawH;
}

function yToDb(y: number, height: number, paddingTop: number, paddingBottom: number): number {
  const drawH = height - paddingTop - paddingBottom;
  const t = (y - paddingTop) / drawH;
  return DB_RANGE - t * (2 * DB_RANGE);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function EQCurve({ filters, className = '', height = 120, interactive = false, onFilterChange }: Props) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredBand, setHoveredBand] = useState<number | null>(null);
  const [draggingBand, setDraggingBand] = useState<number | null>(null);
  const draggingRef = useRef<number | null>(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  // Layout constants
  const PAD_LEFT   = 36;
  const PAD_RIGHT  = 6;
  const PAD_TOP    = 6;
  const PAD_BOTTOM = 18;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W  = canvas.width;
    const H  = canvas.height;

    const drawW = W - PAD_LEFT - PAD_RIGHT;
    const drawH = H - PAD_TOP - PAD_BOTTOM;

    const xOf  = (freq: number) => PAD_LEFT + freqToX(freq, drawW);
    const yOf  = (db: number)   => dbToY(db, H, PAD_TOP, PAD_BOTTOM);

    // ── Clear
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, W, H);

    // ── Grid
    const freqGridLines = [20, 40, 80, 160, 320, 640, 1250, 2500, 5000, 10000, 20000];
    ctx.lineWidth = 1;
    for (const f of freqGridLines) {
      const x = xOf(f);
      ctx.strokeStyle = 'rgba(139,148,158,0.08)';
      ctx.beginPath();
      ctx.moveTo(x, PAD_TOP);
      ctx.lineTo(x, PAD_TOP + drawH);
      ctx.stroke();
    }

    const dbGridLines = [-12, -6, 0, 6, 12];
    for (const db of dbGridLines) {
      const y = yOf(db);
      ctx.strokeStyle = db === 0 ? 'rgba(139,148,158,0.2)' : 'rgba(139,148,158,0.08)';
      ctx.lineWidth   = db === 0 ? 1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(PAD_LEFT, y);
      ctx.lineTo(PAD_LEFT + drawW, y);
      ctx.stroke();
    }

    // ── Axis labels
    ctx.fillStyle = '#484f58';
    ctx.font      = '9px -apple-system, sans-serif';
    ctx.textAlign = 'center';

    const freqLabels: [number, string][] = [
      [100, '100'], [1000, '1k'], [10000, '10k'],
    ];
    for (const [f, lbl] of freqLabels) {
      ctx.fillText(lbl, xOf(f), H - 4);
    }

    ctx.textAlign = 'right';
    const dbLabels = [-12, -6, 0, 6, 12];
    for (const db of dbLabels) {
      ctx.fillStyle = db === 0 ? '#6e7681' : '#484f58';
      ctx.fillText(db === 0 ? '0' : `${db > 0 ? '+' : ''}${db}`, PAD_LEFT - 4, yOf(db) + 3);
    }

    // ── Individual filter curves (colored)
    const currentFilters = filtersRef.current;
    for (let fi = 0; fi < currentFilters.length; fi++) {
      const filter = currentFilters[fi];
      if (Math.abs(filter.gain_dB) < 0.1) continue;
      const curve = computeIndividualResponse(filter);
      const color = BAND_COLORS[fi % BAND_COLORS.length];
      const isHovered = hoveredBand === fi || draggingRef.current === fi;
      ctx.strokeStyle = isHovered ? color : color + '40';
      ctx.lineWidth   = isHovered ? 1.5 : 1;
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

    // ── Composite response curve
    const composite = computeCompositeResponse(currentFilters);

    // Area fill
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
    ctx.lineTo(xOf(FREQ_MAX), zeroY);
    ctx.lineTo(xOf(FREQ_MIN), zeroY);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, PAD_TOP, 0, PAD_TOP + drawH);
    grad.addColorStop(0,   'rgba(88,166,255,0.10)');
    grad.addColorStop(0.5, 'rgba(88,166,255,0.03)');
    grad.addColorStop(1,   'rgba(88,166,255,0.0)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Composite line
    ctx.strokeStyle = '#58a6ff';
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

    // ── Draw band handles (interactive mode)
    if (interactive) {
      for (let fi = 0; fi < currentFilters.length; fi++) {
        const filter = currentFilters[fi];
        const color = BAND_COLORS[fi % BAND_COLORS.length];
        const x = xOf(filter.freq);
        const y = yOf(Math.max(-DB_RANGE, Math.min(DB_RANGE, filter.gain_dB)));
        const isActive = hoveredBand === fi || draggingRef.current === fi;
        const radius = isActive ? 7 : 5;

        // Glow
        if (isActive) {
          ctx.beginPath();
          ctx.arc(x, y, 12, 0, Math.PI * 2);
          ctx.fillStyle = color + '20';
          ctx.fill();
        }

        // Handle circle
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = isActive ? color : color + 'B0';
        ctx.fill();
        ctx.strokeStyle = '#0d1117';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Band label
        if (isActive) {
          ctx.fillStyle = '#e1e4e8';
          ctx.font = 'bold 9px -apple-system, sans-serif';
          ctx.textAlign = 'center';
          const labelY = y < PAD_TOP + 20 ? y + 18 : y - 12;
          ctx.fillText(`${filter.freq}Hz  ${filter.gain_dB >= 0 ? '+' : ''}${filter.gain_dB.toFixed(1)}dB`, x, labelY);
        }
      }
    }

    // ── Border
    ctx.strokeStyle = '#21262d';
    ctx.lineWidth   = 1;
    ctx.strokeRect(PAD_LEFT, PAD_TOP, drawW, drawH);

  }, [filters, hoveredBand, interactive]);

  // ── Respond to container resize
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

    const rect   = container.getBoundingClientRect();
    canvas.width  = Math.round(rect.width) || 300;
    canvas.height = height;
    draw();

    return () => observer.disconnect();
  }, [height, draw]);

  // ── Redraw whenever filters change
  useEffect(() => {
    draw();
  }, [draw]);

  // ── Mouse interaction for dragging band handles
  const getCanvasCoords = useCallback((e: React.MouseEvent | MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  const findBandAtPoint = useCallback((px: number, py: number): number | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const W = canvas.width;
    const H = canvas.height;
    const drawW = W - PAD_LEFT - PAD_RIGHT;

    let closest = -1;
    let closestDist = Infinity;

    for (let fi = 0; fi < filtersRef.current.length; fi++) {
      const filter = filtersRef.current[fi];
      const x = PAD_LEFT + freqToX(filter.freq, drawW);
      const y = dbToY(Math.max(-DB_RANGE, Math.min(DB_RANGE, filter.gain_dB)), H, PAD_TOP, PAD_BOTTOM);
      const dist = Math.sqrt((px - x) ** 2 + (py - y) ** 2);
      if (dist < closestDist) {
        closestDist = dist;
        closest = fi;
      }
    }

    return closestDist < 20 ? closest : null;
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!interactive) return;
    const coords = getCanvasCoords(e);
    if (!coords) return;

    if (draggingRef.current !== null) {
      // Dragging — update filter
      const canvas = canvasRef.current;
      if (!canvas || !onFilterChange) return;
      const W = canvas.width;
      const H = canvas.height;
      const drawW = W - PAD_LEFT - PAD_RIGHT;
      const localX = coords.x - PAD_LEFT;
      const freq = Math.round(Math.max(20, Math.min(20000, xToFreq(localX, drawW))));
      const gain = Math.round(Math.max(-15, Math.min(15, yToDb(coords.y, H, PAD_TOP, PAD_BOTTOM))) * 2) / 2;
      const filter = filtersRef.current[draggingRef.current];
      if (filter && (filter.freq !== freq || filter.gain_dB !== gain)) {
        onFilterChange({ ...filter, freq, gain_dB: gain });
      }
    } else {
      // Hovering
      const band = findBandAtPoint(coords.x, coords.y);
      setHoveredBand(band);
    }
  }, [interactive, getCanvasCoords, findBandAtPoint, onFilterChange]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!interactive) return;
    const coords = getCanvasCoords(e);
    if (!coords) return;
    const band = findBandAtPoint(coords.x, coords.y);
    if (band !== null) {
      e.preventDefault();
      draggingRef.current = band;
      setDraggingBand(band);
    }
  }, [interactive, getCanvasCoords, findBandAtPoint]);

  const handleMouseUp = useCallback(() => {
    if (draggingRef.current !== null) {
      draggingRef.current = null;
      setDraggingBand(null);
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoveredBand(null);
    if (draggingRef.current !== null) {
      draggingRef.current = null;
      setDraggingBand(null);
    }
  }, []);

  // Global mouseup listener for drag release
  useEffect(() => {
    if (draggingBand === null) return;
    const onUp = () => {
      draggingRef.current = null;
      setDraggingBand(null);
    };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, [draggingBand]);

  return (
    <div
      ref={containerRef}
      className={`w-full rounded-lg overflow-hidden ${className}`}
      style={{ background: '#0d1117', border: interactive ? '1px solid #21262d' : 'none' }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          width: '100%',
          height: `${height}px`,
          cursor: interactive
            ? draggingBand !== null
              ? 'grabbing'
              : hoveredBand !== null
                ? 'grab'
                : 'crosshair'
            : 'default',
        }}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        aria-label="EQ frequency response curve"
      />
    </div>
  );
}
