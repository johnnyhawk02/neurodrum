// Starts the page: the screen (ui.js) and the sound engine in an AudioWorklet (worklet.js).
// Browsers only start audio after a click or key press, so the worklet is made on the first one.

import { App } from './ui.js';

let node = null;
let starting = null;
const pending = [];
let app;

function ensure() {
  starting ??= (async () => {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    await ctx.audioWorklet.addModule(new URL('./worklet.js', import.meta.url));
    node = new AudioWorkletNode(ctx, 'neurodrum', { outputChannelCount: [2] });
    node.port.onmessage = ({ data }) => data.type === 'state' && app.receive(data);
    node.connect(ctx.destination);
    // the latest settings first, then anything queued before audio was ready
    node.port.postMessage({ type: 'params', params: app.params });
    for (const m of pending.splice(0)) node.port.postMessage(m);
    if (ctx.state !== 'running') await ctx.resume();
  })();
  return starting;
}

function send(msg) {
  if (node) node.port.postMessage(msg);
  else if (msg.type !== 'params') pending.push(msg);
}

app = new App(document.getElementById('screen'), document.getElementById('preset'), { send, ensure });
window.__app = app; // handy in the browser console
addEventListener('pointerdown', ensure, { once: true });
addEventListener('keydown', ensure, { once: true });
