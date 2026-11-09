// Sound engine: seven FM drum voices driven by a small network of counting neurons.
// Numbers come from MECHANICS.md (decoded from the original program).
// JavaScript port of app/src/engine.rs, kept line for line.
//
// The Rust does its sound maths in 32-bit floats (f32). JavaScript numbers are 64-bit, and
// the FM feedback and phase accumulators amplify the tiny differences until the sound drifts
// apart audibly within a second or two. So every step of the audio path is rounded to f32
// with `f32()` (Math.fround), exactly where the Rust rounds. The result matches the Rust
// render (see test/compare-rust.mjs).

export const VOICES = 7;
const TABLE = 16; // 16-point sine table, linear interpolation
const TICKS_PER_BEAT = 8; // one tick per 1/32 note
const FM_BUS_GAIN = 8000;
const DEPTH_BASE_HZ = 440;
const MAX_DELAY = 96000;

export const RATE_NAMES = ['1/32', '1/16', '1/8'];
const RATE_TICKS = [1, 2, 4];

export const SYNC_NAMES = [
  '1/32', '1/16T', '1/16', '1/8T', '1/16.', '1/8', '1/4T', '1/8.', '1/4', '1/2T', '1/4.', '1/2',
  '1T', '1/2.', '1 bar',
];
export const SYNC_BEATS = [
  0.125, 0.1666667, 0.25, 0.3333333, 0.375, 0.5, 0.6666667, 0.75, 1.0, 1.3333334, 1.5, 2.0,
  2.6666667, 3.0, 4.0,
];

const f32 = Math.fround;
const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);
/** Rust `x as u32`: truncate toward zero, negatives and NaN become 0. */
const asU32 = (x) => (x > 0 ? Math.min(Math.trunc(x), 0xffffffff) : 0);

export function defaultVoiceParams() {
  return {
    pitch: 60.0, // 0..100
    threshold: 0, // 0..6
    amp_att: 0.001, // ms 0.001..25
    amp_att_c: -0.5, // -1..1
    amp_dec: 400.0, // ms 10..2000
    amp_dec_c: -0.5,
    pit_att: 0.1,
    pit_att_c: -0.5,
    pit_dec: 400.0,
    pit_dec_c: -0.5,
    pitch_amt: 0.1, // 0..1
    fm_freq: 0.0, // 0..1
    fm_amt: 0.0, // 0..1
    timbre_x: 0.0,
    timbre_y: 0.0,
    midi_only: false,
    fm_send: 0.0,
    fm_recv: 0.0,
    am_send: 0.0,
    am_recv: 0.0,
    fx_send: 0.0,
    pan: 0.0, // -1..1
    level: -3.0, // dB -60..0
    mute: false,
    // Added in the JS version (not in the original): the chance, 0..1, that a firing neuron
    // plays its voice. The neuron still fires and passes its pulse on either way.
    chance: 1.0,
  };
}

export function dbToGain(db) {
  return db <= -59.99 ? 0.0 : f32(Math.pow(10, f32(db / 20.0)));
}

export function pitchHz(pitch) {
  return f32(440.0 * f32(Math.pow(2, f32(f32(pitch - 57.0) / 12.0))));
}

// Done in f32 like the Rust, so whole-number settings round the same way.
function lin(v, lo, hi) {
  return f32(f32(lo) + f32(f32(clamp(f32(v), 0.0, 1.0)) * f32(hi - lo)));
}

export class Params {
  constructor() {
    this.voices = Array.from({ length: VOICES }, defaultVoiceParams);
    this.links = Array.from({ length: VOICES }, () => new Array(VOICES).fill(false));
    this.master = 0.0; // dB
    this.solo = -1; // -1 none
    this.delay_ms = [0.0, 0.0];
    this.delay_sync = [false, false];
    this.delay_note = [8, 8];
    this.feedback = -12.0; // dB -60..-0.5
    this.filter_freq = 1000.0; // Hz 10..10000
    this.filter_width = 5.8; // 1..7
    this.fx_level = -60.0; // dB
    this.fx_mute = false;
    this.tempo = 120.0;
    this.rate = 1;
  }

