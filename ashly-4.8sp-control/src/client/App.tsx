/**
 * Ashly Protea 4.8SP Control — Main App
 *
 * Desktop: Logic Pro-style mixer with compact channel strips + modal detail editing
 * Mobile:  Tab-based navigation with full channel views
 */

import { useCallback, useEffect, useState, lazy, Suspense } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useDeviceState, defaultDeviceState } from './hooks/useDeviceState';
import { usePresets } from './hooks/usePresets';
import { isDemoMode, useDemoMode } from './demo/useDemoMode';
import ConnectionBar from './components/ConnectionBar';
import MeterBridge from './components/MeterBridge';
import MixerStrip from './components/MixerStrip';
import RoutingMatrix from './components/RoutingMatrix';
import PresetBar from './components/PresetBar';
import ChannelDetailModal from './components/ChannelDetailModal';
import AgentChat from './components/AgentChat';
import { useAgent } from './hooks/useAgent';
import { useChannelNames } from './hooks/useChannelNames';
import { INPUT_LABELS, OUTPUT_LABELS, inputEqFilterBase, outputEqFilterBase } from '../lib/constants';

const InputChannel  = lazy(() => import('./components/InputChannel'));
const OutputChannel = lazy(() => import('./components/OutputChannel'));

// ─── WS URL ───────────────────────────────────────────────────────────────────
function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host  = import.meta.env.DEV
    ? `${window.location.hostname}:3000`
    : window.location.host;
  return `${proto}//${host}/ws`;
}

// ─── Tab navigation (mobile) ──────────────────────────────────────────────────
const TABS = ['Meters', 'Inputs', 'Routing', 'Outputs', 'Presets'] as const;
type Tab = typeof TABS[number];

// ─── Desktop bottom-bar tabs ──────────────────────────────────────────────────
const DESK_TABS = ['Mixer', 'Routing', 'Presets'] as const;
type DeskTab = typeof DESK_TABS[number];

type ViewMode = 'mobile' | 'desktop';

type ModalState = {
  open: boolean;
  channelType: 'input' | 'output';
  channelIndex: number;
  section: 'eq' | 'delay' | 'crossover' | 'limiter';
};

// ─── App root ─────────────────────────────────────────────────────────────────
export default function App() {
  const [demoActive, setDemoActive] = useState(isDemoMode());
  if (demoActive) return <DemoApp onExitDemo={() => setDemoActive(false)} />;
  return <LiveApp onEnterDemo={() => setDemoActive(true)} />;
}

