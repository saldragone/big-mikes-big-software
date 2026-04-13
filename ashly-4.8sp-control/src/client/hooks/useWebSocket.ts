/**
 * WebSocket hook — manages the WS connection lifecycle and provides
 * a stable `send` function plus inbound message stream.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type WSReadyState = 'connecting' | 'open' | 'closed' | 'error';

export interface UseWebSocketReturn {
  readyState: WSReadyState;
  send: (obj: object) => void;
  lastMessage: MessageEvent | null;
}

export function useWebSocket(url: string): UseWebSocketReturn {
  const wsRef        = useRef<WebSocket | null>(null);
  const [readyState, setReadyState] = useState<WSReadyState>('connecting');
  const [lastMessage, setLastMessage] = useState<MessageEvent | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmounted      = useRef(false);

  const connect = useCallback(() => {
    if (unmounted.current) return;

    const ws = new WebSocket(url);
    wsRef.current = ws;
    setReadyState('connecting');

    ws.onopen = () => {
      if (unmounted.current) return;
      setReadyState('open');
    };

    ws.onmessage = (ev) => {
      if (!unmounted.current) setLastMessage(ev);
    };

    ws.onclose = () => {
      if (unmounted.current) return;
      setReadyState('closed');
      // Reconnect after 2s
      reconnectTimer.current = setTimeout(connect, 2000);
    };

    ws.onerror = () => {
      if (unmounted.current) return;
      setReadyState('error');
    };
  }, [url]);

  useEffect(() => {
    unmounted.current = false;
    connect();
    return () => {
      unmounted.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((obj: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(obj));
    }
  }, []);

  return { readyState, send, lastMessage };
}
