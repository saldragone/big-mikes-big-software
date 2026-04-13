// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  routing: number[];  // length 8; each is a bitmask of inputs (bit 0=A, 1=B, 2=C, 3=D)
  inputLabels: string[];   // custom names for inputs
  outputLabels: string[];  // custom names for outputs
  onToggle: (outputIndex: number, inputIndex: number, enabled: boolean) => void;
}

const NUM_INPUTS  = 4;
const NUM_OUTPUTS = 8;

// ── Component ─────────────────────────────────────────────────────────────────

export default function RoutingMatrix({ routing, inputLabels, outputLabels, onToggle }: Props) {
  return (
    <div className="panel overflow-hidden">
      <div className="panel-header">Routing Matrix</div>

      <div className="overflow-x-auto p-3">
        <table
          className="border-collapse w-full min-w-[220px]"
          role="grid"
          aria-label="Input to output routing matrix"
        >
          <thead>
            <tr>
              <th
                className="text-[10px] text-[#484f58] font-normal pb-2 pr-3 text-right whitespace-nowrap"
                aria-hidden="true"
              >
                Out / In
              </th>
              {inputLabels.slice(0, NUM_INPUTS).map((label, i) => (
                <th key={i} scope="col" className="text-center pb-2 px-1">
                  <span className="text-xs font-semibold text-[#e1e4e8] uppercase tracking-widest">
                    {label}
                  </span>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {outputLabels.slice(0, NUM_OUTPUTS).map((outputLabel, outputIndex) => {
              const bitmask = routing[outputIndex] ?? 0;
              return (
                <tr key={outputIndex}>
                  <th
                    scope="row"
                    className="text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider text-right pr-3 py-1 whitespace-nowrap"
                  >
                    {outputLabel}
                  </th>
                  {Array.from({ length: NUM_INPUTS }, (_, inputIndex) => {
                    const isEnabled = Boolean(bitmask & (1 << inputIndex));
                    return (
                      <td key={inputIndex} className="text-center px-1 py-1">
                        <button
                          className="inline-flex items-center justify-center p-[14px] sm:p-[10px] md:p-[6px] rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-[#58a6ff]/60 transition-colors duration-100 group"
                          onClick={() => onToggle(outputIndex, inputIndex, !isEnabled)}
                          aria-pressed={isEnabled}
                          aria-label={`Input ${inputLabels[inputIndex]} to Output ${outputLabel}: ${isEnabled ? 'connected' : 'disconnected'}`}
                        >
                          <span
                            className={`block w-4 h-4 rounded-sm transition-colors duration-100 ${
                              isEnabled
                                ? 'bg-[#3fb950] shadow-[0_0_6px_rgba(63,185,80,0.5)]'
                                : 'bg-[#21262d] group-hover:bg-[#30363d] border border-[#30363d]'
                            }`}
                            aria-hidden="true"
                          />
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="px-3 pb-3 flex items-center gap-4 text-[10px] text-[#8b949e]">
        <div className="flex items-center gap-1.5">
          <span className="block w-3 h-3 rounded-sm bg-[#3fb950]" aria-hidden="true" />
          Connected
        </div>
        <div className="flex items-center gap-1.5">
          <span className="block w-3 h-3 rounded-sm bg-[#21262d] border border-[#30363d]" aria-hidden="true" />
          Disconnected
        </div>
      </div>
    </div>
  );
}
