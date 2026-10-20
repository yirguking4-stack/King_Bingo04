import { useState } from 'react';
import { api } from '../services/api';
import { hapticSuccess, hapticError } from '../services/telegram';
import MethodPicker, { MethodBadge } from '../components/MethodPicker';

const QUICK_AMOUNTS = [50, 100, 200, 500];
const MIN_WITHDRAW = 50;
const MAX_WITHDRAW = 10000;

// Account to pay out to, checked for the method the player chose. Returns the cleaned value or null.
//  TELEBIRR: phone 09XXXXXXXX     CBE: full account number 1000 + 9 digits
function normalizeAccount(raw, method) {
  const d = String(raw || '').replace(/\D/g, '');
  if (method === 'CBE') return /^1000\d{9}$/.test(d) ? d : null;
  if (/^251[79]\d{8}$/.test(d)) return '0' + d.slice(3);
  if (/^0[79]\d{8}$/.test(d)) return d;
  if (/^[79]\d{8}$/.test(d)) return '0' + d;
  return null;
}

export default function Withdraw({ wallet, onBack, onRefresh }) {
  const [method, setMethod] = useState(null); // null = still choosing: 'TELEBIRR' | 'CBE'
  const [fullName, setFullName] = useState('');
  const [account, setAccount] = useState('');
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const available = wallet ? Number(wallet.balance) - Number(wallet.locked_balance || 0) : 0;
  const ready = Number(amount) > 0 && fullName.trim().length > 0 && account.trim().length > 0;
  const kind = method === 'CBE' ? 'CBE' : 'Telebirr';

  function pick(m) {
    setMethod(m);
    setAccount('');
    setError(null);
    setMessage(null);
  }

  async function submit() {
    setError(null);
    setMessage(null);
    const amt = Number(amount);

    if (!amt || amt < MIN_WITHDRAW || amt > MAX_WITHDRAW) {
      setError('መጠኑ ከ ' + MIN_WITHDRAW + ' እስከ ' + MAX_WITHDRAW + ' ETB መሆን አለበት።');
      return;
    }
    if (!fullName.trim()) {
      setError('እባክዎ ሙሉ ስምዎን ያስገቡ።');
      return;
    }
    const acct = normalizeAccount(account, method);
    if (!acct) {
      setError(
        method === 'CBE'
          ? 'እባክዎ ትክክለኛ የ CBE account ቁጥር (1000XXXXXXXXX) ያስገቡ።'
          : 'እባክዎ ትክክለኛ የ Telebirr ስልክ ቁጥር (09XXXXXXXX) ያስገቡ።'
      );
      return;
    }
    if (amt > available) {
      setError('በቂ ቀሪ ሂሳብ የለዎትም። ቀሪ ሂሳብዎ: ' + available + ' ብር ነው።');
      return;
    }

    setSubmitting(true);
    try {
      const note = 'ሙሉ ስም: ' + fullName.trim() + ' | ' + kind + ' ቁጥር: ' + acct;
      const result = await api.withdrawalRequest(amt, note);
      setMessage(result.message);
      setAmount('');
      setFullName('');
      setAccount('');
      hapticSuccess();
      onRefresh?.();
    } catch (err) {
      setError(err.message);
      hapticError();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app-content">
      <button className="btn-secondary" style={{ width: 'auto', marginBottom: 14, padding: '8px 14px' }} onClick={onBack}>
        ← Wallet
      </button>
      <h1 className="section-title">Withdraw</h1>

      <div className="ticket-card">
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 14 }}>
          ያሎት ቀሪ ሂሳብ: <strong style={{ color: 'var(--color-teal)' }}>{available}</strong> ETB
        </div>

        {!method && <MethodPicker hint="ገንዘብ የሚቀበሉበትን ዘዴ ይምረጡ 👇" onPick={pick} />}

        {method && (
          <>
            <MethodBadge method={method} onChange={() => { setMethod(null); setError(null); setMessage(null); }} />

            <label className="field-label">ሙሉ ስም (Full Name)</label>
            <input className="text-input" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="ለምሳሌ: Yirga Tesfaye" />

            <label className="field-label">{method === 'CBE' ? 'የ CBE account ቁጥር ያስገቡ' : 'የ Telebirr ስልክ ቁጥር ያስገቡ'}</label>
            <input
              className="text-input"
              type="tel"
              inputMode="numeric"
              value={account}
              onChange={(e) => setAccount(e.target.value.replace(/[^0-9+]/g, ''))}
              placeholder={method === 'CBE' ? '1000*********' : '09XXXXXXXX'}
            />

            <label className="field-label">የገንዘብ መጠን (ETB)</label>
            <input
              className="text-input"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={'Min ' + MIN_WITHDRAW + ', Max ' + MAX_WITHDRAW}
              style={{ marginBottom: 10 }}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {QUICK_AMOUNTS.map((v) => (
                <button
                  key={v}
                  onClick={() => setAmount(String(v))}
                  className="btn-secondary"
                  style={{
                    width: 'auto',
                    padding: '8px 14px',
                    borderColor: String(amount) === String(v) ? 'var(--color-gold)' : undefined,
                    color: String(amount) === String(v) ? 'var(--color-gold)' : undefined,
                  }}
                >
                  {v}
                </button>
              ))}
            </div>
          </>
        )}

        {error && <div className="error-text">{error}</div>}
        {message && <div className="notice">{message}</div>}

        {method && (
          <button className="btn-primary" disabled={!ready || submitting} onClick={submit}>
            {submitting ? 'በመላክ ላይ…' : '✅ Submit Withdrawal'}
          </button>
        )}
      </div>
    </div>
  );
}
