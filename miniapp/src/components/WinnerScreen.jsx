import { useMemo } from 'react';

const COLUMNS = ['B', 'I', 'N', 'G', 'O'];

/** Which cells ("row-col") make up the winning line for a pattern name from the server. */
export function winningCells(pattern) {
  const cells = new Set();
  const p = String(pattern || '');
  if (p.startsWith('ROW_')) {
    const r = Number(p.slice(4)) - 1;
    for (let c = 0; c < 5; c++) cells.add(`${r}-${c}`);
  } else if (p.startsWith('COLUMN_')) {
    const c = Number(p.slice(7)) - 1;
    for (let r = 0; r < 5; r++) cells.add(`${r}-${c}`);
  } else if (p === 'DIAGONAL_TL_BR') {
    for (let i = 0; i < 5; i++) cells.add(`${i}-${i}`);
  } else if (p === 'DIAGONAL_TR_BL') {
    for (let i = 0; i < 5; i++) cells.add(`${i}-${4 - i}`);
  } else if (p === 'FOUR_CORNERS') {
    ['0-0', '0-4', '4-0', '4-4'].forEach((k) => cells.add(k));
  }
  return cells;
}

const CONFETTI_COLORS = ['#f0b429', '#ffffff', '#a7f3d0', '#fde68a', '#fca5a5', '#93c5fd'];

/**
 * Full-screen result shown to every player when the game ends.
 *  - winner  : green, trophy, "YOU"
 *  - loser   : red, sad face, winner's masked @name
 *  - nowinner: grey, credits refunded
 */
export default function WinnerScreen({ result, isMe, onPlayAgain, onExit }) {
  const kind = result.kind === 'winner' ? (isMe ? 'win' : 'lose') : 'none';
  const calledSet = useMemo(() => new Set(result.calledNumbers || []), [result]);
  const line = useMemo(() => winningCells(result.pattern), [result]);
  const prize = Number(result.prize);

  const confetti = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => ({
        left: Math.round(Math.random() * 100),
        delay: (Math.random() * 2.5).toFixed(2),
        duration: (2.8 + Math.random() * 2.2).toFixed(2),
        size: 6 + Math.round(Math.random() * 6),
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      })),
    []
  );

  const icon = kind === 'win' ? '🏆' : kind === 'lose' ? '😢' : '🎲';
  const title = kind === 'win' ? 'YOU' : kind === 'lose' ? result.usernameMasked : 'No winner';

  return (
    <div className={`ws-overlay ws-${kind}`}>
      {kind === 'win' &&
        confetti.map((c, i) => (
          <span
            key={i}
            className="ws-confetti"
            style={{
              left: `${c.left}%`,
              width: c.size,
              height: c.size * 1.6,
              background: c.color,
              animationDelay: `${c.delay}s`,
              animationDuration: `${c.duration}s`,
            }}
          />
        ))}

      <div className="ws-inner">
        <div className="ws-icon">{icon}</div>
        <div className="ws-title">{title}</div>

        {kind === 'none' ? (
          <div className="ws-won">ጨዋታው ያለ አሸናፊ ተጠናቅቋል። ያስገቡት መጠን ወደ ዋሌትዎ ተመልሷል።</div>
        ) : (
          <>
            <div className="ws-won">Won {prize} ETB</div>
            <div className="ws-sub">{kind === 'win' ? '🎉 እንኳን ደስ አለዎት!' : 'ሌላ ተጫዋች አሸንፏል'}</div>
            {result.cardId != null && <div className="ws-cartela">Cartela #{result.cardId}</div>}

            <div className="ws-letters">
              {COLUMNS.map((c, i) => (
                <span key={c} className="ws-letter" style={{ opacity: 1 - i * 0.14 }}>
                  {c}
                </span>
              ))}
            </div>

            {result.card && (
              <div className="ws-grid">
                {[0, 1, 2, 3, 4].map((row) =>
                  COLUMNS.map((col, ci) => {
                    const num = result.card[col][row];
                    const isFree = num === 0;
                    const inLine = line.has(`${row}-${ci}`);
                    const called = isFree || calledSet.has(num);
                    return (
                      <div
                        key={`${row}-${col}`}
                        className={`ws-cell ${called ? 'called' : ''} ${inLine ? 'line' : ''}`}
                      >
                        {isFree ? '★' : num}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </>
        )}

        <button className="ws-btn ws-btn-main" onClick={onPlayAgain}>
          Play Again
        </button>
        <button className="ws-btn ws-btn-ghost" onClick={onExit}>
          Exit
        </button>
      </div>

      <style>{`
        .ws-overlay {
          position: fixed; inset: 0; z-index: 100; overflow-y: auto; overflow-x: hidden;
          display: flex; justify-content: center; padding: 28px 16px 36px; color: #fff;
        }
        .ws-win  { background: linear-gradient(180deg, #10b981 0%, #047857 100%); }
        .ws-lose { background: linear-gradient(180deg, #dc2626 0%, #991b1b 100%); }
        .ws-none { background: linear-gradient(180deg, #475569 0%, #1e293b 100%); }
        .ws-inner { width: 100%; max-width: 420px; text-align: center; position: relative; z-index: 2; }
        .ws-icon {
          width: 88px; height: 88px; border-radius: 50%; margin: 6px auto 10px; font-size: 46px;
          display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.22);
        }
        .ws-title { font-family: var(--font-display); font-size: 34px; font-weight: 800; letter-spacing: 0.02em; }
        .ws-won { font-size: 26px; font-weight: 800; margin: 14px 0 4px; }
        .ws-none .ws-won { font-size: 16px; font-weight: 600; line-height: 1.5; margin-top: 16px; }
        .ws-sub { font-size: 14px; opacity: 0.9; }
        .ws-cartela { font-size: 18px; font-weight: 700; margin: 10px 0 12px; opacity: 0.92; }
        .ws-letters { display: flex; justify-content: center; gap: 10px; margin-bottom: 12px; }
        .ws-letter {
          width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
          font-weight: 800; font-size: 20px; background: rgba(0,0,0,0.28);
        }
        .ws-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; width: 270px; max-width: 100%; margin: 0 auto 22px; }
        .ws-cell {
          aspect-ratio: 1; display: flex; align-items: center; justify-content: center; border-radius: 9px;
          font-weight: 700; font-size: 17px; background: rgba(0,0,0,0.3); color: rgba(255,255,255,0.7);
        }
        .ws-cell.called { background: rgba(255,255,255,0.3); color: #fff; }
        .ws-cell.line { background: rgba(255,255,255,0.6); color: #111; border: 2px solid #fff; }
        .ws-btn { display: block; width: 100%; padding: 14px; border-radius: 12px; font-size: 17px; font-weight: 700; margin-top: 10px; }
        .ws-btn-main { background: rgba(255,255,255,0.92); color: #064e3b; }
        .ws-lose .ws-btn-main { color: #7f1d1d; }
        .ws-none .ws-btn-main { color: #0f172a; }
        .ws-btn-ghost { background: transparent; border: 1px solid rgba(255,255,255,0.7); color: #fff; }
        .ws-confetti {
          position: absolute; top: -20px; z-index: 1; border-radius: 2px; opacity: 0.9;
          animation-name: ws-fall; animation-iteration-count: infinite; animation-timing-function: linear;
        }
        @keyframes ws-fall {
          0%   { transform: translateY(-20px) rotate(0deg); }
          100% { transform: translateY(105vh) rotate(540deg); }
        }
      `}</style>
    </div>
  );
}
