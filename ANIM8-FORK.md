# anim8-isf-renderer — Anim8 fork of interactive-shader-format-js

Fork of [msfeldstein/interactive-shader-format-js](https://github.com/msfeldstein/interactive-shader-format-js)
(MIT, © 2025 Michael Feldstein — license unchanged, see `LICENSE`).

Upstream tracked as the `upstream` git remote (fetch-only). Public home since
2026-09-19 (operator ruling): **https://github.com/LoomA8osAgent/anim8-isf-renderer**
(`origin`, a GitHub fork of upstream so attribution and upstream PRs stay linked).

## Interop — the two composers and this renderer move together

This fork defines the **ISF2** dialect A8os emits and ingests: the header
extensions (parameter groups, `layer:N` fill layers, declared roles such as
`_lightRig` / `_shapeMath`, the injected ops/camera preludes) on top of ISF.
Two sibling repos consume that contract and must stay consistent with it:

- **A8os / visualeyes** — the compositor (`app/js/formats/isf.js` + the ingest
  layer) is the primary consumer; the standard lives at `specs/isf2-standard.md`.
- **[jevisualeyes](https://github.com/LoomA8osAgent/jevisualeyes)** — the
  decision-model composer (presets now, IR-emitted records next). Its emitter
  targets THIS dialect; plan: A8os `roadmap/jevisualeyes-rework.md` §5.2.

Rule: a header extension exists in `specs/isf2-standard.md` first, then in this
renderer's parser, then in the composer's emitter — never in one without the
other two. A change here that the compositor or the composer cannot read is a
regression, not a feature.

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


### Update 6 — `ISF2` extension schema: parse + validate (G2.3 Stage 3)

`src/ISF2.js` (+ exported from `src/main.js` → `interactiveShaderFormat.ISF2`).
The reference implementation of the ISF2 extension schema — the format's
published, backward-degradable superset of ISF 2.0 (standard:
`anim8-spec/specs/isf2-standard.md`).

```js
ISF2.parse(fsText, { vertexShader })  // → model { meta, inputs, passes, body, raw,
                                      //           isfVersion, type, point2D, a8, warnings }
ISF2.validate(model)                  // → { ok, errors[], warnings[], skipped[] }  (§9.3 V1-V9)
ISF2.normalizeGLSL(src, opts)         // → GLSLNormalize delegate (§7.1)
```

Covers: the top-level `A8VSN` / `A8_ANIMATE` / `A8_CAMERA` / `A8_PROVENANCE`
blocks, the four RESERVED names (`A8_MODE` / `A8_LAYERS` / `A8_OPS` /
`A8_MATERIAL`), unknown-`A8_*` forward compatibility, the per-input extension
fields incl. the gate grammar (`{ param, eq|not|anyOf }` or an AND-array) and
the neutral `_op*` names with `_glyOp*` accepted as grandfathered synonyms, the
normative `point2D` pixel-vs-raw rule, and the ISF 1.0 / filter-type
classifications. Fatal structural failures throw a typed `ISF2Error`
(`.code`, `.line`, `.position`); everything else is a model warning or a
validate error, so "not an ISF file" is always distinguishable from "an ISF
file with problems". V9 (does the body compile) is always reported in
`skipped[]` — this module has no GL context and the standard forbids reporting
it as passed.

`ISF2.emit` is deliberately NOT in this update: the emitter and its
byte-stability contract (standard §9.2 E2/E3) are the next stage, gated on a
byte-identical re-emit of the baked corpus. `parse` already retains everything
it needs (raw source, raw metadata string, untouched metadata object, body
offset), so that stage is additive here. (Landed in Update 7.)

**Zero effect on the vanilla path.** `ISFParser.js` is untouched; this is a
separate, additive layer. Proven by a full-corpus parser differential — every
`.fs` in the A8os ISF corpus (1,928 files) parsed with the pre-change and
post-change bundles, comparing emitted `fragmentShader` / `vertexShader` text,
`uniformDefs`, extracted `inputs` / `passes` / `imports`, filter `type`,
`isfVersion`, validity and error message: **1,928 identical, 0 different.**
Byte-identical emitted GLSL plus a byte-identical control surface is a stronger
guarantee than a pixel-hash compare for a metadata-only change — there is no
tolerance window to hide in. Over the same corpus the ISF2 layer parsed all
1,872 files the parser accepts (the 56 it rejects are the same files the parser
rejects), with zero classification disagreements.

Tests: `tests/isf2-test.js` (107 assertions, tape) — back-compat legs against
the classic fixtures, the A8_* surface, each validation rule V1-V9, the error
surface, and the shared camera-canon gate shapes verbatim.

### Update 7 — `ISF2.emit`: byte-stable emission (G2.3 Stage 4)

`src/ISF2.js` (same module, additive). The emitter half of the reference
implementation, completing the §11 public contract:

```js
ISF2.emit(model, { canonical, indent })        // → fsText  (§9.2 E1-E3, §9.2.1)
ISF2.setExtension(model, 'A8_CAMERA', v)       // the sanctioned extension write
ISF2.appendProvenanceEvent(model, event)       // E4 / P1 — appends, never rewrites
```

**The problem emit exists to solve.** A serializing emitter
(`'/*' + JSON.stringify(meta) + '*/'`) cannot be byte-stable against
hand-authored files: it re-spells every number (`1.0` → `1`), collapses author
line breaks, and silently "repairs" the lenient-JSON files V1 tolerates. So
`emit` **does not serialize what it did not change.** It scans the retained
metadata TEXT into top-level member spans, diffs the live `model.meta` against a
fresh decode of that same text, and rebuilds: unchanged key → the author's own
bytes verbatim; changed key → key text and position kept, VALUE re-serialized;
added key → appended last, canonical; removed key → span and separator dropped.
Unknown keys and unknown per-input fields (E3) survive for free — they are never
re-serialized. The normalization rules N1-N8 (what emit *does* rewrite, and why
each case has no author text to preserve) are normative in standard §9.2.1.

There is deliberately **no "unchanged ⇒ return raw.source" shortcut**: the
identity result is produced BY the splice machinery, so the corpus differential
exercises it rather than measuring a memcpy.

**Acceptance — the corpus round-trip differential.** Every `.fs` in the A8os
shader corpus (2,323 files) through `parse → emit`, comparing output text to
source AND re-parsing the output to compare models: **2,261 byte-identical,
0 text differences, 0 model differences, 0 emitter failures.** The remaining 62
files carry metadata no conforming parser can decode (duplicate JSON keys,
malformed arrays — pre-existing corpus defects, reported separately) and never
reach the emitter.

**Acceptance — the 220-file GLY re-bake** (the named E2/E3 gate): **220 / 220
byte-identical**, 0 model differences. The published baked corpus survives a
round trip through the emitter untouched, legacy `_glyOp*` spellings included
(N6 — rewriting them on sight would break E2 for every one of those files).

**Acceptance — additive-only emission.** Over the same 2,261 files: parse, add
an `A8_PROVENANCE` block, emit, then remove the block and re-emit —
**2,261 reproduce the source byte-for-byte, 0 violations.** Every pre-existing
key, its order, and the GLSL body are provably untouched by an emission that
gained extension content.

Tests: `tests/isf2-test.js` grows to **164 assertions** (107 unchanged + 57 for
emit) — round-trip identity on the fixtures, a hand-authored header with
idiosyncratic indentation and unknown keys, lenient-JSON preservation plus the
`canonical` repair path, each normalization rule N1-N8, the write-surface
semantics (writing `model.a8` alone is NOT emitted), E4 append-never-rewrite,
the error surface, and idempotence.

### Update 8 — `ISFRenderer.setRenderTargetFramebuffer(fb, w, h)` (caller-owned final-pass target — the chain-alpha unlock)

`src/ISFRenderer.js`. Optional caller-owned FINAL-PASS render target
`this._renderTargetFB` (`null` = upstream: final pass renders to the DEFAULT
framebuffer, byte-identical). When set to `{fb,width,height}`, the FINAL visible
pass binds the caller's `WebGLFramebuffer` + viewports to `width,height` instead
of the default FB.

API:
```js
renderer.setRenderTargetFramebuffer(slotFBO, w, h); // final pass → host RGBA FBO
renderer.setRenderTargetFramebuffer(null);           // clear → default-FB (upstream)
```

Two final-output bind sites honor it, covering both ISF output shapes:
- `draw()` else-branch — the single/final pass with **no `TARGET`** (the common
  case): binds `_renderTargetFB.fb` instead of `FRAMEBUFFER=null`; viewport +
  `RENDERSIZE` use the target's authoritative `width,height`. The existing
  per-pass cleanup (`bindFramebuffer null` after the draw) leaves the bind
  self-contained — the caller target never leaks past `draw()`.
- `paintToScreen()` — reached when **every pass has a `TARGET`** (the last buffer
  is copied to screen): binds `_renderTargetFB.fb` for the copy, viewport to the
  target dims, then rebinds `FRAMEBUFFER=null` (only when a target was set) so the
  paint is self-contained.

Semantics:
- **PASSES intermediates + PERSISTENT (self-referencing) buffers are UNTOUCHED** —
  they are renderer-internal FBOs (`generatePersistentBuffers` / `ISFBuffer`),
  bound in the `pass.target` branch, unaffected by this override.
- The renderer **never** deletes, resizes, or creates `fb` — the host owns it.
  The caller's dims are authoritative for the final pass (mirrors how the host
  sizes the target FBO), so `_renderSize` and the target may be set independently.
- Bind sequences stay self-contained per pass (mirror of the intermediate-pass
  rebinds) — no subsequent renderer op inherits the host FBO.
- Existence of the method is the host's capability flag (mirror
  `setValueGLTexture`) — `typeof renderer.setRenderTargetFramebuffer === 'function'`.
  Lives on `ISFRenderer.prototype`, so it rides the instance the app reaches via
  its engine's `this._renderer`; no export change needed.

