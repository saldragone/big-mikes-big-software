import { useState, useCallback, useEffect, KeyboardEvent, ChangeEvent } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  threshold_dBu: number;   // -20 to +20
  ratio: number;           // 0-8 index
  attack: number;          // 0-6 index
  release: number;         // 0-6 index
  enabled: boolean;
  onThresholdChange: (v: number) => void;
  onRatioChange: (v: number) => void;
  onAttackChange: (v: number) => void;
  onReleaseChange: (v: number) => void;
  onEnabledToggle: () => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const RATIO_OPTIONS = ['1.2:1', '1.5:1', '2:1', '3:1', '4:1', '6:1', '10:1', '20:1', 'INF:1'];
const ATTACK_OPTIONS = ['0.5', '1', '2', '5', '10', '20', '50'];   // ms/dB
const RELEASE_OPTIONS = ['10', '20', '50', '100', '200', '500', '1000']; // ms/dB

const THRESHOLD_MIN = -20;
const THRESHOLD_MAX = 20;

// ── Component ─────────────────────────────────────────────────────────────────

export default function LimiterControls({
  threshold_dBu,
  ratio,
  attack,
  release,
  enabled,
  onThresholdChange,
  onRatioChange,
  onAttackChange,
  onReleaseChange,
  onEnabledToggle,
}: Props) {
  const [thresholdDraft, setThresholdDraft] = useState<string>(threshold_dBu.toFixed(1));
  const [editingThreshold, setEditingThreshold] = useState(false);

  // Keep threshold draft in sync when not editing
  useEffect(() => {
    if (!editingThreshold) {
      setThresholdDraft(threshold_dBu.toFixed(1));
    }
  }, [threshold_dBu, editingThreshold]);

  const commitThreshold = useCallback(() => {
    setEditingThreshold(false);
    const parsed = parseFloat(thresholdDraft);
    if (!isNaN(parsed)) {
      const clamped = Math.max(THRESHOLD_MIN, Math.min(THRESHOLD_MAX, parsed));
      onThresholdChange(clamped);
      setThresholdDraft(clamped.toFixed(1));
    } else {
      setThresholdDraft(threshold_dBu.toFixed(1));
    }
  }, [thresholdDraft, threshold_dBu, onThresholdChange]);

  const handleThresholdKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      else if (e.key === 'Escape') {
        setEditingThreshold(false);
        setThresholdDraft(threshold_dBu.toFixed(1));
        (e.target as HTMLInputElement).blur();
      }
    },
    [threshold_dBu]
  );

  const handleRangeChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const val = parseFloat(e.target.value);
      onThresholdChange(val);
    },
    [onThresholdChange]
  );

  // Clamp ratio/attack/release indices to valid range
  const safeRatio   = Math.max(0, Math.min(RATIO_OPTIONS.length - 1, ratio));
  const safeAttack  = Math.max(0, Math.min(ATTACK_OPTIONS.length - 1, attack));
  const safeRelease = Math.max(0, Math.min(RELEASE_OPTIONS.length - 1, release));

  return (
    <div className="flex flex-col gap-3">

      {/* Enable toggle */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Limiter</span>
        <button
          className={`text-xs px-3 py-1 rounded border min-h-[44px] min-w-[64px] font-semibold transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[#58a6ff]/50 ${
            enabled
              ? 'bg-[#1f6feb]/15 border-[#58a6ff]/40 text-[#58a6ff] hover:bg-[#1f6feb]/25'
              : 'btn-ghost'
          }`}
          onClick={onEnabledToggle}
          aria-pressed={enabled}
          aria-label={enabled ? 'Disable limiter' : 'Enable limiter'}
        >
          {enabled ? 'ON' : 'OFF'}
        </button>
      </div>

      <div className={`flex flex-col gap-3 transition-opacity duration-150 ${enabled ? 'opacity-100' : 'opacity-40'}`}>

        {/* Threshold */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] text-[#8b949e] uppercase tracking-wider">
            Threshold
          </label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              className="flex-1 h-2 accent-[#58a6ff]"
              min={THRESHOLD_MIN}
              max={THRESHOLD_MAX}
              step={0.5}
              value={threshold_dBu}
              disabled={!enabled}
              onChange={handleRangeChange}
              aria-label="Limiter threshold"
              aria-valuemin={THRESHOLD_MIN}
              aria-valuemax={THRESHOLD_MAX}
              aria-valuenow={threshold_dBu}
              aria-valuetext={`${threshold_dBu.toFixed(1)} dBu`}
            />
            <div className="flex items-center gap-1 shrink-0">
              <input
                type="text"
                className="input w-16 text-center text-xs font-mono"
                value={thresholdDraft}
                disabled={!enabled}
                onFocus={() => setEditingThreshold(true)}
                onBlur={commitThreshold}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  setEditingThreshold(true);
                  setThresholdDraft(e.target.value);
                }}
                onKeyDown={handleThresholdKeyDown}
                aria-label="Limiter threshold value"
              />
              <span className="text-[10px] text-[#8b949e] font-mono">dBu</span>
            </div>
          </div>
          <div className="flex justify-between text-[9px] text-[#484f58] font-mono px-0.5">
            <span>-20</span>
            <span>0</span>
            <span>+20</span>
          </div>
        </div>

        {/* Ratio, Attack, Release — 2-column grid on mobile, 3-column on desktop */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">

          {/* Ratio */}
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] text-[#8b949e] uppercase tracking-wider">Ratio</label>
            <select
              className="select text-xs min-h-[44px]"
              value={safeRatio}
              disabled={!enabled}
              onChange={(e) => onRatioChange(parseInt(e.target.value, 10))}
              aria-label="Limiter ratio"
            >
              {RATIO_OPTIONS.map((label, i) => (
                <option key={i} value={i}>{label}</option>
              ))}
            </select>
          </div>

          {/* Attack */}
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] text-[#8b949e] uppercase tracking-wider">
              Attack <span className="normal-case">(ms/dB)</span>
            </label>
            <select
              className="select text-xs min-h-[44px]"
              value={safeAttack}
              disabled={!enabled}
              onChange={(e) => onAttackChange(parseInt(e.target.value, 10))}
              aria-label="Limiter attack"
            >
              {ATTACK_OPTIONS.map((label, i) => (
                <option key={i} value={i}>{label}</option>
              ))}
            </select>
          </div>

          {/* Release — spans full width on mobile (2-col grid makes it fill), normal on sm+ */}
          <div className="flex flex-col gap-0.5 col-span-2 sm:col-span-1">
            <label className="text-[10px] text-[#8b949e] uppercase tracking-wider">
              Release <span className="normal-case">(ms/dB)</span>
            </label>
            <select
              className="select text-xs min-h-[44px]"
              value={safeRelease}
              disabled={!enabled}
              onChange={(e) => onReleaseChange(parseInt(e.target.value, 10))}
              aria-label="Limiter release"
            >
              {RELEASE_OPTIONS.map((label, i) => (
                <option key={i} value={i}>{label}</option>
              ))}
            </select>
          </div>

        </div>
      </div>
    </div>
  );
}
