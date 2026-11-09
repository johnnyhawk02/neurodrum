// The Neurodrum screen, drawn on a canvas. JavaScript port of app/src/ui.rs.
// The Rust uses egui, an immediate-mode GUI: everything is redrawn every frame and each
// widget reads the mouse as it draws. A small stand-in for that lives at the top of this
// file, so the panel code below follows ui.rs closely.

import { Params, RATE_NAMES, SYNC_NAMES, VOICES, pitchHz } from './engine.js';
import { FACTORY } from './presets.js';
import { MODES, randomise } from './randomise.js';

export const DESIGN_W = 1180;
export const DESIGN_H = 562;
const VERSION = 'v1.1.0';
const EVOLVE_BARS = [0, 1, 2, 4, 8];
const UNDO_LIMIT = 50;

const BG = '#1c1d1f';
const PANEL = '#2b2c2f';
const PANEL_EDGE = '#46474b';
const WELL = '#121314';
const WELL_TOP = '#222325';
const LINE = '#3a3b3e';
const LABEL = '#5a9ccf';
const TEXT = '#c8c9cb';
const DIM = '#808286';
const ACCENT = '#2f8fdc';
const HOT = '#9fd8ff';
const WARN = '#d05040';

const SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO = 'ui-monospace, Menlo, Consolas, monospace';
const TAU = Math.PI * 2;
const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);

// ---------- rectangles ----------

const rect = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
const rectSize = (x, y, w, h) => rect(x, y, x + w, y + h);
const rectCenter = (cx, cy, w, h) => rect(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2);
const W = (r) => r.x1 - r.x0;
const H = (r) => r.y1 - r.y0;
const cx = (r) => (r.x0 + r.x1) / 2;
const cy = (r) => (r.y0 + r.y1) / 2;
const shrink = (r, m) => rect(r.x0 + m, r.y0 + m, r.x1 - m, r.y1 - m);
const contains = (r, p) => p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;

// ---------- immediate-mode input (the part of egui ui.rs relies on) ----------

class Input {
  constructor(canvas) {
    this.pos = { x: -1e9, y: -1e9 };
    this.last = { ...this.pos };
    this.down = false;
    this.shift = false;
    this.queue = [];
    this.active = null; // widget holding the pointer
    this.moved = 0;
    this.toPoint = (e) => e; // set by the app to map client coords into design coords
    const q = (type, e) => {
      this.shift = e.shiftKey;
      this.queue.push({ type, p: this.toPoint(e), button: e.button });
    };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      q('down', e);
    });
    canvas.addEventListener('pointermove', (e) => q('move', e));
    canvas.addEventListener('pointerup', (e) => q('up', e));
    canvas.addEventListener('dblclick', (e) => q('dbl', e));
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      q('secondary', e);
    });
    addEventListener('keydown', (e) => (this.shift = e.shiftKey));
    addEventListener('keyup', (e) => (this.shift = e.shiftKey));
  }

  /** Called once at the start of each frame. */
  begin() {
    this.pressed = this.released = this.dbl = this.secondary = false;
    this.last = { ...this.pos };
    // One press-release per frame, so quick clicks in different places stay separate.
    let used = 0;
    for (const ev of this.queue) {
      used++;
      this.pos = ev.p;
      if (ev.type === 'down' && ev.button === 0) {
        this.pressed = true;
        this.down = true;
        this.moved = 0;
        this.last = { ...ev.p };
      } else if (ev.type === 'up' && ev.button === 0) {
        this.released = true;
        this.down = false;
        break;
      } else if (ev.type === 'dbl') this.dbl = true;
      else if (ev.type === 'secondary') this.secondary = true;
    }
    this.queue.splice(0, used);
    this.delta = { x: this.pos.x - this.last.x, y: this.pos.y - this.last.y };
    this.moved += Math.abs(this.delta.x) + Math.abs(this.delta.y);
  }

  end() {
    if (this.released || !this.down) this.active = null;
  }

  /** egui's ui.interact: how the pointer relates to this widget this frame. */
  interact(r, id) {
    const over = contains(r, this.pos);
    if (this.pressed && over && this.active === null) this.active = id;
    const mine = this.active === id;
    return {
      hovered: over && (this.active === null || mine),
      dragged: mine && (this.down || this.released),
      delta: mine ? this.delta : { x: 0, y: 0 },
      clicked: mine && this.released && over && this.moved < 6,
      doubleClicked: over && this.dbl,
      secondaryClicked: over && this.secondary,
      pointer: this.pos,
    };
  }
}

// ---------- drawing helpers ----------

function roundRect(g, r, rad) {
  g.beginPath();
  g.roundRect(r.x0, r.y0, W(r), H(r), rad);
}

function fillRect(g, r, rad, color) {
  roundRect(g, r, rad);
  g.fillStyle = color;
  g.fill();
}

/** Stroke drawn inside the rect, like egui's StrokeKind::Inside. */
function strokeRect(g, r, rad, width, color) {
  const h = width / 2;
  roundRect(g, rect(r.x0 + h, r.y0 + h, r.x1 - h, r.y1 - h), Math.max(rad - h, 0));
  g.lineWidth = width;
  g.strokeStyle = color;
  g.stroke();
}

function lineSeg(g, a, b, width, color) {
  g.beginPath();
  g.moveTo(a.x, a.y);
  g.lineTo(b.x, b.y);
  g.lineWidth = width;
  g.strokeStyle = color;
  g.stroke();
}

function polyline(g, pts, width, color) {
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
  g.lineWidth = width;
  g.lineJoin = 'round';
  g.strokeStyle = color;
  g.stroke();
}

function circleFill(g, c, r, color) {
  g.beginPath();
  g.arc(c.x, c.y, r, 0, TAU);
  g.fillStyle = color;
  g.fill();
}

function circleStroke(g, c, r, width, color) {
  g.beginPath();
  g.arc(c.x, c.y, r, 0, TAU);
  g.lineWidth = width;
  g.strokeStyle = color;
  g.stroke();
}

