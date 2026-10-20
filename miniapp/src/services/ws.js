import { useEffect, useRef, useState, useCallback } from 'react';
import { wsUrl } from './api';

/**
 * Manages a single WebSocket connection to the game server. Every incoming
 * event is passed to `onEvent` (none are dropped, even when several arrive at
 * once). Exposes a `send` function and reconnects automatically on drop.
 */
export function useGameSocket(onEvent) {
  const wsRef = useRef(null);
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer = null;

    function connect() {
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;

      ws.onopen = () => !cancelled && setConnected(true);
      ws.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        reconnectTimer = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(evt.data);
          if (!cancelled) handlerRef.current?.(parsed);
        } catch (e) {
          // ignore malformed frame
        }
      };
    }

    connect();
    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  const send = useCallback((type, payload) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }));
    }
  }, []);

  return { connected, send };
}
