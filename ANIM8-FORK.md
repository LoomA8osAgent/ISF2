# anim8-isf-renderer — Anim8 fork of interactive-shader-format-js

Fork of [msfeldstein/interactive-shader-format-js](https://github.com/msfeldstein/interactive-shader-format-js)
(MIT, © 2025 Michael Feldstein — license unchanged, see `LICENSE`).

Upstream tracked as the `upstream` git remote (fetch-only). No public/origin
remote — local repo only until Anim8 release candidate (operator policy).

## Why fork

Anim8 is a multi-format real-time visual compositor (VDMX/Resolume model)
built on a Single Render Authority: ONE WebGL2 context, every shader card
rendered to an FBO slot in a shared pool. The bundled ISFRenderer was
last meaningfully updated years ago (VIDVOX moved to vuo). Anim8 has
accumulated patches/conventions for STY (Shadertoy), PEN (CodePen) etc.
that the ISF path should share. This fork brings ISFRenderer current and
adds the hooks Anim8's pipeline needs.

## Changelog (Anim8 updates on top of upstream `1ef6a70`)

### Update 1 — `ISFRenderer.setRenderSize(w, h)` (per-instance render-size override)

`src/ISFRenderer.js`. Optional instance override `this._renderSize`
(`null` = upstream behaviour). When set to `{width,height}`, `draw()`
renders the final pass viewport + `RENDERSIZE` uniform + PASSES
`evaluateSize($WIDTH/$HEIGHT)` + multipass `paintToScreen` viewport at the
override size instead of `destination.width/height`.

**Why:** Anim8 renders every shader into the ONE shared SRA OffscreenCanvas
(full render size) and blits a sub-region into each card's FBO slot. Per-card
`renderScale` (subsample-for-perf when `< 1`, supersample-for-zoom when `> 1`)
needs the shader to rasterize at `slot.w × slot.h` WITHOUT resizing the shared
canvas. Upstream `draw()` hardcodes `renderWidth = destination.width` so a
caller can only change render size by resizing the destination canvas — not
viable against a shared canvas feeding N cards. `setRenderSize` decouples the
two: the host says "render this shader at sw×sh," the canvas stays full size,
the host blits the sw×sh sub-region. Unblocks ISF in Anim8's per-card
renderScale (STY + PEN already shipped via their own engines, Anim8 S62
Phase B; ISF was the one engine that couldn't subsample without this).

API:
```js
renderer.setRenderSize(sw, sh);   // render at sw×sh into destination's lower-left
renderer.setRenderSize(0, 0);     // (or any <=0) clear → revert to destination dims
```

### Update 2 — `ISFRenderer.setValueGLTexture(name, glTexture, width, height)` (zero-copy GPU image input)

`src/ISFRenderer.js`. Binds a **caller-owned `WebGLTexture`** directly to an
ISF image/sampler2D input, bypassing `texImage2D` / CPU upload entirely.

API:
```js
renderer.setValueGLTexture('inputImage', fboTex, w, h); // bind host FBO texture
renderer.setValueGLTexture('inputImage', null);          // clear → back to canvas path
```

Semantics:
- The renderer **never** deletes, resizes, or `texImage2D`s into `glTexture` —
  the host owns it; the renderer only binds it to a texture unit + points the
  sampler uniform at it each push (new `uniform.externalTexture` branch in
  `pushTexture`, structurally identical to the `ISFTexture.bind` canvas path so
  texture-unit assignment + `draw()` ordering are unchanged).
- `width`/`height` drive the input's `_<name>_imgSize` companion uniform
  (IMG_PIXEL / IMG_NORM_PIXEL / IMG_THIS_PIXEL sampling); `_<name>_imgRect` =
  `[0,0,1,1]`, `_<name>_flip` = `false`.
- The texture is bound **raw** (no `UNPACK_FLIP_Y_WEBGL`, no upload) → it keeps
  GL bottom-left origin. Feed a GL-oriented texture (e.g. an FBO colour
  attachment) and the sampled orientation matches the canvas upload path.
- A subsequent `setValue(name, canvas)` on the same input clears the external
  binding and reverts to the standard texImage2D path.
- The `glTexture` must belong to the same GL context passed to `new ISFRenderer(gl)`.

**Why:** Anim8's SRA pipeline is one WebGL2 context; every card renders to an
FBO. The Mode-3 intra-Stack / Mode-4 cross-card `inputImage` feed was the last
GPU→CPU→GPU readback in the whole compositor — a card's prior-chain FBO was
`readPixels`'d into a 2D canvas, then re-uploaded via `setValue(canvas)` because
upstream `setValue` only accepts `HTMLCanvasElement`/`Image`/`Video`.
`setValueGLTexture` lets the host blit FBO→FBO (GPU-only) and feed the texture
handle straight in, killing the readback stall (project-memory: readback crashed
FPS 75→38 with 6 taps). Host wires it behind capability detection
(`typeof renderer.setValueGLTexture === 'function'`) so the same host code runs
against the pre-`setValueGLTexture` bundle (canvas fallback) and the new one.

### Update 3 — ISFLineMapper null guard (compile-error handler no longer crashes)

`src/ISFLineMapper.js`. The GLSL error-line mapper did
`/ERROR: (\d+):(\d+): (.*)/g.exec(error.message)[2]` unguarded — any error
whose message doesn't match the GLSL "ERROR: n:m:" format (runtime TypeError,
parser throw, driver-specific format, non-string message) made `.exec()`
return `null` → "Cannot read properties of null (reading '2')" thrown INSIDE
`ISFRenderer.sourceChanged`'s catch, masking the true error corpus-wide
(found by the Anim8 G2.2 corpus regression harness). Fix: coerce a missing/
non-string message to `''`; when the regex doesn't match return `-1` (no
mappable line) — the original error object on `renderer.error` stays intact.
`getMainLine` scans now run only after a successful match.

