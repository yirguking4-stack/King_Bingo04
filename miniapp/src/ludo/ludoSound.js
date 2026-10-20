// Game sounds made with the Web Audio API, so no audio files have to be downloaded.
// The "Sound" button in the room switches them on/off through setMuted().
let ctx = null;
let muted = false;
let noise = null;

function audio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch (e) {
    return null;
  }
}

export function setMuted(m) {
  muted = Boolean(m);
}

/** Phones only allow sound after a touch: the first tap anywhere wakes the audio engine up. */
export function unlockAudio() {
  audio();
}
if (typeof window !== 'undefined') {
  ['pointerdown', 'touchstart', 'click'].forEach((ev) => window.addEventListener(ev, unlockAudio, { passive: true }));
}

function noiseBuffer(c) {
  if (!noise) {
    noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1;
  }
  return noise;
}

// a short burst of filtered noise = one "clack" of dice knocking together
function clack(c, at, vol, freq) {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 1.4;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.035);
  src.connect(bp);
  bp.connect(g);
  g.connect(c.destination);
  src.start(at, Math.random() * 0.5);
  src.stop(at + 0.05);
}

/** Dice rattling in a cup: a rising-and-falling "shhhrrr" with clacks on top. */
export function playRoll(ms = 900) {
  const c = muted ? null : audio();
  if (!c) return;
  try {
    const t0 = c.currentTime;
    const dur = ms / 1000;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    src.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(1500, t0);
    bp.frequency.linearRampToValueAtTime(4200, t0 + dur * 0.5);
    bp.frequency.linearRampToValueAtTime(2000, t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.16, t0 + 0.06);
    g.gain.setValueAtTime(0.16, t0 + dur - 0.2);
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(c.destination);
    src.start(t0);
    src.stop(t0 + dur + 0.05);

    let t = t0 + 0.03;
    let gap = 0.045;
    while (t < t0 + dur - 0.1) {
      clack(c, t, 0.22 + Math.random() * 0.12, 1800 + Math.random() * 2200);
      t += gap;
      gap *= 1.16; // the knocking slows down as the dice settle
    }
  } catch (e) {
    /* sound is optional */
  }
}

function pop(c, at, f0, f1, vol, len) {
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(f0, at);
  o.frequency.exponentialRampToValueAtTime(f1, at + len * 0.8);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  o.connect(g);
  g.connect(c.destination);
  o.start(at);
  o.stop(at + len + 0.02);
}

/** One step of a token: a short wooden "tak". Played once per square. */
export function playStep() {
  const c = muted ? null : audio();
  if (!c) return;
  try {
    const t = c.currentTime;
    pop(c, t, 700, 260, 0.32, 0.09);
    clack(c, t, 0.12, 2600);
  } catch (e) {
    /* sound is optional */
  }
}

/** A token leaves the yard. */
export function playExit() {
  const c = muted ? null : audio();
  if (!c) return;
  try {
    const t = c.currentTime;
    pop(c, t, 420, 900, 0.3, 0.14);
    pop(c, t + 0.07, 640, 1200, 0.22, 0.12);
  } catch (e) {
    /* sound is optional */
  }
}

/** A token is captured and thrown back to the yard. */
export function playCapture() {
  const c = muted ? null : audio();
  if (!c) return;
  try {
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.34);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    o.connect(g);
    g.connect(c.destination);
    o.start(t);
    o.stop(t + 0.4);
    clack(c, t, 0.25, 900);
  } catch (e) {
    /* sound is optional */
  }
}

// a warm "orchestra" note: saw + triangle through a low-pass filter
function tone(c, at, freq, len, vol) {
  const g = c.createGain();
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = Math.min(5000, freq * 4);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(vol, at + 0.03);
  g.gain.setValueAtTime(vol * 0.8, at + Math.max(0.04, len - 0.08));
  g.gain.linearRampToValueAtTime(0.0001, at + len);
  lp.connect(g);
  g.connect(c.destination);
  [['sawtooth', freq, 0.5], ['triangle', freq / 2, 0.7]].forEach(([type, f, k]) => {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const og = c.createGain();
    og.gain.value = k;
    o.connect(og);
    og.connect(lp);
    o.start(at);
    o.stop(at + len + 0.02);
  });
}

// fireworks: a low "boom" followed by a crackle
function firework(c, at) {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 220;
  const g = c.createGain();
  g.gain.setValueAtTime(0.5, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.55);
  src.connect(lp);
  lp.connect(g);
  g.connect(c.destination);
  src.start(at, Math.random() * 0.4);
  src.stop(at + 0.6);
  for (let i = 0; i < 9; i += 1) clack(c, at + 0.12 + i * 0.045 + Math.random() * 0.03, 0.08 + Math.random() * 0.08, 3500 + Math.random() * 3000);
}

/**
 * A token reaches the centre: a classical celebration (the opening theme of Beethoven's
 * "Ode to Joy", public domain) with a fanfare chord and fireworks.
 */
export function playCelebration() {
  const c = muted ? null : audio();
  if (!c) return;
  try {
    const t0 = c.currentTime + 0.02;
    firework(c, t0);
    [261.6, 329.6, 392.0, 523.3].forEach((f) => tone(c, t0, f, 0.5, 0.1)); // fanfare chord
    const beat = 0.2;
    const E = 329.6; const F = 349.2; const G = 392.0; const D = 293.7; const C = 261.6;
    const theme = [[E, 1], [E, 1], [F, 1], [G, 1], [G, 1], [F, 1], [E, 1], [D, 1], [C, 1], [C, 1], [D, 1], [E, 1], [D, 1.5], [C, 0.5]];
    let t = t0 + 0.55;
    theme.forEach(([f, b]) => {
      tone(c, t, f * 2, b * beat * 0.95, 0.13);
      t += b * beat;
    });
    [261.6, 329.6, 392.0, 523.3].forEach((f) => tone(c, t, f, 0.9, 0.1)); // final chord
    firework(c, t0 + 1.1);
    firework(c, t0 + 2.0);
    firework(c, t);
  } catch (e) {
    /* sound is optional */
  }
}
