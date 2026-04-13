/**
 * MixerStrip — A compact Logic Pro-style channel strip.
 *
 * Top-to-bottom layout:
 *   EQ curve thumbnail (clickable)
 *   Info pills: delay / xover / limiter (clickable)
 *   Vertical fader
 *   dB readout
 *   Mute button
 *   Channel label
 */

import { useState, useCallback, ChangeEvent, KeyboardEvent } from 'react';
import EQCurve from './EQCurve';

// ── Types ─────────────────────────────────────────────────────────────────────

interface EQFilter {
  filterNum: number;
  freq: number;
  q: number;
  gain_dB: number;
  filterType: number;
  [key: string]: any;
}

interface MixerStripProps {
  channelType: 'input' | 'output';
  index: number;
  label: string;
  gain_dB: number;
  muted: boolean;
  delay_ms: number;
  eqFilters: EQFilter[];
  eqEnabled: boolean;
  polarity?: boolean;
  hpfActive?: boolean;
  lpfActive?: boolean;
  limiterEnabled?: boolean;
  onGainChange: (dB: number) => void;
  onMute: (muted: boolean) => void;
  onOpenDetail: (section: 'eq' | 'delay' | 'crossover' | 'limiter') => void;
  onPolarityToggle?: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function snapToStep(v: number, step: number, min: number) {
  return min + Math.round((v - min) / step) * step;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MixerStrip({
  channelType, index, label, gain_dB, muted, delay_ms,
  eqFilters, eqEnabled, polarity, hpfActive, lpfActive, limiterEnabled,
  onGainChange, onMute, onOpenDetail, onPolarityToggle,
}: MixerStripProps) {
  const isOutput = channelType === 'output';
  const [inputText, setInputText] = useState(gain_dB.toFixed(1));
  const [editing, setEditing] = useState(false);

  // Sync text when not editing
  if (!editing && gain_dB.toFixed(1) !== inputText) setInputText(gain_dB.toFixed(1));

  const commitText = useCallback(() => {
    setEditing(false);
    const p = parseFloat(inputText);
    if (!isNaN(p)) {
      const v = snapToStep(clamp(p, -40, 12), 0.1, -40);
      onGainChange(v);
      setInputText(v.toFixed(1));
    } else {
      setInputText(gain_dB.toFixed(1));
    }
  }, [inputText, gain_dB, onGainChange]);

  const handleFaderChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const raw = parseFloat(e.target.value);
    const v = snapToStep(clamp(raw, -40, 12), 0.1, -40);
    onGainChange(v);
  }, [onGainChange]);

  // Color coding
  const stripBorder = muted ? 'rgba(248,81,73,0.3)' : isOutput ? 'rgba(63,185,80,0.2)' : 'rgba(88,166,255,0.2)';
  const labelBg = muted ? '#f85149' : isOutput ? '#238636' : '#1f6feb';

  return (
    <div className="mixer-strip" style={{ borderTopColor: stripBorder }}>

      {/* ── EQ thumbnail — click to open EQ modal ── */}
      <button className="strip-eq-thumb" onClick={() => onOpenDetail('eq')}
        title="Edit EQ" aria-label={`Edit EQ for ${channelType} ${label}`}>
        <EQCurve filters={eqFilters} height={52} className={eqEnabled ? '' : 'opacity-30'} />
      </button>

      {/* ── Info pills — click to open respective modal ── */}
      <div className="strip-pills">
        <button className="strip-pill" onClick={() => onOpenDetail('delay')} title="Delay">
          <span className="strip-pill-value">{delay_ms > 0 ? `${delay_ms.toFixed(1)}ms` : 'Dly'}</span>
        </button>
        {isOutput && (
          <>
            <button className={`strip-pill ${hpfActive || lpfActive ? 'active' : ''}`}
              onClick={() => onOpenDetail('crossover')} title="Crossover">
              X
            </button>
            <button className={`strip-pill ${limiterEnabled ? 'active' : ''}`}
              onClick={() => onOpenDetail('limiter')} title="Limiter">
              L
            </button>
          </>
        )}
      </div>

      {/* ── Fader ── */}
      <div className="strip-fader-container">
        <input
          type="range"
          className="strip-fader"
          min={-40}
          max={12}
          step={0.1}
          value={gain_dB}
          onChange={handleFaderChange}
          aria-label={`${channelType} ${label} gain`}
        />
        {/* 0 dB tick */}
        <div className="strip-fader-zero" style={{ bottom: `${((0 - (-40)) / (12 - (-40))) * 100}%` }} />
      </div>

      {/* ── dB readout ── */}
      <input
        type="text"
        className="strip-db-readout"
        value={inputText}
        onFocus={() => setEditing(true)}
        onBlur={commitText}
        onChange={(e: ChangeEvent<HTMLInputElement>) => { setEditing(true); setInputText(e.target.value); }}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        aria-label={`${channelType} ${label} dB`}
      />

      {/* ── Buttons row: polarity + mute ── */}
      <div className="strip-buttons">
        {isOutput && onPolarityToggle && (
          <button
            className={`strip-btn-polarity ${polarity ? 'active' : ''}`}
            onClick={onPolarityToggle}
            title="Polarity"
            aria-pressed={polarity}
          >
            &#x03A6;
          </button>
        )}
        <button
          className={`strip-btn-mute ${muted ? 'muted' : ''}`}
          onClick={() => onMute(!muted)}
          aria-pressed={muted}
          aria-label={muted ? 'Unmute' : 'Mute'}
        >
          M
        </button>
      </div>

      {/* ── Channel name ── */}
      <div className="strip-label" style={{ background: labelBg }}>
        {channelType === 'input' ? `In ${label}` : label}
      </div>
    </div>
  );
}
