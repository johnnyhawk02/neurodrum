// Ways to randomise a patch. Not in the original app; added in the JS version.
//
// Every function changes `p` (a Params) in place. `c` is the complexity, 0..1: low values make
// sparse wiring, simple rhythms and plain sounds; high values make dense wiring, long and
// uneven neuron cycles, FM and ring modulation between voices, and voices that only play
// some of the time. `rand` returns 0..1 (Math.random by default; tests pass a seeded one).

import { VOICES, SYNC_NAMES } from './engine.js';

export const MODES = [
  { id: 'all', label: 'All', title: 'Randomise everything' },
  { id: 'wiring', label: 'Wiring', title: 'New links between the neurons' },
  { id: 'rhythm', label: 'Rhythm', title: 'New wiring, thresholds, rate and chances' },
  { id: 'sounds', label: 'Sounds', title: 'New sounds for every voice' },
  { id: 'mix', label: 'Mix', title: 'New levels, pans, sends and delay' },
  { id: 'mutate', label: 'Mutate', title: 'Nudge every setting a little' },
];

const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);
const between = (rand, lo, hi) => lo + rand() * (hi - lo);
const pick = (rand, list) => list[Math.floor(rand() * list.length)];
const chance = (rand, p) => rand() < p;

/** Neurons that neuron 0 can reach through the links (neuron 0 included). */
export function reachable(p) {
  const seen = new Set([0]);
  const todo = [0];
  while (todo.length) {
    const n = todo.pop();
    for (let r = 0; r < VOICES; r++) {
      if (p.links[n][r] && !seen.has(r)) {
        seen.add(r);
        todo.push(r);
      }
    }
  }
  return seen;
}

/**
 * New links. Every neuron first gets one sender among the neurons already reached from
 * neuron 0, so the whole network plays; higher complexity skips fewer neurons and adds
 * more extra links (loops are refused by toggleLink, as in the original).
 */
export function randomWiring(p, c, rand = Math.random) {
  p.clearLinks();
  const order = [1, 2, 3, 4, 5, 6].sort(() => rand() - 0.5);
  const reached = [0];
  for (const n of order) {
    // at low complexity a neuron is sometimes left out, so not every voice plays
    if (reached.length >= 4 && chance(rand, 0.35 * (1 - c))) continue;
    p.toggleLink(pick(rand, reached), n);
    reached.push(n);
  }
  const extra = Math.round(c * 8 * rand() + c * 2);
  for (let k = 0; k < extra; k++) {
    const from = Math.floor(rand() * VOICES);
    const to = Math.floor(rand() * VOICES);
    if (from !== to && !p.links[from][to]) p.toggleLink(from, to);
  }
}

/** New wiring, thresholds, clock rate and voice chances. */
export function randomRhythm(p, c, rand = Math.random) {
  randomWiring(p, c, rand);
  const maxTh = 1 + Math.round(c * 5);
  for (const v of p.voices) {
    v.threshold = Math.floor(rand() * (maxTh + 1));
    v.chance = chance(rand, 0.15 + 0.5 * c) ? between(rand, 0.35 + 0.4 * (1 - c), 1) : 1;
  }
  p.voices[0].threshold = Math.min(p.voices[0].threshold, 1 + Math.round(c * 2));
  p.rate = pick(rand, c > 0.6 ? [0, 1, 1, 2] : [1, 1, 2]);
  p.solo = -1;
}

/** A new sound for one voice. */
export function randomVoiceSound(v, c, rand = Math.random) {
  // a few broad families, so random kits have kicks and hats rather than all middles
  const kind = pick(rand, ['low', 'low', 'mid', 'mid', 'high', 'noise']);
  v.pitch = { low: between(rand, 15, 40), mid: between(rand, 35, 70), high: between(rand, 65, 95), noise: between(rand, 50, 100) }[kind];
  v.amp_att = chance(rand, 0.8) ? between(rand, 0.001, 1.5) : between(rand, 1, 2 + 23 * c);
  v.amp_att_c = between(rand, -1, 1);
  v.amp_dec = kind === 'high' || kind === 'noise' ? between(rand, 20, 250 + 600 * c) : between(rand, 60, 400 + 1200 * c);
  v.amp_dec_c = between(rand, -1, 0.6);
  v.pit_att = between(rand, 0.001, 3);
  v.pit_att_c = between(rand, -1, 1);
  v.pit_dec = between(rand, 10, 150 + 600 * c);
  v.pit_dec_c = between(rand, -1, 0.5);
  v.pitch_amt = kind === 'low' ? between(rand, 0.1, 0.6) : between(rand, 0, 0.15 + 0.5 * c);
  v.fm_freq = rand();
  v.fm_amt = kind === 'noise' ? between(rand, 0.3, 1) : chance(rand, 0.3 + 0.6 * c) ? between(rand, 0, 0.15 + 0.6 * c) : 0;
  v.timbre_x = chance(rand, 0.3 + 0.5 * c) ? between(rand, 0, 0.3 + 0.7 * c) : 0;
  v.timbre_y = chance(rand, 0.3 + 0.5 * c) ? between(rand, 0, 0.3 + 0.7 * c) : 0;
  // modulation between voices: rare and gentle at low complexity
  const mod = (p) => (chance(rand, p) ? between(rand, 0.05, 0.2 + 0.8 * c) : 0);
  v.fm_send = mod(0.4 * c);
  v.fm_recv = mod(0.4 * c);
  v.am_send = mod(0.35 * c);
  v.am_recv = mod(0.35 * c);
  v.midi_only = false;
}

