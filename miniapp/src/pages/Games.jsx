import { hapticImpact } from '../services/telegram';
import GameIcon from '../components/GameIcon';

export default function Games({ onPlayBingo, onPlayLudo, onPlayDama }) {
  return (
    <div className="app-content">
      <h1 className="section-title">Play Games</h1>
      <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 14 }}>ለመጫወት ጨዋታ ይምረጡ</div>

      <button
        className="ticket-card"
        style={{ width: '100%', textAlign: 'left', color: 'inherit', cursor: 'pointer', display: 'flex', gap: 14, alignItems: 'center' }}
        onClick={() => {
          hapticImpact('medium');
          onPlayBingo();
        }}
      >
        <GameIcon name="bingo" size={56} />
        <span style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 17 }}>BINGO</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>Real-time Bingo rooms</div>
        </span>
        <span className="virtual-badge" style={{ borderColor: 'var(--color-teal)', color: 'var(--color-teal)' }}>LIVE</span>
      </button>

      <button
        className="ticket-card"
        style={{ width: '100%', textAlign: 'left', color: 'inherit', cursor: 'pointer', display: 'flex', gap: 14, alignItems: 'center' }}
        onClick={() => {
          hapticImpact('medium');
          onPlayLudo();
        }}
      >
        <GameIcon name="ludo" size={56} />
        <span style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 17 }}>KING LUDO 🎲</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>2 / 4 player real-time Ludo</div>
        </span>
        <span className="virtual-badge" style={{ borderColor: 'var(--color-teal)', color: 'var(--color-teal)' }}>LIVE</span>
      </button>

      <button
        className="ticket-card"
        style={{ width: '100%', textAlign: 'left', color: 'inherit', cursor: 'pointer', display: 'flex', gap: 14, alignItems: 'center' }}
        onClick={() => {
          hapticImpact('medium');
          onPlayDama();
        }}
      >
        <GameIcon name="dama" size={56} />
        <span style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 17 }}>KING DAMA ♛</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>Russian Checkers 1v1 · 50 – 5,000 ETB</div>
        </span>
        <span className="virtual-badge" style={{ borderColor: 'var(--color-teal)', color: 'var(--color-teal)' }}>LIVE</span>
      </button>
    </div>
  );
}