  clone() {
    const p = Object.assign(new Params(), structuredClone({ ...this }));
    return p;
  }

  /** Load a factory preset (stored 0..1 values -> real values, see MECHANICS.md). */
  static fromFactory(preset) {
    const v = preset.values.map(f32);
    const out = new Params();
    for (let i = 0; i < VOICES; i++) {
      const b = i * 20;
      const vp = out.voices[i];
      vp.pitch = lin(v[b], 0.0, 100.0);
      vp.threshold = Math.floor(f32(lin(v[b + 1], 0.0, 6.0) + 0.5));
      vp.amp_att = lin(v[b + 2], 0.001, 25.0);
      vp.amp_att_c = lin(v[b + 3], -1.0, 1.0);
      vp.amp_dec = lin(v[b + 4], 10.0, 2000.0);
      vp.amp_dec_c = lin(v[b + 5], -1.0, 1.0);
      vp.pit_att = lin(v[b + 6], 0.001, 25.0);
      vp.pit_att_c = lin(v[b + 7], -1.0, 1.0);
      vp.pit_dec = lin(v[b + 8], 10.0, 2000.0);
      vp.pit_dec_c = lin(v[b + 9], -1.0, 1.0);
      vp.pitch_amt = v[b + 10];
      vp.fm_freq = v[b + 11];
      vp.fm_amt = v[b + 12];
      vp.timbre_x = v[b + 13];
      vp.timbre_y = v[b + 14];
      vp.midi_only = v[b + 15] > 0.5;
      vp.fm_send = v[b + 16];
      vp.fm_recv = v[b + 17];
      vp.am_send = v[b + 18];
      vp.am_recv = v[b + 19];
      const m = 140 + i * 4;
      vp.fx_send = v[m];
      vp.pan = lin(v[m + 1], -1.0, 1.0);
      vp.level = lin(v[m + 2], -60.0, 0.0);
      vp.mute = v[m + 3] > 0.5;
    }
    out.master = lin(v[168], -60.0, 0.0);
    out.solo = Math.floor(f32(lin(v[169], -1.0, 6.0) + 0.5));
    out.delay_sync = [v[172] > 0.5, v[173] > 0.5];
    out.delay_ms = [lin(v[170], 0.0, 1999.0), lin(v[171], 0.0, 1999.0)];
    out.delay_note = [
      Math.min(Math.max(Math.floor(f32(v[170] * 15.0)), 0), 14),
      Math.min(Math.max(Math.floor(f32(v[171] * 15.0)), 0), 14),
    ];
    out.feedback = lin(v[174], -60.0, -0.5);
    out.filter_freq = f32(10.0 * Math.pow(1000, clamp(v[175], 0.0, 1.0)));
    out.filter_width = lin(v[176], 1.0, 7.0);
    out.fx_level = lin(v[177], -60.0, 0.0);
    out.fx_mute = v[178] > 0.5;
    out.tempo = Math.floor(f32(lin(v[179], 20.0, 240.0) + 0.5));
    out.rate = Math.min(Math.max(Math.floor(f32(lin(v[182], 0.0, 2.0) + 0.5)), 0), 2);
    for (let from = 0; from < VOICES; from++) {
      for (let to = 0; to < VOICES; to++) {
        out.links[from][to] = preset.links[from * VOICES + to] !== 0;
      }
    }
    return out;
  }

  /** True when a path `depth` links long starts at `node` (that means a loop). */
  deepPath(node, depth) {
    if (depth === 0) return true;
    for (let r = 0; r < VOICES; r++) {
      if (this.links[node][r] && this.deepPath(r, depth - 1)) return true;
    }
    return false;
  }

  /**
   * Toggle a link like the original: removing always works, adding is refused when it
   * would make a loop reachable from neuron 0. Returns whether the link exists afterwards.
   */
  toggleLink(from, to) {
    if (this.links[from][to]) {
      this.links[from][to] = false;
      return false;
    }
    if (from === to) return false;
    this.links[from][to] = true;
    if (this.deepPath(0, 7)) this.links[from][to] = false;
    return this.links[from][to];
  }

  clearLinks() {
    for (const row of this.links) row.fill(false);
  }

