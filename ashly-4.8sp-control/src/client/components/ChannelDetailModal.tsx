/**
 * Channel Detail Modal — Logic Pro-style overlay for editing channel parameters.
 * Opens when you click a section on a mixer strip (EQ, delay, crossover, limiter).
 */

import { useEffect, useCallback, useState, KeyboardEvent, ChangeEvent } from 'react';
import EQCurve from './EQCurve';
import CrossoverControls from './CrossoverControls';
import LimiterControls from './LimiterControls';

// ── Types ─────────────────────────────────────────────────────────────────────

interface EQFilter {
  filterNum: number;
  freq: number;
  q: number;
  qByte?: number;
  gain_dB: number;
  gainRaw?: number;
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

type ModalSection = 'eq' | 'delay' | 'crossover' | 'limiter';

interface Props {
  open: boolean;
  onClose: () => void;
  section: ModalSection;
  channelType: 'input' | 'output';
  channelLabel: string;
  channelIndex: number;
  // EQ
  eqFilters: EQFilter[];
  eqEnabled: boolean;
  onEQChange: (filter: EQFilter) => void;
  onEQEnableToggle: () => void;
  // Delay
  delay_ms: number;
  onDelayChange: (ms: number) => void;
  // Crossover (outputs only)
  hpf?: CrossoverFilter;
  lpf?: CrossoverFilter;
  onHPFChange?: (freq: number | 'off', filterType: number) => void;
  onLPFChange?: (freq: number | 'off', filterType: number) => void;
  // Limiter (outputs only)
  limiterThreshold?: number;
  limiterRatio?: number;
  limiterAttack?: number;
  limiterRelease?: number;
  limiterEnabled?: boolean;
  onLimiterChange?: (field: 'threshold' | 'ratio' | 'attack' | 'release', v: number) => void;
  onLimiterEnableToggle?: () => void;
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

// ── EQ Band editor ────────────────────────────────────────────────────────────

function EQBand({ filter, bandIndex, onChange }: { filter: EQFilter; bandIndex: number; onChange: (f: EQFilter) => void }) {
  const [freqDraft, setFreqDraft] = useState(String(filter.freq));
  const [gainDraft, setGainDraft] = useState(filter.gain_dB.toFixed(1));
  const [editingFreq, setEditingFreq] = useState(false);
  const [editingGain, setEditingGain] = useState(false);

  if (!editingFreq && String(filter.freq) !== freqDraft) setFreqDraft(String(filter.freq));
  if (!editingGain && filter.gain_dB.toFixed(1) !== gainDraft) setGainDraft(filter.gain_dB.toFixed(1));

  const commitFreq = useCallback(() => {
    setEditingFreq(false);
    const p = parseInt(freqDraft, 10);
    if (!isNaN(p)) { const c = Math.max(20, Math.min(20000, p)); onChange({ ...filter, freq: c }); setFreqDraft(String(c)); }
    else setFreqDraft(String(filter.freq));
  }, [freqDraft, filter, onChange]);

  const commitGain = useCallback(() => {
    setEditingGain(false);
    const p = parseFloat(gainDraft);
    if (!isNaN(p)) { const c = Math.max(-15, Math.min(15, p)); onChange({ ...filter, gain_dB: c }); setGainDraft(c.toFixed(1)); }
    else setGainDraft(filter.gain_dB.toFixed(1));
  }, [gainDraft, filter, onChange]);

  const onKey = (commit: () => void) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
    if (e.key === 'Escape') { commit(); (e.target as HTMLInputElement).blur(); }
  };

  const closestQ = Q_OPTIONS.reduce((prev, curr) => Math.abs(curr - filter.q) < Math.abs(prev - filter.q) ? curr : prev);

  const BAND_COLORS = ['#f85149', '#f0883e', '#d29922', '#3fb950', '#58a6ff', '#bc8cff', '#f778ba', '#79c0ff'];
  const color = BAND_COLORS[bandIndex % BAND_COLORS.length];

