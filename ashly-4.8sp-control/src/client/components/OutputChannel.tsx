import { useState, useCallback, KeyboardEvent, ChangeEvent } from 'react';
import EQCurve from './EQCurve';
import Fader from './Fader';
import CrossoverControls from './CrossoverControls';
import LimiterControls from './LimiterControls';

// ── Types ─────────────────────────────────────────────────────────────────────

interface EQFilter {
  filterNum: number;
  freq: number;
  q: number;
  qByte: number;
  gain_dB: number;
  gainRaw: number;
  filterType: number;
}

interface CrossoverFilter {
  filterNum: number;
  freq: number;
  freqValue: number;
  filterType: number;
  isOff: boolean;
}

interface LimiterInfo {
  node: number;
  threshold_dBu: number;
  thresholdByte: number;
  ratio: number;
  attack: number;
  release: number;
  enabled?: boolean;
}

interface Props {
  index: number;
  label: string;
  gain_dB: number;
  muted: boolean;
  delay_ms: number;
  polarity: boolean;
  eqFilters: EQFilter[];
  eqEnabled: boolean;
  hpf: CrossoverFilter | undefined;
  lpf: CrossoverFilter | undefined;
  limiter: LimiterInfo | undefined;
  limiterEnabled: boolean;
  onGainChange: (dB: number) => void;
  onMute: (muted: boolean) => void;
  onDelayChange: (ms: number) => void;
  onPolarityToggle: () => void;
  onEQChange: (filter: EQFilter) => void;
  onEQEnableToggle: () => void;
  onHPFChange: (freq: number | 'off', filterType: number) => void;
  onLPFChange: (freq: number | 'off', filterType: number) => void;
  onLimiterChange: (field: 'threshold' | 'ratio' | 'attack' | 'release', v: number) => void;
  onLimiterEnableToggle: () => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const Q_OPTIONS = [0.25, 0.35, 0.5, 0.71, 1.0, 1.41, 2.0, 2.83, 4.0, 5.66, 8.0, 16.0, 32.0, 64.0];

const FILTER_TYPE_LABELS: Record<number, string> = {
  0: 'Parametric',
  1: 'Low Shelf 1st',
  2: 'Low Shelf 2nd',
  3: 'High Shelf 1st',
  4: 'High Shelf 2nd',
};

const DELAY_MIN = 0;
const DELAY_MAX = 682.64;

// ── EQ Band ───────────────────────────────────────────────────────────────────

interface EQBandProps {
  filter: EQFilter;
  bandIndex: number;
  onChange: (filter: EQFilter) => void;
}

function EQBand({ filter, bandIndex, onChange }: EQBandProps) {
  const [freqDraft, setFreqDraft] = useState<string>(String(filter.freq));
  const [gainDraft, setGainDraft] = useState<string>(filter.gain_dB.toFixed(1));
  const [editingFreq, setEditingFreq] = useState(false);
  const [editingGain, setEditingGain] = useState(false);

  // Keep drafts in sync when not editing
  if (!editingFreq && String(filter.freq) !== freqDraft) setFreqDraft(String(filter.freq));
  if (!editingGain && filter.gain_dB.toFixed(1) !== gainDraft) setGainDraft(filter.gain_dB.toFixed(1));

  const commitFreq = useCallback(() => {
    setEditingFreq(false);
    const parsed = parseInt(freqDraft, 10);
    if (!isNaN(parsed)) {
      const clamped = Math.max(20, Math.min(20000, parsed));
      onChange({ ...filter, freq: clamped });
      setFreqDraft(String(clamped));
    } else {
      setFreqDraft(String(filter.freq));
    }
  }, [freqDraft, filter, onChange]);

  const commitGain = useCallback(() => {
    setEditingGain(false);
    const parsed = parseFloat(gainDraft);
    if (!isNaN(parsed)) {
      const clamped = Math.max(-15, Math.min(15, parsed));
      onChange({ ...filter, gain_dB: clamped });
      setGainDraft(clamped.toFixed(1));
    } else {
      setGainDraft(filter.gain_dB.toFixed(1));
    }
  }, [gainDraft, filter, onChange]);

  const handleKeyDown = useCallback(
    (commit: () => void) => (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      else if (e.key === 'Escape') {
        commit();
        (e.target as HTMLInputElement).blur();
      }
    },
    []
  );

  const closestQ = Q_OPTIONS.reduce((prev, curr) =>
    Math.abs(curr - filter.q) < Math.abs(prev - filter.q) ? curr : prev
  );

  return (
    <div className="panel flex-shrink-0 w-[160px] sm:w-auto p-2 flex flex-col gap-1.5">
      <div className="text-[10px] font-semibold text-[#8b949e] uppercase tracking-wider">
        Band {bandIndex + 1}
      </div>

      {/* Filter type */}
      <div className="flex flex-col gap-0.5">
        <label className="text-[10px] text-[#8b949e]">Type</label>
        <select
          className="select text-xs min-h-[32px]"
          value={filter.filterType}
          onChange={(e) => onChange({ ...filter, filterType: parseInt(e.target.value, 10) })}
          aria-label={`Output EQ band ${bandIndex + 1} filter type`}
        >
          {Object.entries(FILTER_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {/* Frequency */}
      <div className="flex flex-col gap-0.5">
        <label className="text-[10px] text-[#8b949e]">Freq (Hz)</label>
        <input
          type="number"
          className="input text-xs min-h-[32px]"
          min={20}
          max={20000}
          step={1}
          value={freqDraft}
          onFocus={() => setEditingFreq(true)}
          onBlur={commitFreq}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            setEditingFreq(true);
            setFreqDraft(e.target.value);
          }}
          onKeyDown={handleKeyDown(commitFreq)}
          aria-label={`Output EQ band ${bandIndex + 1} frequency`}
        />
      </div>

      {/* Gain */}
      <div className="flex flex-col gap-0.5">
        <label className="text-[10px] text-[#8b949e]">Gain (dB)</label>
        <input
          type="number"
          className="input text-xs min-h-[32px]"
          min={-15}
          max={15}
          step={0.1}
          value={gainDraft}
          onFocus={() => setEditingGain(true)}
          onBlur={commitGain}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            setEditingGain(true);
            setGainDraft(e.target.value);
          }}
          onKeyDown={handleKeyDown(commitGain)}
          aria-label={`Output EQ band ${bandIndex + 1} gain`}
        />
      </div>

