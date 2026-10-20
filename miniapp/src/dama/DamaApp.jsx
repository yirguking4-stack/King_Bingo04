import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { useGameSocket } from '../services/ws';
import { hapticError, hapticImpact, hapticSuccess } from '../services/telegram';
import { useNow, secondsLeft, mmss } from '../ludo/ludoUtils';
import GameIcon from '../components/GameIcon';
import './dama.css';

const REASONS = {
  NO_PIECES: 'ሁሉም ጠጠሮች ተበልተዋል',
  NO_MOVES: 'ተጋጣሚው ምንም እርምጃ የለውም',
  TIMEOUT: 'ጊዜ አልፏል (timeout)',
  RESIGN: 'ተጋጣሚው ተሸነፈ (resign)',
  DRAW_REPEAT: 'አቻ — ተመሳሳይ አቋም 3 ጊዜ ተደጋገመ',
  DRAW_KINGS: 'አቻ — 15 ተራ ያለ መብላት በ King ብቻ',
  EXPIRED: 'ተጋጣሚ አልተገኘም',
  VOID: 'ጨዋታው በሲስተም ችግር ተሰርዟል',
  CANCELLED_BY_PLAYER: 'ፍለጋ ተሰርዟል',
};
const fmt = (n) => Number(n || 0).toLocaleString('en-US');

