import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { hapticImpact } from '../services/telegram';

const REFRESH_MS = 5000; // keep the "players online" count feeling live

export default function Lobby({ wallet, onPickTier, onBack }) {
  const [tiers, setTiers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const intervalRef = useRef(null);

  async function load() {
    try {
      const data = await api.stakeTiers();
      setTiers(data);
      setError(null);
    } catch (err) {
      setError('Could not load tables. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    intervalRef.current = setInterval(load, REFRESH_MS);
    return () => clearInterval(intervalRef.current);
  }, []);

  return (
    <div className="app-content">
      {onBack && (
        <button className="btn-secondary" style={{ width: 'auto', marginBottom: 14, padding: '8px 14px' }} onClick={onBack}>
          ← Games
        </button>
      )}
      <h1 className="section-title">Choose a Table</h1>
      {error && <div className="error-text">{error}</div>}
      {loading && <p style={{ color: 'var(--color-text-muted)' }}>Loading tables…</p>}

      {!loading && tiers.length === 0 && !error && (
        <p style={{ color: 'var(--color-text-muted)' }}>No tables available right now.</p>
      )}

      {tiers.map((tier) => {
        const activePlayers = Number(tier.active_players) || 0;
        return (
          <div key={tier.id} className="ticket-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22 }}>
                  {tier.entry_credits} <span style={{ fontSize: 13, color: 'var(--color-teal)' }}>ETB</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: activePlayers > 0 ? 'var(--color-teal)' : 'var(--color-border)',
                    }}
                  />
                  {activePlayers > 0 ? `${activePlayers} player${activePlayers > 1 ? 's' : ''} playing now` : 'No players yet'}
                </div>
              </div>
              <button
                className="btn-primary"
                style={{ width: 'auto', padding: '10px 20px' }}
                onClick={() => {
                  hapticImpact('medium');
                  onPickTier(tier);
                }}
              >
                Join
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
