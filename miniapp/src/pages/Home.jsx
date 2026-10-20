const BINGO_MENU = [
  { key: 'lobby', icon: '🎮', title: 'ጨዋታ ጀምር', desc: 'ጠረጴዛ ይምረጡና ይጫወቱ' },
  { key: 'wallet', icon: '💳', img: 'wallet', title: 'ዋሌት', desc: 'ቀሪ ሂሳብ እና እንቅስቃሴዎች' },
  { key: 'profile', icon: '👤', title: 'ፕሮፋይል', desc: 'Player ID፣ የጨዋታ ታሪክ እና ግብዣ' },
  { key: 'appointments', icon: '🗓', title: 'ቀጠሮ', desc: 'ለመጫወት የሚመችዎትን ሰዓት ይጠቁሙ' },
];

import RefreshButton from '../components/RefreshButton';
import GameIcon from '../components/GameIcon';

export default function Home({ profile, onNavigate, onRefresh }) {
  return (
    <div className="app-content">
      <h1 className="section-title">ሰላም, @{profile?.username || '…'} 👋</h1>

      <div className="ticket-card" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>የእርስዎ ቀሪ ሂሳብ</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <GameIcon name="wallet" size={44} />
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 34, color: 'var(--color-gold-soft)' }}>
            {profile?.wallet?.balance ?? '0.00'}
          </div>
          <RefreshButton onRefresh={onRefresh} />
        </div>
        <span className="virtual-badge">ETB</span>
      </div>

      <h2 className="section-title" style={{ fontSize: 15, marginTop: 4 }}>ጨዋታዎች</h2>

      <button
        className="ticket-card"
        style={{ width: '100%', textAlign: 'left', color: 'inherit', cursor: 'pointer', display: 'flex', gap: 14, alignItems: 'center' }}
        onClick={() => onNavigate('games')}
      >
        <GameIcon name="bingo" size={46} />
        <span style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>KING BINGO</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>Real-time Bingo rooms</div>
        </span>
        <span className="virtual-badge" style={{ borderColor: 'var(--color-teal)', color: 'var(--color-teal)' }}>LIVE</span>
      </button>

      <button
        className="ticket-card"
        style={{ width: '100%', textAlign: 'left', color: 'inherit', cursor: 'pointer', display: 'flex', gap: 14, alignItems: 'center' }}
        onClick={() => onNavigate('ludo')}
      >
        <GameIcon name="ludo" size={46} />
        <span style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>KING LUDO</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>Same wallet, new game</div>
        </span>
        <span className="virtual-badge" style={{ borderColor: 'var(--color-teal)', color: 'var(--color-teal)' }}>LIVE</span>
      </button>

      <h2 className="section-title" style={{ fontSize: 15, marginTop: 20 }}>ሌሎች</h2>
      {BINGO_MENU.slice(1).map((item) => (
        <button
          key={item.key}
          className="ticket-card"
          style={{ width: '100%', textAlign: 'left', color: 'inherit', cursor: 'pointer', display: 'flex', gap: 14, alignItems: 'center' }}
          onClick={() => onNavigate(item.key)}
        >
          {item.img ? <GameIcon name={item.img} size={40} /> : <span style={{ fontSize: 30 }}>{item.icon}</span>}
          <span>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{item.title}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>{item.desc}</div>
          </span>
        </button>
      ))}
    </div>
  );
}
