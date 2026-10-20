import { useEffect, useState } from 'react';
import { api } from '../services/api';
import RefreshButton from '../components/RefreshButton';

const TYPE_LABEL = {
  VIRTUAL_DEPOSIT: '💰 Deposit',
  VIRTUAL_WITHDRAWAL: '💸 Withdrawal',
};

const STATUS_LABEL = {
  PENDING: 'በመጠባበቅ ላይ',
  APPROVED: 'ጸድቋል ✅',
  COMPLETED: 'ተጠናቋል ✅',
  REJECTED: 'ውድቅ ተደርጓል ❌',
};

export default function Transactions({ onBack }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    try {
      const data = await api.myTransactions();
      // this page only shows the player's own deposits and withdrawals
      setRows(data.filter((t) => t.type === 'VIRTUAL_DEPOSIT' || t.type === 'VIRTUAL_WITHDRAWAL'));
      setError(null);
    } catch {
      setError('እንቅስቃሴዎችን መጫን አልተቻለም። እንደገና ይሞክሩ።');
      setRows((r) => r || []);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="app-content">
      <button className="btn-secondary" style={{ width: 'auto', marginBottom: 14, padding: '8px 14px' }} onClick={onBack}>
        ← Wallet
      </button>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h1 className="section-title" style={{ margin: 0 }}>Transactions</h1>
        <RefreshButton size="sm" onRefresh={load} />
      </div>

      {error && <div className="error-text" style={{ margin: '0 0 12px' }}>{error}</div>}
      {rows === null && <p style={{ color: 'var(--color-text-muted)' }}>በመጫን ላይ…</p>}
      {rows && rows.length === 0 && !error && (
        <div className="notice" style={{ textAlign: 'center' }}>ምንም Deposit ወይም Withdrawal እንቅስቃሴ የለም።</div>
      )}

      {rows?.map((tx) => (
        <div key={tx.id} className="ticket-card" style={{ padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontWeight: 600 }}>{TYPE_LABEL[tx.type] || tx.type}</span>
            <span style={{ color: tx.status === 'APPROVED' || tx.status === 'COMPLETED' ? 'var(--color-teal)' : tx.status === 'REJECTED' ? 'var(--color-coral)' : 'var(--color-gold)' }}>
              {STATUS_LABEL[tx.status] || tx.status}
            </span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            {tx.amount} ETB · {new Date(tx.created_at).toLocaleString()}
          </div>
          {tx.reference_note && (
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4, wordBreak: 'break-word' }}>{tx.reference_note}</div>
          )}
        </div>
      ))}
    </div>
  );
}
