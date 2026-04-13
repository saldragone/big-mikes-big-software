/**
 * Ashly Protea 4.8SP Control — Main App
 *
 * Runs in two modes:
 *  - Normal:  WebSocket → Node.js backend → RS-232 → 4.8SP
 *  - Demo:    useDemoMode() provides simulated state (Vercel preview or manual toggle)
 *
 * Demo mode can be activated by:
 *   1. VITE_DEMO_MODE=true env var (Vercel deployment)
 *   2. ?demo=1 URL param
 *   3. Selecting "DEMO" from the port dropdown and clicking Connect
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

// ─── Tab navigation ───────────────────────────────────────────────────────────
const TABS = ['Meters', 'Inputs', 'Routing', 'Outputs', 'Presets'] as const;
type Tab = typeof TABS[number];

const TAB_ICONS: Record<Tab, string> = {
  Meters:  '⬛',
  Inputs:  '↘',
  Routing: '⇄',
  Outputs: '↗',
  Presets: '☰',
};

type ViewMode = 'mobile' | 'desktop';

// ─── App root ────────────────────────────────────────────────────────────────
export default function App() {
  const [demoActive, setDemoActive] = useState(isDemoMode());

  if (demoActive) {
    return <DemoApp onExitDemo={() => setDemoActive(false)} />;
  }
  return <LiveApp onEnterDemo={() => setDemoActive(true)} />;
}

// ─── Demo App ─────────────────────────────────────────────────────────────────
function DemoApp({ onExitDemo }: { onExitDemo: () => void }) {
  const { state, send: demoSend } = useDemoMode();
  const { presetNames, savePreset: dbSave } = usePresets();

  const enrichedState = presetNames
    ? { ...state, presetNames }
    : state;

  const send = useCallback((obj: object) => {
    const m = obj as Record<string, any>;
    if (m.type === 'disconnect') {
      onExitDemo();
      return;
    }
    demoSend(obj);
    if (m.type === 'savePreset') {
      dbSave(m.index, m.name, null);
    }
  }, [demoSend, dbSave, onExitDemo]);

  return (
    <AppShell
      state={enrichedState}
      send={send}
      ports={[{ path: 'DEMO', manufacturer: 'Simulated Ashly 4.8SP' }]}
      connected={true}
      port="DEMO"
      deviceName="4.8SP (Demo)"
      readyState="open"
      onRefreshPorts={() => {}}
      isDemo={true}
    />
  );
}

// ─── Live App ─────────────────────────────────────────────────────────────────
function LiveApp({ onEnterDemo }: { onEnterDemo: () => void }) {
  const { readyState, send: wsSend, lastMessage } = useWebSocket(wsUrl());
  const { state, optimistic } = useDeviceState(lastMessage);
  const { presetNames, savePreset: dbSave } = usePresets();
  const [ports, setPorts] = useState<{ path: string; manufacturer?: string }[]>([]);

  useEffect(() => {
    if (!lastMessage) return;
    try {
      const msg = JSON.parse(lastMessage.data);
      if (msg.type === 'portList') setPorts(msg.ports ?? []);
    } catch {}
  }, [lastMessage]);

  const enrichedState = presetNames
    ? { ...state, presetNames }
    : state;

  const send = useCallback((obj: object) => {
    const m = obj as Record<string, any>;
    if (m.type === 'connect' && m.port === 'DEMO') {
      onEnterDemo();
      return;
    }
    wsSend(obj);
    switch (m.type) {
      case 'setGain':    optimistic.setGain(m.node, m.dB);                   break;
      case 'mute':       optimistic.setMute(m.node, m.muted);                break;
      case 'setDelay':   optimistic.setDelay(m.node, m.ms);                  break;
      case 'setSource':  optimistic.setSource(m.output, m.input, m.enabled); break;
      case 'savePreset': dbSave(m.index, m.name, m.state ?? null);           break;
    }
  }, [wsSend, optimistic, dbSave, onEnterDemo]);

  const onRefreshPorts = useCallback(() => {
    wsSend({ type: 'getPorts' });
  }, [wsSend]);

  return (
    <AppShell
      state={enrichedState}
      send={send}
      ports={ports}
      connected={state.connected}
      port={state.port}
      deviceName={state.deviceName}
      readyState={readyState}
      onRefreshPorts={onRefreshPorts}
      isDemo={false}
    />
  );
}

// ─── Shared shell ─────────────────────────────────────────────────────────────
interface ShellProps {
  state: ReturnType<typeof useDeviceState>['state'] | typeof defaultDeviceState;
  send: (obj: object) => void;
  ports: { path: string; manufacturer?: string }[];
  connected: boolean;
  port: string;
  deviceName: string;
  readyState: string;
  onRefreshPorts: () => void;
  isDemo: boolean;
}

function AppShell({ state, send, ports, connected, port, deviceName, readyState, onRefreshPorts, isDemo }: ShellProps) {
  const [activeTab, setActiveTab] = useState<Tab>('Meters');
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('ashly-view-mode');
    if (saved === 'mobile' || saved === 'desktop') return saved;
    return window.innerWidth >= 1024 ? 'desktop' : 'mobile';
  });

  // Persist view mode
  useEffect(() => {
    localStorage.setItem('ashly-view-mode', viewMode);
  }, [viewMode]);

  // ── Helpers ──────────────────────────────────────────────────────────────
  function inputGain(i: number)    { return state.gains.find(g => g.node === i)?.gain_dB ?? 0; }
  function outputGain(i: number)   { return state.gains.find(g => g.node === i + 4)?.gain_dB ?? 0; }
  function inputMuted(i: number)   { return state.status.mute[i] ?? false; }
  function outputMuted(i: number)  { return state.status.mute[i + 4] ?? false; }
  function inputDelay(i: number)   { return state.delays.find(d => d.node === i)?.ms ?? 0; }
  function outputDelay(i: number)  { return state.delays.find(d => d.node === i + 4)?.ms ?? 0; }
  function inputEQ(i: number) {
    const base = inputEqFilterBase(i);
    return state.eqFilters.filter(f => f.filterNum >= base && f.filterNum < base + 6);
  }
  function outputEQ(i: number) {
    const base = outputEqFilterBase(i);
    return state.eqFilters.filter(f => f.filterNum >= base && f.filterNum < base + 4);
  }
  function outputHPF(i: number)     { return state.crossovers.find(c => c.filterNum === i * 2); }
  function outputLPF(i: number)     { return state.crossovers.find(c => c.filterNum === i * 2 + 1); }
  function outputLimiter(i: number) { return state.limiters.find(l => l.node === i + 4); }

  // ── Event senders ────────────────────────────────────────────────────────
  const handleConnect    = (p: string) => send({ type: 'connect', port: p });
  const handleDisconnect = () => send({ type: 'disconnect' });

  const handleInputGain   = (i: number, dB: number)  => send({ type: 'setGain',  node: i,     dB });
  const handleOutputGain  = (i: number, dB: number)  => send({ type: 'setGain',  node: i + 4, dB });
  const handleInputMute   = (i: number, m: boolean)  => send({ type: 'mute',     node: i,     muted: m });
  const handleOutputMute  = (i: number, m: boolean)  => send({ type: 'mute',     node: i + 4, muted: m });
  const handleInputDelay  = (i: number, ms: number)  => send({ type: 'setDelay', node: i,     ms });
  const handleOutputDelay = (i: number, ms: number)  => send({ type: 'setDelay', node: i + 4, ms });

  const handleInputEQChange  = (_i: number, filter: any) =>
    send({ type: 'setEQ', filter: filter.filterNum, freq: filter.freq, q: filter.q, gain: filter.gain_dB, filterType: filter.filterType });
  const handleOutputEQChange = (_i: number, filter: any) =>
    send({ type: 'setEQ', filter: filter.filterNum, freq: filter.freq, q: filter.q, gain: filter.gain_dB, filterType: filter.filterType });

  const handleHPFChange = (i: number, freq: number | 'off', filterType: number) =>
    send({ type: 'setCrossover', filter: i * 2,     freq, filterType });
  const handleLPFChange = (i: number, freq: number | 'off', filterType: number) =>
    send({ type: 'setCrossover', filter: i * 2 + 1, freq, filterType });

  const handleLimiterChange = (i: number, field: string, v: number) => {
    const lim = outputLimiter(i);
    if (!lim) return;
    send({
      type:      'setLimiter',
      node:      i + 4,
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

  // ── Section renderers ──────────────────────────────────────────────────
  const renderMeters = () => (
    <div className="panel">
      <div className="panel-header">Level Meters</div>
      <div style={{ padding: 12, overflowX: 'auto' }}>
        <MeterBridge
          levels={state.meters.levels}
          gainReduction={state.meters.gainReduction}
          inputLabels={[...INPUT_LABELS]}
          outputLabels={[...OUTPUT_LABELS]}
        />
      </div>
    </div>
  );

  const renderInputs = () => (
    <div className="panel">
      <div className="panel-header">Input Channels</div>
      <div style={{ display: 'grid', gridTemplateColumns: viewMode === 'desktop' ? 'repeat(4, 1fr)' : 'repeat(auto-fit, minmax(280px, 1fr))', gap: 1, background: '#21262d' }}>
        <Suspense fallback={<ChannelSkeleton count={4} />}>
          {INPUT_LABELS.map((label, i) => (
            <div key={i} style={{ background: '#161b22' }}>
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
  );

  const renderRouting = () => (
    <div className="panel">
      <div className="panel-header">Input &rarr; Output Routing</div>
      <div style={{ padding: 12, overflowX: 'auto' }}>
        <RoutingMatrix
          routing={state.status.routing}
          onToggle={handleRoutingToggle}
        />
      </div>
    </div>
  );

  const renderOutputs = () => (
    <div className="panel">
      <div className="panel-header">Output Channels</div>
      <div style={{ display: 'grid', gridTemplateColumns: viewMode === 'desktop' ? 'repeat(4, 1fr)' : 'repeat(auto-fit, minmax(280px, 1fr))', gap: 1, background: '#21262d' }}>
        <Suspense fallback={<ChannelSkeleton count={8} />}>
          {OUTPUT_LABELS.map((label, i) => (
            <div key={i} style={{ background: '#161b22' }}>
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
                onPolarityToggle={() => {}}
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
  );

  const renderPresets = () => (
    <PresetBar
      presetNames={state.presetNames}
      connected={connected}
      onRecall={handleRecallPreset}
      onSave={handleSavePreset}
    />
  );

  const renderActiveSection = () => {
    switch (activeTab) {
      case 'Meters':  return renderMeters();
      case 'Inputs':  return renderInputs();
      case 'Routing': return renderRouting();
      case 'Outputs': return renderOutputs();
      case 'Presets': return renderPresets();
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#0d1117', color: '#e1e4e8' }}>

      {/* ── Header ── */}
      <header className="sticky top-0 z-50" style={{
        background: 'rgba(13,17,23,0.95)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid #21262d',
      }}>
        {/* Top bar */}
        <div className="flex items-center gap-3 px-4 py-2.5">
          {/* Logo */}
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="32" height="32" rx="8" fill="#58a6ff" fillOpacity="0.15"/>
              <path d="M7 22 L11 10 L16 18 L21 10 L25 22" stroke="#58a6ff" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1, color: '#e1e4e8' }}>Ashly Protea</div>
              <div style={{ fontSize: 10, fontWeight: 500, color: '#8b949e', letterSpacing: '0.06em' }}>4.8SP CONTROLLER</div>
            </div>
          </div>

          <div className="flex-1" />

          {/* View mode toggle */}
          <div className="view-toggle">
            <button
              className={`view-toggle-btn ${viewMode === 'mobile' ? 'active' : ''}`}
              onClick={() => setViewMode('mobile')}
              title="Mobile view"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
                <line x1="12" y1="18" x2="12.01" y2="18"/>
              </svg>
            </button>
            <button
              className={`view-toggle-btn ${viewMode === 'desktop' ? 'active' : ''}`}
              onClick={() => setViewMode('desktop')}
              title="Desktop view"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                <line x1="8" y1="21" x2="16" y2="21"/>
                <line x1="12" y1="17" x2="12" y2="21"/>
              </svg>
            </button>
          </div>

          {/* Status chip */}
          {isDemo ? (
            <div className="status-chip status-chip-demo">
              <span className="status-dot" style={{ background: '#58a6ff', boxShadow: '0 0 6px #58a6ff' }} />
              DEMO
            </div>
          ) : connected ? (
            <div className="status-chip status-chip-connected">
              <span className="status-dot" style={{ background: '#3fb950', boxShadow: '0 0 6px #3fb950' }} />
              {deviceName || port}
            </div>
          ) : (
            <div className="status-chip status-chip-disconnected">
              <span className="status-dot" style={{ background: '#484f58' }} />
              OFFLINE
            </div>
          )}

          <div className="hidden sm:block" style={{ fontSize: 10, color: readyState === 'open' ? '#3fb950' : '#484f58', fontFamily: 'monospace' }}>
            WS:{readyState === 'open' ? 'OK' : 'off'}
          </div>
        </div>

        {/* Connection bar */}
        <ConnectionBar
          connected={connected}
          port={port}
          deviceName={deviceName}
          ports={ports}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          onRefreshPorts={onRefreshPorts}
          send={send}
        />

        {/* Tab navigation */}
        <nav className="tab-bar">
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`nav-tab${activeTab === tab ? ' active' : ''}`}
            >
              <span style={{ opacity: 0.6, marginRight: 4 }}>{TAB_ICONS[tab]}</span>
              {tab}
            </button>
          ))}
        </nav>
      </header>

      {/* ── Main content ── */}
      <main className="app-main">
        {viewMode === 'desktop' ? (
          /* ── Desktop command center layout ── */
          <div className="command-center">
            {/* Persistent meters strip at top */}
            <div className="cc-meters">
              {renderMeters()}
            </div>

            {/* Main content area — only the active tab */}
            <div className="cc-content">
              {activeTab === 'Meters' ? (
                <div className="cc-detail-placeholder">
                  <div style={{ textAlign: 'center', padding: 40, color: '#484f58' }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>⬛</div>
                    <div style={{ fontSize: 13 }}>Meters are displayed above. Select another tab to view controls.</div>
                  </div>
                </div>
              ) : (
                renderActiveSection()
              )}
            </div>
          </div>
        ) : (
          /* ── Mobile tab-switched layout ── */
          <div className="mobile-content">
            {renderActiveSection()}
          </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="app-footer">
        <span>Ashly Protea 4.8SP — 9600 baud RS-232</span>
        {isDemo && (
          <span style={{ color: 'rgba(88,166,255,0.5)' }}>Simulated hardware — no serial connection</span>
        )}
      </footer>
    </div>
  );
}

function ChannelSkeleton({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} style={{ height: 260, background: '#161b22', animation: 'pulse 2s infinite' }} />
      ))}
    </>
  );
}
