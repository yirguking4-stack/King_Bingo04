import { useEffect, useState } from 'react';
import { api } from '../services/api';

const fmt = (d) => (d ? new Date(d).toLocaleString() : '—');

export default function LudoRooms() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = () => api.ludoOverview().then(setData).catch((e) => setError(e.message));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  if (error) return <div className="page-title">King Ludo — {error}</div>;
  if (!data) return <div>Loading…</div>;

  return (
    <div>
      <h1 className="page-title">King Ludo</h1>
      <p>
        Finished games: <b>{data.totals.finished}</b> · Commission earned: <b>{data.totals.commission} ETB</b> · Prizes paid: <b>{data.totals.paid} ETB</b>
      </p>

      <h3>Waiting &amp; running rooms ({data.live.length})</h3>
      <table>
        <thead><tr><th>Room</th><th>Status</th><th>Mode</th><th>Crowns</th><th>Bet</th><th>Players</th><th>Pot</th><th>Created</th></tr></thead>
        <tbody>
          {data.live.map((r) => (
            <tr key={r.room_code}>
              <td>{r.room_code}</td>
              <td><span className={`badge ${r.status.toLowerCase()}`}>{r.status}</span></td>
              <td>{r.capacity}P</td>
              <td>{r.crowns}</td>
              <td>{Number(r.bet_amount) === 0 ? 'Free' : r.bet_amount}</td>
              <td>{r.players}/{r.capacity}</td>
              <td>{r.pot_total}</td>
              <td>{fmt(r.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Completed &amp; cancelled</h3>
      <table>
        <thead><tr><th>Room</th><th>Status</th><th>Mode</th><th>Bet</th><th>Winner</th><th>Prize</th><th>Commission</th><th>Reason</th><th>Ended</th></tr></thead>
        <tbody>
          {data.recent.map((r) => (
            <tr key={r.room_code}>
              <td>{r.room_code}</td>
              <td><span className={`badge ${r.status.toLowerCase()}`}>{r.status}</span></td>
              <td>{r.capacity}P · ♛{r.crowns}</td>
              <td>{Number(r.bet_amount) === 0 ? 'Free' : r.bet_amount}</td>
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
              <td>{fmt(e.created_at)}</td>
              <td>{e.kind}</td>
              <td>{e.room_id || '—'}</td>
              <td>{e.user_id || '—'}</td>
              <td><code>{e.detail ? JSON.stringify(e.detail) : ''}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
