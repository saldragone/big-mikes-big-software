import { useState, useEffect } from 'react';

interface PortInfo {
  path: string;
  manufacturer?: string;
}

interface Props {
  connected: boolean;
  port: string;
  deviceName: string;
  ports: PortInfo[];
  onConnect: (port: string) => void;
  onDisconnect: () => void;
  onRefreshPorts: () => void;
  send: (obj: object) => void;
}

// The DEMO pseudo-port is always available regardless of hardware
const DEMO_PORT: PortInfo = { path: 'DEMO', manufacturer: 'Simulated Device' };

export default function ConnectionBar({
  connected,
  port,
  deviceName: _deviceName,
  ports,
  onConnect,
  onDisconnect,
  onRefreshPorts,
  send,
}: Props) {
  // Build the full port list: DEMO always first, then real ports
  const allPorts: PortInfo[] = [DEMO_PORT, ...ports.filter(p => p.path !== 'DEMO')];

  const [selectedPort, setSelectedPort] = useState<string>(port || 'DEMO');

  // Request available ports on mount
  useEffect(() => {
    send({ type: 'getPorts' });
  }, []);

  // Sync selected port with the active connection
  useEffect(() => {
    if (connected && port) setSelectedPort(port);
  }, [connected, port]);

  // Auto-select first real port when list updates (unless DEMO is selected)
  useEffect(() => {
    if (selectedPort === 'DEMO') return;
    if (!selectedPort && ports.length > 0) setSelectedPort(ports[0].path);
  }, [ports]);

  const handleRefresh = () => {
    send({ type: 'getPorts' });
    onRefreshPorts();
  };

  const handleToggle = () => {
    if (connected) {
      onDisconnect();
    } else if (selectedPort) {
      onConnect(selectedPort);
    }
  };

  const isDemo = port === 'DEMO' && connected;

  return (
    <div style={{
      padding: '8px 12px',
      display: 'flex',
      flexWrap: 'wrap',
      gap: 8,
      alignItems: 'center',
      borderTop: '1px solid rgba(255,255,255,0.05)',
    }}>

      {/* Port selector */}
      <div style={{ display: 'flex', gap: 6, flex: '1 1 240px', alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.3)', flexShrink: 0, whiteSpace: 'nowrap' }}>
          Port
        </span>
        <select
          className="select"
          value={selectedPort}
          onChange={e => setSelectedPort(e.target.value)}
          disabled={connected}
          style={{ flex: 1, minWidth: 160 }}
          aria-label="Serial port"
        >
          {allPorts.map(p => (
            <option key={p.path} value={p.path}>
              {p.path === 'DEMO'
                ? '⚡ DEMO — Simulated Ashly 4.8SP'
                : `${p.path}${p.manufacturer ? ` — ${p.manufacturer}` : ''}`}
            </option>
          ))}
        </select>

        {/* Refresh — only relevant when not in demo */}
        {selectedPort !== 'DEMO' && (
          <button
            onClick={handleRefresh}
            disabled={connected}
            className="btn-ghost"
            style={{ flexShrink: 0, padding: '6px 10px', fontSize: 12 }}
            aria-label="Refresh port list"
            title="Refresh serial ports"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.7 }}>
              <path d="M13.65 2.35A7.958 7.958 0 0 0 8 0C3.58 0 0 3.58 0 8s3.58 8 8 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L9 7h7V0l-2.35 2.35z"/>
            </svg>
            <span className="hidden sm:inline">Refresh</span>
          </button>
        )}
      </div>

      {/* Connect / Disconnect */}
      <button
        onClick={handleToggle}
        disabled={!connected && !selectedPort}
        style={{
          flexShrink: 0,
          padding: '6px 16px',
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 600,
          fontFamily: 'Inter, system-ui, sans-serif',
          cursor: 'pointer',
          transition: 'all 0.15s',
          minHeight: 34,
          border: 'none',
          ...(connected
            ? {
                background: 'rgba(239,68,68,0.15)',
                border: '1px solid rgba(239,68,68,0.3)',
                color: '#f87171',
              }
            : selectedPort === 'DEMO'
            ? {
                background: 'linear-gradient(180deg, #fb923c 0%, #ea6b0c 100%)',
                color: 'white',
                boxShadow: '0 0 12px rgba(249,115,22,0.35), 0 1px 2px rgba(0,0,0,0.4)',
              }
            : {
                background: 'linear-gradient(180deg, #fb923c 0%, #ea6b0c 100%)',
                color: 'white',
                boxShadow: '0 1px 2px rgba(0,0,0,0.4)',
              }
          ),
        }}
        aria-label={connected ? 'Disconnect' : selectedPort === 'DEMO' ? 'Start Demo' : 'Connect'}
      >
        {connected
          ? isDemo ? 'Exit Demo' : 'Disconnect'
          : selectedPort === 'DEMO' ? '⚡ Start Demo' : 'Connect'}
      </button>
    </div>
  );
}
