import { useEffect, useState } from 'react';
import { api } from '../services/api';

export default function Users() {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [adjusting, setAdjusting] = useState(null); // user id being adjusted
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  function load() {
    api.users(search).then(setUsers);
  }

  useEffect(load, []);

  async function changeStatus(id, status) {
    await api.setUserStatus(id, status);
    load();
  }

  async function submitAdjustment(id, direction) {
    if (!amount) return;
    await api.adjustBalance(id, Number(amount), direction, reason);
    setAdjusting(null);
    setAmount('');
    setReason('');
    load();
  }

  return (
    <div>
      <h1 className="page-title">Players</h1>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          className="text-input"
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--admin-border)', flex: 1 }}
          placeholder="Search by @username or 5-digit ID"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
        />
        <button className="btn btn-outline" onClick={load}>
          Search
        </button>
      </div>

      <table>
        <thead>
          <tr>
            <th title="Player ID (Inviter Player ID)">Player ID (Inviter)</th>
            <th>Username</th>
            <th>Balance</th>
            <th>Locked</th>
            <th>Status</th>
            <th>Joined</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.user_id_5d}{u.referred_by ? <span title={`Invited by Player ID ${u.referred_by}`} style={{ color: 'var(--admin-muted)' }}>({u.referred_by})</span> : null}</td>
              <td>@{u.username}</td>
              <td>{u.balance}</td>
              <td>{u.locked_balance}</td>
              <td>
                <span className={`badge ${u.status.toLowerCase()}`}>{u.status}</span>
              </td>
              <td>{new Date(u.created_at).toLocaleDateString()}</td>
              <td>
                {adjusting === u.id ? (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      style={{ width: 70, padding: 4 }}
                      placeholder="amt"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                    <input
                      style={{ width: 90, padding: 4 }}
                      placeholder="reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                    <button className="btn btn-approve" onClick={() => submitAdjustment(u.id, 'CREDIT')}>
                      +
                    </button>
                    <button className="btn btn-reject" onClick={() => submitAdjustment(u.id, 'DEBIT')}>
                      −
                    </button>
                    <button className="btn btn-outline" onClick={() => setAdjusting(null)}>
                      x
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-outline" onClick={() => setAdjusting(u.id)}>
                      Adjust
                    </button>
                    {u.status === 'ACTIVE' ? (
                      <button className="btn btn-reject" onClick={() => changeStatus(u.id, 'SUSPENDED')}>
                        Suspend
                      </button>
                    ) : (
                      <button className="btn btn-approve" onClick={() => changeStatus(u.id, 'ACTIVE')}>
                        Reactivate
                      </button>
                    )}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
