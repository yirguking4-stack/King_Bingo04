import { hapticImpact } from '../services/telegram';
import GameIcon from '../components/GameIcon';

export default function Games({ onPlayBingo, onPlayLudo, onPlayDama }) {
  const games = [
    { key: 'bingo', label: 'Bingo', onClick: onPlayBingo },
    { key: 'ludo', label: 'King Ludo', onClick: onPlayLudo },
    { key: 'dama', label: 'King Dama', onClick: onPlayDama },
  ];

  return (
    <div className="app-content">
      <h1 className="section-title">Play Games</h1>
      <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 14 }}>ለመጫወት ጨዋታ ይምረጡ</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {games.map((g) => (
          <button
            key={g.key}
            aria-label={g.label}
            style={{ background: 'none', border: 'none', padding: 0, margin: 0, cursor: 'pointer', display: 'block', minWidth: 0 }}
            onClick={() => {
              hapticImpact('medium');
              g.onClick();
            }}
          >
            <GameIcon
              name={g.key}
              style={{ width: '100%', height: 'auto', aspectRatio: '1 / 1', borderRadius: 14, display: 'block' }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
