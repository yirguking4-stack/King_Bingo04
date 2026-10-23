import { useEffect, useState } from 'react';

// Backend base URL (the apply script replaces VITE_BACKEND_URL with the variable your app already uses).
const API = String(import.meta.env.VITE_BACKEND_URL || '')
  .replace(/\/+$/, '')
  .replace(/\/api$/, '');

// Set to false if you only want to open the sheet from your own button:
//   window.dispatchEvent(new Event('king-support-open'))
const SHOW_FLOATING_BUTTON = false;

const OPTIONS = [
  { id: 'reg', text: 'ከምዝገባ ጋር ለተያያዘ እገዛ' },
  { id: 'dep', text: 'ገንዘብ ከማስገባት (Deposit) ጋር ለተያያዘ እገዛ' },
  { id: 'wd', text: 'ገንዘብ ከማውጣት (Withdraw) ጋር ለተያያዘ እገዛ' },
  { id: 'dep_missing', text: 'ያስገባሁት ገንዘብ ወደ ሂሳቤ አልገባም' },
  { id: 'wd_missing', text: 'ያወጣሁት ገንዘብ አልደረሰኝም' },
  { id: 'bingo', text: 'በ Bingo ጨዋታ ወቅት የገጠመኝ ችግር' },
  { id: 'ludo_dama', text: 'በ Ludo / Dama ጨዋታ የገጠመኝ ችግር' },
  { id: 'bonus', text: 'ስለ ቦነስ እና ሽልማት' },
  { id: 'account', text: 'የአካውንት ወይም የስልክ ቁጥር ለውጥ' },
  { id: 'rules', text: 'ስለ ጨዋታ ህጎች እና አሸናፊነት' },
  { id: 'other', text: 'ሌሎች / Other' },
];

const S = {
  fab: {
    position: 'fixed', right: 14, bottom: 90, zIndex: 9998, width: 46, height: 46,
    borderRadius: 23, border: 'none', background: '#f5b301', color: '#111',
    fontSize: 22, fontWeight: 700, boxShadow: '0 4px 14px rgba(0,0,0,.4)', cursor: 'pointer',
  },
  backdrop: {
    position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.55)',
    display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
  },
  sheet: {
    background: '#fff', color: '#111', width: '100%', maxWidth: 520, maxHeight: '88vh',
    borderTopLeftRadius: 20, borderTopRightRadius: 20, display: 'flex', flexDirection: 'column',
    fontFamily: 'inherit',
  },
  head: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 18px 10px', borderBottom: '1px solid #ececec',
  },
  title: { fontSize: 18, fontWeight: 700 },
  close: { background: 'none', border: 'none', fontSize: 22, color: '#555', cursor: 'pointer' },
  body: { overflowY: 'auto', padding: '4px 18px', flex: 1 },
  row: {
    display: 'flex', alignItems: 'center', gap: 14, padding: '14px 0',
    borderBottom: '1px solid #ececec', cursor: 'pointer', fontSize: 15, lineHeight: 1.35,
  },
  circle: {
    flex: '0 0 auto', width: 26, height: 26, borderRadius: '50%', boxSizing: 'border-box',
    border: '2px solid #d4d4d8', background: '#fff', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
  },
  circleOn: { border: '2px solid #111', background: '#111' },
  dot: { width: 9, height: 9, borderRadius: '50%', background: '#fff' },
  area: {
    width: '100%', boxSizing: 'border-box', margin: '12px 0', padding: 12, minHeight: 90,
    borderRadius: 12, border: '1px solid #d4d4d8', fontSize: 15, fontFamily: 'inherit', resize: 'vertical',
  },
  foot: { padding: '12px 18px 18px', borderTop: '1px solid #ececec' },
  submit: {
    width: '100%', padding: '14px 0', borderRadius: 12, border: 'none', fontSize: 16,
    fontWeight: 700, background: '#111', color: '#fff', cursor: 'pointer',
  },
  submitOff: { background: '#c9c9cf', cursor: 'not-allowed' },
  msg: { fontSize: 14, margin: '0 0 10px', textAlign: 'center' },
};

