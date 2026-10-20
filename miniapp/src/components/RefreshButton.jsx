import { useState } from 'react';
import { hapticImpact } from '../services/telegram';

/**
 * 🔄 button shown next to every balance. Reloads the player's wallet from the server
 * so a fresh balance can be seen without leaving the app.
 */
export default function RefreshButton({ onRefresh, size = 'md' }) {
  const [spinning, setSpinning] = useState(false);

  async function handleClick(e) {
    e.stopPropagation();
    if (spinning || !onRefresh) return;
    setSpinning(true);
    hapticImpact('light');
    try {
      // keep the icon spinning for a moment so the tap always feels acknowledged
      await Promise.all([onRefresh(), new Promise((resolve) => setTimeout(resolve, 600))]);
    } catch {
      /* a failed refresh keeps the old balance on screen */
    } finally {
      setSpinning(false);
    }
  }

  return (
    <button
      type="button"
      className={`refresh-btn${size === 'sm' ? ' sm' : ''}${spinning ? ' spinning' : ''}`}
      onClick={handleClick}
      disabled={spinning}
      aria-label="ቀሪ ሒሳብ አድስ"
      title="Refresh"
    >
      🔄
    </button>
  );
}
