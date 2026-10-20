/**
 * Displays the most recently called number (English letter + Amharic
 * spoken number, per the caller spec) plus a scrollable history strip.
 */
export default function NumberCaller({ currentCall, calledNumbers }) {
  return (
    <div className="caller">
      <div className="caller-current">
        {currentCall ? (
          <>
            <div className="caller-letter">{currentCall.letter}</div>
            <div className="caller-number">{currentCall.number}</div>
            <div className="caller-amharic">{currentCall.spokenNumber}</div>
          </>
        ) : (
          <div className="caller-waiting">Waiting for the first call…</div>
        )}
      </div>

      <div className="caller-history">
        {calledNumbers
          .slice()
          .reverse()
          .slice(0, 12)
          .map((n) => (
            <span key={n} className="history-chip">
              {n}
            </span>
          ))}
      </div>

      <style>{`
        .caller {
          background: var(--color-bg-card);
          border: 1px solid var(--color-border);
          border-radius: 18px;
          padding: 16px;
          margin-bottom: 16px;
          text-align: center;
        }
        .caller-current {
          display: flex;
          align-items: baseline;
          justify-content: center;
          gap: 10px;
          margin-bottom: 12px;
        }
        .caller-letter {
          font-family: var(--font-display);
          font-size: 28px;
          font-weight: 700;
          color: var(--color-gold);
        }
        .caller-number {
          font-family: var(--font-display);
          font-size: 40px;
          font-weight: 700;
        }
        .caller-amharic {
          font-size: 16px;
          color: var(--color-teal);
        }
        .caller-waiting {
          color: var(--color-text-muted);
          padding: 14px 0;
        }
        .caller-history {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          justify-content: center;
        }
        .history-chip {
          background: var(--color-bg-elevated);
          border: 1px solid var(--color-border);
          border-radius: 999px;
          padding: 3px 9px;
          font-size: 12px;
          color: var(--color-text-muted);
        }
      `}</style>
    </div>
  );
}