export default function DamaApp({ profile, onExit, onWalletRefresh }) {
  const [view, setView] = useState({ name: 'lobby', code: null });
  const [cfg, setCfg] = useState(null);
  const [mine, setMine] = useState([]);
  const [history, setHistory] = useState(null);
  const [room, setRoom] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const viewRef = useRef(view);
  viewRef.current = view;
  const prevStatus = useRef(null);

  const say = useCallback((text, ok = false) => {
    setToast({ text, ok });
    setTimeout(() => setToast(null), 3200);
  }, []);
  const syncClock = (serverNow) => serverNow && setOffset(serverNow - Date.now());

  const loadLobby = useCallback(async () => {
    try {
      const [c, a, h] = await Promise.all([api.damaConfig(), api.damaActive(), api.damaHistory()]);
      setCfg(c);
      setMine(a.mine || []);
      setHistory(h.items || []);
    } catch (e) {
      say(e.message);
    }
  }, [say]);

  const { connected, send } = useGameSocket((msg) => {
    if (msg.type === 'dama_state') {
      const st = msg.payload.state;
      if (viewRef.current.code && st.code === viewRef.current.code) {
        syncClock(st.serverNow);
        setRoom(st);
        if (prevStatus.current !== st.status && ['FINISHED', 'CANCELLED'].includes(st.status)) onWalletRefresh?.();
        if (prevStatus.current === 'WAITING' && st.status === 'IN_PROGRESS') hapticSuccess();
        prevStatus.current = st.status;
      }
    } else if (msg.type === 'dama_error') {
      hapticError();
      say(msg.payload.message);
    }
  });

  useEffect(() => { loadLobby(); }, [loadLobby]);

  // subscribe to the room and re-subscribe after every reconnect (reconnection recovery)
  useEffect(() => {
    if (view.name !== 'room' || !connected) return undefined;
    send('dama_enter', { code: view.code });
    api.damaRoom(view.code).then((st) => { syncClock(st.serverNow); setRoom((cur) => cur || st); }).catch(() => {});
    return () => send('dama_exit', { code: view.code });
  }, [connected, view.name, view.code]); // eslint-disable-line react-hooks/exhaustive-deps

  function enter(code) {
    prevStatus.current = null;
    setRoom(null);
    setView({ name: 'room', code });
  }
  async function guard(fn) {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (e) { hapticError(); say(e.message || 'ስህተት ተፈጥሯል'); } finally { setBusy(false); }
  }
  const toLobby = () => { setView({ name: 'lobby', code: null }); setRoom(null); onWalletRefresh?.(); loadLobby(); };
  const onSearch = (bet) => guard(async () => { const r = await api.damaPlay({ bet }); onWalletRefresh?.(); enter(r.code); });
  const onCancel = () => guard(async () => { await api.damaCancel(view.code); toLobby(); });

  return (
    <div className={`dm-root${view.name === 'room' ? ' dm-room' : ''}`}>
      {toast && <div className={`dm-toast${toast.ok ? ' ok' : ''}`}>{toast.text}</div>}
      {view.name === 'lobby' ? (
        <Lobby cfg={cfg} mine={mine} history={history} balance={profile?.wallet?.balance} connected={connected} busy={busy} onBack={onExit} onSearch={onSearch} onOpen={enter} />
      ) : (
        <Room state={room} offset={offset} me={profile?.userId5d} connected={connected} send={send} busy={busy} onCancel={onCancel} onLobby={toLobby} onSearchAgain={(bet) => onSearch(bet)} say={say} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------- lobby
function Lobby({ cfg, mine, history, balance, connected, busy, onBack, onSearch, onOpen }) {
  const [bet, setBet] = useState(null);
  const [showRules, setShowRules] = useState(false);
  const sel = cfg?.bets?.find((b) => b.bet === bet);
  const short = sel && sel.bet > Number(balance || 0);
  const running = mine.find((m) => m.status === 'IN_PROGRESS' || m.status === 'WAITING');

  return (
    <>
      <div className="dm-top">
        <button className="dm-back" onClick={onBack}>← Back</button>
        <div className="dm-brand"><GameIcon name="dama" size={44} /> KING DAMA</div>
        <div className="dm-chip"><GameIcon name="wallet" size={22} /> {fmt(balance)} ETB</div>
      </div>
      <div className={`dm-conn${connected ? '' : ' bad'}`}>{connected ? '● Live' : '○ እንደገና በመገናኘት ላይ…'}</div>

      {running && (
        <div className="dm-resume">
          <span>{running.status === 'WAITING' ? '🔎 ተጋጣሚ በመፈለግ ላይ' : '♟ በሂደት ላይ ያለ ጨዋታ'} ({fmt(running.bet)} ETB)</span>
          <button className="dm-btn small" onClick={() => onOpen(running.code)}>ቀጥል</button>
        </div>
      )}

      <div className="dm-panel">
        <h3 className="dm-title">የውርርድ መጠን ይምረጡ</h3>
        {!cfg && <div className="dm-muted center">በመጫን ላይ…</div>}
        {cfg && !cfg.enabled && <div className="dm-muted center">King Dama ለጊዜው ተዘግቷል</div>}
        <div className="dm-stakes">
          {cfg?.bets?.map((b) => (
            <button key={b.bet} className={`dm-stake${bet === b.bet ? ' on' : ''}`} onClick={() => { hapticImpact(); setBet(b.bet); }}>
              {fmt(b.bet)}<small>ETB</small>
            </button>
          ))}
        </div>
        {sel && (
          <div className="dm-payout">
            <div><span>የእርስዎ ውርርድ</span><b>{fmt(sel.bet)} ETB</b></div>
            <div><span>ጠቅላላ ድምር (pot)</span><b>{fmt(sel.pot)} ETB</b></div>
            <div><span>ኮሚሽን {cfg.commissionPercent}%</span><b>{fmt(sel.commission)} ETB</b></div>
            <div className="win"><span>አሸናፊ ይቀበላል</span><b>{fmt(sel.prize)} ETB</b></div>
            <p className="dm-muted">አቻ ከሆነ ሙሉ ውርርድዎ ይመለሳል። ተጋጣሚ ካልተገኘ ክፍያው ይመለሳል፤ ኮሚሽን አይቆረጥም። ተራዎ {cfg.turnSeconds} ሰከንድ ነው።</p>
          </div>
        )}
        <button className="dm-btn" disabled={!sel || short || busy || !cfg?.enabled} onClick={() => onSearch(sel.bet)}>
          {short ? 'ቀሪ ሂሳብ በቂ አይደለም' : sel ? `ተጋጣሚ ፈልግ — ${fmt(sel.bet)} ETB` : 'መጠን ይምረጡ'}
        </button>
        <button className="dm-link" onClick={() => setShowRules((v) => !v)}>{showRules ? 'ደንቦችን ደብቅ' : 'የጨዋታ ደንቦች'}</button>
        {showRules && (
          <ul className="dm-rules">
            <li>8×8 ሰሌዳ፣ እያንዳንዱ 12 ጠጠር። ነጭ መጀመሪያ ይጫወታል።</li>
            <li>መብላት ግዴታ ነው — መብላት እየቻሉ ሌላ እርምጃ አይፈቀድም።</li>
            <li>ብዙ መብላት ከተቻለ በዚያው ጠጠር መቀጠል አለብዎት።</li>
            <li>ጠጠር ወደ ተቃራኒ ጫፍ ሲደርስ King ይሆናል — King ሩቅ ድረስ ይሄዳል፣ ይበላል።</li>
            <li>ተራ ሲያልፍ ይሸነፋሉ። ኢንተርኔት ቢቋረጥም ቆጣሪው ይቀጥላል።</li>
          </ul>
        )}
        <p className="dm-muted center">⚠ ጨዋታ ከመጠን በላይ አይጫወቱ። በቀሪ ሂሳብዎ ብቻ ይጫወቱ። (Virtual credits)</p>
      </div>

      <div className="dm-panel">
        <h3 className="dm-title">የጨዋታ ታሪክ</h3>
        {!history && <div className="dm-muted center">በመጫን ላይ…</div>}
        {history && history.length === 0 && <div className="dm-muted center">ገና ጨዋታ አልተጫወቱም</div>}
        {history?.map((h) => (
          <div className="dm-hist" key={h.code}>
            <div><b className={h.result.toLowerCase()}>{h.result === 'WIN' ? '🏆 አሸነፉ' : h.result === 'LOSS' ? '✖ ተሸነፉ' : h.result === 'DRAW' ? '🤝 አቻ' : '↩ ተሰርዟል'}</b> · vs {h.opponent || '—'}</div>
            <div className="dm-muted">ውርርድ {fmt(h.bet)} · pot {fmt(h.pot)} · ኮሚሽን {fmt(h.commission)} · ተቀበሉ {fmt(h.payout)} · {h.net >= 0 ? '+' : ''}{fmt(h.net)} ETB · {REASONS[h.reason] || h.reason || ''}</div>
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------- room
function Room({ state, offset, me, connected, send, busy, onCancel, onLobby, onSearchAgain, say }) {
  const now = useNow(250);
  const [sel, setSel] = useState(null);
  const [confirmResign, setConfirmResign] = useState(false);
  const lastSent = useRef(0);

  useEffect(() => { setSel(null); }, [state?.game?.moveNo, state?.game?.turn]);

  if (!state) return <div className="dm-panel center">በመጫን ላይ…</div>;
  const mySide = state.players.find((p) => p.userId5d === me)?.side;
  const opp = state.players.find((p) => p.userId5d !== me);

  // ----- matchmaking screen
  if (state.status === 'WAITING') {
    const left = secondsLeft(state.waitDeadline, now, offset);
    return (
      <div className="dm-panel center dm-wait">
        <div className="dm-spinner" />
        <h3 className="dm-title">ተጋጣሚ በመፈለግ ላይ…</h3>
        <div className="dm-bigtimer">{mmss(left)}</div>
        <div className="dm-muted">የቀረ የፍለጋ ጊዜ · ውርርድ <b>{fmt(state.bet)} ETB</b></div>
        <div className="dm-muted">አሸናፊ ይቀበላል {fmt(state.prize)} ETB · ተጋጣሚ ሲገኝ ጨዋታው በራሱ ይጀምራል</div>
        <button className="dm-btn danger" disabled={busy} onClick={onCancel}>ፍለጋ ሰርዝ (Cancel Search)</button>
      </div>
    );
  }

  // ----- finished / cancelled
  if (state.status !== 'IN_PROGRESS') {
    const g = state.game;
    const won = g && g.winnerSide !== null && g.winnerSide === mySide;
    const cancelled = state.status === 'CANCELLED';
    return (
      <div className="dm-panel center dm-result">
        <div className="dm-trophy">{cancelled ? '↩' : state.isDraw ? '🤝' : won ? '🏆' : '😔'}</div>
        <h2>{cancelled ? (state.endReason === 'EXPIRED' ? 'ተጋጣሚ አልተገኘም' : 'ተሰርዟል') : state.isDraw ? 'አቻ ወጣ' : won ? 'አሸንፈዋል!' : 'ተሸንፈዋል'}</h2>
        <div className="dm-muted">{REASONS[state.endReason] || ''}</div>
        <div className="dm-payout">
          <div><span>ውርርድ</span><b>{fmt(state.bet)} ETB</b></div>
          {!cancelled && !state.isDraw && <><div><span>ጠቅላላ pot</span><b>{fmt(state.pot)} ETB</b></div><div><span>ኮሚሽን {state.commissionPercent}%</span><b>{fmt(state.commission)} ETB</b></div><div className="win"><span>አሸናፊው ተቀበለ</span><b>{fmt(state.paid)} ETB</b></div></>}
          {(cancelled || state.isDraw) && <div className="win"><span>ተመላሽ (ኮሚሽን የለም)</span><b>{fmt(state.bet)} ETB</b></div>}
        </div>
        <button className="dm-btn" disabled={busy} onClick={() => onSearchAgain(state.bet)}>እንደገና ፈልግ ({fmt(state.bet)} ETB)</button>
        <button className="dm-link" onClick={onLobby}>ወደ ምናሌ</button>
      </div>
    );
  }

  // ----- game
  const g = state.game;
  const myTurn = g.turn === mySide;
  const left = secondsLeft(g.deadline, now, offset);
  const low = left != null && left <= 10;
  const flip = mySide === 1; // black sees the board from its own side
  const legalFrom = myTurn ? g.legal : {};
  const targets = sel !== null && legalFrom[sel] ? legalFrom[sel] : [];
  const pendingSet = new Set(g.pending || []);

  function tap(idx) {
    if (!myTurn) return;
    const piece = g.board[idx];
    if (sel !== null && targets.some((t) => t.to === idx)) {
      if (Date.now() - lastSent.current < 400) return; // no duplicate submissions
      lastSent.current = Date.now();
      hapticImpact('medium');
      send('dama_move', { code: state.code, from: sel, to: idx, moveNo: g.moveNo });
      setSel(null);
      return;
    }
    if (legalFrom[idx]) { hapticImpact(); setSel(idx); return; }
    if (piece && !legalFrom[idx]) say(g.mustCapture ? 'መብላት ግዴታ ነው — የሚበላውን ጠጠር ይምረጡ' : 'ይህ ጠጠር መንቀሳቀስ አይችልም');
    setSel(null);
  }

  const order = Array.from({ length: 64 }, (_, i) => i);
  if (flip) order.reverse();
  const chainActive = g.chain !== null && myTurn;

  return (
    <>
      <div className={`dm-player opp${!myTurn ? ' active' : ''}`}>
        <span>{opp?.name || 'Opponent'} {opp && !opp.connected && <em>· ከመስመር ውጭ</em>}</span>
        <span className="dm-cnt">{g.counts[mySide === 0 ? 'b' : 'w']} ♟</span>
      </div>

      <div className={`dm-timer${low ? ' low' : ''}${myTurn ? ' mine' : ''}`}>
        <div className="dm-bar"><i style={{ width: `${Math.max(0, Math.min(100, ((left ?? 0) / g.turnSeconds) * 100))}%` }} /></div>
        <span>{myTurn ? 'የእርስዎ ተራ' : `የ ${opp?.name || 'ተጋጣሚ'} ተራ`} · <b>{left ?? '--'}s</b></span>
      </div>
      {g.mustCapture && myTurn && <div className="dm-must">⚔ መብላት ግዴታ ነው{chainActive ? ' — በዚሁ ጠጠር ይቀጥሉ' : ''}</div>}
      {!connected && <div className="dm-must warn">⚠ ግንኙነት ተቋርጧል — እንደገና በመገናኘት ላይ… (ቆጣሪው ይቀጥላል)</div>}

      <div className="dm-board" role="grid">
        {order.map((idx) => {
          const r = Math.floor(idx / 8);
          const c = idx % 8;
          const dark = (r + c) % 2 === 1;
          const p = g.board[idx];
          const isTarget = targets.some((t) => t.to === idx);
          const isSel = sel === idx;
          const canPick = !!legalFrom[idx];
          return (
            <button key={idx} type="button" className={`dm-sq ${dark ? 'dk' : 'lt'}${isTarget ? ' tgt' : ''}${isSel ? ' sel' : ''}`} onClick={() => dark && tap(idx)} aria-label={`square ${idx}`}>
              {p && (
                <span className={`dm-pc ${p.toLowerCase() === 'w' ? 'w' : 'b'}${p === p.toUpperCase() ? ' k' : ''}${canPick && myTurn ? ' can' : ''}${pendingSet.has(idx) ? ' dead' : ''}`}>
                  {p === p.toUpperCase() ? '♛' : ''}
                </span>
              )}
              {isTarget && !p && <span className="dm-dot" />}
            </button>
          );
        })}
      </div>

      <div className={`dm-player me${myTurn ? ' active' : ''}`}>
        <span>እርስዎ ({mySide === 0 ? 'ነጭ' : 'ጥቁር'})</span>
        <span className="dm-cnt">{g.counts[mySide === 0 ? 'w' : 'b']} ♟</span>
      </div>
      <div className="dm-muted center">ውርርድ {fmt(state.bet)} ETB · አሸናፊ {fmt(state.prize)} ETB</div>

      {!confirmResign ? (
        <button className="dm-link" onClick={() => setConfirmResign(true)}>ተወው (Resign)</button>
      ) : (
        <div className="dm-confirm">
          <span>በእርግጥ ይሸነፋሉ? ውርርድዎ ይጠፋል።</span>
          <button className="dm-btn danger small" onClick={() => { send('dama_resign', { code: state.code }); setConfirmResign(false); }}>አዎ፣ ተወው</button>
          <button className="dm-btn small" onClick={() => setConfirmResign(false)}>አይ</button>
        </div>
      )}
    </>
  );
}
