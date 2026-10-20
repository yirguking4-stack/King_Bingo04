const COLUMNS = ['B', 'I', 'N', 'G', 'O'];

/**
 * Renders a 5x5 card. `card` is { B:[...], I:[...], N:[...], G:[...], O:[...] }
 * (column-major, as returned by the backend). Free space is number 0.
 */
export default function BingoCard({ card, marked, calledSet, onToggle }) {
  if (!card) return null;

  return (
    <div className="bingo-card">
      <div className="bingo-card-header">
        {COLUMNS.map((c) => (
          <div key={c} className="bingo-col-label">
            {c}
          </div>
        ))}
      </div>
      <div className="bingo-card-grid">
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="bingo-card-row">
            {COLUMNS.map((col) => {
              const num = card[col][row];
              const isFree = num === 0;
              const isMarked = isFree || marked.includes(num);
              const wasCalled = isFree || calledSet.has(num);
              return (
                <button
                  key={col + row}
                  className={`bingo-cell ${isMarked ? 'marked' : ''} ${wasCalled && !isMarked ? 'callable' : ''}`}
                  disabled={isFree || !wasCalled}
                  onClick={() => onToggle(num)}
                >
                  {isFree ? '★' : num}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <style>{`
        .bingo-card {
          background: var(--color-bg-card);
          border: 1px solid var(--color-border);
          border-radius: 18px;
          padding: 8px;
        }
        .bingo-card-header, .bingo-card-row {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 5px;
        }
        .bingo-col-label {
          text-align: center;
          font-family: var(--font-display);
          font-weight: 700;
          color: var(--color-gold);
          padding-bottom: 4px;
          font-size: 16px;
        }
        .bingo-card-row {
          margin-bottom: 5px;
        }
        .bingo-cell {
          aspect-ratio: 1;
          border-radius: 10px;
          border: 1px solid var(--color-border);
          background: var(--color-bg-elevated);
          color: var(--color-text);
          font-weight: 700;
          font-size: 17px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .bingo-cell.callable {
          border-color: var(--color-teal);
          color: var(--color-teal);
        }
        .bingo-cell.marked {
          background: var(--color-gold);
          color: #23190a;
          border-color: var(--color-gold);
        }
        .bingo-cell:disabled {
          opacity: 0.55;
        }
      `}</style>
    </div>
  );
}
