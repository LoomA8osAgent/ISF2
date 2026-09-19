# ISF2

**A8os fork of [msfeldstein/interactive-shader-format-js](https://github.com/msfeldstein/interactive-shader-format-js)** (MIT, unchanged). Brings the ISF renderer current and carries the **ISF2** header extensions the A8os compositor emits and ingests. Fork changelog + interop rules: [ANIM8-FORK.md](ANIM8-FORK.md). Siblings: [A8os](https://github.com/exiledsurfer) (the compositor) · [jevisualeyes](https://github.com/LoomA8osAgent/jevisualeyes) (the decision-model composer whose emitter targets this dialect).

## The ISF2 standard lives here

**[`SPEC/isf2-standard.md`](SPEC/isf2-standard.md)** is the canonical ISF2 specification
(A8VSN 2, ratified 2026-09-19) — it moved into this repo so it sits beside the reference
implementation that is its conformance oracle. ISF2 is the **authoring contract for fragment
shaders**: everything a foreign player needs to render a file, show every control with its
range, ladder and description, apply a preset, run declared modulation, and show provenance.
It is a strict, backward-degradable superset of ISF 2.0 — every ISF2 file plays on any
conforming ISF 2.0 host, losing only the extension semantics.

A new per-input field or a new `A8_*` top-level key is a **standard change, made here, before
any producer emits it**.

---

Renders ISF Effects and Compositions into a canvas

[http://www.interactiveshaderformat.com/]([http://www.interactiveshaderformat.com/])

## Example

```
var gl = canvas.getContext("webgl");

// Instantiate the renderer with your webgl context
var renderer = new ISFRenderer(gl);

// Load up the source
renderer.loadSource(fragmentISF, optionalVertexISF);

// Set up any values passing either numbers, arrays of numbers, or image/video elements
renderer.setValue("someInput", someValue);
// If you pass any image/video elements, you need to call `pushTextures` after to pass the images to webgl
renderer.pushTextures();

// Draw it into the canvas
renderer.draw(canvas);
```

## The `ISF2` module — parse · validate · applyPreset · sourceId

`ISF2` is the reference implementation of the standard's schema half (§11). It is pure
string/JSON: no GL, no DOM, no `window`, so it runs in a browser, a worker or node.

```js
var ISF2 = require('interactive-shader-format').ISF2;
```

### `ISF2.parse(fsText, opts?)` → model

Every ratified `A8_*` block and every per-input extension field lands on the model, and
**unknown keys and unknown underscore-prefixed fields survive untouched** — a Level 1 round
trip never destroys state it does not use.

```js
var model = ISF2.parse(fsText);

model.meta                  // the FULL decoded header (the emitter's write surface)
model.inputs                // meta.INPUTS by reference
model.body                  // the GLSL after the header comment
model.a8.presets.bank.D     // §6.5 — the preset bank (A8_CARD_PRESETS reads here too)
model.a8.camera             // §6.11 — { mode, model, state } (a flat iCam* map reconciles here)
model.a8.ops.world          // §6.7 — ACTIVE warp operators, active-only
model.a8.receivers          // §6.6 — A8_MODULATION + `_bind` + A8_ANIMATE, resolved to one list
model.a8.ui.weave.stackOrder// §6.14 — the presentation family, per input
```

### `ISF2.validate(model | fsText)` → `{ ok, level, errors, warnings, info, skipped }`

Implements §9.3 **V1–V12**. `level` is the conformance class the file DEMANDS of a host
(§6.18): 0 vanilla ISF · 1 preservation · 2 presentation · 3 state · 4 performance.
`V9` (does the body compile) is always reported in `skipped` — never as passed.

```js
var v = ISF2.validate(fsText);
if (!v.ok) v.errors.forEach(e => console.log(e.rule, e.code, e.message));
console.log('this file needs a Level ' + v.level + ' host');
```

A legacy ISF file with no extension content validates clean at level 0. A missing
`DESCRIPTION` is a **warning** (V12) — an authoring gate treats it as an error, but ISF2
conformance is a property of the FILE, not of the work.

### `ISF2.applyPreset(model, slotId, opts?)` → `{ inputName: value }`

The flat map §6.5 asks for, built **in the normative recall order** so a host iterating it
pushes the camera before the params. `ISF2.presetPlan` returns the full ordered plan for the
steps a flat map cannot carry — activating ops MINTS inputs, and ranges must be pushed before
values or the values clamp to a stale bracket.

```js
ISF2.applyPreset(model, 'D');                          // the reset baseline
ISF2.applyPreset(model, '1', { withDefaults: true });  // a COMPLETE state, not just the diff
ISF2.applyPreset(model, 'D', { groupId: 'lighting' }); // a group bank

ISF2.presetPlan(model, '1').order;
// ['ops', 'camera', 'arrangement', 'ranges', 'params', 'modulation']
```

### `ISF2.sourceId(source)` → `Promise<"sha256:<hex>">`

§6.15 — the one derivation two implementations must share before anything keyed to a shader
(a preset bank, a provenance chain, a cache) can be portable. A multi-part source object
normalises to one canonical text first, and `params` is skipped because state is never
identity. `ISF2.canonicalSourceText(source)` exposes that normalisation synchronously.

```js
await ISF2.sourceId(fsText);                  // "sha256:9f2c…"
await ISF2.sourceId({ fragmentShader: fsText }); // …the same id
```

### `ISF2.emit(model, opts?)` → fsText

Deterministic and byte-stable: `emit(parse(x)) === x` for an unmodified model, over the whole
published corpus. It is minimal-diff textual surgery over the header text `parse` retained —
an untouched key is re-emitted as the author's own bytes, number spellings and all — so a
consumer that re-emits a file it did not edit never silently rewrites it. Pass
`{ canonical: true }` to re-serialize wholesale.

`ISF2.setExtension(model, key, value)` is the sanctioned extension write (`model.a8` is a
derived VIEW; writing it alone is lost). `ISF2.appendProvenanceEvent(model, event)` appends to
the chain and never rewrites an existing event.

## Raw ISF Parsing

Use the ISFParser class to parse ISF Fragment and Vertex shaders to GLSL shaders and an input data-mapping.

```
var parser = new ISFParser();
parser.parse(fragmentISF, optionalVertexISF);
console.log(parser.fragmentShader, parser.vertexShader, parser.inputs);
```

## Building

Build with browserify

```
npm install -g browserify
browserify main.js -o build/main.js

or

npm install -g watchify
watchify main.js -o build/main.js
```
