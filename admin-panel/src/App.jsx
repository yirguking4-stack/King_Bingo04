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
// Admins AND Agents are treated the same way: only the switches the owner turned ON open a page.
const NAV = [
  { key: 'dashboard', label: 'Dashboard', show: (a) => a.owner },
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
  const [page, setPage] = useState(null);
  const [access, setAccess] = useState(null);
  const [accessError, setAccessError] = useState(null);

  // what this person may do - asked again every 15 s and when the tab gets focus, so a switch the owner
  // turns ON / OFF changes the menu without logging in again
  useEffect(() => {
    if (!authed) return undefined;
    let alive = true;
    const load = () =>
      api
        .me()
        .then((a) => {
          if (alive) {
            setAccess(a);
            setAccessError(null);
          }
        })
        .catch((e) => {
          if (alive) setAccessError(e.message);
        });
    load();
    const t = setInterval(load, 15000);
    window.addEventListener('focus', load);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener('focus', load);
    };
  }, [authed]);

  if (!authed) {
    return <Login onLoggedIn={() => setAuthed(true)} />;
  }

  function logout() {
    clearToken();
    setAccess(null);
    setAuthed(false);
  }

  const nav = access ? NAV.filter((n) => n.show(access)) : [];
  const current = nav.some((n) => n.key === page) ? page : nav[0] && nav[0].key;
  const perms = (access && access.permissions) || {};

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
        {!access && <p>{accessError || 'Loading…'}</p>}
        {access && !current && <p>ምንም ፈቃድ አልተሰጠዎትም። ባለቤቱን (Owner) ያነጋግሩ። (No permission has been given to you.)</p>}
        {access && current === 'dashboard' && <Dashboard />}
        {access && current === 'users' && <Users perms={perms} />}
        {access && current === 'transactions' && <Transactions />}
        {access && current === 'rooms' && <Rooms />}
        {access && current === 'ludo' && <LudoRooms />}
        {access && current === 'dama' && <DamaRooms perms={perms} />}
        {access && current === 'audit' && <AuditLogs />}
        {access && current === 'settings' && <Settings />}
        {access && current === 'admins' && <Admins />}
      </main>
    </div>
  );
}
