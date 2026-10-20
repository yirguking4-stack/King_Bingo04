// cells are "row-col" (0-4), same as WinnerScreen.winningCells
const PATTERNS = [
  { id: 'horizontal', cells: ['0-0', '0-1', '0-2', '0-3', '0-4'] },
  { id: 'vertical', cells: ['0-2', '1-2', '2-2', '3-2', '4-2'] },
  { id: 'diagonal', cells: ['0-4', '1-3', '2-2', '3-1', '4-0'] },
  { id: 'corners', cells: ['0-0', '0-4', '4-0', '4-4'] },
];

function Mini({ cells }) {
  const on = new Set(cells);
  return (
    <div className="pg-mini">
      {[0, 1, 2, 3, 4].map((r) =>
        [0, 1, 2, 3, 4].map((c) => (
          <div key={`${r}-${c}`} className={`pg-cell ${on.has(`${r}-${c}`) ? 'lit' : ''}`} />
        ))
      )}
    </div>
  );
}

/** "Winning & Patterns": the four winning shapes in one row. */
export default function PatternGuide() {
  return (
    <div className="pg-wrap">
      <div className="pg-title">Winning &amp; Patterns</div>
      <div className="pg-grid">
        {PATTERNS.map((p) => (
          <Mini key={p.id} cells={p.cells} />
        ))}
      </div>
      <style>{`
        .pg-wrap { flex: 1; min-width: 0; }
        .pg-title { font-weight: 800; font-size: 15px; margin-bottom: 6px; text-align: center; }
        .pg-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
        .pg-mini {
          display: grid; grid-template-columns: repeat(5, 1fr); gap: 1px;
          background: #0b1118; padding: 1px; border: 2px solid #ffffff; border-radius: 3px;
        }
        .pg-cell { aspect-ratio: 1; background: #26323f; }
        .pg-cell.lit { background: #ffffff; box-shadow: 0 0 4px rgba(255,255,255,.7); }
      `}</style>
    </div>
  );
}
