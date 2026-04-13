/**
 * Ashly Protea 4.8SP Control — Main App
 *
 * Runs in two modes:
 *  - Normal:  WebSocket → Node.js backend → RS-232 → 4.8SP
 *  - Demo:    useDemoMode() provides simulated state (Vercel preview)
 */

import { useCallback, useEffect, useState, lazy, Suspense } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useDeviceState, defaultDeviceState } from './hooks/useDeviceState';
import { usePresets } from './hooks/usePresets';
import { isDemoMode, useDemoMode } from './demo/useDemoMode';
import ConnectionBar from './components/ConnectionBar';
import MeterBridge from './components/MeterBridge';
import RoutingMatrix from './components/RoutingMatrix';
import PresetBar from './components/PresetBar';
import { INPUT_LABELS, OUTPUT_LABELS, inputEqFilterBase, outputEqFilterBase } from '../lib/constants';

const InputChannel  = lazy(() => import('./components/InputChannel'));
const OutputChannel = lazy(() => import('./components/OutputChannel'));

// ─── WS URL (dev: proxy, prod: same origin) ───────────────────────────────────
function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host  = import.meta.env.DEV
    ? `${window.location.hostname}:3000`
    : window.location.host;
  return `${proto}//${host}/ws`;
}

// ─── Tab navigation for mobile ────────────────────────────────────────────────
const TABS = ['Meters', 'Inputs', 'Routing', 'Outputs', 'Presets'] as const;
type Tab = typeof TABS[number];

// ─── Demo banner ─────────────────────────────────────────────────────────────
function DemoBanner() {
  return (
    <div className="bg-brand/15 border-b border-brand/30 px-4 py-2 text-center text-xs text-brand font-medium">
      DEMO MODE — Simulated Ashly 4.8SP. All controls are interactive.
      Connect your own device at{' '}
      <span className="font-mono text-gray-300">localhost:3000</span> for real hardware control.
    </div>
  );
}

// ─── App (Demo wrapper) ───────────────────────────────────────────────────────
export default function App() {
  const demo = isDemoMode();
  return demo ? <DemoApp /> : <LiveApp />;
}

// ─── Demo App ─────────────────────────────────────────────────────────────────
function DemoApp() {
  const { state, send, ports } = useDemoMode();
  const { presetNames, savePreset: dbSave } = usePresets();

  // Overlay DB preset names onto demo state
  const enrichedState = presetNames
    ? { ...state, presetNames }
    : state;

  const sendWithDb = useCallback((obj: object) => {
    send(obj);
    const m = obj as Record<string, any>;
    if (m.type === 'savePreset') {
      dbSave(m.index, m.name, null);
    }
  }, [send, dbSave]);

  return (
    <>
      <DemoBanner />
      <AppShell
        state={enrichedState}
        send={sendWithDb}
        ports={ports}
        readyState="open"
        onRefreshPorts={() => {}}
      />
    </>
  );
}

// ─── Live App ─────────────────────────────────────────────────────────────────
function LiveApp() {
  const { readyState, send: wsSend, lastMessage } = useWebSocket(wsUrl());
  const { state, optimistic } = useDeviceState(lastMessage);
  const { presetNames, savePreset: dbSave } = usePresets();
  const [ports, setPorts] = useState<{ path: string; manufacturer?: string }[]>([]);

  // Intercept portList messages
  useEffect(() => {
    if (!lastMessage) return;
    try {
      const msg = JSON.parse(lastMessage.data);
      if (msg.type === 'portList') setPorts(msg.ports ?? []);
    } catch {}
  }, [lastMessage]);

  // Overlay DB names onto device state (DB is source-of-truth for names)
  const enrichedState = presetNames
    ? { ...state, presetNames }
    : state;

  const send = useCallback((obj: object) => {
    wsSend(obj);
    const m = obj as Record<string, any>;
    switch (m.type) {
      case 'setGain':   optimistic.setGain(m.node, m.dB);                   break;
      case 'mute':      optimistic.setMute(m.node, m.muted);                break;
      case 'setDelay':  optimistic.setDelay(m.node, m.ms);                  break;
      case 'setSource': optimistic.setSource(m.output, m.input, m.enabled); break;
      case 'savePreset': dbSave(m.index, m.name, m.state ?? null);          break;
    }
  }, [wsSend, optimistic, dbSave]);

  const onRefreshPorts = useCallback(() => {
    wsSend({ type: 'getPorts' });
  }, [wsSend]);

  return (
    <AppShell
      state={enrichedState}
      send={send}
      ports={ports}
      readyState={readyState}
      onRefreshPorts={onRefreshPorts}
    />
  );
}

// ─── Shared shell ─────────────────────────────────────────────────────────────
interface ShellProps {
  state: ReturnType<typeof useDeviceState>['state'] | typeof defaultDeviceState;
  send: (obj: object) => void;
  ports: { path: string; manufacturer?: string }[];
  readyState: string;
  onRefreshPorts: () => void;
}

