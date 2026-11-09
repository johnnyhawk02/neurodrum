// Quick checks of the engine's rules (MECHANICS.md) and that every preset renders cleanly.
//   node test/smoke.mjs

import assert from 'node:assert/strict';
import { Engine, Params, VOICES } from '../engine.js';
import { FACTORY } from '../presets.js';

let passed = 0;
const check = (name, fn) => {
  fn();
  passed++;
  console.log(`ok  ${name}`);
};

check('threshold N fires on every (N+1)th pulse', () => {
  const e = new Engine(48000);
  e.params.voices[0].threshold = 2;
  const fired = [];
  for (let k = 0; k < 9; k++) {
    e.pulse(0, 0);
    fired.push(e.nodes[0].fired);
    e.nodes[0].fired = false;
  }
  assert.deepEqual(fired, [false, false, true, false, false, true, false, false, true]);
});

check('a neuron fires the neurons it sends to', () => {
  const e = new Engine(48000);
  e.params.links[0][3] = true;
  e.pulse(0, 0);
  assert.equal(e.nodes[3].fired, true);
  assert.equal(e.nodes[2].fired, false);
});

check('lowering a threshold below the count resets the count', () => {
  const e = new Engine(48000);
  e.setThreshold(1, 5);
  e.nodes[1].count = 4;
  e.setThreshold(1, 2);
  assert.equal(e.nodes[1].count, 0);
});

check('links: no self links, loops reachable from neuron 0 are refused, removing works', () => {
  const p = new Params();
  assert.equal(p.toggleLink(2, 2), false);
  assert.equal(p.toggleLink(0, 1), true);
  assert.equal(p.toggleLink(1, 2), true);
  assert.equal(p.toggleLink(2, 1), false, 'loop 1 -> 2 -> 1 is refused');
  assert.equal(p.links[2][1], false);
  assert.equal(p.toggleLink(3, 4), true);
  assert.equal(p.toggleLink(4, 3), true, 'a loop neuron 0 cannot reach is allowed, as in the original');
  assert.equal(p.toggleLink(0, 1), false, 'toggling an existing link removes it');
});

check('presets load with settings in range', () => {
  for (const f of FACTORY) {
    const p = Params.fromFactory(f);
    assert.ok(p.tempo >= 20 && p.tempo <= 240);
    assert.ok(p.rate >= 0 && p.rate <= 2);
    assert.ok(p.solo >= -1 && p.solo < VOICES);
    for (const v of p.voices) assert.ok(v.threshold >= 0 && v.threshold <= 6);
  }
});

check('every preset plays for four seconds without NaN or silence', () => {
  FACTORY.forEach((f, n) => {
    const e = new Engine(48000);
    e.params = Params.fromFactory(f);
    e.start();
    const buf = new Float32Array(256);
    let peak = 0;
    for (let k = 0; k < 1500; k++) {
      e.render(buf, 2);
      for (const s of buf) {
        assert.ok(Number.isFinite(s), `preset ${n + 1} made a non-finite sample`);
        peak = Math.max(peak, Math.abs(s));
      }
    }
    // the last preset is the Init patch, which has every voice at its defaults
    if (n < FACTORY.length - 1) assert.ok(peak > 0.001, `preset ${n + 1} is silent`);
  });
});

check('mono render averages the two sides', () => {
  const a = new Engine(48000);
  const b = new Engine(48000);
  a.params = Params.fromFactory(FACTORY[0]);
  b.params = Params.fromFactory(FACTORY[0]);
  a.thwack(0, 1);
  b.thwack(0, 1);
  const st = new Float32Array(512);
  const mo = new Float32Array(256);
  a.render(st, 2);
  b.render(mo, 1);
  for (let i = 0; i < 256; i++) assert.ok(Math.abs(mo[i] - (st[2 * i] + st[2 * i + 1]) / 2) < 1e-6);
});

console.log(`\n${passed} checks passed`);
