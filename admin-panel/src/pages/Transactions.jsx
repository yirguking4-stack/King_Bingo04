import { useEffect, useState } from 'react';
import { api } from '../services/api';

export default function Transactions() {
  const [txs, setTxs] = useState([]);
  const [statusFilter, setStatusFilter] = useState('PENDING');
  const [proofUrl, setProofUrl] = useState(null);

  async function viewProof(id) {
    try {
      setProofUrl(await api.depositProof(id));
    } catch (e) {
      alert('Screenshot could not be loaded');
    }
  }

  function load() {
    api.transactions(statusFilter || undefined).then(setTxs);
  }

  // refresh every 15s so new deposit requests show up without reloading
  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function review(id, decision) {
    await api.reviewTransaction(id, decision);
    load();
  }

  return (
    <div>
      <h1 className="page-title">Deposit / Withdrawal Requests</h1>

      <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
        {['PENDING', 'APPROVED', 'REJECTED', ''].map((s) => (
          <button
            key={s || 'ALL'}
            className={`btn ${statusFilter === s ? 'btn-approve' : 'btn-outline'}`}
            onClick={() => setStatusFilter(s)}
          >
            {s || 'ALL'}
          </button>
        ))}
      </div>

      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>Type</th>
            <th>Amount</th>
            <th>Sender No</th>
            <th>Paid to</th>
            <th>Transaction ID</th>
            <th>Note</th>
            <th>Status</th>
            <th>Requested</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {txs.map((tx) => (
            <tr key={tx.id}>
              <td>
                {tx.user_id_5d} · @{tx.username}
              </td>
              <td>{tx.type.replace(/_/g, ' ')}</td>
              <td>{tx.amount}</td>
              <td>{tx.sender_phone || '—'}</td>
              <td>{tx.pay_method ? `${tx.pay_method === 'CBE' ? 'CBE' : 'Telebirr'}${'pay_agent_username' in tx ? (tx.pay_agent_username ? ` · Agent @${tx.pay_agent_username}` : ' · Admin') : ''}` : '—'}</td>
              <td style={{ fontFamily: 'monospace' }}>
                {tx.payment_reference || '—'}
                {tx.has_proof && (
                  <div>
                    <button className="btn btn-outline" style={{ marginTop: 4 }} onClick={() => viewProof(tx.id)}>
                      📎 Screenshot
                    </button>
                  </div>
                )}
              </td>
              <td>{tx.payment_reference ? '—' : tx.reference_note || '—'}</td>
              <td>
                <span className={`badge ${tx.status.toLowerCase()}`}>{tx.status}</span>
              </td>
              <td>{new Date(tx.created_at).toLocaleString()}</td>
              <td>
                {tx.status === 'PENDING' && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-approve" onClick={() => review(tx.id, 'APPROVED')}>
                      Approve
                    </button>
                    <button className="btn btn-reject" onClick={() => review(tx.id, 'REJECTED')}>
                      Reject
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {proofUrl && (
        <div
          onClick={() => setProofUrl(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, cursor: 'zoom-out' }}
        >
          <img src={proofUrl} alt="Payment screenshot" style={{ maxWidth: '92vw', maxHeight: '92vh', borderRadius: 8 }} />
        </div>
      )}
    </div>
  );
}
