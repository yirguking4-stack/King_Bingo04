import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';

// Lets the admin replace the picture shown on top of the bot's menu (the pinned "Play Games" message).
export default function MenuBannerEditor() {
  const [banner, setBanner] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  function load() {
    api.menuBanner().then(setBanner).catch((e) => setMessage({ error: e.message }));
  }
  useEffect(load, []);

  async function upload(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) return setMessage({ error: 'Choose a JPG or PNG picture.' });
    if (file.size > 5 * 1024 * 1024) return setMessage({ error: 'The picture is too big (max 5 MB).' });
    setBusy(true);
    try {
      await api.uploadMenuBanner(file);
      setMessage({ ok: 'Saved. Players see the new picture the next time the bot sends the menu (/start or /menu).' });
      load();
    } catch (err) {
      setMessage({ error: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!window.confirm('Go back to the original picture?')) return;
    setBusy(true);
    try {
      await api.resetMenuBanner();
      setMessage({ ok: 'The original picture is back.' });
      load();
    } catch (err) {
      setMessage({ error: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stat-card" style={{ maxWidth: 420, marginBottom: 12 }}>
      <div className="stat-label" style={{ marginBottom: 8 }}>Bot menu picture (advert)</div>
      {banner?.custom ? (
        <img src={banner.dataUrl} alt="Current menu picture" style={{ width: '100%', borderRadius: 10, marginBottom: 8 }} />
      ) : (
        <p style={{ color: 'var(--admin-muted)', fontSize: 14, marginTop: 0 }}>Using the original built-in picture.</p>
      )}
      <input ref={fileRef} type="file" accept="image/jpeg,image/png" style={{ display: 'none' }} onChange={upload} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-outline" disabled={busy} onClick={() => fileRef.current.click()}>
          {busy ? 'Saving…' : 'Choose new picture'}
        </button>
        {banner?.custom && <button className="btn btn-outline" disabled={busy} onClick={reset}>Use original</button>}
      </div>
      <p style={{ color: 'var(--admin-muted)', fontSize: 12, marginBottom: 0 }}>JPG or PNG, up to 5 MB. A square or portrait picture around 1080 px wide looks best.</p>
      {message?.error && <div style={{ color: '#c0392b', marginTop: 8 }}>{message.error}</div>}
      {message?.ok && <div style={{ color: '#1e8e3e', marginTop: 8 }}>{message.ok}</div>}
    </div>
  );
}
