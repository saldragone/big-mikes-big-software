/**
 * MixerStrip — Logic Pro-style channel strip with inline meter.
 *
 * Layout (top → bottom):
 *   EQ thumbnail (clickable)
 *   Info pills: delay / xover / limiter (clickable)
 *   Fader + Meter (side by side)
 *   dB readout
 *   Mute / Polarity buttons
 *   Channel label
 */

import { useState, useCallback, useRef, useEffect, ChangeEvent, KeyboardEvent } from 'react';
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
  /** Meter level in dBu for this channel */
  meterLevel: number;
  meterClipped: boolean;
  /** Gain reduction in dB (outputs only) */
  gainReduction?: number;
  onGainChange: (dB: number) => void;
  onMute: (muted: boolean) => void;
  onOpenDetail: (section: 'eq' | 'delay' | 'crossover' | 'limiter') => void;
  onPolarityToggle?: () => void;
}

// ── Meter constants ──────────────────────────────────────────────────────────

const DB_MIN = -42;
const DB_MAX = 20;
const DB_RANGE = DB_MAX - DB_MIN;

function dbToPercent(dBu: number): number {
  return Math.max(0, Math.min(100, ((dBu - DB_MIN) / DB_RANGE) * 100));
}

function meterColor(dBu: number): string {
  if (dBu > -3) return '#f85149';
  if (dBu > -10) return '#d29922';
  return '#3fb950';
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
  meterLevel, meterClipped, gainReduction = 0,
  onGainChange, onMute, onOpenDetail, onPolarityToggle,
}: MixerStripProps) {
  const isOutput = channelType === 'output';
  const [inputText, setInputText] = useState(gain_dB.toFixed(1));
  const [editing, setEditing] = useState(false);

  // Smooth meter display
  const displayLevelRef = useRef(DB_MIN);
  const [displayLevel, setDisplayLevel] = useState(DB_MIN);
  const rafRef = useRef(0);

  useEffect(() => {
    let lastTs = 0;
    const animate = (ts: number) => {
      const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.1) : 0;
      lastTs = ts;
      const target = meterLevel;
      const current = displayLevelRef.current;
      if (target >= current) {
        displayLevelRef.current = target;
      } else {
        displayLevelRef.current = Math.max(DB_MIN, current - 20 * dt);
      }
      setDisplayLevel(displayLevelRef.current);
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [meterLevel]);

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

  const labelBg = muted ? '#f85149' : isOutput ? '#238636' : '#1f6feb';
  const meterPct = dbToPercent(displayLevel);
  const meterCol = meterColor(displayLevel);

  return (
    <div className="mixer-strip">

      {/* ── EQ thumbnail ── */}
      <button className="strip-eq-thumb" onClick={() => onOpenDetail('eq')}
        title="Edit EQ" aria-label={`Edit EQ for ${channelType} ${label}`}>
        <EQCurve filters={eqFilters} height={44} className={eqEnabled ? '' : 'opacity-30'} />
      </button>

      {/* ── Info pills ── */}
      <div className="strip-pills">
        <button className="strip-pill" onClick={() => onOpenDetail('delay')} title="Delay">
          {delay_ms > 0 ? `${delay_ms.toFixed(0)}ms` : 'DLY'}
        </button>
        {isOutput && (
          <>
            <button className={`strip-pill ${hpfActive || lpfActive ? 'active' : ''}`}
              onClick={() => onOpenDetail('crossover')} title="Crossover">X</button>
            <button className={`strip-pill ${limiterEnabled ? 'active' : ''}`}
              onClick={() => onOpenDetail('limiter')} title="Limiter">L</button>
          </>
        )}
      </div>

      {/* ── Fader + Meter area ── */}
      <div className="strip-fader-meter">
        {/* Meter bar */}
        <div className="strip-meter-track">
          <div className="strip-meter-fill" style={{
            height: `${meterPct}%`,
            background: meterCol,
          }} />
          {/* Gain reduction overlay */}
          {isOutput && gainReduction > 0 && (
            <div className="strip-meter-gr" style={{
              height: `${Math.min(gainReduction / DB_RANGE * 100, meterPct)}%`,
              top: `${100 - meterPct}%`,
            }} />
          )}
          {/* Clip indicator */}
          <div className={`strip-clip-led ${meterClipped ? 'clipped' : ''}`} />
        </div>

        {/* Fader */}
        <div className="strip-fader-wrap">
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

      {/* ── Buttons row ── */}
      <div className="strip-buttons">
        {isOutput && onPolarityToggle && (
          <button className={`strip-btn-polarity ${polarity ? 'active' : ''}`}
            onClick={onPolarityToggle} title="Polarity">&#x03A6;</button>
        )}
        <button className={`strip-btn-mute ${muted ? 'muted' : ''}`}
          onClick={() => onMute(!muted)} aria-pressed={muted}>M</button>
      </div>

      {/* ── Channel name ── */}
      <div className="strip-label" style={{ background: labelBg }}>
        {channelType === 'input' ? `In ${label}` : label}
      </div>
    </div>
  );
}
