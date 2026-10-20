import { useState } from 'react';
import { api, setToken } from '../services/api';
import { getInitData, getStartParam, hapticError, hapticSuccess } from '../services/telegram';

export default function Onboarding({ telegramProfile, referralCandidate, onRegistered, blockedMessage }) {
  const [phone, setPhone] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  // Invitation ID: filled automatically from the invite link, but the player can change or clear it.
  const [inviter, setInviter] = useState(() => {
    const fromLink = referralCandidate || getStartParam() || new URLSearchParams(window.location.search).get('ref') || '';
    return /^[0-9]{5}$/.test(String(fromLink)) ? String(fromLink) : '';
  });

  if (blockedMessage) {
    return (
      <div className="app-content">
        <div className="notice" style={{ borderColor: 'var(--color-coral)', color: 'var(--color-coral)' }}>
          {blockedMessage}
        </div>
      </div>
    );
  }

  const cleanPhone = phone.replace(/[\s-]/g, '');
  const phoneValid = /^(09|07)[0-9]{8}$/.test(cleanPhone);

  async function submit() {
    setError(null);
    if (!phoneValid) {
      setError('ትክክለኛ የስልክ ቁጥር ያስገቡ (ለምሳሌ 0912345678)።');
      return;
    }
    if (!confirmed) {
      setError('እባክዎ ስልክ ቁጥርዎ ትክክል መሆኑን ያረጋግጡ።');
      return;
    }

    if (inviter && inviter.length !== 5) {
      setError('Invitation ID 5 ቁጥር መሆን አለበት (ለምሳሌ 00005)፣ ወይም ባዶ ይተዉት።');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.register({
        initData: getInitData(),
        phoneNumber: cleanPhone,
        referredBy: inviter || null,
      });

      setToken(res.token);
      hapticSuccess();
      setResult(res);
    } catch (err) {
      hapticError();
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="app-content">
        <div className="ticket-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 44 }}>🎉</div>
          <h1 className="section-title" style={{ marginBottom: 8 }}>
            ምዝገባው ተጠናቋል ✅
          </h1>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>የእርስዎ Player ID</div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 34, letterSpacing: '0.05em' }}>
            {result.user.userId5d}
          </div>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 14, marginBottom: 18 }}>
            @{result.user.username}
          </div>
          <button
            className="btn-primary"
            onClick={async () => {
              // removes the "ተመዝገብ" button from the bot chat, then goes home
              try {
                await api.registrationDone();
              } catch (e) {
                /* not critical */
              }
              onRegistered(result);
            }}
          >
            🏠 Back to home / ወደ ዋና ገጽ
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-content">
      <h1 className="section-title">📝 የምዝገባ ቅጽ</h1>

      <div className="ticket-card">
        <label className="field-label">👤 የቴሌግራም ስም (በራስ-ሰር)</label>
        <input className="text-input" readOnly value={`@${telegramProfile?.username || ''}`} />

        <label className="field-label">🤳 ስልክ ቁጥር</label>
        <input
          className="text-input"
          type="tel"
          inputMode="numeric"
          maxLength={10}
          placeholder="09XXXXXXXX"
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, ''))}
        />

        <label className="field-label">🎟️ Invitation ID (ካለዎት)</label>
        <input
          className="text-input"
          type="tel"
          inputMode="numeric"
          maxLength={5}
          placeholder="00000"
          value={inviter}
          onChange={(e) => setInviter(e.target.value.replace(/[^0-9]/g, ''))}
        />
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '-8px 0 14px' }}>
          {inviter
            ? 'ይህ የጋበዘዎት ሰው Player ID ነው። የሌላ ሰው ID መጠቀም ከፈለጉ ይቀይሩት፣ ወይም ባዶ ያድርጉት።'
            : 'ማንም ካልጋበዘዎት ባዶ ይተዉት።'}
        </div>

        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, marginBottom: 14 }}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span>ይህ ስልክ ቁጥር የእኔ ትክክለኛ ቁጥር መሆኑን አረጋግጣለሁ። ከተመዘገብኩ በኋላ ለመቀየር አድሚንን ማነጋገር እንዳለብኝ ተረድቻለሁ።</span>
        </label>

        {error && <div className="error-text">{error}</div>}

        <button className="btn-primary" disabled={submitting} onClick={submit}>
          {submitting ? 'በመላክ ላይ…' : '✅ ላክ (Submit)'}
        </button>
      </div>
    </div>
  );
}
