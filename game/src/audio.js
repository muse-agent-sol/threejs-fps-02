// Synthesized sound: no audio files, everything is oscillators and noise.
//
// A port at dusk has a small vocabulary — a rifle crack with a body thump, a
// pistol snap, the clack of a bolt, beeps from the charge. Each is built from
// a noise buffer through band filters plus one or two pitched partials, which
// is enough to tell weapons apart by ear and to feel a hit land. Sounds are
// placed roughly in space: gain falls with distance and a stereo pan follows
// the direction, so a shot down A-main sounds like it came from A-main.

let ctx = null;
let master = null;
let noiseBuffer = null;

export function initAudio() {
  if (ctx !== null) return;
  const AC = window.AudioContext ?? window.webkitAudioContext;
  if (AC === undefined) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  const length = ctx.sampleRate;
  noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
}

export function resumeAudio() {
  if (ctx !== null && ctx.state === 'suspended') void ctx.resume();
}

// A positioned output chain for one sound: gain by distance, pan by side.
function out(distance = 0, pan = 0) {
  if (ctx === null || master === null) return null;
  const gain = ctx.createGain();
  const falloff = 1 / (1 + distance * 0.09);
  gain.gain.value = Math.min(1, falloff);
  let node = gain;
  if (typeof ctx.createStereoPanner === 'function') {
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.85, Math.min(0.85, pan));
    gain.connect(panner);
    node = panner;
  }
  node.connect(master);
  return gain;
}

function noise(destination, { at = 0, dur = 0.1, freq = 1200, q = 0.8, gain = 0.5, type = 'bandpass' } = {}) {
  if (ctx === null || noiseBuffer === null) return;
  const t = ctx.currentTime + at;
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer;
  source.loop = true;
  source.playbackRate.value = 0.7 + Math.random() * 0.6;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const env = ctx.createGain();
  env.gain.setValueAtTime(gain, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + dur);
  source.connect(filter).connect(env).connect(destination);
  source.start(t);
  source.stop(t + dur + 0.05);
}

function tone(destination, { at = 0, dur = 0.1, freq = 440, slide = 0, gain = 0.2, type = 'square' } = {}) {
  if (ctx === null) return;
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide !== 0) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  const env = ctx.createGain();
  env.gain.setValueAtTime(gain, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(env).connect(destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

// One gunshot voice per weapon family: crack + body + a short tail.
const SHOT_SHAPES = {
  kestrel: { crack: 2400, body: 300, dur: 0.13, gain: 0.5 },
  sidekick: { crack: 1900, body: 240, dur: 0.16, gain: 0.62 },
  hornet: { crack: 2600, body: 340, dur: 0.09, gain: 0.4 },
  breach12: { crack: 1200, body: 170, dur: 0.3, gain: 0.85 },
  carbine: { crack: 2100, body: 260, dur: 0.17, gain: 0.6 },
  longbow: { crack: 1500, body: 190, dur: 0.34, gain: 0.8 },
  blade: { crack: 900, body: 500, dur: 0.05, gain: 0.15 },
};

export function playShot(weaponId, distance = 0, pan = 0) {
  const destination = out(distance, pan);
  if (destination === null) return;
  const shape = SHOT_SHAPES[weaponId] ?? SHOT_SHAPES.carbine;
  noise(destination, { dur: shape.dur * 0.5, freq: shape.crack, q: 0.6, gain: shape.gain });
  noise(destination, { dur: shape.dur, freq: shape.body, q: 0.7, gain: shape.gain * 0.9, type: 'lowpass' });
  tone(destination, { dur: 0.05, freq: 120, slide: -60, gain: shape.gain * 0.5, type: 'triangle' });
}

export function playDryFire() {
  const destination = out(0, 0);
  if (destination === null) return;
  tone(destination, { dur: 0.04, freq: 1900, gain: 0.12, type: 'square' });
}

export function playReload(weaponId) {
  const destination = out(0, 0);
  if (destination === null) return;
  // Out, pause, in, rack: four small clacks spread over the reload.
  noise(destination, { at: 0.05, dur: 0.05, freq: 900, gain: 0.25 });
  noise(destination, { at: 0.55, dur: 0.05, freq: 700, gain: 0.22 });
  noise(destination, { at: 1.0, dur: 0.06, freq: 1100, gain: 0.28 });
  if (weaponId === 'breach12') noise(destination, { at: 1.35, dur: 0.08, freq: 600, gain: 0.3 });
}

export function playHit(kill = false) {
  const destination = out(0, 0);
  if (destination === null) return;
  tone(destination, { dur: 0.06, freq: kill ? 1560 : 1180, gain: 0.16, type: 'sine' });
  if (kill) tone(destination, { at: 0.07, dur: 0.09, freq: 1960, gain: 0.14, type: 'sine' });
}

export function playHurt() {
  const destination = out(0, 0);
  if (destination === null) return;
  noise(destination, { dur: 0.12, freq: 300, gain: 0.3, type: 'lowpass' });
}

export function playStep(distance = 0, pan = 0) {
  const destination = out(distance, pan);
  if (destination === null) return;
  noise(destination, { dur: 0.05, freq: 480, gain: 0.1, type: 'lowpass' });
}

export function playBeep(final = false) {
  const destination = out(0, 0);
  if (destination === null) return;
  tone(destination, { dur: final ? 0.4 : 0.09, freq: final ? 1480 : 1040, gain: 0.14, type: 'sine' });
}

export function playPlantDone() {
  const destination = out(0, 0);
  if (destination === null) return;
  tone(destination, { dur: 0.08, freq: 880, gain: 0.15, type: 'sine' });
  tone(destination, { at: 0.1, dur: 0.08, freq: 1174, gain: 0.15, type: 'sine' });
  tone(destination, { at: 0.2, dur: 0.14, freq: 1568, gain: 0.15, type: 'sine' });
}

export function playExplosion() {
  const destination = out(0, 0);
  if (destination === null) return;
  noise(destination, { dur: 1.4, freq: 120, gain: 1.0, type: 'lowpass' });
  noise(destination, { dur: 0.5, freq: 500, gain: 0.5, type: 'lowpass' });
  tone(destination, { dur: 1.0, freq: 70, slide: -40, gain: 0.7, type: 'sine' });
}

export function playRoundWin(won) {
  const destination = out(0, 0);
  if (destination === null) return;
  const base = won ? 523 : 392;
  tone(destination, { dur: 0.14, freq: base, gain: 0.12, type: 'triangle' });
  tone(destination, { at: 0.13, dur: 0.14, freq: base * 1.25, gain: 0.12, type: 'triangle' });
  tone(destination, { at: 0.26, dur: 0.24, freq: base * 1.5, gain: 0.12, type: 'triangle' });
}

export function playClick() {
  const destination = out(0, 0);
  if (destination === null) return;
  tone(destination, { dur: 0.03, freq: 2400, gain: 0.06, type: 'square' });
}