  delayTimeMs(side) {
    if (this.delay_sync[side]) {
      return f32(f32(f32(SYNC_BEATS[Math.min(this.delay_note[side], 14)]) * 60000.0) / Math.max(this.tempo, 1.0));
    }
    return this.delay_ms[side];
  }
}

function sineTable() {
  const t = new Float64Array(TABLE);
  for (let i = 0; i < TABLE; i++) t[i] = f32(Math.sin((i * 2 * Math.PI) / TABLE));
  return t;
}

function shape(t, c) {
  if (c > 0.0) return f32(Math.pow(t, f32(Math.pow(10, c))));
  return f32(1.0 - f32(Math.pow(f32(1.0 - t), f32(Math.pow(10, -c)))));
}

/** Attack/decay envelope with the original's curve rule. */
class Env {
  constructor() {
    this.stage = -1; // 0 attack, 1 decay, -1 done
    this.n = 0;
    this.len = 0;
    this.value = 0.0;
  }
  begin(attSamples) {
    this.stage = 0;
    this.n = 0;
    this.len = Math.max(attSamples, 1);
    this.value = 0.0;
  }
  active() {
    return this.stage >= 0;
  }
  process(att, attC, dec, decC) {
    if (this.stage < 0) {
      this.value = 0.0;
      return 0.0;
    }
    const t = Math.min(f32(f32(this.n) / f32(this.len)), 1.0);
    // rising segment: curvature is negated
    this.value = this.stage === 0 ? shape(t, -attC) : f32(1.0 - shape(t, decC));
    this.n += 1;
    if (this.n >= this.len) {
      if (this.stage === 0) {
        this.stage = 1;
        this.n = 0;
        this.len = Math.max(dec, 1);
        this.value = 1.0;
      } else {
        this.stage = -1;
      }
    }
    return this.value;
  }
}

class Voice {
  constructor() {
    this.car_phase = 0.0;
    this.mod_phase = 0.0;
    this.amp = new Env();
    this.pitch = new Env();
    this.vel2 = 0.0;
  }
}

/** 2-pole Butterworth (RBJ biquad, Q = 0.7071). */
class Biquad {
  constructor() {
    this.b0 = this.b1 = this.b2 = this.a1 = this.a2 = 0.0;
    this.x1 = this.x2 = this.y1 = this.y2 = 0.0;
  }
  set(sr, f, high) {
    const w = f32(f32(f32(2 * Math.PI) * f) / sr);
    const s = f32(Math.sin(w));
    const c = f32(Math.cos(w));
    const alpha = f32(s / f32(2.0 * f32(Math.SQRT1_2)));
    const a0 = f32(1.0 + alpha);
    let b0, b1, b2;
    if (high) {
      b0 = f32(f32(1.0 + c) / 2.0);
      b1 = -f32(1.0 + c);
      b2 = f32(f32(1.0 + c) / 2.0);
    } else {
      b0 = f32(f32(1.0 - c) / 2.0);
      b1 = f32(1.0 - c);
      b2 = f32(f32(1.0 - c) / 2.0);
    }
    this.b0 = f32(b0 / a0);
    this.b1 = f32(b1 / a0);
    this.b2 = f32(b2 / a0);
    this.a1 = f32(f32(-2.0 * c) / a0);
    this.a2 = f32(f32(1.0 - alpha) / a0);
  }
  process(x) {
    const y = f32(f32(f32(f32(f32(this.b0 * x) + f32(this.b1 * this.x1)) + f32(this.b2 * this.x2)) - f32(this.a1 * this.y1)) - f32(this.a2 * this.y2));
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = Math.abs(y) < 1e-20 ? 0.0 : y;
    return this.y1;
  }
}

class DelayLine {
  constructor() {
    this.buf = new Float32Array(MAX_DELAY + 4);
    this.pos = 0;
    this.time = 0.0; // smoothed, in samples
  }
  process(x, target) {
    this.time = f32(this.time + f32(f32(target - this.time) * f32(0.0005)));
    const len = this.buf.length;
    this.buf[this.pos] = x;
    const d = clamp(this.time, 0.0, MAX_DELAY);
    let rp = f32(f32(this.pos) - d);
    if (rp < 0.0) rp = f32(rp + f32(len));
    const i = Math.floor(rp) % len;
    const f = f32(rp - Math.floor(rp));
    const a = this.buf[i];
    const b = this.buf[(i + 1) % len];
    this.pos = (this.pos + 1) % len;
    return f32(a + f32(f32(b - a) * f));
  }
}

