import { useEffect, useState } from 'react';
import { api, isAuthenticated, clearToken, getRole } from './services/api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Users from './pages/Users';
import Transactions from './pages/Transactions';
import Rooms from './pages/Rooms';
import LudoRooms from './pages/LudoRooms';
import DamaRooms from './pages/DamaRooms';
import AuditLogs from './pages/AuditLogs';
import Settings from './pages/Settings';
import Admins from './pages/Admins';

// `show(access)` decides who sees the page. access = { owner, permissions: { adjust, suspend, approve, games, audit, settings } }
const NAV = [
  { key: 'dashboard', label: 'Dashboard', show: () => true },
  { key: 'users', label: 'Players', show: (a) => a.permissions.adjust || a.permissions.suspend },
  { key: 'transactions', label: 'Transactions', show: (a) => a.permissions.approve },
  { key: 'rooms', label: 'King Bingo', show: (a) => a.permissions.games },
  { key: 'ludo', label: 'King Ludo', show: (a) => a.permissions.games },
  { key: 'dama', label: 'King Dama', show: (a) => a.permissions.games },
  { key: 'audit', label: 'Audit Logs', show: (a) => a.permissions.audit },
  { key: 'settings', label: 'Settings', show: (a) => a.permissions.settings },
  { key: 'admins', label: 'Admins', show: (a) => a.owner },
];

export default function App() {
  const [authed, setAuthed] = useState(isAuthenticated());
  const isAgent = getRole() === 'agent';
  const [page, setPage] = useState(isAgent ? 'transactions' : 'dashboard');
  const [access, setAccess] = useState(null);
  const [accessError, setAccessError] = useState(null);

  // what this admin may do (agents only ever get the Transactions page)
  useEffect(() => {
    if (!authed || isAgent) return;
    api.me().then(setAccess).catch((e) => setAccessError(e.message));
  }, [authed, isAgent]);

  if (!authed) {
    return <Login onLoggedIn={() => setAuthed(true)} />;
  }

  function logout() {
    clearToken();
    setAccess(null);
    setAuthed(false);
  }

  const effective = isAgent ? { owner: false, permissions: { approve: true } } : access;
  const nav = effective ? (isAgent ? NAV.filter((n) => n.key === 'transactions') : NAV.filter((n) => n.show(effective))) : [];
  const current = nav.some((n) => n.key === page) ? page : nav[0] && nav[0].key;
  const perms = (effective && effective.permissions) || {};

  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="crown">♛</span> KING BINGO {isAgent ? 'Agent' : 'Admin'}
        </div>
        {nav.map((item) => (
          <button key={item.key} className={current === item.key ? 'active' : ''} onClick={() => setPage(item.key)}>
            {item.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={logout}>Log out</button>
      </aside>
      <main className="main">
        {!effective && <p>{accessError || 'Loading…'}</p>}
        {effective && current === 'dashboard' && <Dashboard />}
        {effective && current === 'users' && <Users perms={perms} />}
        {effective && current === 'transactions' && <Transactions />}
        {effective && current === 'rooms' && <Rooms />}
        {effective && current === 'ludo' && <LudoRooms />}
        {effective && current === 'dama' && <DamaRooms perms={perms} />}
        {effective && current === 'audit' && <AuditLogs />}
        {effective && current === 'settings' && <Settings />}
        {effective && current === 'admins' && <Admins />}
      </main>
    </div>
  );
}