**Why:** Anim8's SRA drawing buffer is `alpha:false`. Every ISF card previously
rendered its final pass to the DEFAULT framebuffer, then the compositor
`blitFramebuffer(null → slot.fb)` — and that blit through the alpha-less default
FB discards `gl_FragColor.a` (slot background reads back `0,0,0,255`), so
partially-transparent shader output could never composite over the chain seed.
Feeding the card's RGBA slot FBO straight in as the final-pass target preserves
alpha end-to-end AND removes the per-card default-FB→slot blit entirely. Host
wires it behind capability detection so the same host code runs against a
pre-`setRenderTargetFramebuffer` bundle (default-FB + blit fallback) and the new
one. Additive: with no target set, every path is byte-identical to Update 7 —
proven app-side by the G2.2 corpus regression harness (1,800+ shaders
compile-compare).

### Update 9 — `evaluateSize` `$token` substitution is longest-name-first + global (A8os S88 B10 / DEBT-56)

`src/ISFRenderer.js`. Upstream substituted each declared input's `$name` by a
single insertion-order replace, so an input that is a strict PREFIX of a later
token corrupted it (`p` turned `$prepassTile` into `<value>repassTile`, and
`mathJsEval` threw `Undefined symbol` on EVERY draw — the whole knot/attractor
tube family rendered nothing, silently). Names are now sorted longest-first and
replaced globally. Additive: byte-identical for every header without a
prefix-colliding input.