export class Engine {
  constructor(sr) {
    this.params = new Params();
    this.sr = sr;
    this.playing = false;
    this.table = sineTable();
    this.voices = Array.from({ length: VOICES }, () => new Voice());
    this.nodes = Array.from({ length: VOICES }, () => ({ count: 0, fired: false }));
    this.seed = 0x9e3779b9; // for the chance setting
    this.bars = 0; // whole bars (4 beats) played since start
    this.beat_pos = 0.0;
    this.last_tick = -1;
    this.fm_bus = 0.0;
    this.am_bus = 0.0;
    this.am_follow = 0.0;
    this.am_lp = new Biquad();
    this.am_lp.set(sr, Math.min(10000, f32(sr * 0.45)), false);
    this.level_smooth = new Float32Array(VOICES);
    this.master_smooth = 1.0;
    this.fx_smooth = 0.0;
    this.delay_out = [0.0, 0.0];
    this.hp = [new Biquad(), new Biquad()];
    this.lp = [new Biquad(), new Biquad()];
    this.filt_set = [-1.0, -1.0];
    this.delays = [new DelayLine(), new DelayLine()];
    /** Counts each voice's hits, so the screen can flash them. */
    this.hits = new Array(VOICES).fill(0);
    /** Peak meters per voice and master (decaying). */
    this.meters = new Float32Array(VOICES + 1);
  }

  setSampleRate(sr) {
    this.sr = sr;
    this.am_lp.set(sr, Math.min(10000, f32(sr * 0.45)), false);
    this.filt_set = [-1.0, -1.0];
  }

  nodeCount(i) {
    return this.nodes[i].count;
  }

  setThreshold(i, t) {
    this.params.voices[i].threshold = Math.min(t, 6);
    if (this.nodes[i].count > t) this.nodes[i].count = 0;
  }

  start() {
    this.playing = true;
    this.beat_pos = 0.0;
    this.last_tick = -1;
    this.bars = 0;
    for (const n of this.nodes) {
      n.count = 0;
      n.fired = false;
    }
  }

  stop() {
    this.playing = false;
  }

  /** xorshift32, 0..1 */
  random() {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 4294967296;
  }

  pulse(i, depth) {
    if (depth > 16) return;
    const old = this.nodes[i].count;
    const th = this.params.voices[i].threshold;
    this.nodes[i].count = old + 1;
    if (old >= th) {
      this.nodes[i].count = 0;
      for (let r = 0; r < VOICES; r++) {
        if (this.params.links[i][r]) this.pulse(r, depth + 1);
      }
      this.nodes[i].fired = true;
    }
  }

  thwack(i, vel) {
    const ms = f32(this.sr / 1000.0);
    const vp = this.params.voices[i];
    const v = this.voices[i];
    v.amp.begin(asU32(f32(vp.amp_att * ms)));
    v.pitch.begin(asU32(f32(vp.pit_att * ms)));
    v.vel2 = f32(vel * vel);
    this.hits[i] += 1;
  }

  audible(i) {
    const p = this.params;
    return p.solo >= 0 ? p.solo === i : !p.voices[i].mute;
  }

  lerpTable(phase) {
    const i = Math.floor(phase);
    const f = f32(phase - i);
    const a = this.table[i & (TABLE - 1)];
    const b = this.table[(i + 1) & (TABLE - 1)];
    return f32(a + f32(f32(b - a) * f));
  }

