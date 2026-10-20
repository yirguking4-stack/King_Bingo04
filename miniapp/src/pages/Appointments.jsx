import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { maskName } from '../utils/maskName';
import { hapticImpact } from '../services/telegram';

const MAX = 30;

/** "ቀጠሮ": every player can suggest a time to play (max 30 characters) and everyone sees and votes. */
export default function Appointments({ isAdmin, onBack }) {
  const [items, setItems] = useState(null);
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notify, setNotify] = useState(true);

  async function load() {
    try {
      const data = await api.appointments();
      setItems(data.items);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    api.appointmentPrefs().then((p) => setNotify(p.notify)).catch(() => {});
  }, []);

  async function toggleNotify() {
    const next = !notify;
    setNotify(next);
    try {
      await api.setAppointmentPrefs(next);
    } catch (err) {
      setNotify(!next);
      setError(err.message);
    }
  }

  async function add() {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      await api.addAppointment(body);
      setText('');
      hapticImpact('light');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function vote(id) {
    hapticImpact('light');
    try {
      await api.voteAppointment(id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(id) {
    if (!window.confirm('ይህ ቀጠሮ ይጥፋ?')) return;
    try {
      await api.deleteAppointment(id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="app-content">
      <button className="btn-secondary" style={{ width: 'auto', marginBottom: 14, padding: '8px 14px' }} onClick={onBack}>
        ← Home
      </button>

      <h1 className="section-title">🗓 ቀጠሮ</h1>
      <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
        ለመጫወት የሚመችዎትን ሰዓት ይጻፉ። ሁሉም ተጫዋች ይመለከታል፤ የሚስማማው 👍 ይጫናል። ከ48 ሰዓት በኋላ ይጠፋል።
      </div>

      <button
        className="btn-secondary"
        style={{ width: '100%', marginBottom: 12, display: 'flex', justifyContent: 'space-between' }}
        onClick={toggleNotify}
      >
        <span>🔔 አዲስ ቀጠሮ ሲመጣ አሳውቀኝ</span>
        <span>{notify ? 'በርቷል ✅' : 'ጠፍቷል ⛔'}</span>
      </button>

      <div className="ticket-card">
        <input
          className="text-input"
          maxLength={MAX}
          placeholder="ለምሳሌ፦ ዛሬ ምሽት 2:00"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            {[...text].length}/{MAX}
          </span>
          <button className="btn-primary" style={{ width: 'auto', padding: '10px 18px' }} disabled={busy || !text.trim()} onClick={add}>
            ቀጠሮ አቅርብ
          </button>
        </div>
      </div>

      {error && <div className="error-text" style={{ marginBottom: 10 }}>{error}</div>}

      {items === null && <div className="notice" style={{ textAlign: 'center' }}>Loading…</div>}
      {items && items.length === 0 && <div className="notice" style={{ textAlign: 'center' }}>እስካሁን ምንም ቀጠሮ የለም። የመጀመሪያው ይሁኑ!</div>}

      {items &&
        items.map((a) => (
          <div key={a.id} className="ticket-card" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15, wordBreak: 'break-word' }}>{a.body}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                @{maskName(a.username)}
              </div>
            </div>
            <button
              className="btn-secondary"
              style={{
                width: 'auto', padding: '8px 12px', whiteSpace: 'nowrap',
                borderColor: a.voted ? 'var(--color-gold)' : undefined,
                color: a.voted ? 'var(--color-gold-soft)' : undefined,
              }}
              onClick={() => vote(a.id)}
            >
              👍 {a.votes}
            </button>
            {(a.mine || isAdmin) && (
              <button className="btn-secondary" style={{ width: 'auto', padding: '8px 10px' }} onClick={() => remove(a.id)} aria-label="Delete">
                🗑
              </button>
            )}
          </div>
        ))}
    </div>
  );
}
