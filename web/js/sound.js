// All sounds are synthesized with Web Audio, so there are no files to download.
let ac = null;
let muted = false;
try { muted = localStorage.getItem("bs.muted") === "1"; } catch {}

export const isMuted = () => muted;
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem("bs.muted", m ? "1" : "0"); } catch {}
}

/** Must be called from a user gesture once, to unlock audio on mobile. */
export function unlock() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
  }
  if (ac.state === "suspended") ac.resume();
}

function noise(dur) {
  const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  return src;
}
function env(gain, t, a, peak, dur) {
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + a);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}
function tone(type, f0, f1, dur, peak = 0.2, delay = 0) {
  const t = ac.currentTime + delay;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  env(g, t, 0.005, peak, dur);
  o.connect(g).connect(ac.destination);
  o.start(t); o.stop(t + dur + 0.05);
}
function hiss(dur, type, f0, f1, peak, delay = 0, q = 1) {
  const t = ac.currentTime + delay;
  const n = noise(dur), f = ac.createBiquadFilter(), g = ac.createGain();
  f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  env(g, t, 0.01, peak, dur);
  n.connect(f).connect(g).connect(ac.destination);
  n.start(t); n.stop(t + dur + 0.05);
}

const sounds = {
  flip() {
    for (let i = 0; i < 4; i++) hiss(0.09, "bandpass", 2500, 900, 0.35, i * 0.1, 0.8);
  },
  pen() {
    for (let i = 0; i < 3; i++) hiss(0.08, "highpass", 3500, 5000, 0.12, i * 0.09 + Math.random() * 0.03, 2);
  },
  load() {
    tone("square", 1900, 1200, 0.03, 0.12);
    tone("square", 1300, 700, 0.04, 0.14, 0.08);
  },
  shot() {
    hiss(0.35, "lowpass", 3000, 200, 0.9);
    tone("sine", 140, 40, 0.3, 0.6);
  },
  hit() {
    hiss(0.25, "bandpass", 700, 200, 0.5, 0, 0.7);
  },
  miss() {
    tone("triangle", 220, 140, 0.22, 0.2);
  },
  select() {
    tone("triangle", 660, 880, 0.08, 0.12);
  },
  win() {
    [523, 659, 784, 1047].forEach((f, i) => tone("triangle", f, 0, 0.3, 0.2, i * 0.12));
  },
  lose() {
    [392, 330, 262].forEach((f, i) => tone("triangle", f, 0, 0.35, 0.18, i * 0.16));
  },
};

export function play(name) {
  if (muted || !ac) return;
  try { sounds[name]?.(); } catch {}
}
