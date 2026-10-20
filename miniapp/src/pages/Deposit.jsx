import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { hapticSuccess, hapticError } from '../services/telegram';
import MethodPicker, { MethodBadge } from '../components/MethodPicker';

const QUICK_AMOUNTS = [50, 70, 100, 150, 200];
const MIN_DEPOSIT = 25;
const MAX_DEPOSIT = 10000;

// Sender account, checked for the method the player chose. Returns the cleaned value, or null if invalid (same rule as the server).
//  TELEBIRR: phone 09XXXXXXXX   CBE: account 1000 + digits (the SMS may mask the middle with *)
function normalizeAccount(raw, method) {
  if (method === 'CBE') {
    const v = String(raw || '').replace(/[\s-]/g, '');
    return /^1000[0-9*]{6,12}$/.test(v) ? v : null;
  }
  const d = String(raw || '').replace(/\D/g, '');
  if (/^251[79]\d{8}$/.test(d)) return '0' + d.slice(3);
  if (/^0[79]\d{8}$/.test(d)) return d;
  if (/^[79]\d{8}$/.test(d)) return '0' + d;
  return null;
}

function CopyRow({ title, name, number }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    try {
      navigator.clipboard?.writeText(number);
    } catch {
      /* clipboard not available */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div style={{ padding: '10px 0', borderTop: '1px solid var(--color-border)' }}>
      <div className="field-label" style={{ marginBottom: 2 }}>{title}</div>
      {name && <div style={{ fontWeight: 700, marginBottom: 4 }}>{name}</div>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, flex: 1, wordBreak: 'break-all' }}>{number}</div>
        <button className="btn-secondary" style={{ width: 'auto', padding: '6px 12px' }} onClick={copy}>
          {copied ? 'ተቀድቷል!' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export default function Deposit({ onBack, onRefresh }) {
  const [info, setInfo] = useState(null);
  const [method, setMethod] = useState(null); // null = still choosing: 'TELEBIRR' | 'CBE'
  const [payTo, setPayTo] = useState(null); // which of the listed accounts he paid to
  const [amount, setAmount] = useState('');
  const [senderAccount, setSenderAccount] = useState('');
  const [txId, setTxId] = useState('');
  const [shot, setShot] = useState(null); // compressed screenshot (data URL)
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.paymentInfo().then(setInfo).catch(() => setInfo({ telebirr: null, cbeAccounts: [], methods: { TELEBIRR: [], CBE: [] } }));
  }, []);

  // shrink a phone screenshot to ~1280px JPEG so it uploads fast and fits the server limit
  function pickScreenshot(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1280 / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        let q = 0.72;
        let out = canvas.toDataURL('image/jpeg', q);
        while (out.length > 800 * 1024 && q > 0.35) {
          q -= 0.12;
          out = canvas.toDataURL('image/jpeg', q);
        }
        setShot(out);
        setError(null);
      };
      img.onerror = () => setError('Screenshot ማንበብ አልተቻለም። ሌላ ምስል ይምረጡ።');
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  const txValid = /^[A-Z0-9]{6,30}$/.test(txId);
  const accounts = info?.methods?.[method] || [];
  const chosen = accounts.length === 1 ? accounts[0].ref : payTo;
  const ready = Number(amount) > 0 && Boolean(normalizeAccount(senderAccount, method)) && (accounts.length === 0 || Boolean(chosen)) && (txValid || Boolean(shot)) && (txId === '' || txValid);

  async function submit() {
    setError(null);
    setMessage(null);
    const amt = Number(amount);

    if (!amt || amt < MIN_DEPOSIT || amt > MAX_DEPOSIT) {
      setError('መጠኑ ከ ' + MIN_DEPOSIT + ' እስከ ' + MAX_DEPOSIT + ' ETB መሆን አለበት።');
      return;
    }
    if (!normalizeAccount(senderAccount, method)) {
      setError(
        method === 'CBE'
          ? 'እባክዎ ገንዘቡን የላኩበትን ትክክለኛ የ CBE account ቁጥር (1000XXXXXXXXX) ያስገቡ።'
          : 'እባክዎ ገንዘቡን የላኩበትን ትክክለኛ የ Telebirr ስልክ ቁጥር (09XXXXXXXX) ያስገቡ።'
      );
      return;
    }
    if (accounts.length > 0 && !chosen) {
      setError('እባክዎ ገንዘቡን የላኩበትን አካውንት ይምረጡ።');
      return;
    }
    if (txId !== '' && !txValid) {
      setError('Transaction ID ትክክል አይደለም (6-30 ፊደል ወይም ቁጥር፣ ያለ ክፍተት)፤ ወይም ባዶ ይተዉት እና Screenshot ያያይዙ።');
      return;
    }
    if (!txValid && !shot) {
      setError('Transaction ID ወይም Screenshot ያስገቡ።');
      return;
    }

    setSubmitting(true);
    try {
      const result = await api.depositRequest(amt, normalizeAccount(senderAccount, method), txId || null, shot, method, accounts.length ? chosen : null);
      setMessage(result.message);
      setAmount('');
      setSenderAccount('');
      setTxId('');
      setShot(null);
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
      <h1 className="section-title">Deposit</h1>

      {!method && (
        <div className="ticket-card">
          <MethodPicker hint="ገንዘብ የሚያስገቡበትን ዘዴ ይምረጡ 👇" onPick={(m) => { setMethod(m); setPayTo(null); setError(null); setMessage(null); }} />
        </div>
      )}

      {method && <div className="ticket-card">
        <MethodBadge method={method} onChange={() => { setMethod(null); setError(null); setMessage(null); }} />
        {!info && <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>በመጫን ላይ…</div>}
        {info && accounts.length === 0 && (
          <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
            የ {method === 'CBE' ? 'CBE' : 'Telebirr'} አካውንት አልተመዘገበም። ሌላ ዘዴ ይምረጡ ወይም በኋላ ይሞክሩ።
          </div>
        )}
        {accounts.length > 1 && (
          <div className="field-label" style={{ marginTop: 4 }}>ገንዘቡን የሚልኩበትን አካውንት ይምረጡ</div>
        )}
        {accounts.map((a) => (
          <div
            key={a.ref}
            onClick={() => setPayTo(a.ref)}
            style={{
              borderRadius: 10,
              padding: accounts.length > 1 ? '0 10px' : 0,
              marginBottom: accounts.length > 1 ? 8 : 0,
              border: accounts.length > 1 ? `2px solid ${chosen === a.ref ? 'var(--color-gold)' : 'var(--color-border)'}` : 'none',
            }}
          >
            <CopyRow title={method === 'CBE' ? 'CBE Account' : 'Telebirr'} name={a.accountName} number={a.accountNumber} />
          </div>
        ))}

        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '14px 0 16px', lineHeight: 1.6 }}>
          ከላይ ባለው የ {method === 'CBE' ? 'CBE' : 'Telebirr'} Account የፈለጉትን የገንዘብ መጠን ያስተላልፉ:: ካስተላለፉ በኋላ በ SMS የሚደርሶትን Transaction Number /ID ወይም
          የከፈሉበትን screenshot 📷 ከሥር ያስገቡ።
        </p>

        <label className="field-label">የገንዘብ መጠን (ETB)</label>
        <input
          className="text-input"
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={'Min ' + MIN_DEPOSIT + ', Max ' + MAX_DEPOSIT}
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

        <label className="field-label">{method === 'CBE' ? 'የላኩበትን የ CBE account ቁጥር አስገቡ' : 'የላኩበትን የ Telebirr ስልክ ቁጥር አስገቡ'}</label>
        <input
          className="text-input"
          type="tel"
          inputMode="numeric"
          value={senderAccount}
          onChange={(e) => setSenderAccount(e.target.value.replace(method === 'CBE' ? /[^0-9*]/g : /[^0-9+]/g, ''))}
          placeholder={method === 'CBE' ? '1000*********' : '09XXXXXXXX'}
          style={{ marginBottom: 12 }}
        />

        <label className="field-label">Transaction Number / ID ወይም Screenshot</label>
        <input
          className="text-input"
          value={txId}
          onChange={(e) => setTxId(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())}
          placeholder="ለምሳሌ: CGH5K6L7M8"
          autoCapitalize="characters"
        />

        <div style={{ textAlign: 'center', margin: '8px 0', fontSize: 12, color: 'var(--color-text-muted)' }}>— ወይም —</div>

        <input
          id="shot-input"
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            pickScreenshot(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        {!shot ? (
          <button className="btn-secondary" style={{ width: '100%', marginBottom: 14 }} onClick={() => document.getElementById('shot-input').click()}>
            📎 የክፍያ Screenshot ያያይዙ
          </button>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <img src={shot} alt="screenshot" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--color-border)' }} />
            <span style={{ flex: 1, fontSize: 13 }}>✅ Screenshot ተያይዟል</span>
            <button className="btn-secondary" style={{ width: 'auto', padding: '6px 12px' }} onClick={() => setShot(null)}>
              ✕ አስወግድ
            </button>
          </div>
        )}

        {error && <div className="error-text">{error}</div>}
        {message && <div className="notice">{message}</div>}

        <button className="btn-primary" disabled={!ready || submitting} onClick={submit}>
          {submitting ? 'በመላክ ላይ…' : '✅ Submit Deposit'}
        </button>
      </div>}
    </div>
  );
}
