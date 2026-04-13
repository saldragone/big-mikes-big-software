import { useState, useCallback, KeyboardEvent, ChangeEvent } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CrossoverFilter {
  filterNum: number;
  freq: number;
  freqValue: number;
  filterType: number;
  isOff: boolean;
}

interface Props {
  outputIndex: number;
  hpf: CrossoverFilter | undefined;
  lpf: CrossoverFilter | undefined;
  onHPFChange: (freq: number | 'off', filterType: number) => void;
  onLPFChange: (freq: number | 'off', filterType: number) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const FILTER_TYPE_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'BW 12dB' },
  { value: 1, label: 'Bessel 12dB' },
  { value: 2, label: 'LR 12dB' },
  { value: 3, label: 'BW 18dB' },
  { value: 4, label: 'Bessel 18dB' },
  { value: 5, label: 'BW 24dB' },
  { value: 6, label: 'Bessel 24dB' },
  { value: 7, label: 'LR 24dB' },
];

const FREQ_MIN = 20;
const FREQ_MAX = 20000;

// ── Filter Section ─────────────────────────────────────────────────────────────

interface FilterSectionProps {
  id: string;
  title: string;
  filter: CrossoverFilter | undefined;
  onChange: (freq: number | 'off', filterType: number) => void;
}

function FilterSection({ id, title, filter, onChange }: FilterSectionProps) {
  const isOff = filter?.isOff ?? true;
  const currentFreq = filter?.freq ?? 1000;
  const currentType = filter?.filterType ?? 0;

  const [freqDraft, setFreqDraft] = useState<string>(String(currentFreq));
  const [editingFreq, setEditingFreq] = useState(false);

  // Sync draft when not editing
  if (!editingFreq && String(currentFreq) !== freqDraft) {
    setFreqDraft(String(currentFreq));
  }

  const commitFreq = useCallback(
    (draft: string, type: number, off: boolean) => {
      setEditingFreq(false);
      if (off) {
        onChange('off', type);
        return;
      }
      const parsed = parseInt(draft, 10);
      if (!isNaN(parsed)) {
        const clamped = Math.max(FREQ_MIN, Math.min(FREQ_MAX, parsed));
        onChange(clamped, type);
        setFreqDraft(String(clamped));
      } else {
        setFreqDraft(String(currentFreq));
      }
    },
    [currentFreq, onChange]
  );

  const handleOffToggle = useCallback(() => {
    if (isOff) {
      // Turn on — use current draft freq
      const parsed = parseInt(freqDraft, 10);
      const freq = isNaN(parsed) ? currentFreq : Math.max(FREQ_MIN, Math.min(FREQ_MAX, parsed));
      onChange(freq, currentType);
    } else {
      onChange('off', currentType);
    }
  }, [isOff, freqDraft, currentFreq, currentType, onChange]);

  const handleTypeChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      const type = parseInt(e.target.value, 10);
      if (isOff) {
        onChange('off', type);
      } else {
        const parsed = parseInt(freqDraft, 10);
        const freq = isNaN(parsed) ? currentFreq : Math.max(FREQ_MIN, Math.min(FREQ_MAX, parsed));
        onChange(freq, type);
      }
    },
    [isOff, freqDraft, currentFreq, onChange]
  );

  const handleFreqKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      else if (e.key === 'Escape') {
        setEditingFreq(false);
        setFreqDraft(String(currentFreq));
        (e.target as HTMLInputElement).blur();
      }
    },
    [currentFreq]
  );

  return (
    <div className="panel p-3 flex flex-col gap-2 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[#e1e4e8] uppercase tracking-wider">{title}</span>
        <button
          className={`text-xs px-2 py-1 rounded border min-h-[32px] min-w-[44px] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-brand/50 ${
            isOff
              ? 'btn-ghost'
              : 'btn-active'
          }`}
          onClick={handleOffToggle}
          aria-pressed={!isOff}
          aria-label={`${isOff ? 'Enable' : 'Disable'} ${title}`}
        >
          {isOff ? 'OFF' : 'ON'}
        </button>
      </div>

      {/* Frequency */}
      <div className="flex flex-col gap-0.5">
        <label
          className="text-[10px] text-[#8b949e]"
          htmlFor={`${id}-freq`}
        >
          Freq (Hz)
        </label>
        <input
          id={`${id}-freq`}
          type="number"
          className="input text-sm"
          min={FREQ_MIN}
          max={FREQ_MAX}
          step={1}
          value={freqDraft}
          disabled={isOff}
          onFocus={() => setEditingFreq(true)}
          onBlur={() => commitFreq(freqDraft, currentType, isOff)}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            setEditingFreq(true);
            setFreqDraft(e.target.value);
          }}
          onKeyDown={handleFreqKeyDown}
          aria-label={`${title} frequency`}
        />
      </div>

      {/* Filter type */}
      <div className="flex flex-col gap-0.5">
        <label
          className="text-[10px] text-[#8b949e]"
          htmlFor={`${id}-type`}
        >
          Type
        </label>
        <select
          id={`${id}-type`}
          className="select text-sm"
          value={currentType}
          onChange={handleTypeChange}
          aria-label={`${title} filter type`}
        >
          {FILTER_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function CrossoverControls({
  outputIndex,
  hpf,
  lpf,
  onHPFChange,
  onLPFChange,
}: Props) {
  const idBase = `crossover-out${outputIndex}`;

  return (
    <div className="flex flex-col gap-2 sm:grid sm:grid-cols-2 sm:gap-3">
      <FilterSection
        id={`${idBase}-hpf`}
        title="HPF"
        filter={hpf}
        onChange={onHPFChange}
      />
      <FilterSection
        id={`${idBase}-lpf`}
        title="LPF"
        filter={lpf}
        onChange={onLPFChange}
      />
    </div>
  );
}