      {/* Q */}
      <div className="flex flex-col gap-0.5">
        <label className="text-[10px] text-[#8b949e]">Q</label>
        <select
          className="select text-xs min-h-[32px]"
          value={closestQ}
          onChange={(e) => onChange({ ...filter, q: parseFloat(e.target.value) })}
          aria-label={`Output EQ band ${bandIndex + 1} Q`}
        >
          {Q_OPTIONS.map((q) => (
            <option key={q} value={q}>{q}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ── Section divider ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold text-[#8b949e] uppercase tracking-widest">
      {children}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function OutputChannel({
  index,
  label,
  gain_dB,
  muted,
  delay_ms,
  polarity,
  eqFilters,
  eqEnabled,
  hpf,
  lpf,
  limiter,
  limiterEnabled,
  onGainChange,
  onMute,
  onDelayChange,
  onPolarityToggle,
  onEQChange,
  onEQEnableToggle,
  onHPFChange,
  onLPFChange,
  onLimiterChange,
  onLimiterEnableToggle,
}: Props) {
  // On mobile, collapsed by default; on desktop always visible
  const [expanded, setExpanded] = useState(false);
  const [delayDraft, setDelayDraft] = useState<string>(delay_ms.toFixed(2));
  const [editingDelay, setEditingDelay] = useState(false);

  // Keep delay draft in sync when not editing
  if (!editingDelay && delay_ms.toFixed(2) !== delayDraft) {
    setDelayDraft(delay_ms.toFixed(2));
  }

  const commitDelay = useCallback(() => {
    setEditingDelay(false);
    const parsed = parseFloat(delayDraft);
    if (!isNaN(parsed)) {
      const clamped = Math.max(DELAY_MIN, Math.min(DELAY_MAX, parsed));
      onDelayChange(clamped);
      setDelayDraft(clamped.toFixed(2));
    } else {
      setDelayDraft(delay_ms.toFixed(2));
    }
  }, [delayDraft, delay_ms, onDelayChange]);

  const handleDelayKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      else if (e.key === 'Escape') {
        setEditingDelay(false);
        setDelayDraft(delay_ms.toFixed(2));
        (e.target as HTMLInputElement).blur();
      }
    },
    [delay_ms]
  );

  // Limiter safe defaults
  const limiterThreshold = limiter?.threshold_dBu ?? 0;
  const limiterRatio     = limiter?.ratio ?? 0;
  const limiterAttack    = limiter?.attack ?? 0;
  const limiterRelease   = limiter?.release ?? 0;

  const content = (
    <div className="p-3 flex flex-col gap-4">

      {/* Gain fader */}
      <div className="flex flex-col gap-2">
        <SectionLabel>Gain</SectionLabel>
        <div className="flex justify-center">
          <Fader
            value={gain_dB}
            min={-40}
            max={12}
            step={0.1}
            label="Gain"
            unit="dB"
            onChange={onGainChange}
            onCommit={onGainChange}
          />
        </div>
      </div>

      {/* Delay */}
      <div className="flex flex-col gap-1.5">
        <SectionLabel>Delay</SectionLabel>
        <div className="flex items-center gap-2">
          <input
            type="number"
            className="input text-sm w-28"
            min={DELAY_MIN}
            max={DELAY_MAX}
            step={0.01}
            value={delayDraft}
            onFocus={() => setEditingDelay(true)}
            onBlur={commitDelay}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setEditingDelay(true);
              setDelayDraft(e.target.value);
            }}
            onKeyDown={handleDelayKeyDown}
            aria-label={`Output ${label} delay`}
          />
          <span className="text-xs text-[#8b949e] font-mono">ms</span>
        </div>
      </div>

      {/* Crossover */}
      <div className="flex flex-col gap-2">
        <SectionLabel>Crossover</SectionLabel>
        <CrossoverControls
          outputIndex={index}
          hpf={hpf}
          lpf={lpf}
          onHPFChange={onHPFChange}
          onLPFChange={onLPFChange}
        />
      </div>

      {/* EQ section */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <SectionLabel>Parametric EQ</SectionLabel>
          <button
            className={`text-xs px-2 py-1 min-h-[44px] min-w-[60px] rounded border transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[#58a6ff]/50 ${
              eqEnabled
                ? 'bg-[#1f6feb]/15 border-[#58a6ff]/40 text-[#58a6ff] hover:bg-[#1f6feb]/25'
                : 'btn-ghost'
            }`}
            onClick={onEQEnableToggle}
            aria-pressed={eqEnabled}
            aria-label="Toggle output EQ"
          >
            {eqEnabled ? 'EQ On' : 'EQ Off'}
          </button>
        </div>

        <div className={`transition-opacity duration-150 ${eqEnabled ? 'opacity-100' : 'opacity-40'}`}>
          {/* Mobile: horizontal scroll */}
          <div className="flex gap-2 overflow-x-auto pb-1 sm:hidden" aria-label="Output EQ bands">
            {eqFilters.map((filter, i) => (
              <EQBand key={filter.filterNum} filter={filter} bandIndex={i} onChange={onEQChange} />
            ))}
          </div>

          {/* Desktop: 2-column grid */}
          <div className="hidden sm:grid sm:grid-cols-2 gap-2">
            {eqFilters.map((filter, i) => (
              <EQBand key={filter.filterNum} filter={filter} bandIndex={i} onChange={onEQChange} />
            ))}
          </div>
        </div>

        {/* EQ Curve — interactive: drag handles to adjust freq & gain */}
        <div className={`mt-1 transition-opacity duration-150 ${eqEnabled ? 'opacity-100' : 'opacity-40'}`}>
          <EQCurve filters={eqFilters} height={160} interactive={true} onFilterChange={onEQChange} />
        </div>
      </div>

      {/* Limiter section */}
      <div className="panel p-3">
        <LimiterControls
          threshold_dBu={limiterThreshold}
          ratio={limiterRatio}
          attack={limiterAttack}
          release={limiterRelease}
          enabled={limiterEnabled}
          onThresholdChange={(v) => onLimiterChange('threshold', v)}
          onRatioChange={(v) => onLimiterChange('ratio', v)}
          onAttackChange={(v) => onLimiterChange('attack', v)}
          onReleaseChange={(v) => onLimiterChange('release', v)}
          onEnabledToggle={onLimiterEnableToggle}
        />
      </div>

    </div>
  );

  return (
    <div className="panel overflow-hidden">
      {/* Header */}
      <button
        className="panel-header w-full flex items-center justify-between cursor-pointer sm:cursor-default focus:outline-none focus-visible:ring-1 focus-visible:ring-[#58a6ff]/50"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        aria-controls={`output-channel-${index}-content`}
      >
        <span className="text-[#e1e4e8] font-semibold">Output {label}</span>

        <div className="flex items-center gap-2">
          {/* Gain badge */}
          <span className="text-[11px] font-mono text-[#8b949e]">
            {gain_dB >= 0 ? '+' : ''}{gain_dB.toFixed(1)} dB
          </span>

          {/* Polarity button — stop propagation so it doesn't toggle collapse */}
          <span onClick={(e) => e.stopPropagation()}>
            <button
              className={`text-xs px-2 py-0.5 min-h-[32px] rounded border transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[#58a6ff]/50 ${
                polarity
                  ? 'bg-[#1f6feb]/20 border-[#58a6ff]/50 text-[#58a6ff]'
                  : 'btn-ghost'
              }`}
              onClick={onPolarityToggle}
              aria-pressed={polarity}
              aria-label={`${polarity ? 'Normal' : 'Invert'} polarity for output ${label}`}
            >
              {/* Greek phi character for polarity */}
              &#x03A6;
            </button>
          </span>

          {/* Mute button — stop propagation so it doesn't toggle collapse */}
          <span onClick={(e) => e.stopPropagation()}>
            <button
              className="btn-mute text-xs px-2 py-0.5 min-h-[32px]"
              data-muted={muted}
              onClick={() => onMute(!muted)}
              aria-pressed={muted}
              aria-label={`${muted ? 'Unmute' : 'Mute'} output ${label}`}
            >
              {muted ? 'MUTED' : 'MUTE'}
            </button>
          </span>

          {/* Chevron (mobile only) */}
          <svg
            className={`w-4 h-4 text-[#484f58] transition-transform duration-200 sm:hidden ${expanded ? 'rotate-180' : ''}`}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      </button>

      {/* Content: hidden on mobile when collapsed, always shown on desktop */}
      <div
        id={`output-channel-${index}-content`}
        className={`sm:block ${expanded ? 'block' : 'hidden'}`}
      >
        {content}
      </div>
    </div>
  );
}