### Update 10 — `A8_PASS_PROGRAMS`: one compiled program per pass (A8os G-MARCHER-2PASS)

`src/ISFParser.js` + `src/ISFRenderer.js` + `src/ISFTexture.js`. Upstream ISF
runs every pass of a multipass shader through ONE fragment program branched on
the `PASSINDEX` uniform, so the heaviest pass carries the code (and the register
footprint) of every other pass — which is what makes a march-then-paint split
pointless upstream. With `"A8_PASS_PROGRAMS": true` in the header the parser
sets `perPassPrograms`, and `setupGL` builds `passes.length` programs from the
same source, each prefixed `#define A8_PASS <i>` right after the `#version`
line (`ISFRenderer.injectPassDefine`, exported + tested) so a pass wraps its
body in `#if A8_PASS == i` and the preprocessor removes every other pass's code.

- `this.programs[]` holds them; `this.program` stays the FINAL pass's program so
  every single-program path (`setValue`, `paintToScreen`, the host's uniform
  table) is unchanged.
- Non-texture uniforms are pushed to EVERY program (`pushUniform` loops,
  `_pushUniformTo` does one). Textures are bound once — units are global GL
  state — and their sampler location set on every program (`_setSamplerAll`;
  `ISFTexture.bind` now returns the unit it chose). Pass buffers propagate the
  same way in the `draw()` bind loop.
