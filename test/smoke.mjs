// Quick checks of the engine's rules (MECHANICS.md) and that every preset renders cleanly.
//   node test/smoke.mjs

import assert from 'node:assert/strict';
import { Engine, Params, VOICES } from '../engine.js';
import { FACTORY } from '../presets.js';
import { MODES, randomise, reachable } from '../randomise.js';

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

check('chance 0 keeps a voice silent while its neuron still fires and passes pulses on', () => {
  const e = new Engine(48000);
  e.params.links[0][1] = true;
  e.params.voices[0].chance = 0;
  e.start();
  const buf = new Float32Array(48000);
  e.render(buf, 2);
  assert.equal(e.hits[0], 0);
  assert.ok(e.hits[1] > 0);
});

check('every randomise mode gives a playable patch with settings in range', () => {
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const c of [0, 0.5, 1]) {
    for (const m of MODES) {
      for (let k = 0; k < 30; k++) {
        const p = Params.fromFactory(FACTORY[k % FACTORY.length]);
        randomise(p, m.id, c, rand);
        assert.equal(p.deepPath(0, 7), false, `${m.id}: a loop is reachable from neuron 0`);
        for (let i = 0; i < VOICES; i++) assert.equal(p.links[i][i], false);
        if (m.id !== 'mutate' && m.id !== 'sounds' && m.id !== 'mix') assert.ok(reachable(p).size >= 3, `${m.id}: too few neurons wired`);
        for (const v of p.voices) {
          assert.ok(v.pitch >= 0 && v.pitch <= 100);
          assert.ok(v.amp_att >= 0.001 && v.amp_att <= 25 && v.amp_dec >= 10 && v.amp_dec <= 2000);
          assert.ok(v.pit_att >= 0.001 && v.pit_att <= 25 && v.pit_dec >= 10 && v.pit_dec <= 2000);
          assert.ok(Number.isInteger(v.threshold) && v.threshold >= 0 && v.threshold <= 6);
          assert.ok(v.chance >= 0 && v.chance <= 1);
          for (const key of ['pitch_amt', 'fm_freq', 'fm_amt', 'timbre_x', 'timbre_y', 'fm_send', 'fm_recv', 'am_send', 'am_recv', 'fx_send']) {
            assert.ok(v[key] >= 0 && v[key] <= 1, `${m.id}: ${key} = ${v[key]}`);
          }
          assert.ok(v.pan >= -1 && v.pan <= 1 && v.level >= -60 && v.level <= 0);
        }
        assert.ok(p.delay_note.every((n) => n >= 0 && n <= 14));
        assert.ok(p.filter_freq >= 10 && p.filter_freq <= 10000 && p.feedback >= -60 && p.feedback <= -0.5);
      }
    }
  }
});

check('random patches play without NaN and are not silent', () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 20; k++) {
    const e = new Engine(48000);
    randomise(e.params, 'all', k / 19, rand);
    e.start();
    const buf = new Float32Array(256);
    let peak = 0;
    for (let b = 0; b < 1500; b++) {
      e.render(buf, 2);
      for (const s of buf) {
        assert.ok(Number.isFinite(s));
        peak = Math.max(peak, Math.abs(s));
      }
    }
    assert.ok(peak > 0.001, `random patch ${k} is silent`);
  }
});

console.log(`\n${passed} checks passed`);
