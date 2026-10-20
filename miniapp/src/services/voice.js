/**
 * Voice caller for KING BINGO.
 *
 * 1) Plays small recorded clips that ship with the app (public/audio/en/*.mp3):
 *      "bee ... two". They work on every phone, no phone voice needed.
 *    Optional Amharic recordings (public/audio/am/1.mp3 ... 75.mp3, and B/I/N/G/O/bingo.mp3)
 *    are detected automatically and used instead, clip by clip.
 * 2) If the clips cannot be played, falls back to the phone's text-to-speech, then to a beep.
 *
 * Phones only allow sound after a tap, so unlockAudio()/primeVoice() run from the Join button
 * (and from the very first tap anywhere).
 */
const KEY = 'kb_voice';
const BASE = `${(import.meta.env && import.meta.env.BASE_URL) || '/'}audio`;
const LETTERS = ['B', 'I', 'N', 'G', 'O'];
const LETTER_AM = { B: 'ቢ', I: 'አይ', N: 'ኤን', G: 'ጂ', O: 'ኦ' };

let enabled = true;
try {
  enabled = localStorage.getItem(KEY) !== 'off';
} catch (e) {
  // storage unavailable -> keep default (on)
}

// ---------------------------------------------------------------------------
// Web Audio (recorded clips)
// ---------------------------------------------------------------------------
let audioCtx = null;

function getCtx() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  } catch (e) {
    return null;
  }
}

/** true once the phone has allowed sound. */
export function isVoiceReady() {
  return Boolean(audioCtx && audioCtx.state === 'running');
}

function decode(ctx, data) {
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(data, resolve, reject); // callback form works on old WebViews too
    if (p && p.catch) p.catch(reject);
  });
}

async function fetchClip(ctx, url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') || '';
  if (/text\/html/i.test(type)) throw new Error('not audio');
  return decode(ctx, await res.arrayBuffer());
}

const clips = new Map();
const inflight = new Map();
let amharicProbe = null;

function hasAmharic(ctx) {
  if (!amharicProbe) amharicProbe = fetchClip(ctx, `${BASE}/am/1.mp3`).then(() => true, () => false);
  return amharicProbe;
}

function loadClip(name) {
  if (clips.has(name)) return Promise.resolve(clips.get(name));
  if (inflight.has(name)) return inflight.get(name);
  const ctx = getCtx();
  if (!ctx) return Promise.resolve(null);

  const job = (async () => {
    const langs = (await hasAmharic(ctx)) ? ['am', 'en'] : ['en'];
    for (const lang of langs) {
      try {
        const buf = await fetchClip(ctx, `${BASE}/${lang}/${name}.mp3`);
        clips.set(name, buf);
        return buf;
      } catch (e) {
        // try the next language
      }
    }
    return null;
  })().finally(() => inflight.delete(name));

  inflight.set(name, job);
  return job;
}

let preloadJob = null;

/** Downloads all 81 small clips (about 330 KB) so every call plays instantly. */
export function preloadVoice() {
  if (preloadJob) return preloadJob;
  const names = [...LETTERS, 'bingo'];
  for (let n = 1; n <= 75; n++) names.push(String(n));
  preloadJob = (async () => {
    for (let i = 0; i < names.length; i += 6) {
      await Promise.all(names.slice(i, i + 6).map(loadClip));
    }
  })().catch(() => {
    preloadJob = null;
  });
  return preloadJob;
}

let active = [];

function stopAll() {
  active.forEach((s) => {
    try {
      s.stop();
    } catch (e) {
      // already finished
    }
  });
  active = [];
}

// pause between the letter and the number: "B ... 10" (seconds)
const GAP_SECONDS = 0.7;

function playSequence(buffers) {
  const ctx = getCtx();
  if (!ctx) return false;
  stopAll();
  let t = ctx.currentTime + 0.05;
  for (const buf of buffers) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(t);
    active.push(src);
    t += buf.duration + GAP_SECONDS;
  }
  return true;
}

