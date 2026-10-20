import { useEffect, useRef, useState } from 'react';
import LudoBoard from './LudoBoard';
import { COLORS, COLOR_HEX, COLOR_PILL, COLOR_NAME_AM } from './geometry';
import GameIcon from '../components/GameIcon';
import Confetti from './Confetti';
import { Die, useNow, secondsLeft, mmss, betLabel, setSoundOn, playRattle, playStep, playCapture, playWin } from './ludoUtils';

// centre of each seat's yard (box) in board units, for the emoji overlay
const YARD_CENTRE = [[3, 3], [12, 3], [12, 12], [3, 12]];

function Avatar({ color }) {
  return (
    <svg viewBox="0 0 64 64" className="lu-avatar-svg" aria-hidden="true">
      <circle cx="32" cy="32" r="32" fill={COLOR_HEX[color]} opacity="0.35" />
      <path d="M8 64 C10 46 22 42 32 42 C42 42 54 46 56 64 Z" fill={COLOR_HEX[color]} />
      <rect x="27" y="34" width="10" height="10" rx="4" fill="#f2c9a0" />
      <ellipse cx="32" cy="26" rx="11" ry="13" fill="#f6d7b8" />
      <path d="M20 25 C19 11 30 8 38 11 C46 13 46 22 44 26 C41 21 34 19 28 19 C24 19 21 21 20 25 Z" fill="#14161a" />
    </svg>
  );
}

function PlayerCard({ p, game, now, offset, isMe, rolling, flick, onRoll, seat, bet }) {
  const rollingNow = !!rolling;
  if (!p) return <div className="lu-pl2" style={{ visibility: 'hidden' }} />;
  const isTurn = game && game.phase !== 'DONE' && game.turn === seat && !p.removed;
  const left = isTurn ? secondsLeft(game.deadline, now, offset) : null;
  const canRoll = isTurn && isMe && game.phase === 'ROLL';
  const shown = rollingNow ? flick : isTurn && game.phase === 'MOVE' ? game.dice : null;
  let status = '';
  let cls = '';
  if (p.removed) { status = 'ተወግዷል'; cls = 'warn'; }
  else if (isTurn) { status = game.phase === 'ROLL' ? 'ዳይስ ይጥላል' : 'ቶከን ይመርጣል'; cls = 'on'; }
  else if (!p.connected) status = 'offline';
  return (
    <div className={`lu-pl2${isTurn ? ' turn' : ''}${p.removed ? ' out' : ''}`} style={{ '--c': COLOR_HEX[p.color], '--cd': COLOR_PILL[p.color] }}>
      <div className="av">
        <Avatar color={p.color} />
        <span className="bet">{bet > 0 ? bet : 'Free'}</span>
      </div>
      <div className="nm">
        <b>{p.name}{isMe ? ' ★' : ''}</b>
        {status && <span className={`st ${cls}`}>{status}</span>}
        {p.missed > 0 && !p.removed && <span className="st warn">⚠ {p.missed}/2</span>}
      </div>
      <div className="dice-ring">
        {isTurn || rollingNow ? <Die value={shown} mine={canRoll && !rollingNow} rolling={rollingNow} onClick={onRoll} /> : <Die value={null} />}
        {isTurn && <span className={`clock${left != null && left <= 5 ? ' low' : ''}`}>{left}</span>}
      </div>
    </div>
  );
}

