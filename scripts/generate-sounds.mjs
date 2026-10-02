// Synthesizes the UI sound effects (original, license-free). Usage: node scripts/generate-sounds.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RATE = 22050;
const out = join(import.meta.dirname, '../apps/client/assets/sounds');
mkdirSync(out, { recursive: true });

function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
}

function render(ms, fn) {
  const n = Math.floor((RATE * ms) / 1000);
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = fn(i / RATE, i);
  return buf;
}
const env = (t, decay) => Math.exp(-t * decay);
const mix = (...bufs) => {
  const n = Math.max(...bufs.map((b) => b.length));
  const o = new Float32Array(n);
  for (const b of bufs) for (let i = 0; i < b.length; i++) o[i] += b[i];
  return o;
};
const delay = (buf, ms) => {
  const pad = new Float32Array(Math.floor((RATE * ms) / 1000));
  const o = new Float32Array(pad.length + buf.length);
  o.set(buf, pad.length);
  return o;
};
const tone = (freq, ms, decay, gain = 0.5) =>
  render(ms, (t) => Math.sin(2 * Math.PI * freq * t) * env(t, decay) * gain);

function click(seed, ms, decay, bodyFreq, gain) {
  const noise = seeded(seed);
  let lp = 0;
  return render(ms, (t) => {
    lp += 0.35 * (noise() - lp); // low-passed noise = wooden knock
    return (lp * 1.6 + Math.sin(2 * Math.PI * bodyFreq * t) * 0.6) * env(t, decay) * gain;
  });
}

function wav(samples) {
  const pcm = new Int16Array(samples.length);
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const norm = peak > 0 ? Math.min(1, 0.8 / peak) : 1;
  samples.forEach((s, i) => (pcm[i] = Math.max(-1, Math.min(1, s * norm)) * 32767));
  const data = Buffer.from(pcm.buffer);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const sounds = {
  move: click(1, 90, 55, 170, 0.9),
  capture: mix(click(2, 140, 38, 120, 1), tone(90, 120, 30, 0.4)),
  check: mix(tone(880, 160, 14, 0.5), delay(tone(1175, 200, 12, 0.5), 90)),
  castle: mix(click(3, 90, 55, 170, 0.9), delay(click(4, 90, 55, 210, 0.9), 85)),
  promote: mix(tone(523, 130, 14), delay(tone(659, 130, 14), 80), delay(tone(784, 220, 10), 160)),
  end: mix(tone(659, 220, 9), delay(tone(523, 220, 9), 170), delay(tone(392, 420, 6), 340)),
  error: render(150, (t) => (Math.sin(2 * Math.PI * 140 * t) > 0 ? 1 : -1) * env(t, 20) * 0.25),
};

for (const [name, samples] of Object.entries(sounds)) {
  const file = join(out, `${name}.wav`);
  writeFileSync(file, wav(samples));
  console.log(name, `${((samples.length / RATE) * 1000) | 0}ms`);
}
