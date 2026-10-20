import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api';
import { hapticImpact, hapticError } from '../services/telegram';
import { primeVoice } from '../services/voice';

const COLUMNS = ['B', 'I', 'N', 'G', 'O'];
const TAKEN_REFRESH_MS = 3000;

let cachedPool = null; // the 150 cards never change, so load them once

export default function CardSelect({ tier, wallet, onBack, onJoined }) {
  const [pool, setPool] = useState(cachedPool);
  const [taken, setTaken] = useState(new Set());
  const [joined, setJoined] = useState(null); // { roomCode, cardId } if player already sits at this table
  const [inProgress, setInProgress] = useState(null); // { players, capacity } while a game runs at this stake
  const [selected, setSelected] = useState(1);
  const [picked, setPicked] = useState(false); // has the player moved to a card yet?
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState(null);
  const touchX = useRef(null);
  const listRef = useRef(null);
  const total = pool ? pool.length : 150;

  // load the 150 cards once
  useEffect(() => {
    if (cachedPool) return;
    api
      .cardPool()
      .then((data) => {
        cachedPool = data.cards;
        setPool(data.cards);
      })
      .catch(() => setError('Could not load the cards. Please go back and try again.'));
  }, []);

  // keep the "taken" list live
  async function refreshTaken() {
    try {
      const data = await api.takenCards(tier.id);
      setTaken(new Set(data.taken));
      setJoined(data.joined || null);
      setInProgress(data.inProgress || null);
      return data;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    refreshTaken();
    const id = setInterval(refreshTaken, TAKEN_REFRESH_MS);
    return () => clearInterval(id);
  }, [tier.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // start on the first free card
  useEffect(() => {
    if (picked || !pool) return;
    let n = 1;
    while (n <= total && taken.has(n)) n += 1;
    setSelected(n > total ? 1 : n);
  }, [taken, pool]); // eslint-disable-line react-hooks/exhaustive-deps

  // keep the chosen number visible in the list when changed with the arrows
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-n="${selected}"]`);
    if (el && listRef.current) {
      const box = listRef.current;
      const top = el.offsetTop - box.offsetTop;
      if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - 40) {
        box.scrollTo({ top: Math.max(0, top - 60), behavior: 'smooth' });
      }
    }
  }, [selected]);

  function choose(n) {
    setPicked(true);
    setError(null);
    setSelected(n);
  }

  function step(delta) {
    hapticImpact('light');
    choose(((selected - 1 + delta + total) % total) + 1);
  }

  function nextFree() {
    for (let i = 1; i <= total; i++) {
      const n = ((selected - 1 + i) % total) + 1;
      if (!taken.has(n)) {
        hapticImpact('light');
        choose(n);
        return;
      }
    }
  }

  async function join() {
    if (inProgress) return;
    setError(null);
    if (!affordable) {
      hapticError();
      setError('Low Balance — ቀሪ ሂሳብዎ (ETB) ለመግባት በቂ አይደለም። እባክዎ መጀመሪያ Deposit ያድርጉ።');
      return;
    }
    setJoining(true);
    hapticImpact('medium');
    primeVoice(); // allow the number-calling voice (a tap is required by the phone)
    try {
      const result = await api.joinGame(tier.id, selected);
      onJoined(result.roomCode);
    } catch (err) {
      hapticError();
      setError(err.message);
      if (err.data?.code === 'CARD_TAKEN' || err.data?.code === 'ROOM_CLOSED' || err.data?.code === 'GAME_IN_PROGRESS') {
        await refreshTaken();
      }
    } finally {
      setJoining(false);
    }
  }

  const card = pool ? pool[selected - 1]?.card : null;
  const isTaken = taken.has(selected);
  const affordable = wallet && Number(wallet.balance) >= Number(tier.entry_credits);
  const freeCount = pool ? total - taken.size : null;

  const buttonLabel = useMemo(() => {
    if (joining) return 'Joining…';
    if (inProgress) return 'ጨዋታ በሂደት ላይ ነው';
    if (isTaken) return `Card #${selected} is taken`;
    return `Join Game · Card #${selected}`;
  }, [joining, isTaken, selected, inProgress]);

  return (
    <div className="app-content">
      <button className="btn-secondary" style={{ width: 'auto', marginBottom: 14, padding: '8px 14px' }} onClick={onBack}>
        ← Tables
      </button>

      <h1 className="section-title" style={{ marginBottom: 4 }}>Choose your card</h1>
      <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 14 }}>
        {tier.entry_credits} ETB table{inProgress ? '' : ' · ቁጥር ይምረጡ፤ ካርዱ ከጎን ይታያል።'}
        {!inProgress && freeCount != null && <> · {freeCount} of {total} free</>}
      </div>


      {joined && (
        <div className="notice" style={{ marginBottom: 12 }}>
          You already hold card #{joined.cardId} at this table.{' '}
          <button className="btn-secondary" style={{ width: 'auto', padding: '6px 12px', marginTop: 8 }} onClick={() => onJoined(joined.roomCode)}>
            Go to my room
          </button>
        </div>
      )}

      {inProgress && (
        <div className="notice cs-running">
          🎮 {inProgress.players}/{inProgress.capacity} users በጨዋታ ላይ ናቸው
          <div style={{ fontSize: 12, marginTop: 4, color: 'var(--color-text-muted)' }}>
            ጨዋታው እስኪጠናቀቅ ይጠብቁ፣ ወይም ሌላ stake ይምረጡ።
          </div>
        </div>
      )}

      <div className={`cs-layout ${inProgress ? 'cs-locked' : ''}`}>
        {/* ---- all 150 numbers, always visible ---- */}
        <div className="cs-all" ref={listRef}>
          {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              data-n={n}
              className={`cs-chip ${taken.has(n) ? 'taken' : ''} ${n === selected ? 'sel' : ''}`}
              onClick={() => {
                hapticImpact('light');
                choose(n);
              }}
            >
              {n}
            </button>
          ))}
        </div>

        {/* ---- the chosen card's board, beside the numbers ---- */}
        <div
          className={`cs-preview ${isTaken ? 'is-taken' : ''}`}
          onTouchStart={(e) => {
            touchX.current = e.touches[0].clientX;
          }}
          onTouchEnd={(e) => {
            if (touchX.current == null) return;
            const dx = e.changedTouches[0].clientX - touchX.current;
            touchX.current = null;
            if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
          }}
        >
          <div className="cs-preview-head">
            <button className="cs-arrow" onClick={() => step(-1)} aria-label="Previous card">‹</button>
            <div className="cs-number">
              <span>#{selected}</span>
              {isTaken && <em>Taken</em>}
            </div>
            <button className="cs-arrow" onClick={() => step(1)} aria-label="Next card">›</button>
          </div>

          {!card ? (
            <div style={{ color: 'var(--color-text-muted)', padding: 20, textAlign: 'center', fontSize: 12 }}>Loading…</div>
          ) : (
            <div className="cs-grid" key={selected}>
              {COLUMNS.map((c) => (
                <div key={c} className="cs-col-label">{c}</div>
              ))}
              {[0, 1, 2, 3, 4].map((row) =>
                COLUMNS.map((col) => {
                  const num = card[col][row];
                  return (
                    <div key={col + row} className={`cs-cell ${num === 0 ? 'free' : ''}`}>
                      {num === 0 ? '★' : num}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

      <button className="btn-secondary" style={{ marginTop: 10 }} onClick={nextFree}>Next free card</button>

      {error && <div className="error-text" style={{ marginTop: 12 }}>{error}</div>}

      <button
        className="btn-primary"
        style={{ marginTop: 16 }}
        disabled={!card || isTaken || joining || Boolean(joined) || Boolean(inProgress)}
        onClick={join}
      >
        {buttonLabel}
      </button>

      <style>{`
        .cs-layout { display: flex; gap: 8px; align-items: flex-start; }
        .cs-locked { opacity: 0.35; filter: grayscale(0.6); pointer-events: none; user-select: none; }
        .cs-running { text-align: center; font-weight: 800; margin-bottom: 12px; }
        .cs-preview {
          flex: 1; min-width: 0;
          background: var(--color-bg-card);
          border: 1px solid var(--color-border);
          border-radius: 18px;
          padding: 8px 8px 10px;
          touch-action: pan-y;
          user-select: none;
        }
        .cs-preview.is-taken { opacity: 0.55; }
        .cs-preview-head {
          display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;
        }
        .cs-number { font-family: var(--font-display); font-weight: 700; font-size: 18px; text-align: center; }
        .cs-number span { color: var(--color-gold-soft); }
        .cs-number em {
          font-style: normal; font-size: 11px; margin-left: 8px; padding: 2px 8px; border-radius: 999px;
          color: var(--color-coral); border: 1px solid var(--color-coral);
        }
        .cs-arrow {
          width: 30px; height: 30px; border-radius: 10px; font-size: 20px; line-height: 1;
          background: var(--color-bg-elevated); border: 1px solid var(--color-border); color: var(--color-text);
        }
        .cs-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 3px; animation: cs-fade 0.18s ease; }
        .cs-col-label { text-align: center; font-family: var(--font-display); font-weight: 700; color: var(--color-gold); font-size: 13px; }
        .cs-cell {
          aspect-ratio: 1; display: flex; align-items: center; justify-content: center; border-radius: 6px;
          background: var(--color-bg-elevated); border: 1px solid var(--color-border); font-weight: 700; font-size: 12px;
        }
        .cs-cell.free { background: var(--color-gold); color: #23190a; border-color: var(--color-gold); }
        .cs-slider { display: flex; align-items: center; gap: 10px; margin-top: 14px; color: var(--color-text-muted); font-size: 12px; }
        .cs-slider input { flex: 1; accent-color: var(--color-gold); height: 28px; }
        .cs-all {
          flex: 0 0 44%; display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px;
          height: 330px; overflow-y: auto; padding: 4px; align-content: start;
          background: var(--color-bg-card); border: 1px solid var(--color-border); border-radius: 14px;
        }
        .cs-chip {
          padding: 9px 0; border-radius: 8px; font-size: 12px; font-weight: 700;
          background: var(--color-bg-elevated); border: 1px solid var(--color-border); color: var(--color-text);
        }
        .cs-chip.taken { opacity: 0.3; text-decoration: line-through; }
        .cs-chip.sel { border-color: var(--color-gold); color: var(--color-gold-soft); background: var(--color-bg-card); }
        @keyframes cs-fade { from { opacity: 0.3; transform: translateX(6px); } to { opacity: 1; transform: none; } }
      `}</style>
    </div>
  );
}
