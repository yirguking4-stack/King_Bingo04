import { useEffect, useState } from 'react';
import { api } from '../services/api';

const fmt = (d) => (d ? new Date(d).toLocaleString() : '—');
const box = { padding: 8, border: '1px solid var(--admin-border)', borderRadius: 8 };

export default function DamaRooms() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [bets, setBets] = useState('');
  const [turn, setTurn] = useState(45);
  const [wait, setWait] = useState(120);
  const [majority, setMajority] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [loadedCfg, setLoadedCfg] = useState(false);

  const load = () =>
    api.damaOverview().then((d) => {
      setData(d);
      if (!loadedCfg) {
        setBets(d.settings.bets.join(', '));
        setTurn(d.settings.turnSeconds);
        setWait(d.settings.waitSeconds);
        setMajority(d.settings.majority);
        setEnabled(d.settings.enabled);
        setLoadedCfg(true);
      }
    }).catch((e) => setError(e.message));

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [loadedCfg]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setMsg('');
    try {
      await api.damaSaveConfig({ bets: bets.split(',').map((s) => s.trim()).filter(Boolean), turnSeconds: Number(turn), waitSeconds: Number(wait), majority, enabled });
      setMsg('Saved ✔ (audit-logged)');
    } catch (e) {
      setMsg(e.message);
    }
  }

  async function voidRoom(code) {
    const reason = window.prompt(`Void match ${code}? All stakes are refunded, NO commission.\nReason (verified platform failure):`);
    if (reason === null) return;
    try {
      await api.damaVoid(code, reason);
      load();
    } catch (e) {
      setMsg(e.message);
    }
  }

  if (error) return <div className="page-title">King Dama — {error}</div>;
  if (!data) return <div>Loading…</div>;

  return (
    <div>
      <h1 className="page-title">King Dama (Russian Checkers)</h1>
      <p>
        Finished games: <b>{data.totals.finished}</b> · Commission earned: <b>{data.totals.commission} ETB</b> · Prizes paid: <b>{data.totals.paid} ETB</b>
      </p>

      <h3>Configuration</h3>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <label>Stakes (ETB, comma separated)<br /><input style={{ ...box, width: 320 }} value={bets} onChange={(e) => setBets(e.target.value)} /></label>
        <label>Turn seconds<br />
          <select style={box} value={turn} onChange={(e) => setTurn(e.target.value)}>{data.turnOptions.map((t) => <option key={t} value={t}>{t}</option>)}</select>
        </label>
        <label>Matchmaking wait (s)<br /><input style={{ ...box, width: 90 }} type="number" min="15" max="900" value={wait} onChange={(e) => setWait(e.target.value)} /></label>
        <label><input type="checkbox" checked={majority} onChange={(e) => setMajority(e.target.checked)} /> Majority-capture variant</label>
        <label><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Game enabled</label>
        <button className="btn btn-outline" onClick={save}>Save</button>
        <span>{msg}</span>
      </div>

      <h3>Waiting &amp; running matches ({data.live.length})</h3>
      <table>
        <thead><tr><th>Room</th><th>Status</th><th>Stake</th><th>Players</th><th>Pot</th><th>Created</th><th /></tr></thead>
        <tbody>
          {data.live.map((r) => (
            <tr key={r.room_code}>
              <td>{r.room_code}</td>
              <td><span className={`badge ${r.status.toLowerCase()}`}>{r.status}</span></td>
              <td>{r.bet_amount}</td>
              <td>{r.players}/2</td>
              <td>{r.pot_total}</td>
              <td>{fmt(r.created_at)}</td>
              <td><button className="btn btn-outline" onClick={() => voidRoom(r.room_code)}>Void &amp; refund</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Completed &amp; cancelled</h3>
      <table>
        <thead><tr><th>Room</th><th>Status</th><th>Stake</th><th>Winner</th><th>Prize</th><th>Commission</th><th>Reason</th><th>Ended</th></tr></thead>
        <tbody>
          {data.recent.map((r) => (
            <tr key={r.room_code}>
              <td>{r.room_code}</td>
              <td><span className={`badge ${r.status.toLowerCase()}`}>{r.is_draw ? 'DRAW' : r.status}</span></td>
              <td>{r.bet_amount}</td>
              <td>{r.winner_id_5d ? `${r.winner_id_5d} ${r.winner_username}` : '—'}</td>
              <td>{r.prize}</td>
              <td>{r.commission_taken}</td>
              <td>{r.end_reason || '—'}</td>
              <td>{fmt(r.ended_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Errors &amp; suspicious events</h3>
      <table>
        <thead><tr><th>Time</th><th>Kind</th><th>Room</th><th>User</th><th>Detail</th></tr></thead>
        <tbody>
          {data.events.map((e) => (
            <tr key={e.id}>
              <td>{fmt(e.created_at)}</td><td>{e.kind}</td><td>{e.room_id || '—'}</td><td>{e.user_id || '—'}</td>
              <td><code>{e.detail ? JSON.stringify(e.detail) : ''}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
