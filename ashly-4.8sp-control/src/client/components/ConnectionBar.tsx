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

export default function ConnectionBar({
  connected,
  port,
  deviceName,
  ports,
  onConnect,
  onDisconnect,
  onRefreshPorts,
  send,
}: Props) {
  const [selectedPort, setSelectedPort] = useState<string>(port || '');

  // On mount, request available ports
  useEffect(() => {
    send({ type: 'getPorts' });
  }, []);

  // Keep selectedPort in sync with the connected port
  useEffect(() => {
    if (connected && port) {
      setSelectedPort(port);
    }
  }, [connected, port]);

  // When ports list updates and nothing selected, auto-select first
  useEffect(() => {
    if (!selectedPort && ports.length > 0) {
      setSelectedPort(ports[0].path);
    }
  }, [ports]);

  const handleRefresh = () => {
    send({ type: 'getPorts' });
    onRefreshPorts();
  };

  const handleConnectToggle = () => {
    if (connected) {
      onDisconnect();
    } else if (selectedPort) {
      onConnect(selectedPort);
    }
  };

  return (
    <div className="w-full bg-[#252525] border-b border-[#3a3a3a] px-3 py-2 sm:px-4 sm:py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">

        {/* Status indicator */}
        <div className="flex items-center gap-2 min-w-0 flex-shrink-0">
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${
              connected ? 'bg-green-500' : 'bg-red-500'
            }`}
            aria-label={connected ? 'Connected' : 'Disconnected'}
          />
          <span className="text-sm font-mono text-gray-300 truncate">
            {connected ? port : 'Disconnected'}
          </span>
          {connected && deviceName && (
            <>
              <span className="text-gray-600 flex-shrink-0">|</span>
              <span className="text-sm font-mono text-brand truncate" title={deviceName}>
                {deviceName}
              </span>
            </>
          )}
        </div>

        {/* Spacer on desktop */}
        <div className="hidden sm:block flex-1" />

        {/* Controls row */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">

          {/* Port select */}
          <select
            value={selectedPort}
            onChange={(e) => setSelectedPort(e.target.value)}
            disabled={connected}
            className="
              w-full sm:w-auto
              bg-[#2c2c2c] border border-[#444444] text-gray-200 text-sm
              rounded px-2 py-0 font-mono
              min-h-[44px] sm:min-h-[36px]
              focus:outline-none focus:border-brand
              disabled:opacity-50 disabled:cursor-not-allowed
              appearance-none
            "
            aria-label="Serial port"
          >
            {ports.length === 0 ? (
              <option value="">No ports found</option>
            ) : (
              ports.map((p) => (
                <option key={p.path} value={p.path}>
                  {p.path}
                  {p.manufacturer ? ` — ${p.manufacturer}` : ''}
                </option>
              ))
            )}
          </select>

          {/* Refresh button */}
          <button
            onClick={handleRefresh}
            disabled={connected}
            className="
              w-full sm:w-auto
              min-h-[44px] sm:min-h-[36px]
              px-3 py-1
              bg-[#2c2c2c] hover:bg-[#333333] active:bg-[#3a3a3a]
              border border-[#444444]
              text-gray-300 text-sm font-medium
              rounded
              transition-colors
              disabled:opacity-50 disabled:cursor-not-allowed
              focus:outline-none focus:border-brand
            "
            aria-label="Refresh port list"
          >
            Refresh
          </button>

          {/* Connect / Disconnect button */}
          <button
            onClick={handleConnectToggle}
            disabled={!connected && !selectedPort}
            className={`
              w-full sm:w-auto
              min-h-[44px] sm:min-h-[36px]
              px-4 py-1
              text-sm font-semibold
              rounded
              transition-colors
              focus:outline-none
              disabled:opacity-50 disabled:cursor-not-allowed
              ${connected
                ? 'bg-red-700 hover:bg-red-600 active:bg-red-800 text-white border border-red-600 focus:border-red-400'
                : 'bg-brand hover:bg-orange-500 active:bg-orange-700 text-white border border-orange-600 focus:border-orange-300'
              }
            `}
            aria-label={connected ? 'Disconnect from device' : 'Connect to device'}
          >
            {connected ? 'Disconnect' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  );
}
