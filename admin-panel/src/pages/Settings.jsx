import { useEffect, useState } from 'react';
import { api } from '../services/api';
import MenuBannerEditor from '../components/MenuBannerEditor';
import AgentsEditor from '../components/AgentsEditor';

const inputStyle = { flex: 1, minWidth: 0, padding: 8, border: '1px solid var(--admin-border)', borderRadius: 8 };

function CbeRow({ account, onSaved, onError }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(account.accountName);
  const [number, setNumber] = useState(account.accountNumber);

  async function save() {
    try {
      await api.updateCbeAccount(account.id, name, number);
      setEditing(false);
      onError(null);
      onSaved();
    } catch (err) {
      onError(err.message);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete CBE account "${account.accountName}" (${account.accountNumber})?`)) return;
    try {
      await api.deleteCbeAccount(account.id);
      onError(null);
      onSaved();
    } catch (err) {
      onError(err.message);
    }
  }

  if (!editing) {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--admin-border)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{account.accountName}</div>
          <div style={{ fontSize: 14, color: 'var(--admin-muted)' }}>{account.accountNumber}</div>
        </div>
        <button className="btn btn-outline" onClick={() => setEditing(true)}>Edit</button>
        <button className="btn btn-outline" onClick={remove}>Delete</button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--admin-border)', flexWrap: 'wrap' }}>
      <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Account name" />
      <input
        style={inputStyle}
        value={number}
        inputMode="numeric"
        onChange={(e) => setNumber(e.target.value.replace(/[^0-9]/g, ''))}
        placeholder="Account number"
      />
      <button className="btn btn-outline" onClick={save}>Save</button>
      <button
        className="btn btn-outline"
        onClick={() => {
          setName(account.accountName);
          setNumber(account.accountNumber);
          setEditing(false);
        }}
      >
        Cancel
      </button>
    </div>
  );
}

export default function Settings() {
  const [settings, setSettings] = useState([]);
  const [edits, setEdits] = useState({});

  const [cbe, setCbe] = useState([]);
  const [newName, setNewName] = useState('');
  const [newNumber, setNewNumber] = useState('');
  const [cbeError, setCbeError] = useState(null);

  function load() {
    api.settings().then(setSettings);
  }

  function loadCbe() {
    api.cbeAccounts().then(setCbe).catch((err) => setCbeError(err.message));
  }

  useEffect(() => {
    load();
    loadCbe();
  }, []);

  async function save(key) {
    await api.updateSetting(key, edits[key]);
    load();
  }

  async function addCbe() {
    try {
      await api.addCbeAccount(newName, newNumber);
      setNewName('');
      setNewNumber('');
      setCbeError(null);
      loadCbe();
    } catch (err) {
      setCbeError(err.message);
    }
  }

  return (
    <div>
      <h1 className="page-title">Settings</h1>
      <p style={{ color: 'var(--admin-muted)', fontSize: 14, maxWidth: 480 }}>
        The Telebirr and CBE accounts below are shown to players on the Deposit page (with a Copy button) as
        reference information only. The platform never automates or tracks a real-money transfer against
        them — every ETB request is still reviewed manually under Transactions.
      </p>

      <h2 style={{ marginTop: 20, marginBottom: 8 }}>Agents (deposit / withdrawal handlers)</h2>
      <AgentsEditor />

      <h2 style={{ marginTop: 20, marginBottom: 8 }}>Telegram menu picture</h2>
      <MenuBannerEditor />

      <h2 style={{ marginTop: 20, marginBottom: 8 }}>Payment info</h2>
      {settings.map((s) => (
        <div key={s.key} className="stat-card" style={{ maxWidth: 420, marginBottom: 12 }}>
          <div className="stat-label" style={{ marginBottom: 8 }}>
            {s.key.replace(/_/g, ' ')}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              style={{ flex: 1, padding: 8, border: '1px solid var(--admin-border)', borderRadius: 8 }}
              defaultValue={s.value}
              onChange={(e) => setEdits({ ...edits, [s.key]: e.target.value })}
            />
            <button className="btn btn-outline" onClick={() => save(s.key)}>
              Save
            </button>
          </div>
        </div>
      ))}

      <h2 style={{ marginTop: 28, marginBottom: 8 }}>CBE Accounts</h2>
      <p style={{ color: 'var(--admin-muted)', fontSize: 14, maxWidth: 480, marginTop: 0 }}>
        Add, change or remove CBE accounts. Players see every account listed here on the Deposit page.
      </p>

      <div className="stat-card" style={{ maxWidth: 560, marginBottom: 12 }}>
        {cbe.length === 0 && <div style={{ color: 'var(--admin-muted)', fontSize: 14, marginBottom: 8 }}>No CBE accounts yet.</div>}
        {cbe.map((a) => (
          <CbeRow key={a.id} account={a} onSaved={loadCbe} onError={setCbeError} />
        ))}

        <div style={{ borderTop: '1px solid var(--admin-border)', paddingTop: 12, marginTop: 4 }}>
          <div className="stat-label" style={{ marginBottom: 8 }}>Add CBE account</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input style={inputStyle} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Account name" />
            <input
              style={inputStyle}
              value={newNumber}
              inputMode="numeric"
              onChange={(e) => setNewNumber(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="Account number (e.g. 1000XXXXXXXXX)"
            />
            <button className="btn btn-outline" onClick={addCbe} disabled={!newName.trim() || !newNumber}>
              Add
            </button>
          </div>
        </div>
        {cbeError && <div style={{ color: 'crimson', fontSize: 13, marginTop: 10 }}>{cbeError}</div>}
      </div>
    </div>
  );
}