  return (
    <div className="modal-eq-band" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="modal-eq-band-header">
        <span style={{ color, fontWeight: 700, fontSize: 11 }}>Band {bandIndex + 1}</span>
      </div>
      <div className="modal-eq-band-fields">
        <div className="modal-field">
          <label>Type</label>
          <select className="select text-xs" value={filter.filterType}
            onChange={e => onChange({ ...filter, filterType: parseInt(e.target.value, 10) })}>
            {Object.entries(FILTER_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="modal-field">
          <label>Freq</label>
          <div className="modal-field-row">
            <input type="number" className="input text-xs" min={20} max={20000} step={1}
              value={freqDraft} onFocus={() => setEditingFreq(true)} onBlur={commitFreq}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { setEditingFreq(true); setFreqDraft(e.target.value); }}
              onKeyDown={onKey(commitFreq)} />
            <span className="modal-unit">Hz</span>
          </div>
        </div>
        <div className="modal-field">
          <label>Gain</label>
          <div className="modal-field-row">
            <input type="number" className="input text-xs" min={-15} max={15} step={0.1}
              value={gainDraft} onFocus={() => setEditingGain(true)} onBlur={commitGain}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { setEditingGain(true); setGainDraft(e.target.value); }}
              onKeyDown={onKey(commitGain)} />
            <span className="modal-unit">dB</span>
          </div>
        </div>
        <div className="modal-field">
          <label>Q</label>
          <select className="select text-xs" value={closestQ}
            onChange={e => onChange({ ...filter, q: parseFloat(e.target.value) })}>
            {Q_OPTIONS.map(q => <option key={q} value={q}>{q}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}

// ── Modal Component ───────────────────────────────────────────────────────────

export default function ChannelDetailModal({
  open, onClose, section, channelType, channelLabel, channelIndex,
  eqFilters, eqEnabled, onEQChange, onEQEnableToggle,
  delay_ms, onDelayChange,
  hpf, lpf, onHPFChange, onLPFChange,
  limiterThreshold = 0, limiterRatio = 0, limiterAttack = 0, limiterRelease = 0,
  limiterEnabled = false, onLimiterChange, onLimiterEnableToggle,
}: Props) {

  const [delayDraft, setDelayDraft] = useState(delay_ms.toFixed(2));
  const [editingDelay, setEditingDelay] = useState(false);
  const [activeSection, setActiveSection] = useState<ModalSection>(section);

  // Reset active section when the modal opens with a new section
  useEffect(() => { if (open) setActiveSection(section); }, [open, section]);

  // Keep delay draft synced
  if (!editingDelay && delay_ms.toFixed(2) !== delayDraft) setDelayDraft(delay_ms.toFixed(2));

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const commitDelay = useCallback(() => {
    setEditingDelay(false);
    const p = parseFloat(delayDraft);
    if (!isNaN(p)) { const c = Math.max(DELAY_MIN, Math.min(DELAY_MAX, p)); onDelayChange(c); setDelayDraft(c.toFixed(2)); }
    else setDelayDraft(delay_ms.toFixed(2));
  }, [delayDraft, delay_ms, onDelayChange]);

  if (!open) return null;

  const isOutput = channelType === 'output';
  const tabs: { key: ModalSection; label: string }[] = [
    { key: 'eq', label: 'EQ' },
    { key: 'delay', label: 'Delay' },
    ...(isOutput ? [
      { key: 'crossover' as ModalSection, label: 'X-Over' },
      { key: 'limiter' as ModalSection, label: 'Limiter' },
    ] : []),
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-container" onClick={e => e.stopPropagation()}>

        {/* Modal header */}
        <div className="modal-header">
          <div className="modal-title">
            <span className="modal-channel-badge" style={{
              background: isOutput ? 'rgba(63,185,80,0.15)' : 'rgba(88,166,255,0.15)',
              color: isOutput ? '#3fb950' : '#58a6ff',
            }}>
              {channelType === 'input' ? 'IN' : 'OUT'} {channelLabel}
            </span>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/>
            </svg>
          </button>
        </div>

        {/* Section tabs */}
        <div className="modal-tabs">
          {tabs.map(t => (
            <button key={t.key}
              className={`modal-tab ${activeSection === t.key ? 'active' : ''}`}
              onClick={() => setActiveSection(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="modal-body">

          {/* ── EQ ── */}
          {activeSection === 'eq' && (
            <div className="modal-section">
              <div className="flex items-center justify-between mb-3">
                <span className="modal-section-title">Parametric EQ</span>
                <button
                  className={`modal-toggle ${eqEnabled ? 'on' : ''}`}
                  onClick={onEQEnableToggle}>
                  {eqEnabled ? 'ON' : 'OFF'}
                </button>
              </div>

              {/* Interactive EQ curve — big and prominent */}
              <div className={`mb-4 ${eqEnabled ? '' : 'opacity-40'}`}>
                <EQCurve filters={eqFilters} height={200} interactive={true} onFilterChange={onEQChange} />
              </div>

              {/* Band editors */}
              <div className={`modal-eq-bands ${eqEnabled ? '' : 'opacity-40 pointer-events-none'}`}>
                {eqFilters.map((f, i) => (
                  <EQBand key={f.filterNum} filter={f} bandIndex={i} onChange={onEQChange} />
                ))}
              </div>
            </div>
          )}

          {/* ── Delay ── */}
          {activeSection === 'delay' && (
            <div className="modal-section">
              <span className="modal-section-title">Delay</span>
              <div className="mt-4 flex items-center gap-3">
                <input type="number" className="input text-lg font-mono w-36 text-center"
                  min={DELAY_MIN} max={DELAY_MAX} step={0.01} value={delayDraft}
                  onFocus={() => setEditingDelay(true)}
                  onBlur={commitDelay}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => { setEditingDelay(true); setDelayDraft(e.target.value); }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                />
                <span className="text-sm text-[#8b949e] font-mono">ms</span>
              </div>
              <input type="range" className="w-full mt-4 accent-[#58a6ff]"
                min={DELAY_MIN} max={DELAY_MAX} step={0.01} value={delay_ms}
                onChange={e => onDelayChange(parseFloat(e.target.value))} />
              <div className="flex justify-between text-[10px] text-[#484f58] font-mono mt-1">
                <span>0</span>
                <span>340 ms</span>
                <span>682 ms</span>
              </div>
            </div>
          )}

          {/* ── Crossover ── */}
          {activeSection === 'crossover' && isOutput && onHPFChange && onLPFChange && (
            <div className="modal-section">
              <span className="modal-section-title">Crossover</span>
              <div className="mt-3">
                <CrossoverControls
                  outputIndex={channelIndex}
                  hpf={hpf}
                  lpf={lpf}
                  onHPFChange={onHPFChange}
                  onLPFChange={onLPFChange}
                />
              </div>
            </div>
          )}

          {/* ── Limiter ── */}
          {activeSection === 'limiter' && isOutput && onLimiterChange && onLimiterEnableToggle && (
            <div className="modal-section">
              <LimiterControls
                threshold_dBu={limiterThreshold}
                ratio={limiterRatio}
                attack={limiterAttack}
                release={limiterRelease}
                enabled={limiterEnabled}
                onThresholdChange={v => onLimiterChange('threshold', v)}
                onRatioChange={v => onLimiterChange('ratio', v)}
                onAttackChange={v => onLimiterChange('attack', v)}
                onReleaseChange={v => onLimiterChange('release', v)}
                onEnabledToggle={onLimiterEnableToggle}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