export default function LudoRoom({ state, events, offset, me, balance, connected, send, onLobby, onLeave, onPlayAgain, onRefresh }) {
  const now = useNow(250);
  const [sound, setSound] = useState(true);
  const [note, setNote] = useState('');
  const [roll, setRoll] = useState(null); // { seat, start, until, final }
  const [flick, setFlick] = useState(1);
  const [fx, setFx] = useState([]); // emoji shown in a player's own yard: { id, kind: 'sad' | 'cool', seat }
  const [bursts, setBursts] = useState([]); // ids of confetti bursts in the middle of the board
  const boardRef = useRef(null);
  const [reveal, setReveal] = useState(null); // { seat, value } shown big for a moment after the roll
  const rollRef = useRef(null);
  rollRef.current = roll;
  const prevStatus = useRef(null);

  useEffect(() => setSoundOn(sound), [sound]);

  const addFx = (kind, seat) => {
    const id = `${Date.now()}${Math.random()}`;
    setFx((f) => [...f.filter((x) => !(x.seat === seat && x.kind === kind)), { id, kind, seat }]);
    setTimeout(() => setFx((f) => f.filter((x) => x.id !== id)), 2500);
  };
  const addBurst = () => {
    const id = `${Date.now()}${Math.random()}`;
    setBursts((b) => [...b, id]);
    setTimeout(() => setBursts((b) => b.filter((x) => x !== id)), 4200);
  };
  const boardCentre = () => {
    const r = boardRef.current ? boardRef.current.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  const beginRoll = (seat) => {
    if (rollRef.current && rollRef.current.seat === seat) return;
    const now = Date.now();
    const r = { seat, start: now, until: now + 2500, final: null };
    rollRef.current = r;
    setRoll(r);
    playRattle(800);
  };

  // dice tumbling: random faces until the server result is in and at least ~0.8 s have passed
  useEffect(() => {
    if (!roll) return undefined;
    const iv = setInterval(() => setFlick(1 + Math.floor(Math.random() * 6)), 80);
    const t = setTimeout(() => {
      setRoll(null);
      rollRef.current = null;
      if (roll.final) {
        setReveal({ seat: roll.seat, value: roll.final });
        setTimeout(() => setReveal(null), 1000);
      }
    }, Math.max(0, roll.until - Date.now()));
    return () => { clearInterval(iv); clearTimeout(t); };
  }, [roll]);

  // short messages + roll results from the events that came with the last state
  useEffect(() => {
    if (!events || !events.length || !state) return;
    const nameOf = (seat) => state.players.find((p) => p.seat === seat)?.name || '';
    for (const ev of events) {
      if (ev.type === 'rolled') {
        const now = Date.now();
        const cur = rollRef.current;
        if (!cur || cur.seat !== ev.seat) beginRoll(ev.seat);
        const r = { ...rollRef.current, final: ev.dice, until: Math.max(rollRef.current.start + 850, now + 100) };
        rollRef.current = r;
        setRoll(r);
        if (ev.auto) setNote(`${nameOf(ev.seat)} — ጊዜ ስላለፈ ዳይስ በራስ-ሰር ተጥሏል`);
        else if (ev.noMoves) setNote(`${nameOf(ev.seat)} — ${ev.dice} መጣ፤ እርምጃ የለም`);
        else setNote('');
      } else if (ev.type === 'moved') {
        // token sent back to the yard: 😭 in the owner's own box
        if (ev.captured?.length) [...new Set(ev.captured.map((c) => c.seat))].forEach((sd) => addFx('sad', sd));
        // token reached home: 😎 in the owner's box + confetti from the middle of the board + fanfare
        // (the very last token is celebrated by the game-over screen instead)
        if (ev.reachedCentre && state.status !== 'FINISHED') {
          addFx('cool', ev.seat);
          addBurst();
          playWin();
        }
        if (ev.captured?.length) setNote(`${nameOf(ev.seat)} የተጋጣሚ ቶከን ያዘ! ✂`);
        else if (ev.auto) setNote(`${nameOf(ev.seat)} — ጊዜ ስላለፈ በራስ-ሰር ተንቀሳቅሷል`);
        else if (ev.reachedCentre) setNote(`${nameOf(ev.seat)} ቶከን መሃል ደረሰ ♛`);
      } else if (ev.type === 'removed') {
        setNote(`${nameOf(ev.seat)} 2 ተከታታይ ዳይስ ስላመለጠው ተወግዷል`);
      }
    }
  }, [events]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (state && prevStatus.current && prevStatus.current !== state.status && state.status === 'FINISHED') playWin();
    if (state) prevStatus.current = state.status;
  }, [state?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!state) return <div className="lu-empty">በመጫን ላይ…</div>;

  const mePlayer = state.players.find((p) => p.userId5d === me);
  const mySeat = mePlayer ? mePlayer.seat : null;
  const game = state.game;
  const bySeat = (s) => state.players.find((p) => p.seat === s);
  const waitLeft = secondsLeft(state.waitDeadline, now, offset);

  const header = (
    <>
      <div className="lu-room-top">
        <button className="lu-btn-back" onClick={onLobby}>← Back</button>
        <div className="lu-logo"><span className="crown">👑</span> <span className="k">KING</span> <span className="l">LUDO</span></div>
        <button className="lu-sq" onClick={() => setSound(!sound)} aria-label="Sound">{sound ? '🔊' : '🔇'}</button>
        <button className="lu-sq" onClick={onRefresh} aria-label="Refresh">⟳</button>
      </div>
      <div className="lu-room-sub">
        <span className="gid">#Game_id: {state.code}</span>
        <span className="strip">
          <span>👑 {state.crowns}</span>
          <span>💰 {state.bet > 0 ? Number(state.prize).toFixed(2) : 'Free'}</span>
        </span>
      </div>
      {!connected && <div className="lu-conn bad">○ እንደገና በመገናኘት ላይ… (ጊዜ ቆጣሪው በሰርቨር ይቀጥላል)</div>}
    </>
  );

  // ---------------- waiting for opponents ----------------
  if (state.status === 'WAITING') {
    return (
      <>
        {header}
        <div className="lu-panel lu-wait">
          <div className="lu-muted">ተጫዋቾችን በመጠበቅ ላይ… {state.players.length}/{state.capacity}</div>
          <div className="lu-big">{mmss(waitLeft)}</div>
          <div className="lu-muted">
            {state.capacity === 4 ? 'አዲስ ተጫዋች ሲገባ ቆጣሪው እንደገና 3 ደቂቃ ይጀምራል። ' : ''}
            ተጋጣሚ ካልመጣ ክፍያዎ ተመልሶ ወደ Lobby ይመለሳሉ።
          </div>
          <div className="lu-slots">
            {Array.from({ length: state.capacity }, (_, i) => {
              const p = state.players[i];
              return (
                <div key={i} className={`lu-pl${p ? '' : ' empty'}`}>
                  <div className="av" style={{ background: p ? '#2f7bff' : '#44474d' }}>{p ? '♛' : '?'}</div>
                  <div className="nm"><b>{p ? p.name : 'ባዶ ቦታ'}</b><span className={`st${p?.connected ? ' on' : ''}`}>{p ? (p.connected ? 'online' : 'offline') : 'በመጠበቅ ላይ'}</span></div>
                </div>
              );
            })}
          </div>
          <button className="lu-ghost" onClick={onLeave}>ውጣ {state.bet > 0 ? '(ክፍያ ይመለሳል)' : ''}</button>
        </div>
      </>
    );
  }

  // ---------------- cancelled (nobody came) ----------------
  if (state.status === 'CANCELLED') {
    return (
      <>
        {header}
        <div className="lu-overlay"><div className="lu-modal">
          <h2>ተጋጣሚ አልመጣም</h2>
          <div className="lu-muted">{state.bet > 0 ? `የ ${state.bet} ETB ክፍያዎ ተመልሷል።` : 'ክፍሉ ተዘግቷል።'}</div>
          <button className="lu-join" onClick={onLobby}>ወደ Lobby ተመለስ</button>
        </div></div>
      </>
    );
  }

  // ---------------- playing / finished ----------------
  const myTurn = game && game.phase !== 'DONE' && game.turn === mySeat;
  const turnPlayer = game ? bySeat(game.turn) : null;
  let status = '';
  if (game && game.phase === 'ROLL') status = myTurn ? '🎲 ተራዎ ነው — ዳይሱን ይንኩ' : `የ ${turnPlayer?.name || ''} ተራ`;
  if (game && game.phase === 'MOVE') status = myTurn ? (game.legal.length ? `ዳይስ ${game.dice} — ቶከን ይምረጡ` : `ዳይስ ${game.dice} — እርምጃ የለም`) : `${turnPlayer?.name || ''} ዳይስ ${game.dice}`;
  const winner = state.players.find((p) => p.winner);
  const iWon = winner && winner.userId5d === me;
  const seats = game ? game.seats : [];

  return (
    <>
      {header}
      <div className="lu-players2">
        {[0, 1].map((s) => <PlayerCard key={s} seat={s} p={seats.includes(s) ? bySeat(s) : null} game={game} now={now} offset={offset} isMe={mySeat === s} rolling={roll && roll.seat === s} flick={flick} onRoll={() => { beginRoll(s); send('ludo_roll', { code: state.code }); }} bet={state.bet} />)}
      </div>
      <div className="lu-boardwrap" ref={boardRef}>
        <LudoBoard seats={seats} tokens={game.tokens} legal={roll ? [] : game.legal} turnSeat={game.turn} mySeat={mySeat} onStep={playStep} onCapture={playCapture} onToken={(t) => send('ludo_move', { code: state.code, token: t })} />
        <div className="lu-fx">
          {fx.map((f) => (
            <span key={f.id} className="lu-emo" style={{ left: `${YARD_CENTRE[f.seat][0] / 0.15}%`, top: `${YARD_CENTRE[f.seat][1] / 0.15}%` }}>
              {f.kind === 'sad' ? '😭' : '😎'}
            </span>
          ))}
        </div>
        {bursts.map((id) => <Confetti key={id} seconds={3.2} getOrigin={boardCentre} />)}
        {(roll || reveal) && (
          <div className="lu-bigdie" style={{ '--c': COLOR_HEX[COLORS[(roll || reveal).seat]] }}>
            <Die value={roll ? flick : reveal.value} rolling={!!roll} />
          </div>
        )}
      </div>
      <div className="lu-players2">
        {[3, 2].map((s) => <PlayerCard key={s} seat={s} p={seats.includes(s) ? bySeat(s) : null} game={game} now={now} offset={offset} isMe={mySeat === s} rolling={roll && roll.seat === s} flick={flick} onRoll={() => { beginRoll(s); send('ludo_roll', { code: state.code }); }} bet={state.bet} />)}
      </div>
      <div className="lu-status">{status}</div>
      <div className="lu-muted" style={{ textAlign: 'center', minHeight: 16 }}>{note}</div>
      {mePlayer?.removed && state.status === 'IN_PROGRESS' && <div className="lu-resume" style={{ borderColor: 'var(--lu-red)', background: '#3a2224' }}>ከጨዋታው ተወግደዋል (2 ተከታታይ ያመለጠ ዳይስ)።</div>}

      {iWon && state.status === 'FINISHED' && <Confetti />}
      {state.status === 'FINISHED' && (
        <div className="lu-overlay"><div className="lu-modal">
          {iWon && <div className="lu-cool">😎</div>}
          <h2>{iWon ? '🏆 አሸንፈዋል!' : 'ጨዋታው አብቅቷል'}</h2>
          <div>አሸናፊ: <b style={{ color: COLORS[winner?.seat] ? COLOR_HEX[COLORS[winner.seat]] : undefined }}>{winner ? winner.name : '—'}</b>{winner ? ` (${COLOR_NAME_AM[winner.color]})` : ''}</div>
          {state.bet > 0 && <div className="amt">{state.paid} ETB</div>}
          {state.endReason === 'FORFEIT' && <div className="lu-muted">ተጋጣሚዎች በ 2 ተከታታይ ያመለጠ ዳይስ ተወግደዋል።</div>}
          <button className="lu-join" onClick={() => onPlayAgain({ capacity: state.capacity, bet: state.bet, crowns: state.crowns })}>እንደገና ተጫወት</button>
          <button className="lu-ghost" onClick={onLobby}>ወደ Lobby</button>
        </div></div>
      )}
    </>
  );
}
