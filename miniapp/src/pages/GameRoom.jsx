import GameIcon from '../components/GameIcon';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api';
import { useGameSocket } from '../services/ws';
import { hapticImpact, hapticSuccess, hapticError, closeApp } from '../services/telegram';
import { speakCall, speakBingo, isVoiceOn, setVoiceOn, primeVoice, isVoiceReady, speakTest } from '../services/voice';
import WinnerScreen from '../components/WinnerScreen';
import BingoCard from '../components/BingoCard';
import PatternGuide from '../components/PatternGuide';
import RefreshButton from '../components/RefreshButton';

function letterOf(n) {
  if (n <= 15) return 'B';
  if (n <= 30) return 'I';
  if (n <= 45) return 'N';
  if (n <= 60) return 'G';
  return 'O';
}

export default function GameRoom({ roomCode, balance, myUserId5d, onExit, onPlayAgain, onWalletRefresh }) {
  const { connected, send } = useGameSocket((evt) => handleEvent(evt));
  const [card, setCard] = useState(null);
  const [cardId, setCardId] = useState(null);
  const [marked, setMarked] = useState([]);
  const [calledNumbers, setCalledNumbers] = useState([]);
  const [currentCall, setCurrentCall] = useState(null);
  const [status, setStatus] = useState('WAITING');
  const [waitingSecondsLeft, setWaitingSecondsLeft] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [players, setPlayers] = useState([]);
  const [potTotal, setPotTotal] = useState(0);
  const [result, setResult] = useState(null); // end-of-game screen data
  const [voiceOn, setVoiceOnState] = useState(isVoiceOn());
  const [voiceReady, setVoiceReady] = useState(isVoiceReady());
  const [claimMsg, setClaimMsg] = useState(null);
  const [timeoutMsg, setTimeoutMsg] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [stake, setStake] = useState(null);
  const [playerCount, setPlayerCount] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState('');
  const [chatError, setChatError] = useState(null);
  const chatEndRef = useRef(null);

  // shows a "tap to enable voice" button if the phone has not allowed sound yet
  useEffect(() => {
    const id = setInterval(() => setVoiceReady(isVoiceReady()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [chatMessages]);

  function sendChat() {
    const text = chatText.trim();
    if (!text) return;
    send('chat_message', { text });
    setChatText('');
  }

  function loadRoomState() {
    return api.roomState(roomCode).then((data) => {
      setCard(data.myEntry?.card_numbers || null);
      setCardId(data.myEntry?.card_id ?? null);
      setMarked(data.myEntry?.marked_numbers || []);
      setCalledNumbers(data.room.called_numbers || []);
      setStatus(data.room.status);
      setPotTotal(data.room.pot_total);
      setStake(data.stake ?? null);
      if (data.playerCount != null) setPlayerCount(data.playerCount);
    });
  }

  useEffect(() => {
    loadRoomState();
  }, [roomCode]); // eslint-disable-line react-hooks/exhaustive-deps

  async function refreshAll() {
    setRefreshing(true);
    try {
      await loadRoomState();
      if (connected) send('join_room', { roomCode }); // re-sync player list + room state
      onWalletRefresh?.();
    } catch (e) {
      /* ignore, user can tap again */
    } finally {
      setTimeout(() => setRefreshing(false), 500);
    }
  }

  useEffect(() => {
    if (connected) send('join_room', { roomCode });
  }, [connected, roomCode, send]);

  function handleEvent(evt) {
    const { type, payload } = evt;

    switch (type) {
      case 'room_state':
        setStatus(payload.status);
        setPotTotal(payload.pot_total);
        setCalledNumbers(payload.called_numbers || []);
        break;
      case 'chat_history':
        setChatMessages(payload.messages || []);
        break;
      case 'chat':
        setChatMessages((prev) => [...prev, payload].slice(-50));
        break;
      case 'chat_error':
        setChatError(payload.message);
        setTimeout(() => setChatError(null), 2000);
        break;
      case 'player_list':
        setPlayers(payload.players);
        setPlayerCount(payload.players.length);
        break;
      case 'player_joined':
        setPotTotal(payload.potTotal);
        if (payload.playerCount != null) setPlayerCount(payload.playerCount);
        hapticImpact('light');
        break;

      case 'waiting_started':
        setStatus('WAITING');
        setWaitingSecondsLeft(payload.secondsLeft);
        break;
      case 'waiting_tick':
        setWaitingSecondsLeft(payload.secondsLeft);
        break;
      case 'waiting_timeout':
        setTimeoutMsg('ተጫዋች ስላልተገኘ ጨዋታው ተሰርዟል። ያስገቡት መጠን ወደ ዋሌትዎ ተመልሷል።');
        hapticError();
        onWalletRefresh?.();
        setTimeout(() => onExit?.(), 2500);
        break;

      case 'countdown_started':
        setStatus('COUNTDOWN');
        setWaitingSecondsLeft(null);
        setCountdown(payload.secondsLeft);
        break;
      case 'countdown_tick':
        setCountdown(payload.secondsLeft);
        break;
      case 'game_started':
        setStatus('IN_PROGRESS');
        setCountdown(null);
        break;

      case 'number_called':
        setCurrentCall(payload);
        setCalledNumbers(payload.calledNumbers);
        hapticImpact('light');
        speakCall(payload);
        break;
      case 'winner_declared':
        setResult({ kind: 'winner', ...payload });
        speakBingo();
        hapticSuccess();
        onWalletRefresh?.();
        break;
      case 'game_ended':
        setStatus('FINISHED');
        // winner_declared normally arrives first; this is the fallback (or the "no winner" case)
        setResult((prev) => prev || (payload.cardId != null ? { kind: 'winner', ...payload } : { kind: 'nowinner' }));
        onWalletRefresh?.();
        break;
      case 'claim_result':
        if (payload.valid) {
          setClaimMsg('🎉 BINGO confirmed! Prize added to your wallet.');
        } else {
          setClaimMsg(`Not yet: ${payload.reason}`);
          hapticError();
        }
        break;
      default:
        break;
    }
  }

  const calledSet = useMemo(() => new Set(calledNumbers), [calledNumbers]);

  function toggleMark(num) {
    if (marked.includes(num)) return;
    const updated = [...marked, num];
    setMarked(updated);
    send('mark_number', { number: num });
  }

  function claimBingo() {
    send('claim_bingo', { markedNumbers: marked });
  }

  if (timeoutMsg) {
    return (
      <div className="app-content">
        <div className="notice" style={{ textAlign: 'center' }}>{timeoutMsg}</div>
      </div>
    );
  }

  const recent = calledNumbers.slice().reverse().slice(0, 14);
  while (recent.length < 14) recent.push(null);

  return (
    <div className="gr-root">
      {/* top bar */}
      <div className="gr-top">
        <button className="gr-back" onClick={onExit} disabled={status === 'WAITING' || status === 'COUNTDOWN'} style={status === 'WAITING' || status === 'COUNTDOWN' ? { visibility: 'hidden' } : undefined}>← Back</button>
        <div className="gr-title"><span className="gr-crown">♛</span>KING BINGO</div>
        <div className="gr-credit">
          <GameIcon name="wallet" size={20} style={{ verticalAlign: 'middle', marginRight: 4 }} />{balance ?? 0} ETB
          <RefreshButton size="sm" onRefresh={onWalletRefresh} />
        </div>
      </div>

      {/* info rows */}
      <div className="gr-info">
        <div className="gr-info-row">
          <span className="gr-gameid">#Game_id: {roomCode}</span>
          <span className="gr-info-item">👥 {playerCount ?? players.length}:Player</span>
          <button
            className="gr-tool"
            onClick={() => {
              const next = !voiceOn;
              setVoiceOn(next);
              setVoiceOnState(next);
              if (next) {
                primeVoice();
                setTimeout(() => speakTest(), 400);
              }
            }}
          >
            {voiceOn ? '🔊 Sound' : '🔇 Sound'}
          </button>
        </div>
        <div className="gr-info-row">
          <span className="gr-info-item">#Stake: {stake ?? '—'}</span>
          <span className="gr-info-item">💰 Win: {potTotal}</span>
          <button className="gr-tool" onClick={refreshAll} disabled={refreshing}>
            <span className={refreshing ? 'spin' : ''}>🔄</span> Refresh
          </button>
        </div>
      </div>

      {voiceOn && !voiceReady && (
        <button
          className="gr-tapvoice"
          onClick={() => {
            primeVoice();
            setTimeout(() => {
              setVoiceReady(isVoiceReady());
              speakTest();
            }, 400);
          }}
        >
          🔊 ድምፁን ለማብራት እዚህ ይንኩ
        </button>
      )}

      {status === 'WAITING' && waitingSecondsLeft != null && (
        <div className="gr-notice">⏳ ሌላ ተጫዋች በመጠበቅ ላይ… {waitingSecondsLeft}s</div>
      )}
      {status === 'COUNTDOWN' && countdown != null && (
        <div className="gr-notice">🎮 ጨዋታው በ {countdown}s ውስጥ ይጀምራል</div>
      )}

      {/* called numbers */}
      <div className="gr-called">
        <div className="gr-called-grid">
          {recent.map((n, idx) => (
            <div key={idx} className={`gr-called-cell ${idx === 0 && n ? 'newest' : ''}`}>
              {n ? `${letterOf(n)}${n}` : ''}
            </div>
          ))}
        </div>
      </div>

      {/* current call + winning patterns */}
      <div className="gr-mid">
        <div className="gr-current">
          <div className="gr-current-label">Current Call</div>
          <div className="gr-ball" key={currentCall ? `${currentCall.letter}${currentCall.number}` : 'none'}>
            {currentCall ? `${currentCall.letter}-${currentCall.number}` : '—'}
          </div>
          <div className="gr-count">{calledNumbers.length}/75</div>
        </div>
        <PatternGuide />
      </div>

      {/* card (left) + chat (right) */}
      <div className="gr-cardlabel">Your Card: #{cardId ?? '—'}</div>
      <div className="gr-bottom">
        <div className="gr-cardcol">
          <BingoCard card={card} marked={marked} calledSet={calledSet} onToggle={toggleMark} />
          {claimMsg && <div className="gr-notice" style={{ marginTop: 8 }}>{claimMsg}</div>}
          <button className="gr-bingo" disabled={status !== 'IN_PROGRESS'} onClick={claimBingo}>
            BINGO!
          </button>
        </div>

        <div className="gr-chat">
          <div className="gr-chat-list">
            {chatMessages.length === 0 && <div className="gr-chat-empty">ውይይት የለም</div>}
            {chatMessages.map((m) => (
              <div key={m.id} className="gr-chat-msg">
                <b className={m.userId5d === myUserId5d ? 'me' : ''}>@{m.username}:</b> {m.text}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          {chatError && <div className="gr-chat-err">{chatError}</div>}
          {chatOpen && (
            <div className="gr-chat-input">
              <input
                maxLength={60}
                placeholder="መልዕክት…"
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendChat()}
              />
              <button onClick={sendChat} aria-label="Send">➤</button>
            </div>
          )}
          <button className="gr-chat-btn" onClick={() => setChatOpen((v) => !v)}>
            💬 chat
          </button>
        </div>
      </div>

      <style>{`
        .gr-root { padding: 8px 10px 14px; max-width: 520px; margin: 0 auto; }
        .gr-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
        .gr-back { background: none; border: none; color: var(--color-text); font-weight: 700; font-size: 14px; padding: 6px 4px; }
        .gr-title { font-family: var(--font-display); font-weight: 800; font-size: 19px; letter-spacing: .5px; color: var(--color-text); }
        .gr-crown { color: var(--color-gold); margin-right: 5px; }
        .gr-credit { color: var(--color-gold-soft); font-weight: 800; font-size: 13px; white-space: nowrap; display: flex; align-items: center; gap: 6px; }
        .gr-info { margin: 8px 0; padding: 6px 8px; background: var(--color-bg-card); border: 1px solid var(--color-border); border-radius: 12px; }
        .gr-info-row { display: flex; justify-content: space-between; align-items: center; gap: 6px; padding: 3px 0; font-weight: 700; font-size: 13px; }
        .gr-gameid { color: #38d6e6; }
        .gr-info-item { white-space: nowrap; }
        .gr-tool { background: none; border: none; color: var(--color-text); font-weight: 700; font-size: 13px; padding: 0; }
        .gr-tool .spin { display: inline-block; animation: grspin .8s linear infinite; }
        @keyframes grspin { to { transform: rotate(360deg); } }
        .gr-notice { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: 10px; padding: 6px 10px; font-size: 12px; text-align: center; margin-bottom: 8px; }
        .gr-tapvoice { width: 100%; background: var(--color-bg-elevated); border: 1px solid var(--color-teal); color: var(--color-teal); border-radius: 10px; padding: 7px; font-size: 12px; margin-bottom: 8px; }
        .gr-called { border: 1px solid var(--color-border); background: var(--color-bg-card); padding: 4px; }
        .gr-called-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
        .gr-called-cell { background: #1b2530; border-radius: 6px; text-align: center; font-weight: 800; font-size: 13px; min-height: 28px; line-height: 28px; }
        .gr-called-cell.newest { background: var(--color-gold); color: #23190a; }
        .gr-mid { display: flex; align-items: center; gap: 10px; margin: 10px 0 4px; }
        .gr-current { text-align: center; flex: 0 0 31%; }
        .gr-current-label { font-size: 14px; font-weight: 700; margin-bottom: 6px; }
        .gr-ball {
          width: 80px; height: 80px; margin: 0 auto; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-family: var(--font-display); font-weight: 800; font-size: 25px; color: #fff;
          text-shadow: 0 2px 4px rgba(0,0,0,.45);
          border: 3px solid #fff;
          background: radial-gradient(circle at 32% 28%, #ffd35a 0%, #ff7a2f 38%, #e5195e 72%, #7b1fa2 100%);
          box-shadow: 0 0 0 3px rgba(255,255,255,.18), 0 0 20px rgba(255, 90, 80, .65), inset 0 -6px 12px rgba(0,0,0,.25), inset 0 6px 10px rgba(255,255,255,.25);
          animation: gr-pop .45s ease-out;
        }
        @keyframes gr-pop { 0% { transform: scale(.7); } 60% { transform: scale(1.08); } 100% { transform: scale(1); } }
        .gr-count { margin-top: 4px; font-size: 13px; font-weight: 800; color: var(--color-teal); }
        .gr-cardlabel { font-weight: 800; font-size: 16px; margin: 6px 0 4px; text-align: center; }
        .gr-bottom { display: flex; gap: 8px; align-items: stretch; }
        .gr-cardcol { flex: 0 0 64%; min-width: 0; }
        .gr-cardcol .bingo-cell { font-size: 15px !important; }
        .gr-bingo {
          width: 100%; margin-top: 8px; padding: 12px; border: none; border-radius: 12px;
          font-family: var(--font-display); font-weight: 800; font-size: 24px; color: #fff;
          background: linear-gradient(180deg, #c99a1c, #8f6a0f); opacity: .6;
        }
        .gr-bingo:not(:disabled) { opacity: 1; background: linear-gradient(180deg, var(--color-gold-soft), var(--color-gold)); color: #23190a; box-shadow: 0 0 14px rgba(240,180,41,.5); }
        .gr-chat { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--color-bg-card); border: 1px solid var(--color-border); border-radius: 12px; overflow: hidden; }
        .gr-chat-list { flex: 1; min-height: 160px; max-height: 300px; overflow-y: auto; padding: 8px; font-size: 12px; line-height: 1.35; }
        .gr-chat-empty { color: var(--color-text-muted); text-align: center; margin-top: 12px; }
        .gr-chat-msg { margin-bottom: 8px; word-break: break-word; }
        .gr-chat-msg b { color: #9fb4c8; }
        .gr-chat-msg b.me { color: var(--color-gold-soft); }
        .gr-chat-err { color: #ff8a8a; font-size: 11px; padding: 0 8px 4px; }
        .gr-chat-input { display: flex; gap: 4px; padding: 6px; border-top: 1px solid var(--color-border); }
        .gr-chat-input input { flex: 1; min-width: 0; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: 8px; color: var(--color-text); padding: 6px; font-size: 12px; }
        .gr-chat-input button { background: var(--color-gold); border: none; border-radius: 8px; padding: 0 10px; font-size: 14px; }
        .gr-chat-btn { border: none; border-top: 1px solid var(--color-border); background: var(--color-bg-elevated); color: var(--color-text); font-weight: 800; font-size: 15px; padding: 10px; }
      `}</style>

      {result && (
        <WinnerScreen
          result={result}
          isMe={result.kind === 'winner' && cardId != null && Number(result.cardId) === Number(cardId)}
          onPlayAgain={onPlayAgain}
          onExit={() => {
            onExit?.();
            closeApp();
          }}
        />
      )}
    </div>
  );
}
