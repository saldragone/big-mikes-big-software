import { useRef, useState, useEffect, useCallback, KeyboardEvent, ChangeEvent } from 'react';

interface Props {
  value: number;
  min: number;
  max: number;
  step: number;
  label?: string;
  unit?: string;
  onChange: (val: number) => void;
  onCommit?: (val: number) => void;
  disabled?: boolean;
  className?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function formatDb(v: number): string {
  return v.toFixed(1);
}

// Round to the nearest multiple of `step` to avoid floating-point drift
function snapToStep(v: number, step: number, min: number): number {
  const steps = Math.round((v - min) / step);
  return min + steps * step;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Fader({
  value,
  min,
  max,
  step,
  label,
  unit = 'dB',
  onChange,
  onCommit,
  disabled = false,
  className = '',
}: Props) {
  // Local text-input state so the user can type freely before committing
  const [inputText, setInputText] = useState<string>(formatDb(value));
  const [editingText, setEditingText] = useState<boolean>(false);

  // Keep inputText in sync with prop when not actively editing
  useEffect(() => {
    if (!editingText) {
      setInputText(formatDb(value));
    }
  }, [value, editingText]);

  // ── Range input handlers ────────────────────────────────────────────────────

  const handleRangeChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      if (disabled) return;
      const raw = parseFloat(e.target.value);
      const snapped = snapToStep(clamp(raw, min, max), step, min);
      onChange(snapped);
    },
    [disabled, min, max, step, onChange]
  );

  const handleRangeMouseUp = useCallback(() => {
    if (disabled) return;
    onCommit?.(value);
  }, [disabled, value, onCommit]);

  const handleRangeTouchEnd = useCallback(() => {
    if (disabled) return;
    onCommit?.(value);
  }, [disabled, value, onCommit]);

  // ── Keyboard handler on range input ─────────────────────────────────────────

