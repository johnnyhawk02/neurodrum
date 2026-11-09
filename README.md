# Neurodrum (JavaScript)

A neural rhythm sequencer and FM percussion synth in plain JavaScript, with no dependencies.
Seven FM drum voices are triggered by seven counting "neurons": the clock pulses neuron 0, and
each neuron fires after a set number of pulses and passes the pulse on to the neurons it is
wired to. The page runs the whole app in the browser.

This is a port of the Rust `neurodrum` app (`../neurodrum/app/src`). How the sound works is
described in `../neurodrum/app/MECHANICS.md`.

## Files

| File | What it is | Ported from |
|---|---|---|
| `engine.js` | `Engine` (neurons, clock, voices, FM and ring buses, mixer, delay) and `Params` | `engine.rs` |
| `presets.js` | the 42 factory presets as stored 0..1 values and link matrices | `presets.rs` |
| `ui.js` | the screen, drawn on a canvas | `ui.rs` |
| `worklet.js` | AudioWorklet processor that runs `Engine` | the audio stream in `main.rs` |
| `main.js`, `index.html` | the webpage | `main.rs` |
| `index.js` | re-exports the engine and presets | |
| `test/` | checks, the comparison with the Rust, and a WAV renderer | |

## Play it

Serve the folder and open it in a browser, for example:

```sh
npm start          # python3 -m http.server 8000, then open http://localhost:8000
```

Worklets can't load from `file://`, so the page must be served over http(s).

The controls are the same as the Rust app:

- **Space** plays and stops; keys **1** to **7** hit a voice. Right-click a neuron to hit its voice.
- Click a neuron to edit its voice. **Shift-click** another neuron (or turn on **wire** and click)
  to make it listen to the selected one. Clicking again removes the link. A link that would make
  a loop reachable from neuron 0 is refused, and the neuron flashes red.
- Drag knobs, faders, sliders and the tempo up or down. Hold **Shift** for fine moves.
  Double-click for the default.
- The preset menu, ◀ ▶ and **Init** pick a factory preset.

## Using the engine in code

The engine runs anywhere, Node included:

```js
import { Engine, Params, FACTORY } from './index.js';

const engine = new Engine(48000);
engine.params = Params.fromFactory(FACTORY[0]);
engine.start();                      // run the clock; engine.thwack(voice, 1) hits a voice by hand
const buf = new Float32Array(256);
engine.render(buf, 2);               // 128 interleaved stereo frames (render(buf, 1) for mono)
engine.params.toggleLink(0, 3);      // neuron 0 now also fires neuron 3
engine.setThreshold(3, 2);           // neuron 3 fires on every third pulse
```

Settings in `Params` use the same names and units as the Rust (`pitch` 0..100, `amp_dec` in ms,
`level` in dB, and so on).

`node test/render-wav.mjs 5 8` writes eight seconds of Factory 05 to `preset-05.wav`.

## How close it is to the Rust

The Rust does its sound maths in 32-bit floats. JavaScript numbers are 64-bit, and in a first
version that used them the FM feedback and the oscillator phases amplified the tiny rounding
differences until the sound drifted audibly apart from the Rust within a second or two. So
`engine.js` rounds every step of the audio path to 32 bits with `Math.fround`, where the Rust
rounds.

`npm run test:rust` builds a small Rust program (`test/rust-reference`) that renders four
seconds of every factory preset with the original `engine.rs`, then renders the same with
`engine.js` and compares them. The worst preset differs by -77 dB relative to its signal
(the rest are lower), which is the last-bit differences between Rust's and JavaScript's `pow`,
`sin` and `exp`. The comparison needs Rust installed, and the `neurodrum` folder next to this one.

## Tests

```sh
npm test           # neuron rules, link rules, every preset renders cleanly
npm run test:rust  # sample-by-sample comparison with the Rust engine (needs cargo)
```

## Left out

- The `--screenshot` option of the Rust app.
- When audio can't start, the Rust keeps the clock running silently. In the browser the sound
  starts on the first click or key press, as browsers require.
