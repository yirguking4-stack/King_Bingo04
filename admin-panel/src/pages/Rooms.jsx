import { useEffect, useState } from 'react';
import { api } from '../services/api';

export default function Rooms() {
  const [rooms, setRooms] = useState([]);

  useEffect(() => {
    api.rooms().then(setRooms);
    const interval = setInterval(() => api.rooms().then(setRooms), 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      <h1 className="page-title">Game Rooms</h1>
      <table>
        <thead>
          <tr>
            <th>Room</th>
            <th>Entry</th>
            <th>Players</th>
            <th>Pot</th>
            <th>Commission</th>
            <th>Status</th>
            <th>Winner Pattern</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {rooms.map((r) => (
            <tr key={r.id}>
              <td>{r.room_code}</td>
              <td>{r.entry_credits}</td>
              <td>{r.player_count}</td>
              <td>{r.pot_total}</td>
              <td>{r.commission_taken}</td>
              <td>
                <span className={`badge ${r.status.toLowerCase()}`}>{r.status}</span>
              </td>
              <td>{r.winner_pattern || '—'}</td>
              <td>{new Date(r.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
