import GameIcon from './GameIcon';

const TABS = [
  { key: 'home', label: 'ዋና', icon: '🏠' },
  { key: 'games', label: 'ጨዋታ', icon: '🎟️' },
  { key: 'wallet', label: 'ዋሌት', icon: '💳', img: 'wallet' },
  { key: 'profile', label: 'ፕሮፋይል', icon: '👤' },
  { key: 'support', label: 'እርዳታ', icon: '🆘' },
];

export default function BottomNav({ active, onChange }) {
  return (
    <nav className="bottom-nav">
      {TABS.map((tab) => (
        <button key={tab.key} className={active === tab.key ? 'active' : ''} onClick={() => onChange(tab.key)}>
          <span className="nav-icon">{tab.img ? <GameIcon name={tab.img} size={26} /> : tab.icon}</span>
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
