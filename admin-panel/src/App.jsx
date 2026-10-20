import { useState } from 'react';
import { isAuthenticated, clearToken, getRole } from './services/api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Users from './pages/Users';
import Transactions from './pages/Transactions';
import Rooms from './pages/Rooms';
import LudoRooms from './pages/LudoRooms';
import DamaRooms from './pages/DamaRooms';
import AuditLogs from './pages/AuditLogs';
import Settings from './pages/Settings';

const NAV = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'users', label: 'Players' },
  { key: 'transactions', label: 'Transactions' },
  { key: 'rooms', label: 'Game Rooms' },
  { key: 'ludo', label: 'King Ludo' },
  { key: 'dama', label: 'King Dama' },
  { key: 'audit', label: 'Audit Logs' },
  { key: 'settings', label: 'Settings' },
];

export default function App() {
  const [authed, setAuthed] = useState(isAuthenticated());
  const isAgent = getRole() === 'agent';
  const [page, setPage] = useState(isAgent ? 'transactions' : 'dashboard');

  if (!authed) {
    return <Login onLoggedIn={() => setAuthed(true)} />;
  }

  function logout() {
    clearToken();
    setAuthed(false);
  }

  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="crown">♛</span> KING BINGO {isAgent ? 'Agent' : 'Admin'}
        </div>
        {(isAgent ? NAV.filter((n) => n.key === 'transactions') : NAV).map((item) => (
          <button key={item.key} className={page === item.key ? 'active' : ''} onClick={() => setPage(item.key)}>
            {item.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={logout}>Log out</button>
      </aside>
      <main className="main">
        {!isAgent && page === 'dashboard' && <Dashboard />}
        {!isAgent && page === 'users' && <Users />}
        {page === 'transactions' && <Transactions />}
        {!isAgent && page === 'rooms' && <Rooms />}
        {!isAgent && page === 'ludo' && <LudoRooms />}
        {!isAgent && page === 'dama' && <DamaRooms />}
        {!isAgent && page === 'audit' && <AuditLogs />}
        {!isAgent && page === 'settings' && <Settings />}
      </main>
    </div>
  );
}