### Update 4 — `GLSLNormalize` (fork-native ES1→ES3 normalize module, G2.3 Stage 1)

`src/GLSLNormalize.js` (+ exported from `src/main.js` →
`interactiveShaderFormat.GLSLNormalize`). The complete 14-transform ES 1.00 →
ES 3.00 normalize inventory that previously lived ONLY as Anim8's app-side
`WebGL2RenderingContext.prototype.shaderSource` monkeypatch
(`app/js/formats/isf-es300.js`), ported VERBATIM as pure string→string
functions (no GL / DOM / window):

```js
GLSLNormalize.normalizeGLSL(src, { target: 'es100'|'es300', stage: 'frag'|'vert' })
GLSLNormalize.upgradeES300(fragSrc, vertSrc)   // → { frag, vert }
GLSLNormalize.isLegacyISFSource(src)           // gate predicate
```

`target:'es100'` (default) is a strict NO-OP passthrough — the parser still
emits ES 1.00 and the app monkeypatch stays live. `target:'es300'` produces
byte-identical output to the monkeypatch for the same input (verified over 27
representative corpus files, frag + vert). The monkeypatch INSTALLER stays
app-side (environment-bound); Stage 2 flips the parser skeleton to ES3 and
consumes this module natively. Order-dependency notes in the module header.

### Update 5 — parser emits GLSL ES 3.00 natively (G2.3 Stage 2, the flip)

`src/ISFParser.js`. `generateShaders()` now runs `GLSLNormalize.normalizeGLSL`
(Update 4) on the ASSEMBLED whole shader (frag + vert) after `buildFragment/
buildVertexShader`, gated on the new static `ISFParser.emitsES300 = true`. This
is a pure RELOCATION of the ES 1.00 → ES 3.00 upgrade the Anim8 app previously
did in its `WebGL2RenderingContext.shaderSource` monkeypatch (`isf-es300.js`):
the monkeypatch intercepted the same assembled text at compile time and called
the same transform (`isfUpgradeES300`), so the emitted GLSL is byte-identical —
the ES1 skeleton strings are left untouched because `normalizeGLSL` strips and
re-emits the `#version`/`precision`/prelude/out-decl preamble itself (the
skeleton content below the preamble is normalized in place). No skeleton edit,
no new transform, no divergence risk.

`ISFParser.emitsES300` (exposed as `window.ISFParser.emitsES300`) is the
capability flag the Anim8 app + regression harness read to SKIP installing the
`isf-es300.js` monkeypatch (mirror of the Update-2 `supportsGLTextureInput`
capability pattern). A pre-flip vendored bundle lacks the flag → the app
transparently falls back to the monkeypatch. Verified: full-corpus regression
harness compare, ES3-native output vs the frozen `ES1 forknorm bundle@6897338`
baseline — see Anim8 GOAL.md G2.3 ledger.


## Build

Source is ES modules in `src/`; bundle is webpack (`webpack.config.js` →
`dist/`). `npm install && npm run build` to regenerate the bundle Anim8
loads as `lib/isf-renderer.min.js`.

## Roadmap (researched, not yet implemented)

- ES3 / WebGL2 shader targets
- Source preprocessing parity with Anim8's STY patches (mod/clamp polyfills,
  macro expansion, bare-JSON wrap, ES-3.00 upgrade transform)
- Audio input channels (FFT / waveform) as first-class
- HDR / float render targets
- External `TIME` setter (host-driven clock instead of internal `Date.now`)

## Long-form plan

The full architecture + phased roadmap for evolving this fork into a universal
shader-ingestion + control-extraction runtime (format detection → dialect
transpile → format adapters for Shadertoy / GLSL-Sandbox / twigl / p5 / three /
CodePen-GLSL / KodeLife / Bonzomatic → unified control analyzer → ISF-INPUTS
emission → universal augment) lives in the Anim8 spec repo:

`anim8-spec/specs/shader-runtime.md`

The roadmap bullets above (ES3, preprocessing parity, audio channels, HDR,
TIME-setter) are this fork's slice of that plan; `shader-runtime.md` §11
sequences them as fork Updates 2..N alongside the Anim8-side adapter work.
