// Emergency siren generated with the Web Audio API, plus best-effort multilingual speech.
let ctx = null;

export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  } catch {
    return null;
  }
  return ctx;
}

export const audioBlocked = () => !ctx || ctx.state !== 'running';

// Two-tone wail. Returns a stop function.
export function startSiren() {
  const c = unlockAudio();
  if (!c) return () => {};
  try {
    const carrier = c.createOscillator();
    carrier.type = 'sawtooth';
    carrier.frequency.value = 880;
    const lfo = c.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 1.4; // hi-lo alternation
    const depth = c.createGain();
    depth.gain.value = 300;
    lfo.connect(depth).connect(carrier.frequency);
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2400;
    const vol = c.createGain();
    vol.gain.value = 0.18;
    carrier.connect(filter).connect(vol).connect(c.destination);
    carrier.start();
    lfo.start();
    return () => {
      try {
        vol.gain.setTargetAtTime(0, c.currentTime, 0.05);
        carrier.stop(c.currentTime + 0.3);
        lfo.stop(c.currentTime + 0.3);
      } catch { /* already stopped */ }
    };
  } catch {
    return () => {};
  }
}

// Three short low beeps (about 0.9 s): a denial, distinct from the emergency siren.
export function denyBeep() {
  const c = unlockAudio();
  if (!c) return;
  try {
    const vol = c.createGain();
    vol.gain.value = 0;
    vol.connect(c.destination);
    const osc = c.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 440;
    osc.connect(vol);
    const t0 = c.currentTime + 0.02;
    for (let i = 0; i < 3; i++) {
      const t = t0 + i * 0.3;
      vol.gain.setValueAtTime(0.12, t);
      vol.gain.setValueAtTime(0, t + 0.18);
    }
    osc.start(t0);
    osc.stop(t0 + 0.9);
  } catch { /* audio is best effort */ }
}

function voicesReady(synth) {
  const v = synth.getVoices();
  if (v.length) return Promise.resolve(v);
  return new Promise((resolve) => {
    const done = () => resolve(synth.getVoices());
    synth.addEventListener?.('voiceschanged', done, { once: true });
    setTimeout(done, 1200);
  });
}

// Speaks each [lang, text] for which a matching voice exists. English falls back to the default voice.
export async function speak(lines) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const voices = await voicesReady(synth);
    synth.cancel();
    for (const [lang, text] of lines) {
      const prefix = lang.slice(0, 2).toLowerCase();
      const voice = voices.find((v) => v.lang && v.lang.toLowerCase().replace('_', '-') === lang.toLowerCase())
        || voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(prefix));
      if (!voice && prefix !== 'en') continue; // no Hindi/Telugu voice installed: skip silently
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      if (voice) u.voice = voice;
      synth.speak(u);
    }
  } catch {
    /* speech is best effort */
  }
}

export const stopSpeech = () => {
  try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
};
