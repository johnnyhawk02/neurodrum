// Renders a preset to a WAV file, to listen to the engine without a browser.
//   node test/render-wav.mjs [preset number 1..42] [seconds] [out.wav]

import { writeFileSync } from 'node:fs';
import { Engine, Params } from '../engine.js';
import { FACTORY } from '../presets.js';

const n = Number(process.argv[2] ?? 1);
const seconds = Number(process.argv[3] ?? 8);
const file = process.argv[4] ?? `preset-${String(n).padStart(2, '0')}.wav`;
const sr = 48000;
const e = new Engine(sr);
e.params = Params.fromFactory(FACTORY[n - 1]);
e.start();
const frames = Math.round(sr * seconds);
const pcm = Buffer.alloc(44 + frames * 4);
const buf = new Float32Array(256);
let at = 44;
for (let done = 0; done < frames; done += 128) {
  e.render(buf, 2);
  for (let i = 0; i < Math.min(256, (frames - done) * 2); i++) {
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i])) * 32767), at);
    at += 2;
  }
}
pcm.write('RIFF', 0);
pcm.writeUInt32LE(36 + frames * 4, 4);
pcm.write('WAVEfmt ', 8);
pcm.writeUInt32LE(16, 16);
pcm.writeUInt16LE(1, 20);
pcm.writeUInt16LE(2, 22);
pcm.writeUInt32LE(sr, 24);
pcm.writeUInt32LE(sr * 4, 28);
pcm.writeUInt16LE(4, 32);
pcm.writeUInt16LE(16, 34);
pcm.write('data', 36);
pcm.writeUInt32LE(frames * 4, 40);
writeFileSync(file, pcm);
console.log(`wrote ${file} (${seconds} s of Factory ${String(n).padStart(2, '0')})`);
