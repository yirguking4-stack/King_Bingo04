import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { useGameSocket } from '../services/ws';
import { hapticError, hapticSuccess } from '../services/telegram';
import LudoLobby from './LudoLobby';
import LudoRoom from './LudoRoom';
import './ludo.css';

/**
 * KING LUDO entry point. Self-contained: owns its own WebSocket subscription and screens,
 * and only talks to the rest of the app through `profile`, `onExit` and `onWalletRefresh`.
 */
export default function LudoApp({ profile, onExit, onWalletRefresh }) {
  const [view, setView] = useState({ name: 'lobby', code: null });
  const [lobby, setLobby] = useState(null);
  const [mine, setMine] = useState([]);
  const [room, setRoom] = useState(null);
  const [events, setEvents] = useState([]);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const offsetRef = useRef(0);
  const [offset, setOffset] = useState(0);
  const viewRef = useRef(view);
  viewRef.current = view;
  const prevStatus = useRef(null);

  const say = useCallback((text, ok = false) => {
    setToast({ text, ok });
    setTimeout(() => setToast(null), 3200);
  }, []);

  const syncClock = useCallback((serverNow) => {
    if (!serverNow) return;
    offsetRef.current = serverNow - Date.now();
    setOffset(offsetRef.current);
  }, []);

  const loadLobby = useCallback(async () => {
    try {
      const d = await api.ludoRooms();
      syncClock(d.serverNow);
      setLobby({ rooms: d.rooms });
      setMine(d.mine || []);
    } catch (e) {
      say(e.message);
    }
  }, [say, syncClock]);

  const { connected, send } = useGameSocket((msg) => {
    if (msg.type === 'ludo_lobby') {
      syncClock(msg.payload.serverNow);
      setLobby({ rooms: msg.payload.rooms });
      api.ludoRooms().then((d) => setMine(d.mine || [])).catch(() => {});
    } else if (msg.type === 'ludo_state') {
      const st = msg.payload.state;
      if (viewRef.current.code && st.code === viewRef.current.code) {
        syncClock(st.serverNow);
        setRoom(st);
        setEvents(msg.payload.events || []);
        if (prevStatus.current !== st.status && ['FINISHED', 'CANCELLED'].includes(st.status)) onWalletRefresh?.();
        prevStatus.current = st.status;
      }
    } else if (msg.type === 'ludo_error') {
      hapticError();
      say(msg.payload.message);
    }
  });

  // subscribe to the lobby or to the room, and re-subscribe after every reconnect
  useEffect(() => {
    if (!connected) return undefined;
    if (view.name === 'lobby') {
      send('ludo_lobby');
      loadLobby();
      return () => send('ludo_lobby_leave');
    }
    send('ludo_enter', { code: view.code });
    api.ludoRoom(view.code).then((st) => { syncClock(st.serverNow); setRoom((cur) => cur || st); }).catch(() => {});
    return () => send('ludo_exit', { code: view.code });
  }, [connected, view.name, view.code]); // eslint-disable-line react-hooks/exhaustive-deps

  function enter(code) {
    prevStatus.current = null;
    setRoom(null);
    setEvents([]);
    setView({ name: 'room', code });
  }

  async function guard(fn) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      hapticError();
      say(e.message || 'ስህተት ተፈጥሯል');
    } finally {
      setBusy(false);
    }
  }

  const toLobby = () => {
    setView({ name: 'lobby', code: null });
    onWalletRefresh?.();
  };

  const onJoin = (code, bet) =>
    guard(async () => {
      if (bet > Number(profile?.wallet?.balance || 0)) throw new Error('ቀሪ ሂሳብዎ (ETB) ለመግባት በቂ አይደለም');
      await api.ludoJoin(code);
      hapticSuccess();
      onWalletRefresh?.();
      enter(code);
    });
  const onPlay = (s) => guard(async () => { const r = await api.ludoPlay(s); onWalletRefresh?.(); enter(r.code); });
  const onCreate = (s) => guard(async () => { const r = await api.ludoCreate(s); onWalletRefresh?.(); enter(r.code); });
  const onLeave = () => guard(async () => { await api.ludoLeave(view.code); toLobby(); });
  const onPlayAgain = (s) => guard(async () => { const r = await api.ludoPlay(s); onWalletRefresh?.(); enter(r.code); });
  const onRefresh = () => api.ludoRoom(view.code).then((st) => { syncClock(st.serverNow); setRoom(st); }).catch((e) => say(e.message));

  return (
    <div className={`lu-root${view.name === 'room' ? ' lu-room' : ''}`}>
      {toast && <div className={`lu-toast${toast.ok ? ' ok' : ''}`}>{toast.text}</div>}
      {view.name === 'lobby' ? (
        <LudoLobby
          lobby={lobby}
          mine={mine}
          balance={profile?.wallet?.balance}
          connected={connected}
          busy={busy}
          offset={offset}
          onBack={onExit}
          onJoin={onJoin}
          onOpen={enter}
          onPlay={onPlay}
          onCreate={onCreate}
        />
      ) : (
        <LudoRoom
          state={room}
          events={events}
          offset={offset}
          me={profile?.userId5d}
          balance={profile?.wallet?.balance}
          connected={connected}
          send={send}
          onLobby={toLobby}
          onLeave={onLeave}
          onPlayAgain={onPlayAgain}
          onRefresh={onRefresh}
        />
      )}
    </div>
  );
}