  /** Fill `out` with `out.length / channels` frames, interleaved. */
  render(out, channels = 2) {
    const frames = Math.floor(out.length / Math.max(channels, 1));
    // per-block setup
    const sr = this.sr;
    const p = this.params;
    const w = clamp(f32(p.filter_width), 1.0, 7.0);
    const lpf = clamp(f32(p.filter_freq * w), 20.0, Math.min(20000, f32(sr * 0.45)));
    const hpf = clamp(f32(p.filter_freq / w), 10.0, Math.min(18000, f32(sr * 0.45)));
    if (this.filt_set[0] !== lpf || this.filt_set[1] !== hpf) {
      for (let s = 0; s < 2; s++) {
        this.lp[s].set(sr, lpf, false);
        this.hp[s].set(sr, hpf, true);
      }
      this.filt_set = [lpf, hpf];
    }
    const fb = dbToGain(p.feedback);
    const fxTarget = p.fx_mute ? 0.0 : dbToGain(p.fx_level);
    const masterTarget = dbToGain(p.master);
    const delayTarget = [
      f32(f32(f32(p.delayTimeMs(0)) * sr) / 1000.0),
      f32(f32(f32(p.delayTimeMs(1)) * sr) / 1000.0),
    ];
    const beatsPerSample = f32(p.tempo) / 60.0 / sr; // f64 in the Rust too
    const rate = RATE_TICKS[Math.min(p.rate, 2)];
    const ms = f32(sr / 1000.0);
    const toInc = f32(TABLE / sr);
    const smooth = f32(1.0 - f32(Math.exp(f32(-1.0 / f32(0.01 * sr)))));
    const followAtt = f32(1.0 - f32(Math.exp(f32(-1.0 / f32(f32(0.0005) * sr)))));
    const followDec = f32(1.0 - f32(Math.exp(f32(-1.0 / f32(0.01 * sr)))));
    const levelTarget = new Float32Array(VOICES);
    const panL = new Float32Array(VOICES);
    const panR = new Float32Array(VOICES);
    for (let i = 0; i < VOICES; i++) {
      levelTarget[i] = this.audible(i) ? dbToGain(p.voices[i].level) : 0.0;
      const pn = f32(f32(p.voices[i].pan + 1.0) * 0.5);
      panL[i] = 1.0 - f32(pn * pn);
      panR[i] = 1.0 - f32(f32(1.0 - pn) * f32(1.0 - pn));
    }
    const peak = new Float32Array(VOICES + 1);
    const dry = [0, 0];
    const send = [0, 0];
    const outs = [0, 0];

    for (let f = 0; f < frames; f++) {
      // clock
      if (this.playing) {
        const tick = Math.floor(this.beat_pos * TICKS_PER_BEAT);
        if (tick !== this.last_tick) {
          this.last_tick = tick;
          if (tick % rate === 0) {
            this.pulse(0, 0);
            for (let i = 0; i < VOICES; i++) {
              if (this.nodes[i].fired) {
                this.nodes[i].fired = false;
                const chance = p.voices[i].chance ?? 1;
                if (!p.voices[i].midi_only && (chance >= 1 || this.random() < chance)) this.thwack(i, 1.0);
              }
            }
          }
        }
        this.beat_pos += beatsPerSample;
        this.bars = Math.floor(this.beat_pos / 4);
      }

      dry[0] = dry[1] = 0;
      send[0] = send[1] = 0;
      let fmSum = 0;
      let amSum = 0;
      for (let i = 0; i < VOICES; i++) {
        const vp = p.voices[i];
        const voice = this.voices[i];
        this.level_smooth[i] += f32(f32(levelTarget[i] - this.level_smooth[i]) * smooth);
        if (vp.midi_only || !voice.amp.active()) continue;
        const fmIn = f32(f32(vp.fm_recv) * this.fm_bus);
        const amIn = f32(f32(vp.am_recv) * this.am_bus);
        const carrier = pitchHz(vp.pitch);
        const ratio = f32(1.0 + f32(3.0 * f32(vp.fm_freq)));
        const depth = f32(f32(f32(vp.fm_amt) * 10.0) * DEPTH_BASE_HZ);
        const bend = f32(f32(vp.pitch_amt) * DEPTH_BASE_HZ);
        const aa = asU32(f32(f32(vp.amp_att) * ms));
        const ad = asU32(f32(f32(vp.amp_dec) * ms));
        const pa = asU32(f32(f32(vp.pit_att) * ms));
        const pd = asU32(f32(f32(vp.pit_dec) * ms));
        const a = voice.amp.process(aa, f32(vp.amp_att_c), ad, f32(vp.amp_dec_c));
        const pe = voice.pitch.process(pa, f32(vp.pit_att_c), pd, f32(vp.pit_dec_c));
        let mp = voice.mod_phase;
        const m = f32(f32(f32(this.lerpTable(mp) * depth) * a) + fmIn);
        mp = f32(mp + f32(f32(carrier * ratio) * toInc));
        mp = remEuclid16(mp);
        let cp = voice.car_phase;
        const x = this.lerpTable(cp);
        cp = f32(f32(cp + f32(f32(f32(pe * bend) + m) * toInc)) + f32(carrier * toInc));
        cp = remEuclid16(cp);
        if (!Number.isFinite(cp)) cp = 0.0;
        voice.mod_phase = mp;
        voice.car_phase = cp;
        const x2 = f32(x * x);
        const tx = f32(vp.timbre_x);
        const ty = f32(vp.timbre_y);
        const y = f32(
          f32(x + f32(tx * f32(f32(2.0 * x2) - 1.0))) + f32(f32(ty * f32(f32(4.0 * x2) - 3.0)) * x),
        );
        const o = f32(f32(f32(y + f32(y * amIn)) * voice.vel2) * a);
        const g = f32(o * this.level_smooth[i]);
        const l = f32(g * panL[i]);
        const r = f32(g * panR[i]);
        const fx = f32(vp.fx_send);
        dry[0] = f32(dry[0] + l);
        dry[1] = f32(dry[1] + r);
        send[0] = f32(send[0] + f32(l * fx));
        send[1] = f32(send[1] + f32(r * fx));
        fmSum = f32(fmSum + f32(o * f32(vp.fm_send)));
        amSum = f32(amSum + f32(o * f32(vp.am_send)));
        peak[i] = Math.max(peak[i], Math.abs(g));
      }
      // FM and ring buses (used next sample)
      this.fm_bus = f32(fmSum * FM_BUS_GAIN);
      const target = Math.abs(amSum);
      const k = target > this.am_follow ? followAtt : followDec;
      this.am_follow = f32(this.am_follow + f32(f32(target - this.am_follow) * k));
      const sgn = amSum > 0.001 ? 0.9 : amSum < -0.001 ? -0.9 : amSum;
      this.am_bus = this.am_lp.process(f32(this.am_follow * f32(sgn)));

      // delay
      this.fx_smooth = f32(this.fx_smooth + f32(f32(fxTarget - this.fx_smooth) * smooth));
      this.master_smooth = f32(this.master_smooth + f32(f32(masterTarget - this.master_smooth) * smooth));
      for (let s = 0; s < 2; s++) {
        const inp = clamp(f32(send[s] + f32(fb * this.delay_out[s])), -2.0, 2.0);
        const clipped = f32(f32(inp * f32(3.0 - f32(inp * inp))) * f32(0.45));
        const h = this.hp[s].process(clipped);
        const l = this.lp[s].process(h);
        this.delay_out[s] = this.delays[s].process(l, delayTarget[s]);
        outs[s] = f32(f32(dry[s] + f32(this.fx_smooth * this.delay_out[s])) * this.master_smooth);
      }
      peak[VOICES] = Math.max(peak[VOICES], Math.abs(outs[0]), Math.abs(outs[1]));
      const base = f * channels;
      if (channels === 1) {
        out[base] = f32(0.5 * f32(outs[0] + outs[1]));
      } else {
        out[base] = clamp(outs[0], -1.5, 1.5);
        out[base + 1] = clamp(outs[1], -1.5, 1.5);
        for (let c = 2; c < channels; c++) out[base + c] = 0.0;
      }
    }
    const fall = f32(Math.exp(f32(-frames / f32(f32(0.25) * sr))));
    for (let i = 0; i <= VOICES; i++) {
      this.meters[i] = Math.max(f32(this.meters[i] * fall), peak[i]);
    }
  }
}

/** Rust `x.rem_euclid(16.0)` on an f32. */
function remEuclid16(x) {
  const r = f32(x % TABLE);
  return r < 0 ? f32(r + TABLE) : r;
}
