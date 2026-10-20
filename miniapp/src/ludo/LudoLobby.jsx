import { useState } from 'react';
import { hapticImpact } from '../services/telegram';
import GameIcon from '../components/GameIcon';
import { useNow, secondsLeft, mmss, betLabel } from './ludoUtils';

function Crown() {
  return (
    <svg viewBox="0 0 24 18" width="22" height="17" aria-hidden="true">
      <path d="M2 16 L1 5 L7 10 L12 2 L17 10 L23 5 L22 16 Z" fill="#f5b81c" stroke="#b8860b" strokeWidth="1" />
      <rect x="2" y="15" width="20" height="2.4" rx="1" fill="#f5b81c" stroke="#b8860b" strokeWidth="0.6" />
    </svg>
  );
}

const BETS = [0, 20, 30, 50, 100, 200, 300, 500, 700, 1000, 2000, 3000, 4000, 5000, 7000, 10000];

export default function LudoLobby({ lobby, mine, balance, connected, busy, offset, onBack, onJoin, onOpen, onPlay, onCreate }) {
  const [capacity, setCapacity] = useState(2);
  const [bet, setBet] = useState(0);
  const [crowns, setCrowns] = useState(4);
  const now = useNow(500);
  const rooms = lobby?.rooms || [];
  const settings = { capacity, bet, crowns };
  const short = bet > Number(balance || 0);
  const myCodes = new Set((mine || []).map((m) => m.code));
  const running = (mine || []).find((m) => m.status === 'IN_PROGRESS');

  return (
    <>
      <div className="lu-top">
        <button className="lu-btn-back" onClick={onBack}>← Back</button>
        <div className="lu-brand"><GameIcon name="ludo" size={54} /></div>
        <div className="lu-chip"><GameIcon name="wallet" size={24} /> {Number(balance || 0).toFixed(2)} ETB</div>
      </div>
      <div className={`lu-conn${connected ? '' : ' bad'}`}>{connected ? '● Live' : '○ እንደገና በመገናኘት ላይ…'}</div>

      {running && (
        <div className="lu-resume">
          <span>🎲 በሂደት ላይ ያለ ጨዋታ አለዎት ({betLabel(running.bet)})</span>
          <button className="lu-join" onClick={() => onOpen(running.code)}>ቀጥል</button>
        </div>
      )}

      <div className="lu-panel">
        <h3 className="lu-title">ክፍት ክፍሎች ({rooms.length})</h3>
        <div className="lu-rooms">
          {!lobby && <div className="lu-empty">በመጫን ላይ…</div>}
          {lobby && rooms.length === 0 && <div className="lu-empty">አሁን ክፍት ክፍል የለም። PLAY NOW ይጫኑ — አዲስ ክፍል ይፈጠራል።</div>}
          {rooms.map((r) => {
            const left = secondsLeft(r.waitDeadline, now, offset);
            const first = r.players[0]?.name || '@***';
            const isMine = myCodes.has(r.code);
            return (
              <div className="lu-rcard" key={r.code}>
                <div className="lu-rl">
                  <div className="r1">
                    <b>{first}</b>
                    <span className="lu-dots2">{Array.from({ length: r.capacity }, (_, i) => <span key={i} className={`d${i < r.players.length ? ' on' : ''}`} />)}</span>
                    <span className={`lu-pill${left != null && left <= 20 ? ' low' : ''}`}>🕒 {mmss(left)}</span>
                  </div>
                  <div className="r2">
                    <span className="fee">{betLabel(r.bet)}</span>
                    <span className="cnt">{r.players.length}/{r.capacity}</span>
                    <span className="mode">{r.capacity}P</span>
                  </div>
                </div>
                <div className="lu-rr">
                  <div className="crowns">{Array.from({ length: r.crowns }, (_, i) => <Crown key={i} />)}</div>
                  <div className="prize">{r.bet > 0 ? `${r.prize} ETB` : 'Free'}</div>
                </div>
                {isMine ? (
                  <button className="lu-join2 mine" onClick={() => onOpen(r.code)}>ክፈት</button>
                ) : (
                  <button className="lu-join2" disabled={busy || left === 0} onClick={() => { hapticImpact('light'); onJoin(r.code, r.bet); }}>Join</button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="lu-seg">
        <button className={capacity === 2 ? 'on' : ''} onClick={() => setCapacity(2)}>👥 2 player</button>
        <button className={capacity === 4 ? 'on' : ''} onClick={() => setCapacity(4)}>👥👥 4 player</button>
      </div>

      <div className="lu-panel">
        <h3 className="lu-title">♛ Bet Amount</h3>
        <div className="lu-grid">
          {BETS.map((b) => (
            <button key={b} className={`lu-opt${bet === b ? ' on' : ''}`} onClick={() => setBet(b)}>
              {b === 0 ? 'Free' : b}
            </button>
          ))}
        </div>
        <div className="lu-muted" style={{ marginTop: 8, textAlign: 'center' }}>
          {bet === 0 ? 'ነፃ ጨዋታ — ምንም ክፍያ የለውም' : `አሸናፊው የሚያገኘው ${Math.round(bet * capacity * 0.9 * 100) / 100} ETB (ከእያንዳንዱ ተጫዋች 10% ኮሚሽን ተቀንሶ)`}
        </div>
      </div>

      <div className="lu-panel">
        <h3 className="lu-title">♛ Select Crowns</h3>
        <div className="lu-crowns">
          {[1, 2, 4].map((n) => (
            <button key={n} className={`lu-opt${crowns === n ? ' on' : ''}`} onClick={() => setCrowns(n)}>{'♛'.repeat(n)}</button>
          ))}
        </div>
        <div className="lu-muted" style={{ marginTop: 8, textAlign: 'center' }}>ለማሸነፍ ወደ መሃል መድረስ ያለባቸው ቶከኖች ብዛት: {crowns}</div>
      </div>

      <div className="lu-bottom">
        <button className="lu-create" disabled={busy || short} onClick={() => onCreate(settings)}>＋ ክፍል ፍጠር</button>
        <button className="lu-play" disabled={busy || short} onClick={() => { hapticImpact('medium'); onPlay(settings); }}>
          {short ? 'ቀሪ ሂሳብ በቂ አይደለም' : '♛ PLAY NOW ♛'}
        </button>
      </div>
    </>
  );
}
