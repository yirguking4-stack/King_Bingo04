import { useState } from 'react';
import { api, setToken, setRole } from '../services/api';

export default function Login({ onLoggedIn }) {
  const [playerId, setPlayerId] = useState('');
  const [code, setCode] = useState('');
  const [asAgent, setAsAgent] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setError(null);
    if (!playerId.trim() || !code.trim()) {
      setError('Player ID እና ኮድ ሁለቱንም ያስገቡ።');
      return;
    }
    setSubmitting(true);
    try {
      const result = asAgent ? await api.agentLoginCode(playerId.trim(), code.trim()) : await api.adminLoginCode(playerId.trim(), code.trim());
      setToken(result.token);
      setRole(asAgent ? 'agent' : 'admin');
      onLoggedIn(result.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <h1>♛ KING BINGO Admin</h1>
        <p style={{ color: 'var(--admin-muted)', fontSize: 14, marginBottom: 20 }}>
          {asAgent ? 'Player ID እና የ Agent Code ያስገቡ።' : 'Player ID እና Admin Code ያስገቡ።'}
        </p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button className={`btn ${!asAgent ? 'btn-approve' : 'btn-outline'}`} style={{ flex: 1 }} onClick={() => setAsAgent(false)}>Admin</button>
          <button className={`btn ${asAgent ? 'btn-approve' : 'btn-outline'}`} style={{ flex: 1 }} onClick={() => setAsAgent(true)}>Agent</button>
        </div>
        <input
          className="text-input"
          style={{ marginBottom: 10 }}
          placeholder="Player ID (ለምሳሌ 00001)"
          value={playerId}
          onChange={(e) => setPlayerId(e.target.value)}
        />
        <input
          className="text-input"
          style={{ marginBottom: 14 }}
          type="password"
          placeholder={asAgent ? 'Agent Code' : 'Admin Code'}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />

        {error && <p style={{ color: 'var(--admin-danger)', fontSize: 13 }}>{error}</p>}

        <button className="btn btn-approve" style={{ width: '100%', padding: '10px 0' }} disabled={submitting} onClick={submit}>
          {submitting ? 'በመግባት ላይ…' : 'Log in'}
        </button>
      </div>
    </div>
  );
}
