import { useEffect, useRef, useState } from 'react';
import { initTelegram, getInitData } from './services/telegram';
import { api, setToken } from './services/api';
import BottomNav from './components/BottomNav';
import RefreshButton from './components/RefreshButton';
import Onboarding from './pages/Onboarding';
import Home from './pages/Home';
import Lobby from './pages/Lobby';
import GameRoom from './pages/GameRoom';
import CardSelect from './pages/CardSelect';
import Wallet from './pages/Wallet';
import Games from './pages/Games';
import Deposit from './pages/Deposit';
import Withdraw from './pages/Withdraw';
import Transactions from './pages/Transactions';
import Profile from './pages/Profile';
import Support from './pages/Support';
import Appointments from './pages/Appointments';
import LudoApp from './ludo/LudoApp';
import DamaApp from './dama/DamaApp';
import GameIcon from './components/GameIcon';
import { launch } from './services/launch';

export default function App() {
  const [booting, setBooting] = useState(true);
  const [needsRegistration, setNeedsRegistration] = useState(false);
  const [telegramProfile, setTelegramProfile] = useState(null);
  const [referralCandidate, setReferralCandidate] = useState(null);
  const [blockedMessage, setBlockedMessage] = useState(null);
  const [profile, setProfile] = useState(null);
  // opened from a bot menu button or a "new ቀጠሮ" notification: ?tab=lobby|wallet|profile|support|appointments
  const [tab, setTab] = useState(() => launch.tab || 'home');
  const [activeRoomCode, setActiveRoomCode] = useState(null);
  const [pickingTier, setPickingTier] = useState(null); // table whose card the player is choosing
  const [lastTier, setLastTier] = useState(null); // table of the game just played (for "Play Again")

  useEffect(() => {
    initTelegram();
    bootstrap();
  }, []);

  async function bootstrap() {
    try {
      const initData = getInitData();
      const result = await api.authWithTelegram(initData);

      if (result.needsRegistration) {
        setTelegramProfile(result.telegramProfile);
        setReferralCandidate(result.referralCandidate);
        setNeedsRegistration(true);
      } else {
        setToken(result.token);
        await refreshProfile();
      }
    } catch (err) {
      if (err.data?.error === 'USERNAME_REQUIRED') {
        setBlockedMessage(err.data.message);
      } else {
        setBlockedMessage('ግንኙነት አልተሳካም። እባክዎ ቆይተው እንደገና ይሞክሩ።');
      }
    } finally {
      setBooting(false);
    }
  }

  async function refreshProfile() {
    const me = await api.me();
    setProfile(me);
  }

  // coming back to the app (e.g. after a "balance updated" message) reloads the wallet automatically
  const lastAutoRefresh = useRef(0);
  useEffect(() => {
    function reloadIfVisible() {
      if (document.visibilityState !== 'visible' || !profile) return;
      const now = Date.now();
      if (now - lastAutoRefresh.current < 3000) return; // visibilitychange + focus often fire together
      lastAutoRefresh.current = now;
      refreshProfile().catch(() => {});
    }
    document.addEventListener('visibilitychange', reloadIfVisible);
    window.addEventListener('focus', reloadIfVisible);
    return () => {
      document.removeEventListener('visibilitychange', reloadIfVisible);
      window.removeEventListener('focus', reloadIfVisible);
    };
  }, [profile]);

  function handleRegistered() {
    setNeedsRegistration(false);
    setTab('home');
    refreshProfile();
  }

  if (booting) {
    return (
      <div className="app-shell">
        <div className="app-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
          <div style={{ color: 'var(--color-text-muted)' }}>KING BINGO በመጫን ላይ…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {!activeRoomCode && tab !== 'ludo' && tab !== 'dama' && (
      <header className="app-header">
        <div className="brand">
          <span className="brand-crown">♛</span> KING BINGO
        </div>
        {profile && !needsRegistration && (
          <div className="credit-chip">
            <GameIcon name="wallet" size={24} />
            <span className="value">{profile.wallet.balance}</span>
            <span className="label">ETB</span>
            <RefreshButton size="sm" onRefresh={refreshProfile} />
          </div>
        )}
      </header>
      )}

      {needsRegistration || blockedMessage ? (
        <Onboarding
          telegramProfile={telegramProfile}
          referralCandidate={referralCandidate}
          blockedMessage={blockedMessage}
          onRegistered={handleRegistered}
        />
      ) : (
        <>
          {activeRoomCode ? (
            <GameRoom
              roomCode={activeRoomCode}
              myUserId5d={profile?.userId5d}
              balance={profile?.wallet?.balance}
              onExit={() => {
                setActiveRoomCode(null);
                refreshProfile();
              }}
              onPlayAgain={() => {
                // straight back to card selection for the same table
                setActiveRoomCode(null);
                refreshProfile();
                if (lastTier) setPickingTier(lastTier);
                else setTab('games');
              }}
              onWalletRefresh={refreshProfile}
            />
          ) : pickingTier ? (
            <CardSelect
              tier={pickingTier}
              wallet={profile?.wallet}
              onBack={() => setPickingTier(null)}
              onJoined={(roomCode) => {
                setLastTier(pickingTier);
                setPickingTier(null);
                setActiveRoomCode(roomCode);
                refreshProfile();
              }}
            />
          ) : (
            <>
              {tab === 'home' && <Home profile={profile} onNavigate={setTab} onRefresh={refreshProfile} />}
              {tab === 'games' && <Games onPlayBingo={() => setTab('lobby')} onPlayLudo={() => setTab('ludo')} onPlayDama={() => setTab('dama')} />}
              {tab === 'ludo' && <LudoApp profile={profile} onExit={() => setTab('games')} onWalletRefresh={refreshProfile} />}
              {tab === 'dama' && <DamaApp profile={profile} onExit={() => setTab('games')} onWalletRefresh={refreshProfile} />}
              {tab === 'lobby' && <Lobby wallet={profile?.wallet} onPickTier={setPickingTier} onBack={() => setTab('games')} />}
              {tab === 'wallet' && <Wallet wallet={profile?.wallet} onRefresh={refreshProfile} onNavigate={setTab} />}
              {tab === 'deposit' && <Deposit onBack={() => setTab('wallet')} onRefresh={refreshProfile} />}
              {tab === 'withdraw' && <Withdraw wallet={profile?.wallet} onBack={() => setTab('wallet')} onRefresh={refreshProfile} />}
              {tab === 'transactions' && <Transactions onBack={() => setTab('wallet')} />}
              {tab === 'profile' && <Profile profile={profile} />}
              {tab === 'support' && <Support />}
              {tab === 'appointments' && <Appointments isAdmin={profile?.isAdmin === true} onBack={() => setTab('home')} />}
              {tab !== 'ludo' && tab !== 'dama' && <BottomNav
                active={tab === 'lobby' ? 'games' : ['deposit', 'withdraw', 'transactions'].includes(tab) ? 'wallet' : tab}
                onChange={setTab}
              />}
            </>
          )}
        </>
      )}
    </div>
  );
}
