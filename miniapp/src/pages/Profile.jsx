import { useEffect, useState } from 'react';
import { api } from '../services/api';
import WebApp from '@twa-dev/sdk';

export default function Profile({ profile }) {
  const [referrals, setReferrals] = useState([]);
  const [history, setHistory] = useState([]);
  const [copied, setCopied] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    api.myReferrals().then(setReferrals);
    api.gameHistory().then(setHistory);
  }, []);

  // every player's link carries their own Player ID: the invitee's "Invitation ID" box fills itself from it
  const botUsername = import.meta.env.VITE_BOT_USERNAME || 'KingGames7_bot';
  const referralLink = `https://t.me/${botUsername}?start=${profile?.userId5d}`;

  // support username comes from the environment (VITE_SUPPORT_USERNAME), never from the code
  const supportUsername = String(import.meta.env.VITE_SUPPORT_USERNAME || '').replace(/^@/, '').trim();

  const shareText =
    '👑🎰 KING BINGO — ዕድልዎ ዛሬ ሊከፈት ይችላል! 🎰👑\n' +
    'ተጫውተው ያሸንፉ፣ ሽልማትዎን ይውሰዱ!\n\n' +
    '✍️ ተመዝግበው በመጀመሪያ Deposit 25 ETB Bonus ያገኛሉ።\n' +
    '✍️ ሌላ ሰው ሲጋብዙ 👉 የጋበዙት ሰው የእርሶን player_ID ተጠቅሞ ከተመዘገበ እና የመጀመሪያውን Deposit ሲያደርግ ለእርሶ 15 ETB ኮሚሽን ያገኛሉ።\n' +
    (supportUsername ? `✅ ለበለጠ መረጃ ➡ @${supportUsername}\n` : '') +
    '🏆 እንዳያመልጣችሁ!\n\n' +
    '👇 አሁን ይቀላቀሉ';

  function copyLink() {
    navigator.clipboard?.writeText(`${shareText}\n${referralLink}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function shareLink() {
    const url = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(shareText)}`;
    try {
      if (WebApp?.openTelegramLink) return WebApp.openTelegramLink(url);
    } catch (e) {
      /* fall through */
    }
    window.open(url, '_blank');
  }

  return (
    <div className="app-content">
      <h1 className="section-title">Your Profile</h1>

      <div className="ticket-card" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Player ID</div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 30, letterSpacing: '0.05em' }}>
          {profile?.userId5d}
        </div>
        <div style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>@{profile?.username}</div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginTop: 14 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20 }}>{profile?.gamesPlayed ?? 0}</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Games Played</div>
          </div>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20, color: 'var(--color-gold)' }}>
              {profile?.gamesWon ?? 0}
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Wins</div>
          </div>
        </div>
      </div>

      <div className="ticket-card">
        <div className="field-label">ጓደኛዎን ይጋብዙ፦ የተጋበዘው ሰው የመጀመሪያውን deposit ሲያደርግ 10.00 ETB ያገኛሉ (ለአንድ ሰው አንድ ጊዜ ብቻ)</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="text-input" style={{ marginBottom: 0 }} readOnly value={referralLink} />
          <button className="btn-secondary" style={{ width: 'auto', padding: '0 14px' }} onClick={copyLink}>
            {copied ? '✓' : 'Copy'}
          </button>
        </div>
        <button className="btn-primary" style={{ width: '100%', marginTop: 10 }} onClick={shareLink}>
          📤 Share
        </button>
      </div>

      <h2 className="section-title" style={{ fontSize: 16 }}>
        Referred Players ({referrals.length})
      </h2>
      {referrals.map((r) => (
        <div key={r.user_id_5d} className="ticket-card" style={{ padding: 12 }}>
          <strong>{r.user_id_5d}</strong> · @{r.username}
        </div>
      ))}

      <button
        className="btn-secondary"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0' }}
        onClick={() => setShowHistory((v) => !v)}
      >
        <span>🎮 Game History ({history.length})</span>
        <span>{showHistory ? '▲' : '▼'}</span>
      </button>
      {showHistory && (
        <>
          {history.length === 0 && (
            <div className="notice" style={{ textAlign: 'center' }}>ምንም የጨዋታ ታሪክ የለም።</div>
          )}
          {history.map((h) => (
            <div key={h.room_code} className="ticket-card" style={{ padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{h.room_code}</span>
                <span style={{ color: h.is_winner ? 'var(--color-gold)' : 'var(--color-text-muted)' }}>
                  {h.is_winner ? `Won ${h.prize_credits} ETB` : h.status}
                </span>
              </div>
            </div>
          ))}
        </>
      )}

      {profile?.isAdmin === true && (
        <div className="notice" style={{ marginTop: 20 }}>
          ✅ የ Admin መለያ ነዎት። የ Admin Panel የድር አድራሻ ሲሆን በ Player ID እና በ Admin Code ይገባሉ። የ Deposit እና Withdrawal ጥያቄዎች በ Telegram መልዕክት ይደርሱዎታል።
        </div>
      )}
    </div>
  );
}
