import RefreshButton from '../components/RefreshButton';
import GameIcon from '../components/GameIcon';

// Wallet hub: balance + one button per page. Each button opens ONLY its own page.
const ITEMS = [
  { key: 'deposit', icon: '💰', title: 'Deposit', desc: 'ገንዘብ ወደ ዋሌትዎ ያስገቡ' },
  { key: 'withdraw', icon: '💸', title: 'Withdraw', desc: 'ገንዘብ ያውጡ' },
  { key: 'transactions', icon: '📜', title: 'Transactions', desc: 'የ Deposit እና Withdrawal ታሪክ' },
];

export default function Wallet({ wallet, onRefresh, onNavigate }) {
  return (
    <div className="app-content">
      <h1 className="section-title">Wallet</h1>

      <div className="ticket-card" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Available Balance</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <GameIcon name="wallet" size={44} />
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 34, color: 'var(--color-gold-soft)' }}>
            {wallet?.balance ?? '0.00'}
          </div>
          <RefreshButton onRefresh={onRefresh} />
        </div>
        <span className="virtual-badge">ETB</span>
        {Number(wallet?.locked_balance) > 0 && (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 8 }}>
            {wallet.locked_balance} ETB ተቆልፏል (ቦነስ) አንድ ጨዋታ እስኪጫወቱ ድረስ
          </div>
        )}
      </div>

      {ITEMS.map((item) => (
        <button
          key={item.key}
          className="ticket-card"
          style={{ width: '100%', textAlign: 'left', color: 'inherit', cursor: 'pointer', display: 'flex', gap: 14, alignItems: 'center' }}
          onClick={() => onNavigate(item.key)}
        >
          <span style={{ fontSize: 30 }}>{item.icon}</span>
          <span>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{item.title}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>{item.desc}</div>
          </span>
        </button>
      ))}
    </div>
  );
}