- `draw()` selects `programs[i]` before `PASSINDEX` is set, restores the final
  program after the loop; `cleanup()` frees them.
- SAME-FRAME READS (ISF semantics, per-pass-programs only): after a targeted pass
  draws, its freshly written texture is bound on a new unit and every program's
  sampler pointed at it, so a LATER pass reads THIS frame's result; a pass reading
  its OWN target still sees the prior frame (PERSISTENT). Upstream binds every
  buffer once before the loop, so every cross-pass read lagged a frame — fatal for
  a march→paint split (last frame's hits along this frame's rays). The two
  `bindTexture(TEXTURE_2D, null)` calls in the loop (they unbind the ACTIVE unit,
  i.e. the buffer just rebound) are skipped under the flag.
- Off (the default) is byte-identical to upstream: `this.programs` is null and
  every new branch is skipped. Parser + `injectPassDefine` are covered by
  `tests/parser-test.js`; the multi-program draw is proven app-side.

### Update 11 — `loadSource(src, vs, { program })` adopts a caller-linked program (A8os DEBT-32 / DEBT-38 lane 2)

- `ISFGLProgram.adopt(gl, program, vShader, fShader)` wraps an ALREADY-LINKED program
  without compiling or linking (LINK_STATUS must read true — a cached read after the
  caller's COMPLETION_STATUS poll, never a stall). Ownership transfers; `cleanup()`
  deletes it like a compiled one (null shaders tolerated).
- `ISFRenderer.loadSource` takes a third arg `opts.program = { program, vShader,
  fShader, vertexShader, fragmentShader }`. `setupGL` adopts it ONLY in
  single-program mode and ONLY when the parser's emitted vertex + fragment strings
  equal the handed-over strings byte-for-byte; any miss compiles as before and leaves
  the caller's objects untouched. `renderer.adoptedProgram` says which happened;
  `ISFRenderer.supportsProgramAdopt = true` is the host capability flag.
- Why: the A8os hotswap links the same pair in the background under
  KHR_parallel_shader_compile and then handed this lib the SOURCE TEXT — a second
  link on the main thread. Adopting removes that link entirely (adopt ~34 ms measured).
  Note for whoever measures next: the residual cold-add freeze on ANGLE-Metal is the
  GPU process building the pipeline state at the FIRST DRAW (measured 4.7 s via a sync
  fence, `sdf.op-add-cold-attribution`), not anything this lib does.
- Test: `tests/renderer-test.js` 'Adopt caller-linked program' (adopted program IS the
  renderer's + byte-identical render; mismatched strings refused with caller objects
  intact; unlinked program refused). Needs headless-gl's native binding.

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
