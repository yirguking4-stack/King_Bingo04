import { useEffect, useState } from 'react';

export function useNow(ms = 250) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** seconds left until a server deadline, using the offset between server and phone clock */
export function secondsLeft(deadline, now, offset) {
  if (!deadline) return null;
  return Math.max(0, Math.ceil((deadline - (now + offset)) / 1000));
}

export function mmss(sec) {
  if (sec == null) return '--:--';
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

export const betLabel = (bet) => (Number(bet) === 0 ? 'Free' : `${Number(bet)} ETB`);

const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

export function Die({ value, mine, rolling, onClick, disabled }) {
  const pips = PIPS[value] || [];
  const Tag = mine ? 'button' : 'div';
  return (
    <Tag
      className={`lu-die${mine ? ' mine' : ''}${rolling ? ' rolling' : ''}${!value && !mine ? ' blank' : ''}`}
      onClick={mine ? onClick : undefined}
      disabled={mine ? disabled : undefined}
      aria-label={mine ? 'Roll dice' : 'Dice'}
    >
      {Array.from({ length: 9 }, (_, i) => (
        <i key={i} className={pips.includes(i) ? 'p' : ''} />
      ))}
    </Tag>
  );
}

// ---- WebAudio sounds (no audio files needed) ----
let ctx = null;
let soundOn = true;
export const setSoundOn = (v) => { soundOn = !!v; };
function ac() {
  ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// one sharp plastic "tak": a very short noise click through a narrow band-pass filter
function tak(c, when, gain, freq) {
  const len = Math.max(1, Math.floor(c.sampleRate * 0.022));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let k = 0; k < len; k += 1) d[k] = (Math.random() * 2 - 1) * Math.pow(1 - k / len, 4);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = 3; // narrow band -> a clear "tik/tak", not a hiss
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(f); f.connect(g); g.connect(c.destination);
  src.start(when);
}

/** dice shaken in a cup: a fast, separate "ትርርርርርር" of clicks that slows down, then two knocks as it lands */
export function playRattle(ms = 800) {
  if (!soundOn) return;
  try {
    const c = ac();
    const t0 = c.currentTime + 0.01;
    const total = ms / 1000;
    let t = 0;
    while (t < total - 0.14) {
      tak(c, t0 + t, 0.5 + Math.random() * 0.25, 2200 + Math.random() * 2400);
      t += 0.02 + (t / total) * 0.04 + Math.random() * 0.01; // clicks drift apart as the dice slow down
    }
    tak(c, t0 + t + 0.02, 0.9, 1200); // dice land: two knocks
    tak(c, t0 + t + 0.13, 0.7, 1500);
  } catch (e) { /* audio is optional */ }
}

/** one step of a token ("ጳ") */
export function playStep() {
  if (!soundOn) return;
  try {
    const c = ac();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(760, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(380, c.currentTime + 0.07);
    g.gain.setValueAtTime(0.28, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.09);
    o.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime + 0.1);
  } catch (e) { /* audio is optional */ }
}

export function playCapture() {
  if (!soundOn) return;
  try {
    const c = ac();
    [330, 220, 150].forEach((f, i) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const t = c.currentTime + i * 0.09;
      g.gain.setValueAtTime(0.16, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      o.connect(g); g.connect(c.destination);
      o.start(t); o.stop(t + 0.13);
    });
  } catch (e) { /* audio is optional */ }
}

/** classical celebration fanfare: rising major arpeggio, then a bright held chord */
export function playWin() {
  if (!soundOn) return;
  try {
    const c = ac();
    const t0 = c.currentTime + 0.02;
    const note = (freq, start, dur, vol, type) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0 + start);
      g.gain.exponentialRampToValueAtTime(vol, t0 + start + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
      o.connect(g); g.connect(c.destination);
      o.start(t0 + start); o.stop(t0 + start + dur + 0.05);
    };
    [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => note(f, k * 0.15, 0.32, 0.22, 'triangle'));
    [523.25, 659.25, 783.99, 1046.5].forEach((f) => note(f, 0.65, 1.2, 0.1, 'sawtooth'));
    note(1318.5, 0.9, 1.0, 0.16, 'triangle');
  } catch (e) { /* audio is optional */ }
}

// kept for older callers
export function blip(freq = 440, ms = 90) {
  if (!soundOn) return;
  try {
    const c = ac();
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.value = freq;
    g.gain.value = 0.08;
    o.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime + ms / 1000);
  } catch (e) { /* audio is optional */ }
}
