// AudioWorklet processor running the neurodrum Engine in the browser
// (the job app/src/main.rs gives the cpal audio stream).
//
//   await ctx.audioWorklet.addModule(new URL('./worklet.js', import.meta.url));
//   const node = new AudioWorkletNode(ctx, 'neurodrum', { outputChannelCount: [2] });
//   node.connect(ctx.destination);
//
// Messages to the processor (node.port.postMessage):
//   { type: 'params', params }     replace all settings (a Params-shaped plain object)
//   { type: 'play' } / { type: 'stop' }
//   { type: 'hit', voice: n }      play voice n now
//
// Messages from the processor, about 30 times a second:
//   { type: 'state', playing, counts: [7], hits: [7], meters: Float32Array(8) }

import { Engine, Params, VOICES } from './engine.js';

class NeurodrumProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.engine = new Engine(sampleRate);
    this.buf = new Float32Array(128 * 2);
    this.reportEvery = Math.max(1, Math.round(sampleRate / 30 / 128));
    this.blocks = 0;
    this.port.onmessage = ({ data }) => this.onMessage(data);
  }

  onMessage(data) {
    const e = this.engine;
    switch (data.type) {
      case 'params':
        e.params = Object.assign(new Params(), data.params);
        for (let i = 0; i < VOICES; i++) e.setThreshold(i, e.params.voices[i].threshold);
        break;
      case 'play': e.start(); break;
      case 'stop': e.stop(); break;
      case 'hit': e.thwack(data.voice, 1.0); break;
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const frames = out[0].length;
    if (this.buf.length !== frames * 2) this.buf = new Float32Array(frames * 2);
    this.engine.render(this.buf, 2);
    const l = out[0];
    const r = out[1] ?? out[0];
    for (let f = 0; f < frames; f++) {
      l[f] = this.buf[2 * f];
      if (out[1]) r[f] = this.buf[2 * f + 1];
    }
    if (++this.blocks >= this.reportEvery) {
      this.blocks = 0;
      const e = this.engine;
      this.port.postMessage({
        type: 'state',
        playing: e.playing,
        counts: e.nodes.map((n) => n.count),
        hits: e.hits.slice(),
        meters: Float32Array.from(e.meters),
      });
    }
    return true;
  }
}

registerProcessor('neurodrum', NeurodrumProcessor);
