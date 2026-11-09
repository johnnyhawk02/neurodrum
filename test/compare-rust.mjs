// Renders every factory preset with the JS engine and compares it with the Rust renders
// made by test/rust-reference (four seconds each, 48 kHz stereo, playing from the start).
//
//   node test/compare-rust.mjs test/rust-reference/out

import { readFileSync } from 'node:fs';
import { Engine, Params, VOICES } from '../engine.js';
import { FACTORY } from '../presets.js';

const dir = process.argv[2] ?? 'test/rust-reference/out';
const sr = 48000;
const frames = sr * 4;
let worst = -Infinity;
let failed = 0;

for (let n = 0; n < FACTORY.length; n++) {
  const e = new Engine(sr);
  e.params = Params.fromFactory(FACTORY[n]);
  for (let i = 0; i < VOICES; i++) e.setThreshold(i, e.params.voices[i].threshold);
  e.start();
  const js = new Float32Array(frames * 2);
  const buf = new Float32Array(128 * 2);
  for (let pos = 0; pos < js.length; pos += buf.length) {
    e.render(buf, 2);
    js.set(buf.subarray(0, Math.min(buf.length, js.length - pos)), pos);
  }
  const raw = readFileSync(`${dir}/preset-${String(n).padStart(2, '0')}.f32`);
  const rust = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);

  let errSq = 0;
  let refSq = 0;
  for (let i = 0; i < js.length; i++) {
    const d = js[i] - rust[i];
    errSq += d * d;
    refSq += rust[i] * rust[i];
  }
  // error relative to the signal, in dB (lower is better)
  const rel = refSq > 0 ? 10 * Math.log10(errSq / refSq + 1e-30) : errSq > 0 ? 0 : -300;
  worst = Math.max(worst, rel);
  const ok = rel < -60;
  if (!ok) failed++;
  console.log(`preset ${String(n + 1).padStart(2, '0')}: error ${rel.toFixed(1)} dB ${ok ? '' : ' <-- differs'}`);
}
console.log(`\nworst ${worst.toFixed(1)} dB relative to the signal; ${failed} of ${FACTORY.length} presets above -60 dB`);
process.exit(failed ? 1 : 0);