  const handleRangeKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (disabled) return;
      const multiplier = e.shiftKey ? 10 : 1;
      let delta = 0;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
        delta = step * multiplier;
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
        delta = -step * multiplier;
      } else {
        return;
      }
      e.preventDefault();
      const next = snapToStep(clamp(value + delta, min, max), step, min);
      onChange(next);
      onCommit?.(next);
    },
    [disabled, value, min, max, step, onChange, onCommit]
  );

  // ── Text input handlers ──────────────────────────────────────────────────────

  const handleTextFocus = useCallback(() => {
    setEditingText(true);
  }, []);

  const handleTextBlur = useCallback(() => {
    setEditingText(false);
    const parsed = parseFloat(inputText);
    if (!isNaN(parsed)) {
      const snapped = snapToStep(clamp(parsed, min, max), step, min);
      onChange(snapped);
      onCommit?.(snapped);
      setInputText(formatDb(snapped));
    } else {
      setInputText(formatDb(value));
    }
  }, [inputText, min, max, step, value, onChange, onCommit]);

  const handleTextChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
  }, []);

  const handleTextKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        (e.target as HTMLInputElement).blur();
      } else if (e.key === 'Escape') {
        setEditingText(false);
        setInputText(formatDb(value));
        (e.target as HTMLInputElement).blur();
      }
    },
    [value]
  );

  // ── 0 dB marker position ─────────────────────────────────────────────────────
  // The range input is rotated -90 deg so "left" is bottom, "right" is top.
  // The 0 dB marker percentage along the track (0 = min, 100 = max).
  const zeroPct = min < 0 && max > 0
    ? ((0 - min) / (max - min)) * 100
    : -1; // hidden if 0 is not in range

  // ── Track height ─────────────────────────────────────────────────────────────
  // The rotated range element sits inside a fixed-height container.
  const TRACK_HEIGHT = 180; // px — the element's visible height after rotation

  const rangeRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className={`flex flex-col items-center gap-1 select-none ${disabled ? 'opacity-50 pointer-events-none' : ''} ${className}`}
    >
      {/* Label */}
      {label && (
        <span className="text-xs text-gray-400 font-mono text-center leading-tight max-w-[64px] truncate" title={label}>
          {label}
        </span>
      )}

      {/* Fader track container */}
      <div
        className="relative flex items-center justify-center"
        style={{ height: `${TRACK_HEIGHT}px`, width: '44px' }}
      >
        {/* 0 dB tick mark — drawn as a pseudo-line on the container */}
        {zeroPct >= 0 && (
          <div
            className="absolute pointer-events-none"
            style={{
              // For a rotated range input: the track goes bottom→top.
              // zeroPct=0 means bottom (min), zeroPct=100 means top (max).
              // Map to pixel offset from top of the container.
              top: `${((100 - zeroPct) / 100) * TRACK_HEIGHT}px`,
              left: '0',
              right: '0',
              height: '1px',
              backgroundColor: 'rgba(255,255,255,0.2)',
              zIndex: 1,
            }}
          />
        )}

        {/* The range input, rotated to be vertical */}
        <input
          ref={rangeRef}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={handleRangeChange}
          onMouseUp={handleRangeMouseUp}
          onTouchEnd={handleRangeTouchEnd}
          onKeyDown={handleRangeKeyDown}
          aria-label={label ?? 'Fader'}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={`${formatDb(value)} ${unit}`}
          style={{
            // Rotate the element so that the track is vertical (bottom = min, top = max)
            transform: 'rotate(-90deg)',
            // The input's width becomes the visible track height after rotation
            width: `${TRACK_HEIGHT}px`,
            // Ensure minimum touch target height
            height: '44px',
            cursor: disabled ? 'not-allowed' : 'pointer',
            // Suppress default browser styling that fights with Tailwind
            WebkitAppearance: 'slider-vertical',
            appearance: 'none',
            // Background styling for the track
            background: 'transparent',
            outline: 'none',
          }}
          className="fader-range"
        />
      </div>

      {/* Numeric text input */}
      <div className="flex items-center gap-0.5">
        <input
          type="text"
          value={inputText}
          disabled={disabled}
          onChange={handleTextChange}
          onFocus={handleTextFocus}
          onBlur={handleTextBlur}
          onKeyDown={handleTextKeyDown}
          aria-label={`${label ?? 'Fader'} value`}
          className="input text-center text-xs font-mono w-[52px] min-h-[30px] px-1 py-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
        />
        {unit && (
          <span className="text-xs text-gray-500 font-mono">{unit}</span>
        )}
      </div>

      {/* Inline styles for the range input track and thumb */}
      <style>{`
        .fader-range::-webkit-slider-runnable-track {
          height: 6px;
          border-radius: 3px;
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.1);
        }
        .fader-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 20px;
          height: 20px;
          border-radius: 4px;
          background: linear-gradient(180deg, #555 0%, #3a3a3a 100%);
          border: 1px solid rgba(255,255,255,0.2);
          cursor: pointer;
          margin-top: -8px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.6);
          transition: background 0.1s, box-shadow 0.1s;
        }
        .fader-range::-webkit-slider-thumb:hover {
          background: linear-gradient(180deg, #fb923c 0%, #f97316 100%);
          border-color: rgba(249,115,22,0.5);
          box-shadow: 0 0 8px rgba(249,115,22,0.4);
        }
        .fader-range::-webkit-slider-thumb:active {
          background: linear-gradient(180deg, #ea6b0c 0%, #c2570d 100%);
        }
        .fader-range::-moz-range-track {
          height: 6px;
          border-radius: 3px;
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.1);
        }
        .fader-range::-moz-range-thumb {
          width: 20px;
          height: 20px;
          border-radius: 4px;
          background: linear-gradient(180deg, #555 0%, #3a3a3a 100%);
          border: 1px solid rgba(255,255,255,0.2);
          cursor: pointer;
          box-shadow: 0 1px 3px rgba(0,0,0,0.6);
        }
        .fader-range::-moz-range-thumb:hover {
          background: linear-gradient(180deg, #fb923c 0%, #f97316 100%);
          border-color: rgba(249,115,22,0.5);
        }
        .fader-range:focus::-webkit-slider-thumb {
          box-shadow: 0 0 0 2px #f97316;
        }
        .fader-range:focus::-moz-range-thumb {
          box-shadow: 0 0 0 2px #f97316;
        }
        .fader-range:focus {
          outline: none;
        }
      `}</style>
    </div>
  );
}