function AppShell({ state, send, ports, readyState, onRefreshPorts }: ShellProps) {
  const [activeTab, setActiveTab] = useState<Tab>('Meters');

  // Keyboard shortcut: M = mute selected channel (future: track selected)
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      // Global shortcuts can be added here
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Helpers ──────────────────────────────────────────────────────────────

  function inputGain(i: number) { return state.gains.find(g => g.node === i)?.gain_dB ?? 0; }
  function outputGain(i: number) { return state.gains.find(g => g.node === i + 4)?.gain_dB ?? 0; }
  function inputMuted(i: number) { return state.status.mute[i] ?? false; }
  function outputMuted(i: number) { return state.status.mute[i + 4] ?? false; }
  function inputDelay(i: number) { return state.delays.find(d => d.node === i)?.ms ?? 0; }
  function outputDelay(i: number) { return state.delays.find(d => d.node === i + 4)?.ms ?? 0; }
  function inputEQ(i: number) {
    const base = inputEqFilterBase(i);
    return state.eqFilters.filter(f => f.filterNum >= base && f.filterNum < base + 6);
  }
  function outputEQ(i: number) {
    const base = outputEqFilterBase(i);
    return state.eqFilters.filter(f => f.filterNum >= base && f.filterNum < base + 4);
  }
  function outputHPF(i: number) { return state.crossovers.find(c => c.filterNum === i * 2); }
  function outputLPF(i: number) { return state.crossovers.find(c => c.filterNum === i * 2 + 1); }
  function outputLimiter(i: number) { return state.limiters.find(l => l.node === i + 4); }

  // ── Event senders ────────────────────────────────────────────────────────

  const handleConnect = (port: string) => send({ type: 'connect', port });
  const handleDisconnect = () => send({ type: 'disconnect' });

  const handleInputGain  = (i: number, dB: number) => send({ type: 'setGain',  node: i,     dB });
  const handleOutputGain = (i: number, dB: number) => send({ type: 'setGain',  node: i + 4, dB });
  const handleInputMute  = (i: number, m: boolean) => send({ type: 'mute',     node: i,     muted: m });
  const handleOutputMute = (i: number, m: boolean) => send({ type: 'mute',     node: i + 4, muted: m });
  const handleInputDelay = (i: number, ms: number) => send({ type: 'setDelay', node: i,     ms });
  const handleOutputDelay= (i: number, ms: number) => send({ type: 'setDelay', node: i + 4, ms });

  const handleOutputPolarity = (i: number) => {
    const pol = [...state.status.polarity];
    pol[i] = !pol[i];
    // polarity is part of status message — send full status (simplified: toggle via source select)
    // In full impl we'd reconstruct the status message; for now, optimistic only
  };

  const handleInputEQChange = (_i: number, filter: any) =>
    send({ type: 'setEQ', filter: filter.filterNum, freq: filter.freq, q: filter.q, gain: filter.gain_dB, filterType: filter.filterType });

  const handleOutputEQChange = (_i: number, filter: any) =>
    send({ type: 'setEQ', filter: filter.filterNum, freq: filter.freq, q: filter.q, gain: filter.gain_dB, filterType: filter.filterType });

  const handleHPFChange = (i: number, freq: number | 'off', filterType: number) =>
    send({ type: 'setCrossover', filter: i * 2, freq, filterType });

  const handleLPFChange = (i: number, freq: number | 'off', filterType: number) =>
    send({ type: 'setCrossover', filter: i * 2 + 1, freq, filterType });

  const handleLimiterChange = (i: number, field: string, v: number) => {
    const lim = outputLimiter(i);
    if (!lim) return;
    send({
      type: 'setLimiter',
      node: i + 4,
      threshold: field === 'threshold' ? v : lim.threshold_dBu,
      ratio:     field === 'ratio'     ? v : lim.ratio,
      attack:    field === 'attack'    ? v : lim.attack,
      release:   field === 'release'   ? v : lim.release,
    });
  };

  const handleRoutingToggle = (outputIndex: number, inputIndex: number, enabled: boolean) =>
    send({ type: 'setSource', output: outputIndex + 4, input: inputIndex, enabled });

  const handleRecallPreset = (index: number) => send({ type: 'recallPreset', index });
  const handleSavePreset   = (index: number, name: string) => send({ type: 'savePreset', index, name });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col bg-[#1e1e1e] text-gray-100 font-mono">

      {/* Connection Bar */}
      <header className="sticky top-0 z-50 bg-[#1e1e1e] border-b border-[#333] shadow-lg">
        <ConnectionBar
          connected={state.connected}
          port={state.port}
          deviceName={state.deviceName}
          ports={ports}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          onRefreshPorts={onRefreshPorts}
          send={send}
        />
      </header>

      {/* Mobile tab bar */}
      <nav className="flex md:hidden sticky top-[57px] z-40 bg-[#252525] border-b border-[#333] overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab}
            className={`flex-1 min-w-[70px] px-3 py-2.5 text-xs font-semibold uppercase tracking-wide
              transition-colors whitespace-nowrap
              ${activeTab === tab
                ? 'text-brand border-b-2 border-brand bg-[#2c2c2c]'
                : 'text-gray-500 hover:text-gray-300'}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </nav>

      {/* Main content */}
      <main className="flex-1 p-2 md:p-4 space-y-4 max-w-[1800px] mx-auto w-full">

        {/* ── Meters (always visible on desktop, tab on mobile) ── */}
        <section className={activeTab === 'Meters' ? 'block' : 'hidden md:block'}>
          <div className="panel">
            <div className="panel-header">Level Meters</div>
            <div className="p-2 overflow-x-auto">
              <MeterBridge
                levels={state.meters.levels}
                gainReduction={state.meters.gainReduction}
                inputLabels={[...INPUT_LABELS]}
                outputLabels={[...OUTPUT_LABELS]}
              />
            </div>
          </div>
        </section>

        {/* ── Inputs ── */}
        <section className={activeTab === 'Inputs' ? 'block' : 'hidden md:block'}>
          <div className="panel">
            <div className="panel-header">Input Channels</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-px bg-[#333]">
              <Suspense fallback={<ChannelSkeleton count={4} />}>
                {INPUT_LABELS.map((label, i) => (
                  <div key={i} className="bg-[#252525]">
                    <InputChannel
                      index={i}
                      label={label}
                      gain_dB={inputGain(i)}
                      muted={inputMuted(i)}
                      delay_ms={inputDelay(i)}
                      eqFilters={inputEQ(i)}
                      eqEnabled={state.status.eqEnable[i] ?? true}
                      onGainChange={dB => handleInputGain(i, dB)}
                      onMute={m => handleInputMute(i, m)}
                      onDelayChange={ms => handleInputDelay(i, ms)}
                      onEQChange={f => handleInputEQChange(i, f)}
                      onEQEnableToggle={() => {}}
                    />
                  </div>
                ))}
              </Suspense>
            </div>
          </div>
        </section>

        {/* ── Routing Matrix ── */}
        <section className={activeTab === 'Routing' ? 'block' : 'hidden md:block'}>
          <div className="panel">
            <div className="panel-header">Input → Output Routing</div>
            <div className="p-2 overflow-x-auto">
              <RoutingMatrix
                routing={state.status.routing}
                onToggle={handleRoutingToggle}
              />
            </div>
          </div>
        </section>

        {/* ── Outputs ── */}
        <section className={activeTab === 'Outputs' ? 'block' : 'hidden md:block'}>
          <div className="panel">
            <div className="panel-header">Output Channels</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-[#333]">
              <Suspense fallback={<ChannelSkeleton count={8} />}>
                {OUTPUT_LABELS.map((label, i) => (
                  <div key={i} className="bg-[#252525]">
                    <OutputChannel
                      index={i}
                      label={label}
                      gain_dB={outputGain(i)}
                      muted={outputMuted(i)}
                      delay_ms={outputDelay(i)}
                      polarity={state.status.polarity[i] ?? false}
                      eqFilters={outputEQ(i)}
                      eqEnabled={state.status.eqEnable[i + 4] ?? true}
                      hpf={outputHPF(i)}
                      lpf={outputLPF(i)}
                      limiter={outputLimiter(i)}
                      limiterEnabled={state.status.limiterEnable[i] ?? false}
                      onGainChange={dB => handleOutputGain(i, dB)}
                      onMute={m => handleOutputMute(i, m)}
                      onDelayChange={ms => handleOutputDelay(i, ms)}
                      onPolarityToggle={() => handleOutputPolarity(i)}
                      onEQChange={f => handleOutputEQChange(i, f)}
                      onEQEnableToggle={() => {}}
                      onHPFChange={(freq, ft) => handleHPFChange(i, freq, ft)}
                      onLPFChange={(freq, ft) => handleLPFChange(i, freq, ft)}
                      onLimiterChange={(field, v) => handleLimiterChange(i, field, v)}
                      onLimiterEnableToggle={() => {}}
                    />
                  </div>
                ))}
              </Suspense>
            </div>
          </div>
        </section>

        {/* ── Presets ── */}
        <section className={activeTab === 'Presets' ? 'block' : 'hidden md:block'}>
          <PresetBar
            presetNames={state.presetNames}
            connected={state.connected}
            onRecall={handleRecallPreset}
            onSave={handleSavePreset}
          />
        </section>

      </main>

      {/* Footer */}
      <footer className="border-t border-[#333] px-4 py-2 text-[10px] text-gray-600 flex flex-wrap gap-3 justify-between">
        <span>Ashly Protea 4.8SP Control — 9600 baud RS-232</span>
        <span className={`font-medium ${readyState === 'open' ? 'text-green-600' : 'text-red-600'}`}>
          WS: {readyState}
        </span>
      </footer>
    </div>
  );
}

function ChannelSkeleton({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="h-64 bg-[#252525] animate-pulse" />
      ))}
    </>
  );
}