export default function SupportModal() {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState('');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('idle'); // idle | sending | done | error
  const [err, setErr] = useState('');

  useEffect(() => {
    const onOpen = () => {
      setSel('');
      setNote('');
      setStatus('idle');
      setErr('');
      setOpen(true);
    };
    window.addEventListener('king-support-open', onOpen);
    return () => window.removeEventListener('king-support-open', onOpen);
  }, []);

  const needsNote = sel === 'other';
  const canSend = !!sel && status !== 'sending' && (!needsNote || note.trim().length >= 3);

  async function submit() {
    if (!canSend) return;
    setStatus('sending');
    setErr('');
    try {
      const initData = (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) || '';
      const res = await fetch(`${API}/api/support`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, category: sel, message: note }),
      });
      let data = {};
      try { data = await res.json(); } catch (e) { /* ignore */ }
      if (res.ok && data.ok) {
        setStatus('done');
        return;
      }
      setStatus('error');
      if (res.status === 429) setErr(`እባክዎ ${data.retryAfter || 60} ሰከንድ ቆይተው ደግመው ይሞክሩ።`);
      else if (res.status === 401) setErr('እባክዎ Mini App ን በ Telegram ውስጥ ከፍተው ይሞክሩ።');
      else if (res.status === 503) setErr('የእገዛ አገልግሎቱ ገና አልተዘጋጀም። ቆይተው ይሞክሩ።');
      else if (data.error === 'message_required') setErr('እባክዎ መልዕክትዎን ይጻፉ።');
      else setErr('መላክ አልተሳካም። እባክዎ ደግመው ይሞክሩ።');
    } catch (e) {
      setStatus('error');
      setErr('ግንኙነት አልተሳካም። ኢንተርኔትዎን ያረጋግጡ።');
    }
  }

  return (
    <>
      {SHOW_FLOATING_BUTTON && !open && (
        <button
          type="button"
          style={S.fab}
          aria-label="Support"
          onClick={() => window.dispatchEvent(new Event('king-support-open'))}
        >
          ?
        </button>
      )}
      {open && (
        <div style={S.backdrop} onClick={() => setOpen(false)}>
          <div style={S.sheet} onClick={(e) => e.stopPropagation()}>
            <div style={S.head}>
              <span style={S.title}>እገዛ / Support</span>
              <button type="button" style={S.close} onClick={() => setOpen(false)} aria-label="Close">✕</button>
            </div>

            {status === 'done' ? (
              <div style={{ ...S.body, padding: '40px 18px', textAlign: 'center' }}>
                <div style={{ fontSize: 44 }}>✅</div>
                <p style={{ fontSize: 17, fontWeight: 700 }}>ጥያቄዎ ደርሶናል</p>
                <p style={{ fontSize: 14, color: '#555' }}>በቅርቡ እናግኝዎታለን። እናመሰግናለን!</p>
                <button type="button" style={{ ...S.submit, marginTop: 18 }} onClick={() => setOpen(false)}>
                  ዝጋ
                </button>
              </div>
            ) : (
              <>
                <div style={S.body} role="radiogroup" aria-label="Support options">
                  {OPTIONS.map((o, i) => {
                    const on = sel === o.id;
                    return (
                      <label key={o.id} style={S.row}>
                        <input
                          type="radio"
                          name="king-support"
                          value={o.id}
                          checked={on}
                          onChange={() => setSel(o.id)}
                          style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
                        />
                        <span style={{ ...S.circle, ...(on ? S.circleOn : null) }}>
                          {on && <span style={S.dot} />}
                        </span>
                        <span>{i + 1}. {o.text}</span>
                      </label>
                    );
                  })}
                  {needsNote && (
                    <textarea
                      style={S.area}
                      value={note}
                      maxLength={500}
                      placeholder="ችግርዎን ወይም ጥያቄዎን እዚህ ይጻፉ..."
                      onChange={(e) => setNote(e.target.value)}
                    />
                  )}
                </div>
                <div style={S.foot}>
                  {status === 'error' && <p style={{ ...S.msg, color: '#c62828' }}>{err}</p>}
                  <button
                    type="button"
                    style={{ ...S.submit, ...(canSend ? null : S.submitOff) }}
                    disabled={!canSend}
                    onClick={submit}
                  >
                    {status === 'sending' ? 'በመላክ ላይ...' : 'ያመልክቱ / Submit'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