// ─── Demo App ─────────────────────────────────────────────────────────────────
function DemoApp({ onExitDemo }: { onExitDemo: () => void }) {
  const { state, send: demoSend } = useDemoMode();
  const { presetNames, savePreset: dbSave } = usePresets();
  const enrichedState = presetNames ? { ...state, presetNames } : state;

  const send = useCallback((obj: object) => {
    const m = obj as Record<string, any>;
    if (m.type === 'disconnect') { onExitDemo(); return; }
    demoSend(obj);
    if (m.type === 'savePreset') dbSave(m.index, m.name, null);
  }, [demoSend, dbSave, onExitDemo]);

  return (
    <AppShell state={enrichedState} send={send}
      ports={[{ path: 'DEMO', manufacturer: 'Simulated Ashly 4.8SP' }]}
      connected={true} port="DEMO" deviceName="4.8SP (Demo)" readyState="open"
      onRefreshPorts={() => {}} isDemo={true} />
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

  const enrichedState = presetNames ? { ...state, presetNames } : state;

  const send = useCallback((obj: object) => {
    const m = obj as Record<string, any>;
    if (m.type === 'connect' && m.port === 'DEMO') { onEnterDemo(); return; }
    wsSend(obj);
    switch (m.type) {
      case 'setGain':    optimistic.setGain(m.node, m.dB); break;
      case 'mute':       optimistic.setMute(m.node, m.muted); break;
      case 'setDelay':   optimistic.setDelay(m.node, m.ms); break;
      case 'setSource':  optimistic.setSource(m.output, m.input, m.enabled); break;
      case 'savePreset': dbSave(m.index, m.name, m.state ?? null); break;
    }
  }, [wsSend, optimistic, dbSave, onEnterDemo]);

  return (
    <AppShell state={enrichedState} send={send} ports={ports}
      connected={state.connected} port={state.port} deviceName={state.deviceName}
      readyState={readyState} onRefreshPorts={() => wsSend({ type: 'getPorts' })}
      isDemo={false} />
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
  const [mobileTab, setMobileTab] = useState<Tab>('Meters');
  const [deskTab, setDeskTab] = useState<DeskTab>('Mixer');
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('ashly-view-mode');
    if (saved === 'mobile' || saved === 'desktop') return saved;
    return window.innerWidth >= 1024 ? 'desktop' : 'mobile';
  });
  const [modal, setModal] = useState<ModalState>({
    open: false, channelType: 'input', channelIndex: 0, section: 'eq',
  });

  const [chatOpen, setChatOpen] = useState(false);
  const channelNames = useChannelNames();

  useEffect(() => { localStorage.setItem('ashly-view-mode', viewMode); }, [viewMode]);

  // ── Agent (Little Mike) ────────────────────────────────────────────────
  const getDeviceState = useCallback(() => ({
    connected,
    channelNames: channelNames.names,
    channelNamesSummary: {
      inputs: channelNames.inputLabels.map((n, i) => `Node ${i}: "${n}"`).join(', '),
      outputs: channelNames.outputLabels.map((n, i) => `Node ${i + 4}: "${n}"`).join(', '),
    },
    gains: state.gains,
    mutes: state.status.mute,
    delays: state.delays,
    eqFilters: state.eqFilters,
    eqEnable: state.status.eqEnable,
    crossovers: state.crossovers,
    limiters: state.limiters,
    limiterEnable: state.status.limiterEnable,
    routing: state.status.routing,
    polarity: state.status.polarity,
    meters: state.meters,
    presetNames: state.presetNames,
  }), [state, connected, channelNames.names]);

  const executeToolCall = useCallback((name: string, input: Record<string, any>) => {
    switch (name) {
      case 'set_gain':      send({ type: 'setGain', node: input.node, dB: input.dB }); break;
      case 'set_mute':      send({ type: 'mute', node: input.node, muted: input.muted }); break;
      case 'set_eq':        send({ type: 'setEQ', filter: input.filter, freq: input.freq, q: input.q, gain: input.gain, filterType: input.filterType }); break;
      case 'set_delay':     send({ type: 'setDelay', node: input.node, ms: input.ms }); break;
      case 'set_crossover': send({ type: 'setCrossover', filter: input.filter, freq: input.freq, filterType: input.filterType }); break;
      case 'set_limiter':   send({ type: 'setLimiter', node: input.node, threshold: input.threshold, ratio: input.ratio, attack: input.attack, release: input.release }); break;
      case 'set_routing':   send({ type: 'setSource', output: input.output, input: input.input, enabled: input.enabled }); break;
      case 'recall_preset': send({ type: 'recallPreset', index: input.index }); break;
      case 'save_preset':   send({ type: 'savePreset', index: input.index, name: input.name }); break;
      case 'rename_channel': channelNames.renameChannel(input.node, input.name); break;
    }
  }, [send, channelNames]);

  const agent = useAgent({ getDeviceState, executeToolCall });

  // ── Data helpers ────────────────────────────────────────────────────────
  const inputGain    = (i: number) => state.gains.find(g => g.node === i)?.gain_dB ?? 0;
  const outputGain   = (i: number) => state.gains.find(g => g.node === i + 4)?.gain_dB ?? 0;
  const inputMuted   = (i: number) => state.status.mute[i] ?? false;
  const outputMuted  = (i: number) => state.status.mute[i + 4] ?? false;
  const inputDelay   = (i: number) => state.delays.find(d => d.node === i)?.ms ?? 0;
  const outputDelay  = (i: number) => state.delays.find(d => d.node === i + 4)?.ms ?? 0;
  const inputEQ      = (i: number) => { const base = inputEqFilterBase(i); return state.eqFilters.filter(f => f.filterNum >= base && f.filterNum < base + 6); };
  const outputEQ     = (i: number) => { const base = outputEqFilterBase(i); return state.eqFilters.filter(f => f.filterNum >= base && f.filterNum < base + 4); };
  const outputHPF    = (i: number) => state.crossovers.find(c => c.filterNum === i * 2);
  const outputLPF    = (i: number) => state.crossovers.find(c => c.filterNum === i * 2 + 1);
  const outputLimiter = (i: number) => state.limiters.find(l => l.node === i + 4);

  // ── Event senders ──────────────────────────────────────────────────────
  const handleConnect    = (p: string) => send({ type: 'connect', port: p });
  const handleDisconnect = () => send({ type: 'disconnect' });
  const handleInputGain   = (i: number, dB: number)  => send({ type: 'setGain', node: i, dB });
  const handleOutputGain  = (i: number, dB: number)  => send({ type: 'setGain', node: i + 4, dB });
  const handleInputMute   = (i: number, m: boolean)  => send({ type: 'mute', node: i, muted: m });
  const handleOutputMute  = (i: number, m: boolean)  => send({ type: 'mute', node: i + 4, muted: m });
  const handleInputDelay  = (i: number, ms: number)  => send({ type: 'setDelay', node: i, ms });
  const handleOutputDelay = (i: number, ms: number)  => send({ type: 'setDelay', node: i + 4, ms });
  const handleInputEQChange  = (_i: number, filter: any) =>
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
    send({ type: 'setLimiter', node: i + 4,
      threshold: field === 'threshold' ? v : lim.threshold_dBu,
      ratio: field === 'ratio' ? v : lim.ratio,
      attack: field === 'attack' ? v : lim.attack,
      release: field === 'release' ? v : lim.release,
    });
  };
  const handleRoutingToggle = (oi: number, ii: number, en: boolean) =>
    send({ type: 'setSource', output: oi + 4, input: ii, enabled: en });
  const handleRecallPreset = (i: number) => send({ type: 'recallPreset', index: i });
  const handleSavePreset = (i: number, name: string) => send({ type: 'savePreset', index: i, name });

  // ── Modal helpers ──────────────────────────────────────────────────────
  const openModal = (channelType: 'input' | 'output', channelIndex: number, section: 'eq' | 'delay' | 'crossover' | 'limiter') => {
    setModal({ open: true, channelType, channelIndex, section });
  };
  const closeModal = () => setModal(m => ({ ...m, open: false }));

  // Modal data for the currently open channel
  const mc = modal;
  const modalEqFilters = mc.channelType === 'input' ? inputEQ(mc.channelIndex) : outputEQ(mc.channelIndex);
  const modalEqEnabled = mc.channelType === 'input'
    ? (state.status.eqEnable[mc.channelIndex] ?? true)
    : (state.status.eqEnable[mc.channelIndex + 4] ?? true);
  const modalDelay = mc.channelType === 'input' ? inputDelay(mc.channelIndex) : outputDelay(mc.channelIndex);
  const modalHpf = mc.channelType === 'output' ? outputHPF(mc.channelIndex) : undefined;
  const modalLpf = mc.channelType === 'output' ? outputLPF(mc.channelIndex) : undefined;
  const modalLimiter = mc.channelType === 'output' ? outputLimiter(mc.channelIndex) : undefined;
  const modalLabel = mc.channelType === 'input' ? INPUT_LABELS[mc.channelIndex] : OUTPUT_LABELS[mc.channelIndex];

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#0d1117', color: '#e1e4e8' }}>

      {/* ── Header ── */}
      <header className="sticky top-0 z-50" style={{
        background: 'rgba(13,17,23,0.96)', backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)', borderBottom: '1px solid #21262d',
      }}>
        <div className="flex items-center gap-3 px-4 py-2">
          {/* Logo */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="8" fill="#58a6ff" fillOpacity="0.15"/>
              <path d="M7 22 L11 10 L16 18 L21 10 L25 22" stroke="#58a6ff" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1 }}>Ashly 4.8SP</div>
              <div style={{ fontSize: 9, color: '#6e7681', letterSpacing: '0.06em' }}>CONTROLLER</div>
            </div>
          </div>

          <div className="flex-1" />

          {/* View toggle */}
          <div className="view-toggle">
            <button className={`view-toggle-btn ${viewMode === 'mobile' ? 'active' : ''}`}
              onClick={() => setViewMode('mobile')} title="Mobile view">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>
              </svg>
            </button>
            <button className={`view-toggle-btn ${viewMode === 'desktop' ? 'active' : ''}`}
              onClick={() => setViewMode('desktop')} title="Desktop mixer">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
              </svg>
            </button>
          </div>

          {/* Status */}
          {isDemo ? (
            <div className="status-chip status-chip-demo">
              <span className="status-dot" style={{ background: '#58a6ff', boxShadow: '0 0 6px #58a6ff' }} />DEMO
            </div>
          ) : connected ? (
            <div className="status-chip status-chip-connected">
              <span className="status-dot" style={{ background: '#3fb950', boxShadow: '0 0 6px #3fb950' }} />{deviceName || port}
            </div>
          ) : (
            <div className="status-chip status-chip-disconnected">
              <span className="status-dot" style={{ background: '#484f58' }} />OFFLINE
            </div>
          )}
        </div>

        {/* Connection */}
        <ConnectionBar connected={connected} port={port} deviceName={deviceName} ports={ports}
          onConnect={handleConnect} onDisconnect={handleDisconnect} onRefreshPorts={onRefreshPorts} send={send} />

        {/* Tab bar */}
        {viewMode === 'mobile' ? (
          <nav className="tab-bar">
            {TABS.map(tab => (
              <button key={tab} onClick={() => setMobileTab(tab)}
                className={`nav-tab${mobileTab === tab ? ' active' : ''}`}>{tab}</button>
            ))}
          </nav>
        ) : (
          <nav className="tab-bar">
            {DESK_TABS.map(tab => (
              <button key={tab} onClick={() => setDeskTab(tab)}
                className={`nav-tab${deskTab === tab ? ' active' : ''}`}>{tab}</button>
            ))}
          </nav>
        )}
      </header>

      {/* ── Main ── */}
      <main style={{ flex: 1, overflow: 'hidden' }}>

        {viewMode === 'desktop' ? (
          /* ═══════════════════════════════════════════════════════════════════
             DESKTOP — Logic Pro-style mixer
             ═══════════════════════════════════════════════════════════════════ */
          <div className="desk-layout">
            {deskTab === 'Mixer' && (
              <div className="mixer-console">
                {/* Inputs */}
                <div className="mixer-group">
                  <div className="mixer-group-label">Inputs</div>
                  <div className="mixer-strips">
                    {channelNames.inputLabels.map((label, i) => (
                      <MixerStrip key={`in-${i}`}
                        channelType="input" index={i} label={label}
                        gain_dB={inputGain(i)} muted={inputMuted(i)}
                        delay_ms={inputDelay(i)} eqFilters={inputEQ(i)}
                        eqEnabled={state.status.eqEnable[i] ?? true}
                        meterLevel={state.meters.levels[i]?.level_dBu ?? -42}
                        meterClipped={state.meters.levels[i]?.clipped ?? false}
                        onGainChange={dB => handleInputGain(i, dB)}
                        onMute={m => handleInputMute(i, m)}
                        onOpenDetail={section => openModal('input', i, section)}
                        onRename={name => channelNames.renameChannel(i, name)}
                      />
                    ))}
                  </div>
                </div>

                {/* Divider */}
                <div className="mixer-divider" />

                {/* Outputs */}
                <div className="mixer-group">
                  <div className="mixer-group-label">Outputs</div>
                  <div className="mixer-strips">
                    {channelNames.outputLabels.map((label, i) => (
                      <MixerStrip key={`out-${i}`}
                        channelType="output" index={i} label={label}
                        gain_dB={outputGain(i)} muted={outputMuted(i)}
                        delay_ms={outputDelay(i)} eqFilters={outputEQ(i)}
                        eqEnabled={state.status.eqEnable[i + 4] ?? true}
                        polarity={state.status.polarity[i] ?? false}
                        hpfActive={!outputHPF(i)?.isOff}
                        lpfActive={!outputLPF(i)?.isOff}
                        limiterEnabled={state.status.limiterEnable[i] ?? false}
                        meterLevel={state.meters.levels[i + 4]?.level_dBu ?? -42}
                        meterClipped={state.meters.levels[i + 4]?.clipped ?? false}
                        gainReduction={state.meters.gainReduction[i] ?? 0}
                        onGainChange={dB => handleOutputGain(i, dB)}
                        onMute={m => handleOutputMute(i, m)}
                        onOpenDetail={section => openModal('output', i, section)}
                        onPolarityToggle={() => {}}
                        onRename={name => channelNames.renameChannel(i + 4, name)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {deskTab === 'Routing' && (
              <div style={{ padding: 16, maxWidth: 800, margin: '0 auto' }}>
                <RoutingMatrix routing={state.status.routing} inputLabels={channelNames.inputLabels} outputLabels={channelNames.outputLabels} onToggle={handleRoutingToggle} />
              </div>
            )}

            {deskTab === 'Presets' && (
              <div style={{ padding: 16, maxWidth: 800, margin: '0 auto' }}>
                <PresetBar presetNames={state.presetNames} connected={connected}
                  onRecall={handleRecallPreset} onSave={handleSavePreset} />
              </div>
            )}
          </div>
        ) : (
          /* ═══════════════════════════════════════════════════════════════════
             MOBILE — Tab-based views
             ═══════════════════════════════════════════════════════════════════ */
          <div style={{ padding: 12, maxWidth: 800, margin: '0 auto' }}>
            {mobileTab === 'Meters' && (
              <div className="panel">
                <div className="panel-header">Level Meters</div>
                <div style={{ padding: 12, overflowX: 'auto' }}>
                  <MeterBridge levels={state.meters.levels} gainReduction={state.meters.gainReduction}
                    inputLabels={[...INPUT_LABELS]} outputLabels={[...OUTPUT_LABELS]} />
                </div>
              </div>
            )}

            {mobileTab === 'Inputs' && (
              <div className="flex flex-col gap-3">
                <Suspense fallback={<ChannelSkeleton count={4} />}>
                  {INPUT_LABELS.map((label, i) => (
                    <InputChannel key={i} index={i} label={label}
                      gain_dB={inputGain(i)} muted={inputMuted(i)} delay_ms={inputDelay(i)}
                      eqFilters={inputEQ(i)} eqEnabled={state.status.eqEnable[i] ?? true}
                      onGainChange={dB => handleInputGain(i, dB)}
                      onMute={m => handleInputMute(i, m)}
                      onDelayChange={ms => handleInputDelay(i, ms)}
                      onEQChange={f => handleInputEQChange(i, f)}
                      onEQEnableToggle={() => {}} />
                  ))}
                </Suspense>
              </div>
            )}

            {mobileTab === 'Routing' && (
              <RoutingMatrix routing={state.status.routing} inputLabels={channelNames.inputLabels} outputLabels={channelNames.outputLabels} onToggle={handleRoutingToggle} />
            )}

            {mobileTab === 'Outputs' && (
              <div className="flex flex-col gap-3">
                <Suspense fallback={<ChannelSkeleton count={8} />}>
                  {OUTPUT_LABELS.map((label, i) => (
                    <OutputChannel key={i} index={i} label={label}
                      gain_dB={outputGain(i)} muted={outputMuted(i)} delay_ms={outputDelay(i)}
                      polarity={state.status.polarity[i] ?? false}
                      eqFilters={outputEQ(i)} eqEnabled={state.status.eqEnable[i + 4] ?? true}
                      hpf={outputHPF(i)} lpf={outputLPF(i)} limiter={outputLimiter(i)}
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
                      onLimiterEnableToggle={() => {}} />
                  ))}
                </Suspense>
              </div>
            )}

            {mobileTab === 'Presets' && (
              <PresetBar presetNames={state.presetNames} connected={connected}
                onRecall={handleRecallPreset} onSave={handleSavePreset} />
            )}
          </div>
        )}
      </main>

      {/* ── Channel Detail Modal ── */}
      <ChannelDetailModal
        open={modal.open}
        onClose={closeModal}
        section={modal.section}
        channelType={modal.channelType}
        channelLabel={modalLabel}
        channelIndex={modal.channelIndex}
        eqFilters={modalEqFilters}
        eqEnabled={modalEqEnabled}
        onEQChange={f => modal.channelType === 'input'
          ? handleInputEQChange(modal.channelIndex, f)
          : handleOutputEQChange(modal.channelIndex, f)}
        onEQEnableToggle={() => {}}
        delay_ms={modalDelay}
        onDelayChange={ms => modal.channelType === 'input'
          ? handleInputDelay(modal.channelIndex, ms)
          : handleOutputDelay(modal.channelIndex, ms)}
        hpf={modalHpf}
        lpf={modalLpf}
        onHPFChange={(freq, ft) => handleHPFChange(modal.channelIndex, freq, ft)}
        onLPFChange={(freq, ft) => handleLPFChange(modal.channelIndex, freq, ft)}
        limiterThreshold={modalLimiter?.threshold_dBu ?? 0}
        limiterRatio={modalLimiter?.ratio ?? 0}
        limiterAttack={modalLimiter?.attack ?? 0}
        limiterRelease={modalLimiter?.release ?? 0}
        limiterEnabled={modal.channelType === 'output' ? (state.status.limiterEnable[modal.channelIndex] ?? false) : false}
        onLimiterChange={(field, v) => handleLimiterChange(modal.channelIndex, field, v)}
        onLimiterEnableToggle={() => {}}
      />

      {/* ── Little Mike Chat ── */}
      <AgentChat
        messages={agent.messages}
        loading={agent.loading}
        onSend={agent.sendMessage}
        onClear={agent.clearChat}
        collapsed={!chatOpen}
        onToggle={() => setChatOpen(o => !o)}
      />

      {/* ── Footer ── */}
      <footer className="app-footer">
        <span>Ashly Protea 4.8SP — 9600 baud RS-232</span>
        {isDemo && <span style={{ color: 'rgba(88,166,255,0.5)' }}>Simulated — no serial</span>}
      </footer>
    </div>
  );
}

function ChannelSkeleton({ count }: { count: number }) {
  return <>{Array.from({ length: count }, (_, i) => (
    <div key={i} style={{ height: 200, background: '#161b22', borderRadius: 10, animation: 'pulse 2s infinite' }} />
  ))}</>;
}