/** Text with an egui-style anchor such as 'LEFT_TOP' or 'CENTER_CENTER'. */
function text(g, p, anchor, s, font, color) {
  const [h, v] = anchor.split('_');
  g.font = font;
  g.fillStyle = color;
  g.textAlign = h === 'LEFT' ? 'left' : h === 'RIGHT' ? 'right' : 'center';
  g.textBaseline = v === 'TOP' ? 'top' : v === 'BOTTOM' ? 'bottom' : 'middle';
  g.fillText(s, p.x, p.y);
}

const prop = (size) => `${size}px ${SANS}`;
const mono = (size) => `${size}px ${MONO}`;

function panel(g, r) {
  fillRect(g, r, 7, PANEL);
  strokeRect(g, r, 7, 1.5, PANEL_EDGE);
}

function well(g, r) {
  fillRect(g, r, 4, WELL);
  // the soft sheen across the top half, as in the original's display wells
  const grad = g.createLinearGradient(0, r.y0, 0, cy(r));
  grad.addColorStop(0, WELL_TOP);
  grad.addColorStop(1, WELL);
  g.save();
  roundRect(g, r, 4);
  g.clip();
  g.fillStyle = grad;
  g.fillRect(r.x0, r.y0, W(r), H(r) / 2);
  g.restore();
  strokeRect(g, r, 4, 1, LINE);
}

const heading = (g, p, s) => text(g, p, 'LEFT_TOP', s, prop(13), LABEL);
const small = (g, p, anchor, s, c) => text(g, p, anchor, s, mono(10.5), c);

function grid(g, r, step) {
  const c = '#2a2c30';
  for (let x = r.x0 + step; x < r.x1; x += step) lineSeg(g, { x, y: r.y0 }, { x, y: r.y1 }, 1, c);
  for (let y = r.y0 + step; y < r.y1; y += step) lineSeg(g, { x: r.x0, y }, { x: r.x1, y }, 1, c);
}

function shape(t, c) {
  return c > 0 ? Math.pow(t, Math.pow(10, c)) : 1 - Math.pow(1 - t, Math.pow(10, -c));
}

function neuronPos(center, radius, i) {
  if (i === 0) return center;
  const a = -Math.PI / 2 + ((i - 1) * TAU) / 6;
  return { x: center.x + Math.cos(a) * radius, y: center.y + Math.sin(a) * radius };
}

function arrow(g, from, to, nodeR, color) {
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const d = { x: (to.x - from.x) / len, y: (to.y - from.y) / len };
  const a = { x: from.x + d.x * (nodeR + 2), y: from.y + d.y * (nodeR + 2) };
  const b = { x: to.x - d.x * (nodeR + 3), y: to.y - d.y * (nodeR + 3) };
  lineSeg(g, a, b, 2, color);
  const n = { x: -d.y, y: d.x };
  g.beginPath();
  g.moveTo(b.x, b.y);
  g.lineTo(b.x - d.x * 9 + n.x * 4.5, b.y - d.y * 9 + n.y * 4.5);
  g.lineTo(b.x - d.x * 9 - n.x * 4.5, b.y - d.y * 9 - n.y * 4.5);
  g.closePath();
  g.fillStyle = color;
  g.fill();
}

function lerpColor(a, b, t) {
  t = clamp(t, 0, 1);
  const pa = [1, 3, 5].map((k) => parseInt(a.slice(k, k + 2), 16));
  const pb = [1, 3, 5].map((k) => parseInt(b.slice(k, k + 2), 16));
  const m = pa.map((x, k) => Math.trunc(x + (pb[k] - x) * t));
  return `rgb(${m[0]},${m[1]},${m[2]})`;
}

// ---------- the app ----------

export class App {
  /**
   * @param canvas      the <canvas> to draw on
   * @param presetSelect a <select> laid over the preset name (the egui ComboBox)
   * @param audio       { send(msg), ensure() }: posts messages to the worklet, starting audio if needed
   */
  constructor(canvas, presetSelect, audio) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.select = presetSelect;
    this.audio = audio;
    this.input = new Input(canvas);
    this.input.toPoint = (e) => this.toDesign(e);
    this.params = Params.fromFactory(FACTORY[0]);
    this.preset = 0;
    this.voice = 0;
    this.display = 'mixer';
    this.wiring = false;
    this.playing = false;
    this.counts = new Array(VOICES).fill(0);
    this.hitsSeen = new Array(VOICES).fill(0);
    this.flash = new Array(VOICES).fill(null);
    this.refused = null;
    this.meters = new Float32Array(VOICES + 1);
    this.cmds = [];
    this.lastSent = '';
    this.complexity = 0.5;
    this.evolve = 0; // mutate every this many bars while playing (0 = off)
    this.lastBar = 0;
    this.undo = [];

    for (let i = 0; i < FACTORY.length; i++) {
      const o = document.createElement('option');
      o.value = i;
      o.textContent = `Factory ${String(i + 1).padStart(2, '0')}`;
      presetSelect.append(o);
    }
    presetSelect.addEventListener('change', () => this.loadPreset(Number(presetSelect.value)));

