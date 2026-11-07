import { useEffect, useState } from 'react';
import { api } from '../services/api';

const fmt = (d) => (d ? new Date(d).toLocaleString() : '—');
const reasonLabel = (r) => (r.end_reason === 'FINISHED' ? 'Finished' : r.end_reason === 'EXPIRED' ? 'Expired' : 'Cancelled');

// winner_pattern is stored as ROW_3, COLUMN_2, DIAGONAL_TL_BR, DIAGONAL_TR_BL or FOUR_CORNERS
function patternInfo(p) {
  let m = /^ROW_(\d)$/.exec(p || '');
  if (m) {
    const r = Number(m[1]) - 1;
    return { label: `Row ${m[1]}`, cells: [0, 1, 2, 3, 4].map((c) => r * 5 + c) };
  }
  m = /^COLUMN_(\d)$/.exec(p || '');
  if (m) {
    const c = Number(m[1]) - 1;
    return { label: `Column ${m[1]}`, cells: [0, 1, 2, 3, 4].map((r) => r * 5 + c) };
  }
  if (p === 'DIAGONAL_TL_BR') return { label: 'Diagonal ↘', cells: [0, 6, 12, 18, 24] };
  if (p === 'DIAGONAL_TR_BL') return { label: 'Diagonal ↙', cells: [4, 8, 12, 16, 20] };
  if (p === 'FOUR_CORNERS') return { label: '4 Corners', cells: [0, 4, 20, 24] };
  return { label: p || '—', cells: [] };
}

function PatternGrid({ cells }) {
  const on = new Set(cells);
  return (
    <span style={{ display: 'inline-grid', gridTemplateColumns: 'repeat(5, 7px)', gap: 1, flexShrink: 0 }}>
      {Array.from({ length: 25 }, (_, i) => (
        <span key={i} style={{ width: 7, height: 7, borderRadius: 1, background: on.has(i) ? 'var(--admin-accent)' : 'var(--admin-border)' }} />
      ))}
    </span>
  );
}

const winnerText = (r) => (r.winners && r.winners.length ? r.winners.map((w) => `${w.id_5d} @${w.username}`).join(', ') : '—');

export default function Rooms() {
  const [rooms, setRooms] = useState([]);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = () => {
      api.rooms().then(setRooms).catch((e) => setError(e.message));
      api.bingoHistory().then(setHistory).catch((e) => setError(e.message));
    };
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const live = rooms.filter((r) => ['WAITING', 'COUNTDOWN', 'IN_PROGRESS'].includes(r.status));

  return (
    <div>
      <h1 className="page-title">King Bingo</h1>
      {error && <p style={{ color: 'var(--admin-danger)' }}>{error}</p>}

      <h3>Game history</h3>
      <table>
        <thead>
          <tr>
            <th>Room</th>
            <th>Status</th>
            <th>Bet</th>
            <th>Winner</th>
            <th>Prize</th>
            <th>Commission</th>
            <th>Reason</th>
            <th>Winning pattern</th>
            <th>Ended</th>
          </tr>
        </thead>
        <tbody>
          {history.map((r) => {
            const pat = patternInfo(r.winner_pattern);
            return (
              <tr key={r.room_code}>
                <td>{r.room_code}</td>
                <td><span className={`badge ${r.status.toLowerCase()}`}>{r.status}</span></td>
                <td>{Number(r.bet_amount) === 0 ? 'Free' : r.bet_amount}</td>
                <td>{winnerText(r)}</td>
                <td>{r.prize}</td>
                <td>{r.commission_taken}</td>
                <td>{reasonLabel(r)}</td>
                <td>
                  {r.winner_pattern ? (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <PatternGrid cells={pat.cells} />
                      <span><b>{pat.label}</b><br />{winnerText(r)}</span>
                    </div>
                  ) : '—'}
                </td>
                <td>{fmt(r.ended_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h3>Waiting &amp; running rooms ({live.length})</h3>
      <table>
        <thead>
          <tr>
            <th>Room</th>
            <th>Entry</th>
            <th>Players</th>
            <th>Pot</th>
            <th>Status</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {live.map((r) => (
            <tr key={r.id}>
              <td>{r.room_code}</td>
              <td>{r.entry_credits}</td>
              <td>{r.player_count}</td>
              <td>{r.pot_total}</td>
              <td><span className={`badge ${r.status.toLowerCase()}`}>{r.status}</span></td>
              <td>{fmt(r.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
