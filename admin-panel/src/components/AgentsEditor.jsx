import { useEffect, useState } from 'react';
import { api } from '../services/api';

const inputStyle = { flex: 1, minWidth: 140, padding: 8, border: '1px solid var(--admin-border)', borderRadius: 8 };

// shown ONCE after creating an agent / resetting his code: the server keeps only a hash
function CodeBox({ info, onClose }) {
  if (!info) return null;
  return (
    <div className="stat-card" style={{ maxWidth: 560, marginBottom: 12, border: '2px solid #1e8e3e' }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Agent access code — @{info.username} (Player ID {info.userId5d})</div>
      <div style={{ fontFamily: 'monospace', fontSize: 26, letterSpacing: 3, margin: '8px 0' }}>{info.code}</div>
      <div style={{ fontSize: 13, color: 'var(--admin-muted)' }}>
        Send this code to the agent privately NOW — it cannot be shown again (use “New code” to replace it). The agent logs in to the
        admin panel with the “Agent” tab: Player ID + this code.
      </div>
      <button className="btn btn-outline" style={{ marginTop: 10 }} onClick={onClose}>I saved it</button>
    </div>
  );
}

function AgentCard({ agent, onChanged, onCode, onError }) {
  const [f, setF] = useState({ ...agent });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    try {
      await api.updateAgent(agent.id, f);
      onError(null);
      onChanged();
    } catch (e) {
      onError(e.message);
    }
  }
  async function newCode() {
    if (!window.confirm(`Create a new access code for @${agent.username}? The old code stops working.`)) return;
    try {
      const r = await api.resetAgentCode(agent.id);
      onCode({ ...agent, code: r.code });
    } catch (e) {
      onError(e.message);
    }
  }
  async function remove() {
    if (!window.confirm(`Remove @${agent.username} as agent? Their pending deposits will wait for an admin.`)) return;
    try {
      await api.deleteAgent(agent.id);
      onChanged();
    } catch (e) {
      onError(e.message);
    }
  }

  return (
    <div style={{ borderTop: '1px solid var(--admin-border)', padding: '12px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <strong>@{agent.username}</strong>
        <span style={{ color: 'var(--admin-muted)', fontSize: 13 }}>Player ID {agent.userId5d}</span>
        <label style={{ marginLeft: 'auto', fontSize: 14 }}>
          <input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} /> Active
        </label>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <input style={inputStyle} placeholder="Telebirr account name" value={f.telebirrName} onChange={(e) => set('telebirrName', e.target.value)} />
        <input style={inputStyle} placeholder="Telebirr phone (09XXXXXXXX)" inputMode="numeric" value={f.telebirrPhone} onChange={(e) => set('telebirrPhone', e.target.value.replace(/[^0-9+]/g, ''))} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <input style={inputStyle} placeholder="CBE account name" value={f.cbeName} onChange={(e) => set('cbeName', e.target.value)} />
        <input style={inputStyle} placeholder="CBE account number (1000…)" inputMode="numeric" value={f.cbeNumber} onChange={(e) => set('cbeNumber', e.target.value.replace(/[^0-9]/g, ''))} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-approve" onClick={save}>Save</button>
        <button className="btn btn-outline" onClick={newCode}>New code</button>
        <button className="btn btn-outline" onClick={remove}>Remove</button>
      </div>
    </div>
  );
}

export default function AgentsEditor() {
  const [agents, setAgents] = useState([]);
  const [playerId, setPlayerId] = useState('');
  const [username, setUsername] = useState('');
  const [codeInfo, setCodeInfo] = useState(null);
  const [error, setError] = useState(null);

  function load() {
    api.agents().then(setAgents).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function add() {
    try {
      const r = await api.addAgent(playerId.trim(), username.trim());
      setPlayerId('');
      setUsername('');
      setError(null);
      setCodeInfo({ ...r.agent, code: r.code });
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function revoke() {
    if (!window.confirm(`Take the agent permission away from @${username.replace(/^@/, '')} (Player ID ${playerId})?`)) return;
    try {
      await api.revokeAgent(playerId.trim(), username.trim());
      setPlayerId('');
      setUsername('');
      setError(null);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="stat-card" style={{ maxWidth: 620, marginBottom: 12 }}>
      <p style={{ color: 'var(--admin-muted)', fontSize: 14, marginTop: 0 }}>
        An agent is a trusted player who may <b>only</b> approve or reject deposit and withdrawal requests: he gets the Telegram alerts with
        <b> ✅ Approve / ❌ Reject</b> buttons right under them and has no other access to the system (the access code below is only needed
        if he also wants to use the Transactions page of this panel). Their Telebirr / CBE account is offered to players on the Deposit page; a deposit sent to an agent’s account is alerted to,
        and approved by, that agent (admins can always approve). Agents cannot approve their own requests.
      </p>

      <CodeBox info={codeInfo} onClose={() => setCodeInfo(null)} />

      {agents.length === 0 && <div style={{ color: 'var(--admin-muted)', fontSize: 14, marginBottom: 8 }}>No agents yet.</div>}
      {agents.map((a) => (
        <AgentCard key={a.id} agent={a} onChanged={load} onCode={setCodeInfo} onError={setError} />
      ))}

      <div style={{ borderTop: '1px solid var(--admin-border)', paddingTop: 12, marginTop: 4 }}>
        <div className="stat-label" style={{ marginBottom: 8 }}>Give / take back the permission — Player ID + @username (must belong to the same player)</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input style={inputStyle} placeholder="Player ID (e.g. 00005)" inputMode="numeric" maxLength={5} value={playerId} onChange={(e) => setPlayerId(e.target.value.replace(/[^0-9]/g, ''))} />
          <input style={inputStyle} placeholder="@username" value={username} onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))} />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <button className="btn btn-approve" disabled={playerId.length !== 5 || !username.trim()} onClick={add}>Give permission</button>
          <button className="btn btn-outline" disabled={playerId.length !== 5 || !username.trim()} onClick={revoke}>Take back</button>
        </div>
      </div>
      {error && <div style={{ color: 'crimson', fontSize: 13, marginTop: 10 }}>{error}</div>}
    </div>
  );
}