    // keyboard: 1-7 hit a voice, space plays/stops
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLSelectElement || e.repeat) return;
      if (e.key >= '1' && e.key <= '7') {
        const h = Number(e.key) - 1;
        this.cmds.push({ type: 'hit', voice: h });
        this.voice = h;
      } else if (e.key === ' ') {
        e.preventDefault();
        this.cmds.push({ type: this.playing ? 'stop' : 'play' });
      } else if ((e.key === 'z' || e.key === 'Z') && !e.altKey) {
        e.preventDefault();
        this.undoLast();
      } else if (e.ctrlKey || e.metaKey || e.altKey) {
        // leave browser shortcuts alone
      } else if (e.key === 'r' || e.key === 'R') {
        this.randomise('all');
      } else if (e.key === 'm' || e.key === 'M') {
        this.randomise('mutate');
      }
    });

    const frame = () => {
      this.update();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /** Called with each state report from the worklet (the Rust `pull`). */
  receive(state) {
    this.playing = state.playing;
    for (let i = 0; i < VOICES; i++) {
      this.counts[i] = state.counts[i];
      if (state.hits[i] !== this.hitsSeen[i]) {
        this.hitsSeen[i] = state.hits[i];
        this.flash[i] = performance.now();
      }
    }
    this.meters = state.meters;
    // evolve: mutate the patch at the start of every N bars
    if (state.bars !== undefined) {
      if (this.evolve && state.playing && state.bars > this.lastBar && state.bars % this.evolve === 0) {
        this.randomise('mutate');
      }
      this.lastBar = state.bars;
    }
  }

  /** Apply a randomise mode, keeping the old patch for undo. */
  randomise(mode) {
    this.undo.push(this.params.clone());
    if (this.undo.length > UNDO_LIMIT) this.undo.shift();
    randomise(this.params, mode, this.complexity);
  }

  undoLast() {
    const prev = this.undo.pop();
    if (prev) this.params = prev;
  }

  loadPreset(i) {
    if (this.params) this.undo.push(this.params.clone());
    this.preset = i;
    this.params = Params.fromFactory(FACTORY[i]);
  }

  /** The Rust `push`: hand the settings and queued commands to the engine. */
  push() {
    const json = JSON.stringify(this.params);
    if (json !== this.lastSent) {
      this.lastSent = json;
      this.audio.send({ type: 'params', params: this.params });
    }
    for (const c of this.cmds.splice(0)) {
      if (c.type !== 'stop') this.audio.ensure();
      this.audio.send(c);
      if (c.type === 'play') this.playing = true;
      if (c.type === 'stop') this.playing = false;
    }
  }

  layout() {
    const dpr = devicePixelRatio || 1;
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(cw * dpr) || this.canvas.height !== Math.round(ch * dpr)) {
      this.canvas.width = Math.round(cw * dpr);
      this.canvas.height = Math.round(ch * dpr);
    }
    // scale the fixed layout to fit the window
    const z = clamp(Math.min(cw / DESIGN_W, ch / DESIGN_H), 0.3, 4);
    this.z = z;
    this.ox = (cw - DESIGN_W * z) / 2;
    this.oy = (ch - DESIGN_H * z) / 2;
    this.g.setTransform(z * dpr, 0, 0, z * dpr, this.ox * dpr, this.oy * dpr);
  }

  toDesign(e) {
    const b = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - b.left - this.ox) / this.z, y: (e.clientY - b.top - this.oy) / this.z };
  }

  /** Lay a DOM element over a design-space rect. */
  place(el, r) {
    const b = this.canvas.getBoundingClientRect();
    Object.assign(el.style, {
      left: `${b.left + scrollX + this.ox + r.x0 * this.z}px`,
      top: `${b.top + scrollY + this.oy + r.y0 * this.z}px`,
      width: `${W(r) * this.z}px`,
      height: `${H(r) * this.z}px`,
      fontSize: `${13 * this.z}px`,
    });
  }

  update() {
    this.layout();
    this.input.begin();
    const g = this.g;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = BG;
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    g.restore();

    const area = rect(0, 0, DESIGN_W, DESIGN_H);
    const m = 8;
    const header = rectSize(area.x0 + m, area.y0 + 4, W(area) - 2 * m, 44);
    const top = header.y1 + 4;
    const bottom = 512; // the panels keep the original's size; the randomise bar goes below
    const lw = 372;
    const vw = 404;
    const left = rect(area.x0 + m, top, area.x0 + m + lw, bottom);
    const mid = rect(left.x1 + 8, top, left.x1 + 8 + vw, bottom);
    const right = rect(mid.x1 + 8, top, area.x1 - m, bottom);
    this.header(header);
    this.left(left);
    this.voicePanel(mid);
    this.displayPanel(right);
    this.randomBar(rect(area.x0 + m, bottom + 6, area.x1 - m, area.y1 - m));

    this.input.end();
    this.push();
  }

  // ----- widgets (each draws and handles the mouse) -----

  /** Rotary knob. Drag up/down to change, double-click for the default value. */
  knob(id, center, radius, label, obj, key, min, max, def, shown) {
    const g = this.g;
    const r = rectCenter(center.x, center.y, radius * 2 + 8, radius * 2 + 8);
    const resp = this.input.interact(r, id);
    if (resp.dragged && resp.delta.y) {
      const fine = this.input.shift ? 0.2 : 1.0;
      const d = (-resp.delta.y / 150) * (max - min) * fine;
      obj[key] = clamp(obj[key] + d, min, max);
    }
    if (resp.doubleClicked) obj[key] = def;
    const t = clamp((obj[key] - min) / (max - min), 0, 1);
    const a0 = Math.PI * 0.75;
    const sweep = Math.PI * 1.5;
    const pts = (from, to) =>
      Array.from({ length: 25 }, (_, k) => {
        const a = a0 + sweep * (from + ((to - from) * k) / 24);
        return { x: center.x + Math.cos(a) * (radius + 2.5), y: center.y + Math.sin(a) * (radius + 2.5) };
      });
    polyline(g, pts(0, 1), 2.5, '#1a1b1d');
    if (t > 0) polyline(g, pts(0, t), 2.5, ACCENT);
    circleFill(g, center, radius, '#3d3f43');
    circleStroke(g, center, radius, 1, '#585a5f');
    const a = a0 + sweep * t;
    lineSeg(
      g,
      { x: center.x + Math.cos(a) * radius * 0.3, y: center.y + Math.sin(a) * radius * 0.3 },
      { x: center.x + Math.cos(a) * radius * 0.9, y: center.y + Math.sin(a) * radius * 0.9 },
      2,
      resp.hovered || resp.dragged ? HOT : TEXT,
    );
    small(g, { x: center.x, y: center.y + radius + 5 }, 'CENTER_TOP', label, DIM);
    small(g, { x: center.x, y: center.y + radius + 16 }, 'CENTER_TOP', shown(obj[key]), TEXT);
  }

  /** Two-way pad: x left->right, y bottom->top, both 0..1. Returns whether it changed. */
  xyPad(id, r, obj, kx, ky) {
    const g = this.g;
    well(g, r);
    grid(g, r, 10);
    const resp = this.input.interact(r, id);
    let changed = false;
    if (resp.dragged || resp.clicked) {
      const pp = resp.pointer;
      obj[kx] = clamp((pp.x - r.x0) / W(r), 0, 1);
      obj[ky] = clamp(1 - (pp.y - r.y0) / H(r), 0, 1);
      changed = true;
    }
    const pt = { x: r.x0 + obj[kx] * W(r), y: r.y1 - obj[ky] * H(r) };
    const c = 'rgba(90,156,207,0.27)';
    lineSeg(g, { x: pt.x, y: r.y0 }, { x: pt.x, y: r.y1 }, 1, c);
    lineSeg(g, { x: r.x0, y: pt.y }, { x: r.x1, y: pt.y }, 1, c);
    circleFill(g, pt, 5, ACCENT);
    circleStroke(g, pt, 5, 1, HOT);
    return changed;
  }

  /** Horizontal mini slider. */
  hslider(id, r, obj, key, min, max, def, bipolar) {
    const g = this.g;
    fillRect(g, r, 2, WELL);
    strokeRect(g, r, 2, 1, LINE);
    const resp = this.input.interact(r, id);
    if (resp.dragged && resp.delta.x) {
      obj[key] = clamp(obj[key] + (resp.delta.x / W(r)) * (max - min), min, max);
    }
    if (resp.doubleClicked) obj[key] = def;
    const t = (obj[key] - min) / (max - min);
    const inner = shrink(r, 2);
    g.fillStyle = ACCENT;
    if (bipolar) {
      const c = cx(inner);
      const x = inner.x0 + t * W(inner);
      const x0 = Math.min(c, x);
      g.fillRect(x0, inner.y0, Math.max(Math.max(c, x) - x0, 1), H(inner));
    } else {
      g.fillRect(inner.x0, inner.y0, t * W(inner), H(inner));
    }
  }

  /** Vertical level fader in dB (-60..0) with a meter. */
  fader(id, r, obj, key, def, meter) {
    const g = this.g;
    fillRect(g, r, 3, WELL);
    strokeRect(g, r, 3, 1, LINE);
    for (let k = 1; k < 12; k++) {
      const y = r.y0 + (H(r) * k) / 12;
      lineSeg(g, { x: r.x0 + 3, y }, { x: r.x0 + 7, y }, 1, LINE);
      lineSeg(g, { x: r.x1 - 7, y }, { x: r.x1 - 3, y }, 1, LINE);
    }
    // meter
    const mdb = meter > 1e-4 ? 20 * Math.log10(meter) : -60;
    const mt = clamp((mdb + 60) / 60, 0, 1);
    g.fillStyle = '#3fb070';
    g.fillRect(cx(r) - 2, r.y1 - 3 - mt * (H(r) - 6), 4, mt * (H(r) - 6));
    const resp = this.input.interact(r, id);
    if (resp.dragged && resp.delta.y) {
      obj[key] = clamp(obj[key] + (-resp.delta.y / (H(r) - 10)) * 60, -60, 0);
    }
    if (resp.doubleClicked) obj[key] = def;
    const t = (obj[key] + 60) / 60;
    const y = r.y1 - 5 - t * (H(r) - 10);
    const cap = rectCenter(cx(r), y, W(r) - 4, 9);
    fillRect(g, cap, 2, '#8a8c90');
    lineSeg(g, { x: cap.x0 + 2, y }, { x: cap.x1 - 2, y }, 1, '#000');
  }

  toggle(id, r, label, on) {
    const g = this.g;
    const resp = this.input.interact(r, id);
    const fill = on ? ACCENT : resp.hovered ? '#44464a' : '#36373b';
    fillRect(g, r, 3, fill);
    strokeRect(g, r, 3, 1, PANEL_EDGE);
    text(g, { x: cx(r), y: cy(r) }, 'CENTER_CENTER', label, prop(11), on ? '#fff' : TEXT);
    return resp.clicked;
  }

  envGraph(r, att, attC, dec, decC) {
    // time axis is scaled so both a 25 ms attack and a 2 s decay stay readable
    const aw = Math.sqrt(att / 25) * 0.3 * W(r);
    const dw = Math.sqrt(dec / 2000) * 0.7 * W(r);
    const h = H(r) - 6;
    const pts = [];
    for (let k = 0; k <= 20; k++) {
      const t = k / 20;
      pts.push({ x: r.x0 + 3 + t * aw, y: r.y1 - 3 - shape(t, -attC) * h });
    }
    for (let k = 0; k <= 40; k++) {
      const t = k / 40;
      pts.push({ x: r.x0 + 3 + aw + t * dw, y: r.y1 - 3 - (1 - shape(t, decC)) * h });
    }
    polyline(this.g, pts, 1.5, ACCENT);
  }

  // ----- panels -----

  header(r) {
    const g = this.g;
    // logo: a hexagon outline with a dot (original shapes only)
    const c = { x: r.x0 + 22, y: cy(r) };
    const hex = Array.from({ length: 7 }, (_, k) => {
      const a = Math.PI / 6 + (k * TAU) / 6;
      return { x: c.x + Math.cos(a) * 15, y: c.y + Math.sin(a) * 15 };
    });
    polyline(g, hex, 3, ACCENT);
    circleFill(g, c, 4, HOT);
    text(g, { x: r.x0 + 46, y: r.y0 + 6 }, 'LEFT_TOP', 'NEURODRUM', prop(22), '#fff');
    text(g, { x: r.x0 + 48, y: r.y0 + 31 }, 'LEFT_TOP', 'neural rhythm sequencer · FM percussion synth', prop(11), DIM);
    small(g, { x: r.x1 - 4, y: r.y0 + 32 }, 'RIGHT_TOP', VERSION, DIM);

    // preset picker: PRESET ◀ [Factory nn] ▶ Init
    const x = r.x1 - 430;
    const y = r.y0 + 6;
    text(g, { x, y: y + 13 }, 'LEFT_CENTER', 'PRESET', prop(12), LABEL);
    const n = FACTORY.length;
    if (this.toggle('pprev', rectSize(x + 52, y + 1, 24, 24), '◀', false)) this.loadPreset((this.preset + n - 1) % n);
    const sel = rectSize(x + 82, y + 1, 182, 24);
    fillRect(g, sel, 3, '#36373b');
    strokeRect(g, sel, 3, 1, PANEL_EDGE);
    this.place(this.select, sel);
    if (Number(this.select.value) !== this.preset) this.select.value = String(this.preset);
    if (this.toggle('pnext', rectSize(x + 270, y + 1, 24, 24), '▶', false)) this.loadPreset((this.preset + 1) % n);
    if (this.toggle('pinit', rectSize(x + 300, y + 1, 40, 24), 'Init', false)) this.loadPreset(n - 1);
  }

  left(r) {
    const g = this.g;
    const inp = this.input;
    panel(g, r);
    const inner = shrink(r, 8);
    // top strip: clock | rate | transport
    const strip = rectSize(inner.x0, inner.y0, W(inner), 58);
    well(g, strip);
    const c1 = strip.x0 + W(strip) * 0.36;
    const c2 = strip.x0 + W(strip) * 0.62;
    lineSeg(g, { x: c1, y: strip.y0 }, { x: c1, y: strip.y1 }, 2, PANEL);
    lineSeg(g, { x: c2, y: strip.y0 }, { x: c2, y: strip.y1 }, 2, PANEL);
    heading(g, { x: strip.x0 + 6, y: strip.y0 + 4 }, 'CLOCK');
    // tempo drag
    const tr = rectSize(strip.x0 + 8, strip.y0 + 24, c1 - strip.x0 - 16, 26);
    const resp = inp.interact(tr, 'tempo');
    if (resp.dragged) {
      this.params.tempo = clamp(this.params.tempo - resp.delta.y * 0.5 + resp.delta.x * 0.5, 20, 240);
    }
    if (resp.doubleClicked) this.params.tempo = 120;
    text(g, { x: tr.x0, y: cy(tr) }, 'LEFT_CENTER', `${Math.round(this.params.tempo)} bpm`, mono(18), resp.hovered ? HOT : TEXT);
    heading(g, { x: c1 + 6, y: strip.y0 + 4 }, 'RATE');
    RATE_NAMES.forEach((name, k) => {
      const b = rectSize(c1 + 6 + k * ((c2 - c1 - 10) / 3), strip.y0 + 26, (c2 - c1 - 16) / 3, 24);
      if (this.toggle(`rate${k}`, b, name, this.params.rate === k)) this.params.rate = k;
    });
    heading(g, { x: c2 + 6, y: strip.y0 + 4 }, 'TRANSPORT');
    const bw = (strip.x1 - c2 - 18) / 2;
    const sb = rectSize(c2 + 6, strip.y0 + 26, bw, 24);
    const pb = rectSize(c2 + 12 + bw, strip.y0 + 26, bw, 24);
    if (this.toggle('stop', sb, 'stop', !this.playing)) this.cmds.push({ type: 'stop' });
    if (this.toggle('play', pb, 'play', this.playing)) this.cmds.push({ type: 'play' });

    // neurons
    const nr = rect(inner.x0, strip.y1 + 6, inner.x1, inner.y1);
    well(g, nr);
    heading(g, { x: nr.x0 + 6, y: nr.y0 + 4 }, 'NEURONS');
    if (this.toggle('wire', rectSize(nr.x1 - 128, nr.y0 + 5, 56, 20), 'wire', this.wiring)) this.wiring = !this.wiring;
    if (this.toggle('clear', rectSize(nr.x1 - 66, nr.y0 + 5, 58, 20), 'clear', false)) this.params.clearLinks();
    small(
      g,
      { x: nr.x0 + 8, y: nr.y1 - 6 },
      'LEFT_BOTTOM',
      this.wiring ? 'click a neuron to make it listen' : 'shift-click to set listener',
      DIM,
    );
    const center = { x: cx(nr), y: cy(nr) + 8 };
    const radius = Math.min(H(nr) * 0.36, W(nr) * 0.34);
    const nodeR = 19;
    // faint wiring frame like the original's hexagon
    for (let a = 1; a < 7; a++) {
      for (let b = a + 1; b < 7; b++) {
        lineSeg(g, neuronPos(center, radius, a), neuronPos(center, radius, b), 1, '#303236');
      }
      lineSeg(g, center, neuronPos(center, radius, a), 1, '#303236');
    }
    for (let from = 0; from < VOICES; from++) {
      for (let to = 0; to < VOICES; to++) {
        if (this.params.links[from][to]) {
          const col = from === this.voice || to === this.voice ? HOT : ACCENT;
          arrow(g, neuronPos(center, radius, from), neuronPos(center, radius, to), nodeR, col);
        }
      }
    }
    const now = performance.now();
    for (let i = 0; i < VOICES; i++) {
      const pos = neuronPos(center, radius, i);
      const nresp = inp.interact(rectCenter(pos.x, pos.y, nodeR * 2, nodeR * 2), `neuron${i}`);
      if (nresp.clicked) {
        if ((inp.shift || this.wiring) && i !== this.voice) {
          const existed = this.params.links[this.voice][i];
          const nowLinked = this.params.toggleLink(this.voice, i);
          if (!existed && !nowLinked) this.refused = { n: i, t: now };
        } else {
          this.voice = i;
        }
      }
      if (nresp.secondaryClicked) this.cmds.push({ type: 'hit', voice: i });
      const fl = this.flash[i] === null ? 0 : Math.max(1 - (now - this.flash[i]) / 250, 0);
      circleFill(g, pos, nodeR, lerpColor('#4a4c51', HOT, fl));
      let edge = [1, '#66686d'];
      if (this.refused && this.refused.n === i && now - this.refused.t < 400) edge = [2.5, WARN];
      else if (i === this.voice) edge = [2.5, ACCENT];
      else if (nresp.hovered) edge = [1.5, TEXT];
      circleStroke(g, pos, nodeR, edge[0], edge[1]);
      text(g, { x: pos.x, y: pos.y - 4 }, 'CENTER_CENTER', String(i), prop(15), fl > 0.5 ? '#000' : '#fff');
      // count dots: threshold+1 small dots, filled up to count
      const n = this.params.voices[i].threshold + 1;
      for (let k = 0; k < n; k++) {
        const dp = { x: pos.x + (k - (n - 1) / 2) * 4.5, y: pos.y + 9 };
        if (k < this.counts[i]) circleFill(g, dp, 1.6, HOT);
        else circleStroke(g, dp, 1.4, 0.8, DIM);
      }
    }
    // clock marker: a small "clock in" tick under neuron 0
    const c = this.playing ? ACCENT : DIM;
    const a = { x: center.x - nodeR - 16, y: center.y + nodeR + 14 };
    lineSeg(g, a, { x: center.x - nodeR * 0.55, y: center.y + nodeR * 0.75 }, 1.5, c);
    text(g, { x: a.x - 2, y: a.y + 2 }, 'RIGHT_TOP', 'clock', mono(10), c);
  }

  voicePanel(r) {
    const g = this.g;
    panel(g, r);
    const inner = shrink(r, 8);
    const v = this.voice;
    // top strip: voice | thrsh | pitch
    const strip = rectSize(inner.x0, inner.y0, W(inner), 58);
    well(g, strip);
    const c1 = strip.x0 + 112;
    const c2 = c1 + 86;
    for (const x of [c1, c2]) lineSeg(g, { x, y: strip.y0 }, { x, y: strip.y1 }, 2, PANEL);
    heading(g, { x: strip.x0 + 6, y: strip.y0 + 4 }, 'VOICE');
    if (this.toggle('vprev', rectSize(strip.x0 + 8, strip.y0 + 26, 22, 24), '◀', false)) this.voice = (v + VOICES - 1) % VOICES;
    if (this.toggle('vnext', rectSize(strip.x0 + 78, strip.y0 + 26, 22, 24), '▶', false)) this.voice = (v + 1) % VOICES;
    text(g, { x: strip.x0 + 54, y: strip.y0 + 38 }, 'CENTER_CENTER', String(v), mono(20), '#fff');
    heading(g, { x: c1 + 6, y: strip.y0 + 4 }, 'THRSH');
    const vp = this.params.voices[v];
    const th = vp.threshold;
    if (this.toggle('thd', rectSize(c1 + 6, strip.y0 + 26, 20, 24), '−', false) && th > 0) vp.threshold = th - 1;
    if (this.toggle('thu', rectSize(c2 - 26, strip.y0 + 26, 20, 24), '+', false) && th < 6) vp.threshold = th + 1;
    text(g, { x: (c1 + c2) / 2, y: strip.y0 + 38 }, 'CENTER_CENTER', String(vp.threshold), mono(20), '#fff');
    heading(g, { x: c2 + 6, y: strip.y0 + 4 }, 'PITCH');
    // pitch: horizontal drag field
    const pr = rect(c2 + 8, strip.y0 + 24, strip.x1 - 62, strip.y1 - 6);
    const resp = this.input.interact(pr, 'pitchdrag');
    if (resp.dragged) {
      const fine = this.input.shift ? 0.02 : 0.1;
      vp.pitch = clamp(vp.pitch + (resp.delta.x - resp.delta.y) * fine, 0, 100);
    }
    if (resp.doubleClicked) vp.pitch = 60;
    fillRect(g, pr, 3, '#0c0d0e');
    fillRect(g, rect(pr.x0, pr.y0, pr.x0 + clamp(vp.pitch / 100, 0, 1) * W(pr), pr.y1), 3, '#1d3c58');
    strokeRect(g, pr, 3, 1, LINE);
    text(g, { x: pr.x0 + 6, y: cy(pr) }, 'LEFT_CENTER', `${vp.pitch.toFixed(1)} ${pitchHz(vp.pitch).toFixed(0)}Hz`, mono(13), resp.hovered ? HOT : TEXT);
    if (this.toggle('midionly', rectSize(strip.x1 - 56, strip.y0 + 26, 50, 24), 'silent', vp.midi_only)) vp.midi_only = !vp.midi_only;

    // envelopes
    const midTop = strip.y1 + 6;
    const half = (W(inner) - 6) / 2;
    const eh = 128;
    const ar = rectSize(inner.x0, midTop, half, eh);
    const pr2 = rectSize(inner.x0 + half + 6, midTop, half, eh);
    well(g, ar);
    well(g, pr2);
    heading(g, { x: ar.x0 + 6, y: ar.y0 + 4 }, 'AMP EG');
    heading(g, { x: pr2.x0 + 6, y: pr2.y0 + 4 }, 'PITCH EG');
    this.envGraph(rectSize(ar.x0 + 70, ar.y0 + 6, half - 76, 26), vp.amp_att, vp.amp_att_c, vp.amp_dec, vp.amp_dec_c);
    this.envGraph(rectSize(pr2.x0 + 80, pr2.y0 + 6, half - 86, 26), vp.pit_att, vp.pit_att_c, vp.pit_dec, vp.pit_dec_c);
    const ky = ar.y0 + 64;
    const kr = 13;
    const msF = (x) => `${x.toFixed(1)}ms`;
    const ms0 = (x) => `${x.toFixed(0)}ms`;
    const crv = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);
    let step = half / 4;
    this.knob('aa', { x: ar.x0 + step * 0.5, y: ky }, kr, 'attack', vp, 'amp_att', 0.001, 25, 0.001, msF);
    this.knob('aac', { x: ar.x0 + step * 1.5, y: ky }, kr, 'curve', vp, 'amp_att_c', -1, 1, -0.5, crv);
    this.knob('ad', { x: ar.x0 + step * 2.5, y: ky }, kr, 'decay', vp, 'amp_dec', 10, 2000, 400, ms0);
    this.knob('adc', { x: ar.x0 + step * 3.5, y: ky }, kr, 'curve', vp, 'amp_dec_c', -1, 1, -0.5, crv);
    step = half / 5;
    const px = pr2.x0;
    this.knob('pa', { x: px + step * 0.5, y: ky }, kr, 'attack', vp, 'pit_att', 0.001, 25, 0.1, msF);
    this.knob('pac', { x: px + step * 1.5, y: ky }, kr, 'curve', vp, 'pit_att_c', -1, 1, -0.5, crv);
    this.knob('pd', { x: px + step * 2.5, y: ky }, kr, 'decay', vp, 'pit_dec', 10, 2000, 400, ms0);
    this.knob('pdc', { x: px + step * 3.5, y: ky }, kr, 'curve', vp, 'pit_dec_c', -1, 1, -0.5, crv);
    this.knob('pam', { x: px + step * 4.5, y: ky }, kr, 'amount', vp, 'pitch_amt', 0, 1, 0.1, (x) => `${(x * 440).toFixed(0)}Hz`);

    // FM and timbre pads
    const padTop = ar.y1 + 6;
    const padH = inner.y1 - padTop - 46;
    const fr = rectSize(inner.x0, padTop, half, padH);
    const tr = rectSize(inner.x0 + half + 6, padTop, half, padH);
    this.xyPad('fmpad', fr, vp, 'fm_freq', 'fm_amt');
    this.xyPad('tpad', tr, vp, 'timbre_x', 'timbre_y');
    heading(g, { x: fr.x0 + 6, y: fr.y0 + 4 }, 'FM');
    heading(g, { x: tr.x0 + 6, y: tr.y0 + 4 }, 'TIMBRE');
    small(g, { x: fr.x1 - 6, y: fr.y0 + 6 }, 'RIGHT_TOP', `ratio ${(1 + 3 * vp.fm_freq).toFixed(2)}  depth ${(vp.fm_amt * 4400).toFixed(0)}Hz`, DIM);
    small(g, { x: tr.x1 - 6, y: tr.y0 + 6 }, 'RIGHT_TOP', `x ${vp.timbre_x.toFixed(2)}  y ${vp.timbre_y.toFixed(2)}`, DIM);

    // sends
    const sr = rect(inner.x0, inner.y1 - 40, inner.x1, inner.y1);
    well(g, sr);
    const sw = W(sr) / 2 - 100;
    const rows = [['FM Send', 'fm_send'], ['FM Receive', 'fm_recv'], ['Ring Send', 'am_send'], ['Ring Receive', 'am_recv']];
    rows.forEach(([name, key], k) => {
      const x = sr.x0 + 8 + Math.floor(k / 2) * (W(sr) / 2);
      const y = sr.y0 + 6 + (k % 2) * 17;
      small(g, { x, y: y + 1 }, 'LEFT_TOP', name, DIM);
      this.hslider(`send${k}`, rectSize(x + 84, y, sw, 12), vp, key, 0, 1, 0, false);
    });
  }

  displayPanel(r) {
    const g = this.g;
    panel(g, r);
    const inner = shrink(r, 8);
    // tab buttons
    const tabs = rectSize(inner.x0, inner.y0, W(inner), 26);
    heading(g, { x: tabs.x0 + 2, y: tabs.y0 + 5 }, 'DISPLAY');
    if (this.toggle('tmix', rectSize(tabs.x0 + 80, tabs.y0, 80, 24), 'Mixer', this.display === 'mixer')) this.display = 'mixer';
    if (this.toggle('tdel', rectSize(tabs.x0 + 166, tabs.y0, 80, 24), 'Delay', this.display === 'delay')) this.display = 'delay';
    const body = rect(inner.x0, tabs.y1 + 6, inner.x1, inner.y1);
    well(g, body);
    if (this.display === 'mixer') this.mixer(body);
    else this.delay(body);
  }

  mixer(r) {
    const g = this.g;
    const w = (W(r) - 12) / (VOICES + 1);
    for (let i = 0; i < VOICES; i++) {
      const x0 = r.x0 + 6 + i * w;
      const sr = rectSize(x0 + 2, r.y0 + 4, w - 4, H(r) - 8);
      const sel = i === this.voice;
      const hr = rectSize(sr.x0, sr.y0, W(sr), 18);
      if (this.input.interact(hr, `mixsel${i}`).clicked) this.voice = i;
      fillRect(g, hr, 2, sel ? '#244a6c' : '#242528');
      text(g, { x: cx(hr), y: cy(hr) }, 'CENTER_CENTER', `Voice ${i}`, prop(11.5), '#fff');
      const vp = this.params.voices[i];
      const y = hr.y1 + 6;
      small(g, { x: sr.x0, y }, 'LEFT_TOP', 'FX', DIM);
      this.hslider(`fx${i}`, rectSize(sr.x0 + 16, y + 1, W(sr) - 18, 10), vp, 'fx_send', 0, 1, 0, false);
      small(g, { x: sr.x0, y: y + 16 }, 'LEFT_TOP', 'Pn', DIM);
      this.hslider(`pan${i}`, rectSize(sr.x0 + 16, y + 17, W(sr) - 18, 10), vp, 'pan', -1, 1, 0, true);
      // chance that a firing neuron plays this voice (added in the JS version)
      small(g, { x: sr.x0, y: y + 32 }, 'LEFT_TOP', 'Ch', DIM);
      this.hslider(`ch${i}`, rectSize(sr.x0 + 16, y + 33, W(sr) - 18, 10), vp, 'chance', 0, 1, 1, false);
      const bw = (W(sr) - 4) / 2;
      if (this.toggle(`m${i}`, rectSize(sr.x0, y + 49, bw, 18), 'M', vp.mute)) vp.mute = !vp.mute;
      const soloed = this.params.solo === i;
      if (this.toggle(`s${i}`, rectSize(sr.x0 + bw + 4, y + 49, bw, 18), 'S', soloed)) this.params.solo = soloed ? -1 : i;
      const fr = rect(cx(sr) - 11, y + 74, cx(sr) + 11, sr.y1 - 14);
      this.fader(`lv${i}`, fr, vp, 'level', -3, this.meters[i]);
      small(g, { x: cx(sr), y: sr.y1 }, 'CENTER_BOTTOM', `${vp.level.toFixed(0)}dB`, TEXT);
    }
    // master
    const x0 = r.x0 + 6 + VOICES * w;
    const sr = rectSize(x0 + 2, r.y0 + 4, w - 4, H(r) - 8);
    fillRect(g, sr, 3, '#1c1d20');
    text(g, { x: cx(sr), y: sr.y0 + 9 }, 'CENTER_CENTER', 'Master', prop(11.5), '#fff');
    const fr = rect(cx(sr) - 11, sr.y0 + 96, cx(sr) + 11, sr.y1 - 14);
    this.fader('master', fr, this.params, 'master', 0, this.meters[VOICES]);
    small(g, { x: cx(sr), y: sr.y1 }, 'CENTER_BOTTOM', `${this.params.master.toFixed(0)}dB`, TEXT);
  }

  /** The randomise bar (added in the JS version). */
  randomBar(r) {
    const g = this.g;
    panel(g, r);
    const y = r.y0 + 6;
    const h = H(r) - 12;
    heading(g, { x: r.x0 + 10, y: cy(r) - 8 }, 'RANDOMISE');
    let x = r.x0 + 104;
    for (const m of MODES) {
      if (this.toggle(`rnd-${m.id}`, rectSize(x, y, 62, h), m.label, false)) this.randomise(m.id);
      x += 66;
    }
    x += 14;
    small(g, { x, y: cy(r) }, 'LEFT_CENTER', 'complexity', DIM);
    const cr = rectSize(x + 76, cy(r) - 6, 120, 12);
    this.hslider('complexity', cr, this, 'complexity', 0, 1, 0.5, false);
    small(g, { x: cr.x1 + 6, y: cy(r) }, 'LEFT_CENTER', `${Math.round(this.complexity * 100)}%`, TEXT);
    x = cr.x1 + 52;
    heading(g, { x, y: cy(r) - 8 }, 'EVOLVE');
    x += 58;
    for (const n of EVOLVE_BARS) {
      const label = n === 0 ? 'off' : n === 1 ? '1 bar' : `${n}`;
      if (this.toggle(`evolve${n}`, rectSize(x, y, n === 1 ? 44 : 32, h), label, this.evolve === n)) {
        this.evolve = n;
        this.lastBar = 0;
      }
      x += (n === 1 ? 44 : 32) + 4;
    }
    const ur = rectSize(r.x1 - 70, y, 62, h);
    if (this.toggle('undo', ur, 'Undo', false)) this.undoLast();
    if (!this.undo.length) fillRect(g, ur, 3, 'rgba(43,44,47,0.6)');
  }

  delay(r) {
    const g = this.g;
    const p = this.params;
    const left = rectSize(r.x0, r.y0, 120, H(r));
    const right = rect(r.x1 - 70, r.y0, r.x1, r.y1);
    const pad = rect(left.x1 + 6, r.y0 + 24, right.x0 - 6, r.y1 - 50);
    lineSeg(g, { x: left.x1, y: r.y0 }, { x: left.x1, y: r.y1 }, 2, PANEL);
    lineSeg(g, { x: right.x0, y: r.y0 }, { x: right.x0, y: r.y1 }, 2, PANEL);
    lineSeg(g, { x: r.x0, y: cy(r) }, { x: left.x1, y: cy(r) }, 2, PANEL);
    for (let side = 0; side < 2; side++) {
      const top = side === 0 ? r.y0 : cy(r);
      heading(g, { x: r.x0 + 6, y: top + 4 }, side === 0 ? 'DELAY LEFT' : 'DELAY RIGHT');
      const center = { x: r.x0 + 36, y: top + 62 };
      if (p.delay_sync[side]) {
        const box = { idx: p.delay_note[side] };
        this.knob(`dl${side}`, center, 15, 'time', box, 'idx', 0, 14, 8, (x) => SYNC_NAMES[Math.min(Math.round(x), 14)]);
        p.delay_note[side] = clamp(Math.round(box.idx), 0, 14);
      } else {
        this.knob(`dl${side}`, center, 15, 'time', p.delay_ms, side, 0, 1999, 0, (x) => `${x.toFixed(0)}ms`);
      }
      if (this.toggle(`sync${side}`, rectSize(r.x0 + 70, top + 50, 44, 22), 'sync', p.delay_sync[side])) {
        p.delay_sync[side] = !p.delay_sync[side];
      }
    }
    heading(g, { x: left.x1 + 8, y: r.y0 + 4 }, 'FEEDBACK / FILTER');
    // x: filter frequency (log 10..10000), y: feedback dB (-60..-0.5)
    const xy = {
      x: clamp(Math.log10(p.filter_freq / 10) / 3, 0, 1),
      y: clamp((p.feedback + 60) / 59.5, 0, 1),
    };
    if (this.xyPad('fbpad', pad, xy, 'x', 'y')) {
      p.filter_freq = 10 * Math.pow(1000, xy.x);
      p.feedback = -60 + xy.y * 59.5;
    }
    // band drawn on the pad: the part of the spectrum the feedback keeps
    const w = p.filter_width;
    const toX = (f) => pad.x0 + clamp(Math.log10(f / 10) / 3, 0, 1) * W(pad);
    g.fillStyle = 'rgba(47,143,220,0.11)';
    const bx0 = toX(p.filter_freq / w);
    g.fillRect(bx0, pad.y0, toX(p.filter_freq * w) - bx0, H(pad));
    small(g, { x: pad.x0 + 4, y: pad.y1 - 4 }, 'LEFT_BOTTOM', `${p.filter_freq.toFixed(0)} Hz  fb ${p.feedback.toFixed(1)} dB`, DIM);
    const wr = rect(pad.x0 + 80, pad.y1 + 20, pad.x1 - 8, pad.y1 + 32);
    small(g, { x: pad.x0 + 2, y: pad.y1 + 20 }, 'LEFT_TOP', 'Filter Width', DIM);
    this.hslider('fwidth', wr, p, 'filter_width', 1, 7, 5.8, false);
    small(g, { x: wr.x1, y: wr.y1 + 2 }, 'RIGHT_TOP', p.filter_width.toFixed(1), TEXT);
    // return
    text(g, { x: cx(right), y: right.y0 + 10 }, 'CENTER_CENTER', 'Return', prop(11.5), '#fff');
    if (this.toggle('fxmute', rectSize(cx(right) - 22, right.y0 + 22, 44, 18), 'mute', p.fx_mute)) p.fx_mute = !p.fx_mute;
    const fr = rect(cx(right) - 11, right.y0 + 48, cx(right) + 11, right.y1 - 16);
    this.fader('fxlevel', fr, p, 'fx_level', -60, 0);
    small(g, { x: cx(right), y: right.y1 - 2 }, 'CENTER_BOTTOM', `${p.fx_level.toFixed(0)}dB`, TEXT);
  }
}
