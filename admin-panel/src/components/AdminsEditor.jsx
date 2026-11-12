import { useEffect, useState } from 'react';
import { api } from '../services/api';

const inputStyle = { flex: 1, minWidth: 140, padding: 8, border: '1px solid var(--admin-border)', borderRadius: 8 };

// the six switches, in the order the owner sees them
export const PERMISSION_LIST = [
  { key: 'adjust', icon: '👤', label: 'Adjust', hint: 'Add / subtract a player’s balance' },
  { key: 'suspend', icon: '⛔', label: 'Suspend', hint: 'Block / unblock players' },
  { key: 'approve', icon: '✅', label: 'Approve / Reject', hint: 'Handle deposit and withdrawal requests' },
  { key: 'games', icon: '🎮', label: 'See Games Status', hint: 'View King Bingo, King Ludo and King Dama status and history' },
  { key: 'audit', icon: '📄', label: 'Audit Logs', hint: 'Read all logs' },
  { key: 'settings', icon: '⚙️', label: 'Settings', hint: 'All Settings: Telebirr / CBE, agents, menu picture, Dama configuration' },
];

const NONE = { adjust: false, suspend: false, approve: false, games: false, audit: false, settings: false };

function Switch({ checked, onChange, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} className={`perm-switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="perm-knob" />
    </button>
  );
}

function PermissionList({ value, onChange, disabled }) {
  return (
    <div className="perm-list">
      {PERMISSION_LIST.map((p) => (
        <div key={p.key} className="perm-row">
          <span className="perm-icon">{p.icon}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontWeight: 600 }}>{p.label}</span>
            <span style={{ display: 'block', fontSize: 12, color: 'var(--admin-muted)' }}>{p.hint}</span>
          </span>
          <Switch checked={value[p.key] === true} disabled={disabled} onChange={(v) => onChange({ ...value, [p.key]: v })} />
        </div>
      ))}
    </div>
  );
}

// shown ONCE after creating an admin / resetting his code: the server keeps only a hash
function CodeBox({ info, onClose }) {
  if (!info) return null;
  return (
    <div className="stat-card" style={{ maxWidth: 560, marginBottom: 12, border: '2px solid #1e8e3e' }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Personal admin code — @{info.username} (Player ID {info.userId5d})</div>
      <div style={{ fontFamily: 'monospace', fontSize: 26, letterSpacing: 3, margin: '8px 0' }}>{info.code}</div>
      <div style={{ fontSize: 13, color: 'var(--admin-muted)' }}>
        Send this code to him privately NOW — it cannot be shown again (use “New code” to replace it). He logs in on the “Admin” tab with his
        Player ID + this code. The shared admin code does not work for him.
      </div>
      <button className="btn btn-outline" style={{ marginTop: 10 }} onClick={onClose}>I saved it</button>
    </div>
  );
}

function AdminCard({ admin, onChanged, onCode, onError }) {
  const [perms, setPerms] = useState(admin.permissions);
  const changed = JSON.stringify(perms) !== JSON.stringify(admin.permissions);

  useEffect(() => setPerms(admin.permissions), [admin]);

  async function save() {
    try {
      await api.updateAdmin(admin.userId, perms);
      onError(null);
      onChanged();
    } catch (e) {
      onError(e.message);
    }
  }
  async function newCode() {
    if (!window.confirm(`Create a new personal code for @${admin.username}? The old code stops working.`)) return;
    try {
      const r = await api.resetAdminCode(admin.userId);
      onCode({ ...admin, code: r.code });
    } catch (e) {
      onError(e.message);
    }
  }
  async function remove() {
    if (!window.confirm(`Remove @${admin.username} as admin? He loses all admin access immediately.`)) return;
    try {
      await api.deleteAdmin(admin.userId);
      onError(null);
      onChanged();
    } catch (e) {
      onError(e.message);
    }
  }

  return (
    <div style={{ borderTop: '1px solid var(--admin-border)', padding: '12px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <strong>@{admin.username}</strong>
        <span style={{ color: 'var(--admin-muted)', fontSize: 13 }}>Player ID {admin.userId5d}</span>
        {admin.status !== 'ACTIVE' && <span className="badge suspended">{admin.status}</span>}
      </div>
      <PermissionList value={perms} onChange={setPerms} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        <button className="btn btn-approve" disabled={!changed} onClick={save}>Save changes</button>
        <button className="btn btn-outline" onClick={newCode}>New code</button>
        <button className="btn btn-outline" onClick={remove}>Remove admin</button>
      </div>
    </div>
  );
}

export default function AdminsEditor() {
  const [admins, setAdmins] = useState([]);
  const [playerId, setPlayerId] = useState('');
  const [username, setUsername] = useState('');
  const [perms, setPerms] = useState(NONE);
  const [codeInfo, setCodeInfo] = useState(null);
  const [error, setError] = useState(null);

  function load() {
    api.admins().then(setAdmins).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function add() {
    try {
      const r = await api.addAdmin(playerId.trim(), username.trim(), perms);
      setPlayerId('');
      setUsername('');
      setPerms(NONE);
      setError(null);
      setCodeInfo({ ...r.admin, code: r.code });
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="stat-card" style={{ maxWidth: 680, marginBottom: 12 }}>
      <p style={{ color: 'var(--admin-muted)', fontSize: 14, marginTop: 0 }}>
        Give another person admin access and choose <b>exactly</b> what he may do. Anything you leave <b>off</b> is blocked everywhere — in this
        panel, in the server and in the Telegram Approve / Reject buttons — and you can change the switches or remove him at any time (it takes
        effect immediately). Only you (the owner) can see and use this page.
      </p>

      <CodeBox info={codeInfo} onClose={() => setCodeInfo(null)} />

      {admins.length === 0 && <div style={{ color: 'var(--admin-muted)', fontSize: 14, marginBottom: 8 }}>No limited admins yet.</div>}
      {admins.map((a) => (
        <AdminCard key={a.userId} admin={a} onChanged={load} onCode={setCodeInfo} onError={setError} />
      ))}

      <div style={{ borderTop: '1px solid var(--admin-border)', paddingTop: 12, marginTop: 4 }}>
        <div className="stat-label" style={{ marginBottom: 8 }}>Add an admin — Player ID + @username (must belong to the same player)</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <input style={inputStyle} placeholder="Player ID (e.g. 00005)" inputMode="numeric" maxLength={5} value={playerId} onChange={(e) => setPlayerId(e.target.value.replace(/[^0-9]/g, ''))} />
          <input style={inputStyle} placeholder="@username" value={username} onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))} />
        </div>
        <PermissionList value={perms} onChange={setPerms} />
        <button className="btn btn-approve" style={{ marginTop: 10 }} disabled={playerId.length !== 5 || !username.trim()} onClick={add}>Make admin</button>
      </div>
      {error && <div style={{ color: 'crimson', fontSize: 13, marginTop: 10 }}>{error}</div>}
    </div>
  );
}
