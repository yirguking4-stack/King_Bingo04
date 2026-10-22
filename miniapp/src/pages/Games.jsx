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

      {games.map((g) => (
        <button
          key={g.key}
          aria-label={g.label}
          className="ticket-card"
          style={{ width: '100%', color: 'inherit', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
          onClick={() => {
            hapticImpact('medium');
            g.onClick();
          }}
        >
          <GameIcon name={g.key} size={96} />
        </button>
      ))}
    </div>
  );
}
