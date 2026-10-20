import WebApp from '../services/telegram';

// Admin's Telegram username (without @). Set VITE_SUPPORT_USERNAME in Vercel (miniapp project).
const SUPPORT_USERNAME = String(import.meta.env.VITE_SUPPORT_USERNAME || '').replace(/^@/, '').trim();

function openChat() {
  const url = `https://t.me/${SUPPORT_USERNAME}`;
  try {
    if (WebApp?.openTelegramLink) return WebApp.openTelegramLink(url);
  } catch (e) {
    /* fall through */
  }
  window.open(url, '_blank');
}

const TOPICS = [
  '💳 Deposit ወይም Withdrawal ጥያቄዎ ከዘገየ',
  '🎮 ጨዋታ ወይም BINGO ቁልፍ ችግር ካጋጠመዎት',
  '🔑 የ Player ID ወይም አካውንት ጉዳይ',
  '🎁 የግብዣ ወይም የጉርሻ ጥያቄ',
];

export default function Support() {
  return (
    <div className="app-content">
      <h1 className="section-title">🆘 እርዳታ / Support</h1>

      <div className="ticket-card">
        <p style={{ marginTop: 0 }}>ችግር ከገጠመዎት በቀጥታ Admin ን በ Telegram ያነጋግሩ።</p>
        <ul style={{ paddingLeft: 18, margin: '8px 0 14px', color: 'var(--color-text-muted)', fontSize: 13, lineHeight: 1.7 }}>
          {TOPICS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>

        {SUPPORT_USERNAME ? (
          <>
            <button className="btn-primary" style={{ width: '100%' }} onClick={openChat}>
              💬 Admin ን ያነጋግሩ (@{SUPPORT_USERNAME})
            </button>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 10, textAlign: 'center' }}>
              መልዕክት ሲልኩ የእርስዎን Player ID ያካትቱ።
            </div>
          </>
        ) : (
          <div className="notice" style={{ textAlign: 'center' }}>Support ገና አልተዘጋጀም። እባክዎ ቆይተው ይሞክሩ።</div>
        )}
      </div>
    </div>
  );
}
