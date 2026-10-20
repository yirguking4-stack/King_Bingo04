import { useEffect, useState } from 'react';
import { api } from '../services/api';

export default function Dashboard() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    api.dashboard().then(setStats);
  }, []);

  if (!stats) return <p>Loading…</p>;

  return (
    <div>
      <h1 className="page-title">Dashboard</h1>
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-value">{stats.totalUsers}</div>
          <div className="stat-label">Registered Players</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.pendingTransactions}</div>
          <div className="stat-label">Pending Transactions</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.roomsToday}</div>
          <div className="stat-label">Rooms Opened Today</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.totalVirtualCreditsInCirculation.toLocaleString()}</div>
          <div className="stat-label">ETB in Circulation</div>
        </div>
      </div>
    </div>
  );
}
