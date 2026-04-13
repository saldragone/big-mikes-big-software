import { useRef, useEffect, useCallback } from 'react';

interface MeterLevel {
  level_dBu: number;
  clipped: boolean;
}

interface Props {
  levels: MeterLevel[];       // length 12: 4 inputs then 8 outputs
  gainReduction: number[];    // length 8: dB of gain reduction per output
  inputLabels: string[];      // ['A','B','C','D']
  outputLabels: string[];     // ['1'..'8']
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DB_MIN = -42;
const DB_MAX = 20;
const DB_RANGE = DB_MAX - DB_MIN; // 62 dB

const DECAY_RATE_DB_PER_SEC = 20;   // meter bar falloff
const PEAK_HOLD_MS = 2000;           // how long peak line is held
const PEAK_DECAY_DB_PER_SEC = 10;   // peak line falloff after hold expires

const COLOR_GREEN  = '#22c55e';
const COLOR_YELLOW = '#eab308';
const COLOR_RED    = '#ef4444';
const COLOR_CLIP   = '#ff0000';
const COLOR_GR     = '#3b82f6';      // gain reduction overlay
const COLOR_BG     = '#1e1e1e';
const COLOR_TRACK  = '#2c2c2c';
const COLOR_LABEL  = '#9ca3af';      // gray-400
const COLOR_GROUP  = '#6b7280';      // gray-500
const COLOR_PEAK   = '#ffffff';
const COLOR_CLIP_INACTIVE = '#3a1111';

const CLIP_LED_H = 6;   // px height of clip LED at top

// dBu → 0..1 (0 = bottom, 1 = top)
function dbToFraction(dbu: number): number {
  return Math.max(0, Math.min(1, (dbu - DB_MIN) / DB_RANGE));
}

// Per-channel runtime state (mutable, lives outside React state for perf)
interface ChanState {
  displayDb: number;        // smoothed meter level
  peakDb: number;           // peak hold level
  peakTimestamp: number;    // when peak was last updated
  peakDecaying: boolean;    // whether peak line is decaying
  clipped: boolean;         // latched clip flag
}

function makeChanState(): ChanState {
  return {
    displayDb: DB_MIN,
    peakDb: DB_MIN,
    peakTimestamp: 0,
    peakDecaying: false,
    clipped: false,
  };
}

export default function MeterBridge({
  levels,
  gainReduction,
  inputLabels,
  outputLabels,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);
  const lastTsRef = useRef<number>(0);

  // 12 channels of runtime state — never triggers re-render
  const chanStates = useRef<ChanState[]>(
    Array.from({ length: 12 }, makeChanState)
  );

  // Live levels forwarded into the ref so the animation loop can read them
  // without re-subscribing to RAF on every prop change.
  const levelsRef        = useRef<MeterLevel[]>(levels);
  const gainReductionRef = useRef<number[]>(gainReduction);
  levelsRef.current        = levels;
  gainReductionRef.current = gainReduction;

  const draw = useCallback((ts: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // ── Layout ──────────────────────────────────────────────────────────────

    const W = canvas.width;
    const H = canvas.height;

    const isMobile = W < 480;
    const barW     = isMobile ? 20 : 16;
    const gapW     = 2;
    const stride   = barW + gapW;

    const LABEL_H  = 18;    // px at bottom for channel labels
    const GROUP_H  = 14;    // px at top for group labels
    const MARGIN_L = 4;

    const trackH = H - LABEL_H - GROUP_H - CLIP_LED_H - 4; // usable bar height

    const dt = lastTsRef.current ? Math.min((ts - lastTsRef.current) / 1000, 0.1) : 0;
    lastTsRef.current = ts;

    // ── Update state ────────────────────────────────────────────────────────

    const liveL = levelsRef.current;
    const states = chanStates.current;

    for (let i = 0; i < 12; i++) {
      const live = liveL[i] ?? { level_dBu: DB_MIN, clipped: false };
      const s = states[i];

      // Latch clip
      if (live.clipped) s.clipped = true;

      // Smooth decay on meter bar
      if (live.level_dBu >= s.displayDb) {
        s.displayDb = live.level_dBu;
      } else {
        s.displayDb = Math.max(
          DB_MIN,
          s.displayDb - DECAY_RATE_DB_PER_SEC * dt
        );
      }

      // Peak hold logic
      if (live.level_dBu >= s.peakDb) {
        s.peakDb        = live.level_dBu;
        s.peakTimestamp = ts;
        s.peakDecaying  = false;
      } else if (!s.peakDecaying && ts - s.peakTimestamp > PEAK_HOLD_MS) {
        s.peakDecaying = true;
      } else if (s.peakDecaying) {
        s.peakDb = Math.max(DB_MIN, s.peakDb - PEAK_DECAY_DB_PER_SEC * dt);
      }
    }

    // ── Clear ────────────────────────────────────────────────────────────────

    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, W, H);

    // ── Group labels ─────────────────────────────────────────────────────────

    ctx.fillStyle = COLOR_GROUP;
    ctx.font = `10px sans-serif`;
    ctx.textAlign = 'left';

    const inputsWidth  = 4 * stride;
    const outputsWidth = 8 * stride;
    const inputsX  = MARGIN_L;
    const gap3     = 12;
    const outputsX = inputsX + inputsWidth + gap3;

    ctx.fillText('Inputs',  inputsX,  GROUP_H - 2);
    ctx.fillText('Outputs', outputsX, GROUP_H - 2);

    // ── Draw channels ────────────────────────────────────────────────────────

    const drawChannel = (
      chIdx: number,     // 0-11
      xLeft: number,
      isOutput: boolean,
      label: string
    ) => {
      const s = states[chIdx];
      const grDb = isOutput ? (gainReductionRef.current[chIdx - 4] ?? 0) : 0;

      const topY    = GROUP_H + CLIP_LED_H + 4;
      const bottomY = topY + trackH;

      // Background track
      ctx.fillStyle = COLOR_TRACK;
      ctx.fillRect(xLeft, topY, barW, trackH);

      // Meter bar
      const frac = dbToFraction(s.displayDb);
      const barH = Math.round(frac * trackH);
      const barY = bottomY - barH;

      if (barH > 0) {
        // Split bar into color zones: draw from bottom up
        //   green:  DB_MIN  .. -10 dBu
        //   yellow: -10     .. -3  dBu
        //   red:    -3      .. DB_MAX

        const yellowThresh = dbToFraction(-10);
        const redThresh    = dbToFraction(-3);

        const greenH  = Math.min(frac, yellowThresh) * trackH;
        const yellowH = Math.max(0, Math.min(frac, redThresh) - yellowThresh) * trackH;
        const redH    = Math.max(0, frac - redThresh) * trackH;

        // Green
        if (greenH > 0) {
          ctx.fillStyle = COLOR_GREEN;
          ctx.fillRect(xLeft, bottomY - Math.round(greenH), barW, Math.round(greenH));
        }
        // Yellow
        if (yellowH > 0) {
          ctx.fillStyle = COLOR_YELLOW;
          ctx.fillRect(
            xLeft,
            bottomY - Math.round(greenH) - Math.round(yellowH),
            barW,
            Math.round(yellowH)
          );
        }
        // Red
        if (redH > 0) {
          ctx.fillStyle = COLOR_RED;
          ctx.fillRect(xLeft, barY, barW, Math.round(redH));
        }
      }

      // Gain reduction overlay (blue, from top of filled bar downward by GR amount)
      if (isOutput && grDb > 0) {
        const grFrac = Math.min(grDb / DB_RANGE, 1);
        const grPx   = Math.round(grFrac * trackH);
        // Draw from top of current bar segment downward
        const overlayTop = barY;
        const overlayH   = Math.min(grPx, barH);
        if (overlayH > 0) {
          ctx.fillStyle = COLOR_GR;
          ctx.globalAlpha = 0.55;
          ctx.fillRect(xLeft, overlayTop, barW, overlayH);
          ctx.globalAlpha = 1.0;
        }
      }

      // Peak hold line
      if (s.peakDb > DB_MIN) {
        const pFrac = dbToFraction(s.peakDb);
        const pY    = bottomY - Math.round(pFrac * trackH);
        ctx.strokeStyle = COLOR_PEAK;
        ctx.globalAlpha = s.peakDecaying ? Math.max(0, (s.peakDb - DB_MIN) / DB_RANGE) : 0.9;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xLeft, pY);
        ctx.lineTo(xLeft + barW, pY);
        ctx.stroke();
        ctx.globalAlpha = 1.0;
      }

      // Clip LED
      ctx.fillStyle = s.clipped ? COLOR_CLIP : COLOR_CLIP_INACTIVE;
      ctx.fillRect(xLeft, GROUP_H, barW, CLIP_LED_H);

      // Channel label
      ctx.fillStyle = COLOR_LABEL;
      ctx.font = `10px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(label, xLeft + barW / 2, H - 3);
    };

    // Inputs (channels 0-3)
    for (let i = 0; i < 4; i++) {
      drawChannel(i, inputsX + i * stride, false, inputLabels[i] ?? String(i + 1));
    }

    // Outputs (channels 4-11)
    for (let i = 0; i < 8; i++) {
      drawChannel(4 + i, outputsX + i * stride, true, outputLabels[i] ?? String(i + 1));
    }

    rafRef.current = requestAnimationFrame(draw);
  }, [inputLabels, outputLabels]);

  // ── Resize canvas to match its CSS size ──────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (canvas.width !== Math.round(width) || canvas.height !== Math.round(height)) {
          canvas.width  = Math.round(width);
          canvas.height = Math.round(height);
        }
      }
    });

    observer.observe(canvas);

    // Set initial size
    const rect = canvas.getBoundingClientRect();
    canvas.width  = Math.round(rect.width)  || 300;
    canvas.height = Math.round(rect.height) || 120;

    return () => observer.disconnect();
  }, []);

  // ── Start / stop animation loop ──────────────────────────────────────────

  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [draw]);

  // ── Tap to clear clip latch ───────────────────────────────────────────────

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const y = e.clientY - rect.top;
    // Click in top GROUP_H + CLIP_LED_H area clears all clip latches
    if (y < 24) {
      chanStates.current.forEach((s) => { s.clipped = false; });
    }
  }, []);

  return (
    <div className="w-full bg-[#1e1e1e] rounded overflow-hidden">
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        className="w-full"
        style={{ height: '140px', display: 'block', cursor: 'default' }}
        title="Click top area to clear clip indicators"
      />
    </div>
  );
}