/** Unlocks sound + starts loading the clips. Safe to call many times. */
export function unlockAudio() {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const blip = ctx.createBufferSource();
    blip.buffer = ctx.createBuffer(1, 1, 22050); // one silent sample: tells the phone "sound is wanted"
    blip.connect(ctx.destination);
    blip.start(0);
  } catch (e) {
    // ignore
  }
  preloadVoice();
}

// the very first tap anywhere in the app also unlocks sound
if (typeof document !== 'undefined') {
  const events = ['pointerdown', 'touchend', 'click'];
  const unlock = () => {
    unlockAudio();
    if (isVoiceReady()) events.forEach((ev) => document.removeEventListener(ev, unlock));
  };
  events.forEach((ev) => document.addEventListener(ev, unlock, { passive: true }));
}

// ---------------------------------------------------------------------------
// Fallback: the phone's own text-to-speech, then a beep
// ---------------------------------------------------------------------------
const synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
let voices = [];

function loadVoices() {
  if (synth) voices = synth.getVoices() || [];
}
if (synth) {
  loadVoices();
  if (synth.addEventListener) synth.addEventListener('voiceschanged', loadVoices);
}

function findVoice(prefix) {
  return voices.find((v) => String(v.lang || '').toLowerCase().replace('_', '-').startsWith(prefix));
}

function beep() {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 660;
    gain.gain.value = 0.2;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
  } catch (e) {
    // ignore
  }
}

function say(text, voice, lang, keepQueue = false) {
  const u = new SpeechSynthesisUtterance(text);
  if (voice) {
    u.voice = voice;
    u.lang = voice.lang;
  } else {
    u.lang = lang;
  }
  u.rate = 0.75; // calm
  u.pitch = 1.1; // feminine, clear
  if (!keepQueue) synth.cancel();
  synth.speak(u);
}

/** Says the letter, then (after a pause) the number: "B ... 10". */
function sayLetterNumber(letterText, numberText, voice, lang) {
  say(letterText, voice, lang);
  setTimeout(() => say(numberText, voice, lang, true), 700);
}

function fallbackSpeak(call) {
  if (!synth || voices.length === 0) {
    loadVoices();
    if (!synth || voices.length === 0) {
      beep();
      if (!synth) return;
    }
  }
  const am = findVoice('am');
  if (am) {
    sayLetterNumber(LETTER_AM[call.letter] || call.letter, String(call.spokenNumber), am);
  } else {
    sayLetterNumber(call.letter, String(call.number), findVoice('en'), 'en-US');
  }
}

function fallbackBingo() {
  if (!synth) {
    beep();
    return;
  }
  const am = findVoice('am');
  if (am) say('ቢንጎ!', am);
  else say('Bingo!', findVoice('en'), 'en-US');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export function isVoiceOn() {
  return enabled;
}

export function setVoiceOn(on) {
  enabled = Boolean(on);
  try {
    localStorage.setItem(KEY, enabled ? 'on' : 'off');
  } catch (e) {
    // ignore
  }
  if (!enabled) {
    stopAll();
    if (synth) synth.cancel();
  }
}

/** Call from a tap (button) so the phone allows sound later. */
export function primeVoice() {
  unlockAudio();
  if (!synth) return;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    synth.speak(u);
  } catch (e) {
    // ignore
  }
}

/** call = { letter, number, spokenNumber } from the server's number_called event. */
export async function speakCall(call) {
  if (!enabled || !call) return;
  const ctx = getCtx();
  if (ctx && ctx.state === 'running') {
    const [letter, number] = await Promise.all([loadClip(call.letter), loadClip(String(call.number))]);
    if (letter && number && enabled) {
      playSequence([letter, number]);
      return;
    }
  }
  fallbackSpeak(call);
}

export async function speakBingo() {
  if (!enabled) return;
  const ctx = getCtx();
  if (ctx && ctx.state === 'running') {
    const clip = await loadClip('bingo');
    if (clip && enabled) {
      playSequence([clip]);
      return;
    }
  }
  fallbackBingo();
}

/** Plays "B, two" so the player can check the sound is on. */
export function speakTest() {
  return speakCall({ letter: 'B', number: 2, spokenNumber: 'ሁለት' });
}