export function randomSounds(p, c, rand = Math.random) {
  for (const v of p.voices) randomVoiceSound(v, c, rand);
}

/** New levels, pans, effect sends and delay. */
export function randomMix(p, c, rand = Math.random) {
  for (const v of p.voices) {
    v.level = between(rand, -18, -3);
    v.pan = between(rand, -1, 1) * (0.2 + 0.7 * c);
    v.fx_send = chance(rand, 0.4 + 0.4 * c) ? between(rand, 0, 0.3 + 0.6 * c) : 0;
    v.mute = false;
  }
  p.solo = -1;
  for (let s = 0; s < 2; s++) {
    p.delay_sync[s] = chance(rand, 0.8);
    p.delay_note[s] = Math.floor(rand() * SYNC_NAMES.length);
    p.delay_ms[s] = between(rand, 20, 700);
  }
  p.feedback = between(rand, -30, -6 + 4 * c);
  p.filter_freq = 10 * Math.pow(1000, between(rand, 0.35, 0.95));
  p.filter_width = between(rand, 1.5, 6.5);
  p.fx_level = chance(rand, 0.85) ? between(rand, -24, -6) : -60;
  p.fx_mute = false;
}

/** Nudge every setting a little: `c` sets how far, and how often wiring and thresholds change. */
export function mutate(p, c, rand = Math.random) {
  const amt = 0.04 + 0.16 * c;
  const nudge = (obj, key, lo, hi) => {
    obj[key] = clamp(obj[key] + (rand() * 2 - 1) * amt * (hi - lo), lo, hi);
  };
  for (const v of p.voices) {
    nudge(v, 'pitch', 0, 100);
    nudge(v, 'amp_att', 0.001, 25);
    nudge(v, 'amp_att_c', -1, 1);
    nudge(v, 'amp_dec', 10, 2000);
    nudge(v, 'amp_dec_c', -1, 1);
    nudge(v, 'pit_att', 0.001, 25);
    nudge(v, 'pit_att_c', -1, 1);
    nudge(v, 'pit_dec', 10, 2000);
    nudge(v, 'pit_dec_c', -1, 1);
    for (const k of ['pitch_amt', 'fm_freq', 'fm_amt', 'timbre_x', 'timbre_y', 'fx_send']) nudge(v, k, 0, 1);
    // leave modulation that is off, off; move what is on
    for (const k of ['fm_send', 'fm_recv', 'am_send', 'am_recv']) if (v[k] > 0) nudge(v, k, 0, 1);
    if ((v.chance ?? 1) < 1) nudge(v, 'chance', 0.2, 1);
    nudge(v, 'pan', -1, 1);
  }
  // rhythm changes are the most noticeable, so they happen less often
  if (chance(rand, 0.3 + 0.5 * c)) {
    const v = pick(rand, p.voices);
    v.threshold = clamp(v.threshold + (chance(rand, 0.5) ? 1 : -1), 0, 6);
  }
  if (chance(rand, 0.2 + 0.5 * c)) {
    const from = Math.floor(rand() * VOICES);
    const to = Math.floor(rand() * VOICES);
    if (from !== to) {
      p.toggleLink(from, to);
      // don't cut a neuron off if that leaves it silent
      if (!reachable(p).has(to)) p.toggleLink(from, to);
    }
  }
}

/** Apply one of MODES by id. */
export function randomise(p, mode, c, rand = Math.random) {
  switch (mode) {
    case 'all':
      randomRhythm(p, c, rand);
      randomSounds(p, c, rand);
      randomMix(p, c, rand);
      p.tempo = Math.round(between(rand, 85, 150));
      break;
    case 'wiring': randomWiring(p, c, rand); break;
    case 'rhythm': randomRhythm(p, c, rand); break;
    case 'sounds': randomSounds(p, c, rand); break;
    case 'mix': randomMix(p, c, rand); break;
    case 'mutate': mutate(p, c, rand); break;
    default: throw new Error(`unknown randomise mode ${mode}`);
  }
  return p;
}
