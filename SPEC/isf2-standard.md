# ISF2 — Interactive Shader Format 2, A8 Extension Standard

**Version:** A8VSN 2 (RATIFIED 2026-09-19; §10.1 states what the major increment costs
and what is grandfathered)
**Baseline format:** ISF 2.0 (VIDVOX Interactive Shader Format)
**License:** MIT. ISF2 is a strict, backward-degradable superset of ISF 2.0. The
upstream ISF specification and the reference JavaScript renderer this standard's
reference implementation forks are both MIT-licensed.

> **Canonical home (2026-09-19, §11.1):** this document lives at `SPEC/isf2-standard.md` in
> the public ISF2 repo — GitHub `https://github.com/LoomA8osAgent/ISF2`, local clone
> `~/gits/ISF2` (renamed from `~/gits/anim8-isf-renderer` the same day), beside the reference
> renderer that is its conformance oracle. The A8os/visualeyes tree carries a pointer stub
> only: the standard is EDITED here and READ from here.

---

## 1. Scope

ISF2 is a file format for self-contained, real-time GLSL fragment shaders with a
declared, machine-readable control surface. An ISF2 file is a single text file (by
convention `.fs`) consisting of:

1. a JSON metadata block inside the file's **first** `/* … */` comment, and
2. a GLSL fragment-shader body.

ISF2 extends ISF 2.0 with a versioned extension surface in two tiers:

- **Top-level `A8_*` keys** for non-input concerns (animation directives,
  provenance, camera capability), plus the extension-version key `A8VSN`.
- **Per-input extension fields** (underscore-prefixed, e.g. `_groupId`) carrying UI
  semantics on individual input declarations.

Both tiers ride ISF's designed extension channel — unknown JSON keys — so **every
valid ISF2 file is also a valid ISF 2.0 file**. A legacy ISF host ignores every
extension key and still renders the shader in 2D with its declared inputs.

This standard defines:

- the file structure and metadata schema (§3–§5),
- the ISF2 extension keys and fields (§6),
- the GLSL execution environment (§7),
- input-type semantics, including the `point2D` coordinate convention and the
  audio-input convention (§8),
- conformance levels and validation rules (§9),
- versioning and degradation policy (§10),
- the public reference-implementation API (§11).

**Out of scope.** How a file's declarations come to exist — hand-authoring, code
generation, or automatic analysis of undeclared shader source — is an authoring-tool
concern outside this standard. ISF2 defines the *output*: a valid, declared,
renderable file. Any tool that produces files conforming to this document
interoperates fully.

> **NARROWED by §6.4 (RATIFIED 2026-09-19, queue item 1).** The paragraph above draws the
> boundary at "the tool made it, the file carries it". §6.4 narrows it: the *mechanism* of
> authoring (gestures, chrome, pickers, panes) stays out, but the authored **control surface**
> and the authored **state** are part of the artifact. Read §6.4 with this paragraph — the
> sentence above governs analysis and generation only.

---

## 2. Relationship to ISF 2.0

ISF2 preserves the ISF 2.0 contract in full: metadata block, `INPUTS` array,
`PASSES` multipass model, `IMPORTED` resources, `IMG_*` sampling functions, and the
standard built-in uniforms. The table below is the complete list of divergences and
additions.

### 2.1 Divergences and additions

| # | Area | ISF 2.0 | ISF2 | Degradation on a legacy host |
|---|------|---------|------|------------------------------|
| D1 | Extension version | — | Top-level `A8VSN` string key, independent of `ISFVSN` (which stays `"2"`) | Ignored; file renders as plain ISF 2.0 |
| D2 | Top-level extension blocks | — | `A8_ANIMATE`, `A8_PROVENANCE`, `A8_CAMERA` (§6.2); further `A8_*` names reserved | Ignored |
| D3 | Per-input extension fields | — | Underscore-prefixed fields on `INPUTS` entries: grouping, gating, operator metadata, slider affordances, managed slots, audio roles (§6.3) | Ignored; input renders as a plain control |
| D4 | GLSL dialect | GLSL ES 1.00-idiom bodies (`texture2D`, `gl_FragColor`) | Reference implementation compiles to GLSL ES 3.00; ES 1.00-idiom bodies are accepted and normalized (§7.1). Authors targeting maximum legacy-host reach SHOULD stay within the ES 1.00-compatible common subset | An ES 1.00-subset body renders anywhere; an ES 3.00-only body (dynamic loop bounds, `textureLod`, dynamic indexing) fails to compile on ES 1.00 hosts |
| D5 | `point2D` semantics | Underspecified across hosts | Normative pixel-vs-raw rule (§8.2): `MIN`+`MAX` both present ⇒ raw values; either absent ⇒ pixel-consuming, host supplies pixel coordinates scaled by live render size | Behavior matches the dominant legacy-host (VIDVOX) convention by construction |
| D6 | `audio`/`audioFFT` delivery | Host-defined audio objects | Hosts MUST accept the declarations; MAY satisfy them as image samplers carrying waveform/FFT texture data (§8.3). Hosts without audio MUST bind silence (black) rather than fail | Legacy hosts with native audio support work unchanged |
| D7 | Metadata JSON strictness | Hosts vary; many parse leniently | **Emitted** ISF2 files MUST carry strictly parseable standard JSON (no comments, no trailing commas). Consumers MAY be lenient with third-party files | Strict JSON parses everywhere — strictly safer |
| D8 | Extension-neutrality guarantee | — | Extension keys/fields MUST NOT change the input set an ISF 2.0 parser extracts (§9.3, V6) | This rule *is* the degradation guarantee |
| D9 | Provenance | — | `A8_PROVENANCE` append-only history block; ISF2 exporters MUST preserve and append, never strip or rewrite (§6.2.3) | Ignored (but carried verbatim if the file is copied whole) |
| D10 | Emission determinism | — | A conforming ISF2 emitter is byte-stable: emitting an unchanged parsed model reproduces the input file byte-for-byte (§11) | N/A (tooling property) |

### 2.2 ISF 1.0 files

ISF2 consumers MUST recognize ISF 1.0 files by any of these markers: a top-level
`PERSISTENT_BUFFERS` key, or the identifiers `vv_FragNormCoord` /
`vv_vertShaderInit` in the source. Consumers SHOULD upgrade them per the ISF 2.0
rules: fold `PERSISTENT_BUFFERS` entries into `PASSES` entries with
`PERSISTENT: true`, and rename `vv_*` identifiers to their `isf_*` equivalents.
ISF2 emitters MUST NOT produce ISF 1.0 constructs.

---

## 3. File structure

```
/*{
    …JSON metadata block…
}*/

…GLSL fragment shader body…
```

Normative rules:

- **F1.** The metadata block MUST be the **first** `/* … */` comment in the file.
  Everything after the closing `*/` is the shader body.
- **F2.** The comment's contents MUST be a single standard-JSON object. No comments
  inside the JSON, no trailing commas (emitters — D7; consumers MAY repair).
- **F3.** The file is UTF-8 text.
- **F4.** An optional companion vertex shader (`.vs`, same basename) may accompany
  the file, exactly as in ISF 2.0. When absent, the host supplies the default
  pass-through vertex shader.

---

## 4. Metadata schema — standard keys (ISF 2.0 tier)

| Key | Type | Required | Semantics |
|-----|------|----------|-----------|
| `ISFVSN` | string | RECOMMENDED | ISF baseline version. ISF2 files declare `"2"`. Absent ⇒ interpret as 2.0 unless ISF 1.0 markers are present (§2.2) |
| `DESCRIPTION` | string | optional | Human-readable ONE-LINE description (shown in lists / cards / library rows) |
| `LONG_DESCRIPTION` | string | optional | Human-readable RICH description — 2–3 sentences on what the shader is and how it behaves. Rendered in the library detail panel + editor info header. `DESCRIPTION` stays the short list form; `LONG_DESCRIPTION` is the paragraph. Absent ⇒ hosts fall back to `DESCRIPTION` |
| `CREDIT` | string | optional | Author credit line |
| `CATEGORIES` | array of string | optional | Classification tags |
| `INPUTS` | array of input objects | optional (default `[]`) | The declared control surface (§5) |
| `PASSES` | array of pass objects | optional | Multipass definition (§7.4). Absent ⇒ one direct-to-output pass |
| `IMPORTED` | object | optional | Named external image resources; each key becomes a `sampler2D` uniform (§7.5) |

Unknown top-level keys MUST be preserved by parsers and re-emitted by emitters
(this is the extension channel both ISF 2.0 and ISF2 rely on).

---

## 5. Input declarations

Each entry of `INPUTS` is an object:

| Field | Type | Required | Semantics |
|-------|------|----------|-----------|
| `NAME` | string | required | The GLSL uniform name. Must be a valid GLSL identifier, unique within the file |
| `TYPE` | string | required | One of `float`, `bool`, `event`, `long`, `color`, `point2D`, `image`, `audio`, `audioFFT` |
| `LABEL` | string | optional | Display name. An explicitly empty string (`""`) is a valid value meaning "render no label" — hosts MUST NOT substitute `NAME` for an explicit `""` |
| `DESCRIPTION` | string | optional | ONE-LINE plain-English guide to what THIS control does *to the image* — written for a user, not a physicist. Hosts SHOULD surface it as the control's tooltip (`data-tip`). Legacy hosts ignore it. This is the canonical, machine-readable home for the per-control guide — NOT a source comment block (comments drift and cannot be rendered) |
| `DEFAULT` | per type | optional | Initial value (scalar; `[r,g,b,a]` for `color`; `[x,y]` for `point2D`) |
| `MIN`, `MAX` | per type | optional | Range bounds (scalar; `[x,y]` arrays for `point2D` — see §8.2) |
| `VALUES` | array of int | optional (`long` only) | Enumerated values |
| `LABELS` | array of string | optional (`long` only) | Display labels paired with `VALUES` |

### 5.1 GLSL uniform mapping

| `TYPE` | GLSL uniform | Notes |
|--------|--------------|-------|
| `float` | `float` | |
| `bool` | `bool` | |
| `event` | `bool` | Momentary: true for exactly one rendered frame per trigger |
| `long` | `int` | With optional `VALUES`/`LABELS` enumeration |
| `color` | `vec4` | RGBA, each component 0.0–1.0 |
| `point2D` | `vec2` | Coordinate semantics per §8.2 |
| `image` | `sampler2D` | Plus host-managed companion uniforms (§7.3) |
| `audio` | `sampler2D` | Waveform texture (§8.3) |
| `audioFFT` | `sampler2D` | FFT-magnitude texture (§8.3) |

> **Implementer note.** `audio` / `audioFFT` are legal to DECLARE, but a host may
> not build a uniform for them directly — the reference renderer does not, and
> the degradation-safe encoding (`TYPE: "image"` + `_audioRole`, §8.3) is what
> reaches the widest host set. `ISF2.validate` accepts the declaration and emits
> a warning naming the host dependency; it is never an error.

### 5.2 Description metadata — authoring standard (RATIFIED 2026-07-14)

The human-readable guide to a shader and its controls is **structured metadata the
host renders**, never a source-comment block. Comments drift, users don't read
source, and a host cannot parse a comment into a tooltip. Canon:

- **`DESCRIPTION`** (top-level) — one line for lists/cards.
- **`LONG_DESCRIPTION`** (top-level) — 2–3 sentence paragraph; the library detail +
  editor info panel render it.
- **Per-input `DESCRIPTION`** — one line per control; the host renders it as the
  control's `data-tip` tooltip (ties into the app-wide "tooltip on every
  interactive element" canon — `design/interaction-system.md`). This is the ONLY
  canonical home for the per-control guide.

The JSON header is the single source of truth; the app reads it and drives the
tooltips + info panel. An optional short human comment near the top of the file is
courtesy for raw-file readers only, never authoritative.

**Producer prompt language (RATIFIED — for LLM shader generators, `roadmap/isf-corpus-magic-math-assessment.md` + producer prompts):**

> Every INPUT carries a one-line `DESCRIPTION` (what it does to the image, plain
> English — written for a user, not a physicist). Add a top-level `LONG_DESCRIPTION`
> (2–3 sentences: what the shader is and how it behaves). These become the app's
> tooltips and info panel; do not put the control guide in source comments.
>
> **THE HOST OWNS THE CAMERA — never declare your own.** Do NOT emit camera inputs
> (pan / zoom / orbit / rotate / observer angle / distance / fov) and never use a
> `_groupId` of `"camera"`. The host injects a full camera rig (`iCam*`) into every
> shader and renders it as the one canonical camera accordion; a shader-declared
> camera duplicates it, produces a SECOND confusing camera group, and fights the
> host for control of the view.
> - **2D shaders:** just render in the coordinate space you're given. The host warps
>   the sample coordinate for you.
> - **RAYMARCH / true-3D shaders — copy these three lines EXACTLY:**
>   ```glsl
>   vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
>   vec3 ro, rd;
>   a8CameraRay(uv, ro, rd);          // ← the marker; the host injects the helper
>   ```
>   Then march along `ro`/`rd`. **Do NOT** build `ro`/`rd` by hand, **do NOT** write a
>   look-at basis, **do NOT** auto-orbit the eye on `TIME`. Calling `a8CameraRay` is
>   what opts you into the shared true-3D camera (`camera-canon.md` §10); a shader that
>   omits the marker instead gets the host's 2D coordinate warp applied *on top of* its
>   hand-rolled camera — **two cameras fighting over one view.**
>
>   *(Learned the hard way: an outside model given only the prose "call the host's shared
>   eye/ray helper" QUOTED the rule in a comment and then hand-rolled a look-at camera with
>   a time-driven orbit — because we never gave it the symbol. **A canon written for agents
>   must state the CALL, not the principle.**)*
> - Position the scene so the WORLD ORIGIN is the thing worth looking at — the shared
>   camera orbits the origin. (Domain-repetition lattices in particular: shift the
>   lattice so the origin lands in a gap, not inside a cell.)
>
> **Build explicit geometry, not a warped plane.** Do not make the primary space a
> radial remap of the screen (`1.0/r`, `log(r)`, `atan/length`-driven tunnels) — that
> coordinate map dominates the look and yields the same generic tunnel regardless of
> how sophisticated the math on top of it is (empirically: two Orch-OR attempts with
> genuinely rigorous wavefunction math both rendered as tunnels). Model the object:
> use an SDF / raymarch / real lattice, and make the declared structure **countable in
> a frozen frame** (if the description says "13 protofilaments", the viewer must be able
> to count 13).
>
> **EVERY DIMENSION OF EVERY SDF PRIMITIVE IS A CONTROL — no magic-number sizes.** If you
> raymarch an SDF, the operator MUST be able to reshape the thing you built. A hardcoded
> literal in a distance function is a control you stole. For each primitive expose, at
> minimum: its **size on every axis** (radius / half-extents / per-axis scale — X, Y and Z
> independently, not one uniform "scale"), plus any rounding, thickness, repetition
> spacing, or count the shape is defined by. `length(p.xz) - 0.4` is a FAILURE: the 0.4 is
> the entire size of the object, frozen. Write `length(p.xz / scale.xz) - radius` with
> `radius` and per-axis `scale` as live inputs.
> - **Naming for free composites:** name an axis triple `<base>X` / `<base>Y` / `<base>Z`
>   (e.g. `tubuleScaleX/Y/Z`) in the same `_groupId` — the host auto-composes them into a
>   single xyz composite slider with a master (`panelBuildAxisComposites`). Three loose
>   floats are a worse UI for the same data.
> - Scaling an SDF domain non-uniformly makes the field non-exact: divide the domain by the
>   scale, evaluate, then multiply the distance by the SMALLEST scale component so the march
>   under-estimates and cannot overshoot.
> - The rule generalizes: **anything the shader hardcodes that a user would obviously want to
>   change is a missing input.** This is the whole reason the host exists — to hand the
>   operator the knobs the generator buried.
>
> **CROP YOUR INFINITE FIELDS.** A periodic lattice (gyroid, Schwarz, any TPMS) or a
> domain-repeated field is INFINITE. If you march it with the eye inside the field, every ray
> hits a wall at once and the frame is a smear — the operator sees mush, not a lattice.
> Intersect the field with a finite bounding shape and expose that bound's size on every axis:
> ```glsl
> float boundSDF(vec3 p) { return length(p / vec3(sizeX, sizeY, sizeZ)) - 1.0; }  // ball
> float map(vec3 p) { return max(latticeField(p), boundSDF(p)); }                 // hard crop
> ```
> Offer the bound as a `long` enum (ball / box / cylinder / slice / infinite) so the operator
> can also *choose* the infinite case deliberately. **An unbounded lattice viewed from inside
> itself is not a composition; it is a wall.**
>
> **THE HOST OWNS THE CAMERA ⇒ YOU DO NOT KNOW WHERE THE CAMERA IS.** This is the COROLLARY of
> the camera rule, and it is the one that kills shaders silently. The operator can zoom, so the
> eye distance is unknown and changes at performance time (`a8CameraRay` starts the eye ~11
> units out, not the ~2.5 a hand-rolled camera would use). Therefore **never key anything on the
> absolute ray distance `t`**:
> - **Depth fog** — `exp(-k * t)` with `t ≈ 11` is `exp(-3.85) ≈ 0.02`: your object renders BLACK.
>   Omit fog, or normalise it (`exp(-k * (t - tNear))`, or fade by depth *through the object*).
> - **Ambient occlusion** — never `1.0 - t/tMax`. Use a FIELD-based AO, which is camera-independent:
>   `float ao = clamp(map(p + n * 0.18) / 0.18, 0.0, 1.0);`
> - Same for attenuation, LOD, and any distance-driven fade.
>
> *(Learned 2026-07-14: a shader that obeyed EVERY stated rule perfectly — called `a8CameraRay`,
> cropped its field, marched the level set correctly — still rendered as a black frame, because
> it shaded for a camera 2.5 units away. Neutralising its fog and AO alone revealed a flawless
> specimen underneath. **Surrendering the camera creates downstream obligations, and a rule that
> does not state its own consequences is not finished.**)*
>
> **A LEVEL SET NEEDS A WALL — `abs(field) - thickness`.** The zero-set of a TPMS/algebraic field
> is an infinitely thin MEMBRANE. Rendering it directly gives you a perforated shell, not a solid
> lattice of struts. Take the absolute value and subtract a thickness to grow solid walls around
> the surface — **and thickness is a DIMENSION, so it is a required control** (Rule: every
> dimension of every primitive is an input):
> ```glsl
> float field = /* gyroid / Schwarz-P / … */ - iso;   // the level set
> float shape = abs(field) - wallThickness;           // solid walls around the zero-set
> return max(shape, boundSDF(p));                     // then crop
> ```
> Expose BOTH `iso` (which surface of the family — the porosity) and `wallThickness` (how solid
> the struts are). They are different knobs and a performer will want both.
>
> **KNOW WHETHER YOUR FIELD IS A DISTANCE OR A LEVEL SET.** A sphere/box/cylinder returns a
> TRUE distance, so naive sphere-tracing (`t += d`) is safe. A TPMS or algebraic surface
> (gyroid, Barth, Chmutov) returns a field whose zero-set is the surface but **whose magnitude
> is not a distance** — naive tracing overshoots and shreds it. Do NOT paper over this with a
> magic fudge factor (`field * 0.16`); that under-marches and smears. Normalise by the gradient
> and detect the sign change, then bisect:
> ```glsl
> float d = map(p), g = max(length(grad(p)), 1e-4);
> t += clamp(abs(d) / g, MIN_STEP, MAX_STEP);       // gradient-normalised cone step
> if (d * dPrev < 0.0) { /* bisect between tPrev and t — the surface is BETWEEN samples */ }
> ```
> A level-set field passes through zero *between* samples, so a proximity test (`abs(d) < eps`)
> misses it entirely. Budget the march (≥200 steps for a lattice; 80 will not do).
>
> *(Why this is a hard rule and not a nicety: the host's ingestion engine is required to
> ASSUME the user wants control over undeclared geometry — it extracts the dimensions you
> hardcode and synthesizes the per-axis controls you omit (`shader-runtime.md` §Stage 4g,
> `MAGIC-INTENT-BLIND-TO-GEOMETRY`). A DECLARED control always beats a synthesized one: you
> know the primitive's meaningful range, its label, and its group; the engine has to infer
> them. Declare them and the shader arrives whole.)*

> **Preview-overlay UI (QUEUED — deferred to the A8osPlayer resume, 2026-07-14).** The
> surface that renders per-input `DESCRIPTION` + `LONG_DESCRIPTION` as an overlay on
> the preview window (the info/embed-overlay pattern the operator built for the player)
> is designed as part of the player work — see `specs/a8os-player.md`. This spec fixes
> the DATA standard; the overlay UI is its consumer.

#### 5.2a Addendum — the sentence FORM — RATIFIED 2026-09-19

§5.2 above is unchanged. This addendum states the one thing it never did: the SHAPE of a
per-input `DESCRIPTION`.

```
<what it does to the image> — <what the MIN end looks like>, <what the MAX end looks like>
```

Both ends in the performer's words, never units, never the input's `NAME` or `LABEL` restated.
A *shape*, not a length limit (the exemplars average ~14 words). The rule §5.2 already gives —
*what it does to the image, in plain English, written for a performer, not a physicist* — is
unchanged; this states how the line ENDS.

**Why both ends.** A sentence naming its two endpoints carries an ordered ladder, which is what
makes the control machine-legible to a composer as well as human-legible as a tooltip
(`specs/ai/decision-models.md` §P2.4a). A sentence naming only the effect reads fine and composes to a
guess.

**Provenance per sentence** (from CS-9, `design/prompts/card-surface-canon.md:288`): a
`DESCRIPTION` is `lifted` · `authored` · `proposed` · `role`. The FILE carries only the text —
the tag is producer-side bookkeeping and belongs in `A8_PROVENANCE` (§6.16), never as a new
per-input field. Only `lifted` and `authored` may be composed on.

---

## 6. ISF2 extension surface

### 6.1 `A8VSN` — extension version

```json
"A8VSN": "1"
```

- String, top-level. Declares which version of THIS standard the file's extension
  keys conform to. Independent of `ISFVSN` (which remains `"2"`) so that legacy
  hosts' version parsing is never disturbed.
- A file carrying any `A8_*` key or any §6.3 per-input extension field SHOULD carry
  `A8VSN`. A file with `A8VSN` and no extension content is valid.
- ISF2-aware consumers encountering an `A8VSN` greater than they implement MUST
  still render the file, ignoring unrecognized extension content (same degradation
  contract as a legacy host).

### 6.2 Top-level `A8_*` blocks

At `A8VSN 1`, exactly three content blocks are defined. All other `A8_`-prefixed
top-level names are **reserved** for future versions of this standard; producers
MUST NOT use them for private purposes. (Names already reserved for planned use:
`A8_MODE`, `A8_LAYERS`, `A8_OPS`, `A8_MATERIAL`.)

> **SUPERSEDED at `A8VSN 2` by §6.17** (RATIFIED 2026-09-19, queue items 2/4), which replaces
> the reserved list above with the full defined + grandfathered table. The paragraph is
> retained because it is the `A8VSN 1` contract and every pre-`A8VSN 2` file was written to it.
>
> It was also FALSE against the shipped producer on the day it was annotated — the record of
> what §6.5–§6.17 exist to fix:
> - `A8GLSLEmit`'s DECLARE resolver writes an **`A8_OPS`** block
>   (`app/js/formats/_glsl-emit.js:271`) — a name this paragraph reserves against private
>   use, emitted by the standard's own reference producer.
> - Five further top-level `A8_*` names are live and undefined here:
>   **`A8_RAYMARCH_OPS`** (read at `app/js/formats/isf.js:847`), **`A8_FOLD`** (composed at
>   `app/js/formats/_sdf-template.js:10423`, read at `app/js/formats/isf.js:1748`),
>   **`A8_CARD_PRESETS`** + **`A8_GROUP_BANKS`** (both read at `app/js/card.js:2801`),
>   and **`A8_PASS_PROGRAMS`** (implemented by the reference renderer, `~/gits/ISF2`
>   `ANIM8-FORK.md` §Update 10).
>
> §6.5–§6.13 define those keys and §6.17 carries the corrected reserved list.

Top-level `A8_*` keys carry **non-input** concerns only. Anything that is a
property of one input belongs on that input's declaration (§6.3), never in a
parallel top-level structure.

#### 6.2.1 `A8_ANIMATE` — authored animation directives

Declarative oscillator bindings that give a file authored motion on hosts that
implement parameter animation. Array of objects:

```json
"A8_ANIMATE": [
  { "input": "u_L0_rotation", "curve": "sine", "rate": 0.25,
    "depth": 0.5, "phase": 0.0, "bipolar": true, "baseValue": 0.0 }
]
```

| Field | Type | Required | Semantics |
|-------|------|----------|-----------|
| `input` | string | required | `NAME` of a declared input in this file |
| `curve` | string | required | Oscillator waveform identifier (e.g. `sine`, `triangle`, `saw`, `square`; hosts MAY support more; unknown curves degrade to no animation) |
| `rate` | number | required | Oscillation rate in Hz |
| `depth` | number | required | Modulation depth as a fraction of the input's range |
| `phase` | number | optional (default 0) | Phase offset, 0–1 of one cycle |
| `bipolar` | bool | optional (default false) | Oscillate symmetrically around `baseValue` rather than upward from it |
| `baseValue` | number | optional (default: the input's `DEFAULT`) | The center/rest value the oscillation is applied to |

Hosts that do not implement animation ignore the block; the file renders at its
`DEFAULT`s. Hosts that do implement it MUST treat `A8_ANIMATE` as the *initial*
animation state — a performer's live changes take precedence.

#### 6.2.2 `A8_CAMERA` — camera capability declaration

```json
"A8_CAMERA": { "mode": "ray" }
```

At `A8VSN 1` the only defined shape is `{ "mode": "ray" }`. It declares that the
shader body implements the ray-camera hook: a GLSL function call site of the form
`a8CameraRay(uv, ro, rd)` through which an ISF2-aware host may inject a true-3D
eye position (`ro`) and per-fragment ray direction (`rd`) for raymarched content.
The `iCam*` uniform namespace is reserved for host camera integration; shader
authors MUST NOT declare unrelated uniforms with that prefix.

Hosts without camera support ignore the block; the shader MUST render correctly
with its own internal default camera when the hook is not driven.

> ⚠ **FALSE AGAINST SHIPPED CODE — annotated 2026-09-19, not rewritten (queue item 3).**
> "the only defined shape is `{ "mode": "ray" }`" is contradicted by the shipped emitter.
> `app/js/formats/_glsl-emit.js:250`-`:258` builds the block from the live camera STATE —
> every Tier-A `iCam*` name whose value is set, plus `iCamPanX` / `iCamPanY`, plus
> `iCamModel` — and emits it at `:270` as `A8_CAMERA`. So the deployed block is a flat
> state map with **no `mode` key at all**, and a conforming Level 1 parser reading the
> §6.2.2 shape finds nothing it recognises. **§6.11 (RATIFIED 2026-09-19, queue item 3) is the
> reconciliation** — `{mode, model, state}`, with the flat map grandfathered (§10.1). The
> `iCam*` reservation sentence and the `a8CameraRay` hook contract above are both accurate and
> unaffected.

#### 6.2.3 `A8_PROVENANCE` — content provenance

An append-only history of the file's origin and transformations:

```json
"A8_PROVENANCE": {
  "version": "1.0",
  "origin": { "source": "user", "author": "…", "license": "MIT", "url": "…" },
  "chain": [
    { "action": "create", "timestamp": "2026-09-19T09:14:20.192Z", "by": "…", "contentHash": "…" }
  ]
}
```

| Field | Semantics |
|-------|-----------|
| `version` | Provenance-schema version, currently `"1.0"` |
| `origin` | Where the content came from: `source`, `author`, `license` (SPDX identifier where possible), optional `url`; optional generation `seed`/`params` for generated content |
| `chain` | Append-only array of events. Every entry carries `action`, `timestamp` (ISO-8601 string), `by`, and `contentHash` |

Normative rules:

- **P1.** The chain is **append-only**. A tool that transforms an ISF2 file
  (re-emits, converts, re-parameterizes) MUST append an event describing the
  transformation and MUST NOT modify or remove existing entries.
- **P2.** A tool exporting or republishing an ISF2 file MUST preserve
  `A8_PROVENANCE` verbatim (plus its own appended event).
- **P3.** License information in `origin.license` governs downstream use; tools
  aggregating multiple ISF2 files SHOULD surface the most restrictive license in
  the set.

> ⚠ **FALSE AGAINST SHIPPED CODE — annotated 2026-09-19, corrected 2026-09-19 step (iv).**
> Two details of the table + example above do not describe what A8os writes; neither breaks a
> conforming V5 validator:
> - **`origin` carries six fields this table omits** — `url`, `authorUrl`, `grabbed`,
>   `grabbedBy`, `contentHash` alongside `source`/`author`/`license`
>   (`prvCreateOrigin`, `app/js/provenance.js:10-19`).
> - **`prvCreate` adds a fourth top-level member, `composition`** (`app/js/provenance.js:28`),
>   beside `version`/`origin`/`chain`; chain entries additionally carry `description`
>   (`app/js/provenance.js:38`).
>
> Measured the same day: **zero** files in `app/user-media/**` carry an `A8_PROVENANCE` block
> (`grep -rl '"A8_PROVENANCE"' app/user-media research app/app-library` → 0), which is the
> evidence behind the §6.16 save-path obligation. **§6.16 (RATIFIED 2026-09-19) is the
> reconciliation** and adds P4; the normative rules P1–P3 are accurate and unaffected.

### 6.3 Per-input extension fields

Extension properties of an individual input are carried **on that input's
declaration**, as additional fields with a leading underscore (plus a small set of
uppercase slider-affordance flags). ISF 2.0 parsers pass unknown input fields
through untouched, which is what makes this tier degradation-safe.

Defined at `A8VSN 1`:

| Field | Type | Synonym | Semantics |
|-------|------|---------|-----------|
| `_groupId` | string | — | Grouping key: inputs sharing a `_groupId` form one UI group (accordion/section). Producers SHOULD use a stable, namespaced convention (e.g. `"layer:0"`); the four shared ids are profiled in §6.14 E |
| `_groupLabel` | string | — | Display label for the group (first occurrence wins) |
| `_headerSlot` | bool | — | `true` ⇒ the input renders in its group's **header strip** (a color swatch, a compact selector) instead of the group body. It is a placement FLAG, not a slot name — a group's header slots render in declaration order |
| `_contextGate` | gate | — | Conditional visibility: the input renders only while the gate passes. Grammar below |
| `_contextHeaderGate` | gate | — | Same grammar, applied to a `_headerSlot` element |
| `_menuOnly` | bool | — | The input is presented in a secondary/context menu rather than the primary control list |
| `_op` | bool | `_glyOp` | Marks the input as a **warp operator**: an optional transform stage the user can activate/deactivate as a unit |
| `_opIdentity` | number | `_glyOpIdentity` | The operator's identity ("off") value — the value at which the operator has no effect. Hosts deactivating an operator set it here |
| `_opAuthored` | bool | `_glyOpAuthored` | The operator was active in the authored composition and SHOULD be visible/active by default; non-authored operators are available but hidden until activated |
| `_opCompanion` | string | `_glyOpCompanion` | Links a parameter to the operator (`NAME`) it belongs to, so it shows/hides with that operator |
| `_a8ManagedSlot` | bool | — | The image input is host-managed (e.g. a fill-texture slot bound through the host's own media routing) and MUST NOT be rendered as an ordinary user file-input row |
| `_audioRole` | string | — | `"wave"` or `"fft"`. Tags an `image`-typed input as carrying audio texture data (§8.3) — the degradation-safe encoding of `audio`/`audioFFT` |
| `BIPOLAR` | bool | — | Slider affordance: the value is symmetric around a center; hosts SHOULD render a center-detented control |
| `TICKS` | array of number | — | Slider affordance: notable values to mark on the control |
| `SNAP_TICKS` | bool | — | Values snap to the declared `TICKS` |
| `PLAIN` | bool | — | Render as a plain (non-bindable/non-automatable) control |

**Operator-field naming.** The neutral `_op*` names are canonical. The `_glyOp*`
spellings are **grandfathered synonyms** carried by already-published files;
consumers MUST accept both and treat them as the same field, producers MUST emit
the neutral names. Where both appear on one input, the neutral name wins.

#### 6.3.1 Gate grammar

A gate is either **one predicate** or an **array of predicates**, ANDed:

```json
"_contextGate": { "param": "mode", "eq": 4 }
"_contextGate": { "param": "scope", "not": "skybox" }
"_contextGate": { "param": "sliceMode", "anyOf": [4, 7] }
"_contextGate": [ { "param": "spinMode", "not": 0 }, { "param": "model", "eq": "scene" } ]
```

| Field | Semantics |
|-------|-----------|
| `param` | REQUIRED. The `NAME` of the sibling input that drives the gate |
| `eq` | Passes when the driver's value equals this value |
| `not` | Passes when the driver's value does not equal this value |
| `anyOf` | Array. Passes when the driver's value is a member |

Normative rules:

- **G1.** A predicate carries `param` plus **exactly one** of `eq` / `not` / `anyOf`.
- **G2.** A gate whose driver value is **undefined** PASSES (default-visible until
  the driver is first committed).
- **G3.** Gating is presentation-only (X3): a hidden input keeps its declared
  value and its uniform is still supplied to the shader.

> ⚠ **INCOMPLETE AGAINST SHIPPED CODE — annotated 2026-09-19, not rewritten.** The host's
> single gate evaluator (`panelEvalContextGate`, `app/js/components.js:3008`) accepts three
> constructs this grammar does not describe, and **V7 as written would reject the app's own
> camera rig**:
> - **`in: [...]`** — a ratified alias of `anyOf` (`app/js/components.js:3057`). The camera
>   canon uses it on four descriptors (`_camera-canon.js:178`, `:179`, `:194`, `:195` —
>   `{ param: 'iCamModel', in: ['scene', 'planeinf'] }`), so a G1-strict validator ("exactly
>   one of `eq`/`not`/`anyOf`") REDs a shipped, correct file.
> - **`{ any: [ …gates ] }`** — the OR wrapper, composing with the array-AND form
>   (`app/js/components.js:3061-3070`).
> - **`def: <value>`** — an opt-in override of G2's fail-open: the clause states what an
>   ABSENT driver means (`app/js/components.js:3040`). G2 remains correct for every clause
>   that declares no `def`.
>
> One further silent rule: the evaluator normalises a boolean driver value to `1`/`0` before
> comparing (`app/js/components.js:3051`), so `eq: 1` matches a driver committed as `true`.
> These are additions to the grammar, not contradictions of it; §6.14 carries the proposed
> published form. G1/G2/G3 stand as written until that is ratified.

Rules:

- **X1.** All per-input extension fields are OPTIONAL. A host implementing none of
  them MUST still render the input as a plain control of its `TYPE`.
- **X2.** Underscore-prefixed input-field names not listed here are reserved for
  future versions of this standard.
- **X3.** No per-input extension field may alter the input's `TYPE`, `NAME`,
  uniform mapping, or value semantics (see V6, §9.3). They are presentation and
  orchestration metadata only.

---

> **§6.4 – §6.18 and Appendices A/B were RATIFIED 2026-09-19** (the ten-item decision queue in
> `roadmap/isf2-authoring-contract-gap.md` §6, closed in one pass) and land at `A8VSN 2` (§10.1).
>
> Per-block legend — **PORTABLE** (a foreign player honours it with no A8os knowledge) ·
> **A8OS-SPECIFIC** (the shape is published; a player that cannot resolve the content marks it
> `unresolved` and continues — never fails the load).

### 6.4 Scope — ISF2 as the authoring contract — RATIFIED 2026-09-19 (queue item 1)

**The amendment.** §1 "Out of scope" draws the line at *the tool made it, the file carries
it*. That line is redrawn: the **mechanism** of authoring stays out, the **result** comes in.

| Stays OUT (the tool) | Comes IN (the artifact) |
|---|---|
| Gestures — cmd-click eject, hold-drag reorder, bracket drag, right-click menus | Their RESULT: `arrangement`, brackets (§6.5) |
| Chrome markup — panel DOM, accordion elements, class names | Presentation SEMANTICS: group, header slot, row cluster, order (§6.3, §6.14) |
| Pane geometry, preview pill, gizmo, pickers, the Library module | The picked REF (§6.12), host-resolved |
| Storage paths + endpoints | The source-identity KEY DERIVATION (§6.15) |
| Diagnostic rows, instrumentation | — |
| Every non-fragment-shader substrate (P5J, PEN-DOM, CSS, LOT, M3D, MILK, WASM, TXT) | — (the operator's scope ruling) |

**The test.** A thing is in scope iff a *foreign player* needs it to do one of five acts:
**(a)** render · **(b)** show every control with its range, ladder and description ·
**(c)** apply a preset · **(d)** run declared modulation · **(e)** show provenance.
Anything else is the tool's.

**Consequence.** §1's "Out of scope" paragraph keeps its first sentence (analysis and
generation remain authoring-tool concerns) and loses its implicit claim that the authored
control surface and authored state are the tool's. They are the artifact's, and §6.5–§6.16
are where they live.

- **Conformance:** none directly — this is the scoping rule the rest of the block set rests on.
- **Reference renderer:** none. **Producer:** none.

### 6.5 `A8_PRESETS` — the preset bank in the file — RATIFIED 2026-09-19 (queue item 2)

The highest-value addition: without it, goal (c) *apply a preset* has no format at all. It
unifies two live-but-undefined header keys (`A8_CARD_PRESETS` + `A8_GROUP_BANKS`, both read
by the one resolver at `app/js/card.js:2802`) and publishes the slot schema
`specs/preset-json.md:11` documents today only as an app format.

```json
"A8_PRESETS": {
  "schema": "1",
  "bank": {
    "D": {
      "name": "Koine",
      "params":      { "weave": 0.4, "hue": 0.0 },
      "ranges":      { "weave": [0.0, 1.0] },
      "inverts":     { "weave": false },
      "deactivated": [],
      "opacity":     [1, 1, 1, 1],
      "blend":       "normal",
      "renderState": "active",
      "ops":         { "world": { "u_tile": 0.4 } },
      "camera":      { "iCamZoom": 0.3 },
      "arrangement": { "excludedParams": [], "paramOrder": [], "paramLabels": {},
                       "excludedGroups": [], "groupOrder": [], "groupLabels": {} },
      "modulation":  { "receivers": [] },
      "generation":  { "provenance": [] }
    },
    "1": { "name": "Audio Boom", "params": { "weave": 1.2 } }
  },
  "groupBanks": { "lighting": { "D": { "params": { "rmKeyDir": 0.5 } } } }
}
```

**Slot fields.** `params` · `ranges` · `inverts` · `deactivated` · `opacity` · `blend` ·
`renderState` map 1:1 to the card snapshot (`app/js/card.js:5405`–`:5462`). Two rules are
normative because a host will otherwise invent them:

- **`opacity` is the per-channel `[r,g,b,a]` vector, with `a` derived as `max(r,g,b)`**
  (`app/js/card.js:5421`). Never a scalar — **RULED 2026-09-19 (queue-clarification):** this
  stays an ERROR (normative, not advisory); §11.1 step (v) re-grades it to a warning ONLY if
  the corpus is measured, at that step, to carry scalar `opacity` in the wild — no re-grade
  without that measurement.
- **`ranges` are BRACKETS, not `MIN`/`MAX`.** `MIN`/`MAX` (§5) are the declared domain; a
  bracket is the performer's operating window inside it, user-dragged, and it is the span a
  bound modulator sweeps (`app/js/card.js:1793` — the `sx-bounds-edited` commit into
  `card.ranges`; `specs/sx-wrap.md:400`). A player honouring only `MIN`/`MAX` sweeps the
  wrong span, which looks like a broken modulator and is not.

`arrangement` carries the eject / reorder / rename RESULT — the single most-used authoring
gesture, whose output is pure data (`app/js/card.js:5429`, `:5436`). `ops` and `camera`
re-state §6.7 / §6.11 **per slot**, because a preset that cannot change the active op set or
the view is not a preset of these shaders. `groupBanks` is `A8_GROUP_BANKS`, keyed by
`_groupId`.

**Normative recall order — this is where hosts will get it wrong:**

> `ops` → `camera` → `arrangement` → `ranges` → `params` → `modulation`

`ops` first because activating an op **MINTS INPUTS** that later steps write to
(`specs/ops-canon.md:328`). `ranges` before `params` because a value push CLAMPS to the live
bracket: restoring values against a stale narrow window silently lands the default inside it
and the slot never recalls — the lesson recorded as `BOUND-D-RESET-CLAMPED-BY-STALE-BRACKET`
(`specs/CLAUDE.md:313`), published here so nobody relearns it.

- **Conformance:** Level 1 parses + preserves; **Level 3** (§6.18) applies a slot. `D` is the
  reset baseline, `1`–`11` are user slots, an absent slot is absent (never `null`-padded).
- **Slots are addressed by id, never by position.** `bank` is a JSON object; a host that
  enumerates it with `Object.keys()` gets integer-like keys FIRST regardless of insertion
  order (the JS spec's own key-ordering rule — `"1"` sorts before `"D"` in every engine),
  which is not declaration order and is not a host bug. A conforming host that renders a bank
  deliberately sorts its own listing (`D` first, then numeric slots ascending); it resolves a
  recall by the slot's own key, never by `bank`'s enumeration order (2026-09-19 step (iv)).
- **Reference renderer:** PARSE + VALIDATE (every `params` / `ranges` / `inverts` key names a
  declared input). Applying is a host act, but the module SHOULD expose
  `ISF2.applyPreset(model, slotId)` → a flat `{name: value}` map so hosts do not each
  re-derive the recall order.
- **Producer:** MUST emit `D` at minimum when a bank exists.
- **PORTABLE**, except `modulation.receivers[].source.id` (§6.6) and `generation` (§6.16).

**Supersession.** `A8_CARD_PRESETS` and `A8_GROUP_BANKS` become **grandfathered synonyms —
read-only for consumers AND still-valid producer output until `A8VSN 2`**: consumers MUST
accept them; producers SHOULD emit `A8_PRESETS` from now and MUST from `A8VSN 2`. The two-sided
wording is deliberate — a one-sided "producers MUST NOT emit" would have made every already
published file's own authoring gate enforce a violation the day this ratified (queue item 11).
Exactly the
`_glyOp*` precedent (§6.3 "Operator-field naming") and the E2 rule that goes with it (N6,
§9.2.1): a round trip through a file the emitter did not otherwise touch re-emits the legacy
spelling rather than rewriting it. Measured cost of the supersession: **3 files**
(`grep -rl '"A8_CARD_PRESETS"' app/user-media research app/app-library` → 2;
`"A8_GROUP_BANKS"` → 1).

### 6.6 `A8_MODULATION` — declared binds — RATIFIED 2026-09-19 (queue items 5, 6)

`A8_ANIMATE` (§6.2.1) can express one thing: an oscillator the author attached to an input.
It cannot express a bind to an external source, the bracket the oscillator sweeps, or the
easing-library curve the live oscillator actually uses (`specs/data-router.md:162` — a
`curveId` into the "Waveforms and Easings" library, not a bare waveform name).
`A8_MODULATION` is its superset and, per queue item 5, its **replacement**.

```json
"A8_MODULATION": {
  "receivers": [
    { "target": "weave",
      "source": { "id": "ck:phase", "kind": "clock", "range": [0, 1] },
      "transform": { "srcRange": [0, 1], "dstRange": [0.2, 0.8],
                     "invert": false, "min": 0.2, "max": 0.8 },
      "oscillator": { "curve": "sine", "rate": 0.25, "depth": 0.5,
                      "phase": 0.0, "bipolar": true, "base": 0.5 },
      "active": true }
  ]
}
```

Shape from the live receiver config (`specs/data-router.md:134`) and the oscillator transform
(`specs/data-router.md:162`) with **one change**: `source` is a `{id, kind, range}` triple
rather than a bare id string.

**`kind` is the portable part.** Defined values: `clock` · `audio-band` · `audio-rms` ·
`beat` · `lfo` · `sequencer` · `param` · `host`. A foreign player with its own clock can
honour a `clock`-kind bind without ever knowing what `ck:phase` is.

**`id` is A8OS-SPECIFIC.** The live id namespace (`specs/data-router.md:234`) is module-local
— `ck:*` · `aa:band:F<n>` · `aa:rms` · `lf:<idx>:<wave>` · `sq:0:<track>:out` ·
`sx:{cardId}:{param}`. A player that cannot resolve an id **MUST**, in order:

1. mark the receiver `unresolved` and surface that state on the control;
2. fall back to the `oscillator` block if one is present — it is entirely self-contained;
3. otherwise leave the parameter at its slot value.

**It MUST NOT fail the load.** An unresolvable modulation source is a missing performance
input, never a malformed file.

**Transform semantics** are the published affine: raw → normalise via `srcRange` → invert in
`[0,1]` → scale to `dstRange` → clamp to `[min, max]` (`specs/data-router.md:152`).
`scale`/`offset` are never stored; they are implied. `transform.invert` is a REFLECTION of
the parameter's own `inverted` state (§6.5 `inverts`), which owns the truth
(`specs/data-router.md:158`) — a host restoring both MUST take `inverts` as authoritative.
Where an `oscillator` block is present it **bypasses the affine**: the curve IS the mapping,
and delivery clamps to the bracket (§6.5 `ranges`).

**Relationship to `_bind` (§6.14 D).** The per-input `_bind` shorthand is
a receiver in one field: `{source, min, max}` desugars to
`{target, source:{id,kind}, transform:{min,max}, active:true}` — `min`/`max` are the BRACKET
(`app/js/editors/_base.js:1914` pushes them through `sxSetRange` before binding), never
`dstRange`. Same rule as `A8_ANIMATE` where both name one input: `A8_MODULATION` wins.

**Relationship to `A8_ANIMATE` (queue item 5 — DEPRECATE).** `A8_ANIMATE` is **deprecated at
`A8VSN 2`**: consumers MUST continue to accept it (it is the shape every pre-`A8VSN 2` file
carries), producers MUST emit `A8_MODULATION` instead. An `A8_ANIMATE` entry is exactly an
`A8_MODULATION` receiver with no `source`, so the upgrade is mechanical:
`{input, curve, rate, depth, phase, bipolar, baseValue}` →
`{target: input, oscillator: {curve, rate, depth, phase, bipolar, base: baseValue}, active: true}`.
Where both name the same input, `A8_MODULATION` wins. **This deprecation is why these
additions force `A8VSN 2` rather than `1.x` (§10).**

**Full precedence — 2026-09-19 step (iv), where more than one names the same input:**
`A8_MODULATION` > `_bind` > `A8_ANIMATE` — the live gated spelling always outranks the
deprecated one, and the desugar sits between them because it is a shorthand FOR the live
shape. The reference resolver builds the receiver list in exactly this order, first-target-wins
(`resolveReceivers`, `src/ISF2.js:792-855`, `put()` no-ops on a target already claimed,
`:795-800`).

- **Conformance:** **Level 4** (§6.18).
- **Reference renderer:** PARSE-AND-IGNORE + VALIDATE (`target` names a declared input;
  `kind` is a defined value; `transform` ranges are two-element numeric arrays). It hosts no
  modulation, so it never runs one.
- **Producer:** emit what it authored. The A8os card already serializes this state
  (`app/js/card.js:5457`, operator-ratified — *"every card, every editor, anywhere that has
  presets must save/recall/deliver bindings, no holes"*); it has no format to carry it in.
- **PORTABLE** via `kind` + `oscillator`; `id` **A8OS-SPECIFIC** with the mandated
  `unresolved` path above.

### 6.7 `A8_OPS` — active warp / shading operators — RATIFIED 2026-09-19 (queue item 4)

**Why this is not optional.** Operators are **injected at load and never baked into the
`.fs`** (`specs/ops-canon.md:322`). A foreign player that ignores `A8_OPS` therefore renders
the shader *without the warps the author activated* — a different image, silently, with no
error anywhere. This block is the only way the author's picture survives the file.

```json
"A8_OPS": {
  "world":    { "u_tile": 0.4, "u_mirrorX": 1 },
  "raymarch": { "ao": 1, "softShadow": 1 },
  "sdf":      { "u_opCurlNoise": 0.2 }
}
```

Scope → `{ opName: amount }`, **active-only** — an op nobody activated is ABSENT, not
present-at-identity, because activation is what recompiles it into the GLSL
(`specs/ops-canon.md:328`, the unified `card.opActive` field this mirrors verbatim). An
**unknown op name is IGNORED**, which degrades to that op's identity — the same graceful
floor every other extension has.

**Scopes are open, not enumerated.** The A8os serializer walks whatever scope keys the engine
declares rather than hand-listing them (`app/js/card.js:5557`), so a new scope costs no schema
change. Defined today: `world` (injected screen-space warps) · `sdf` (per-term field ops) ·
`raymarch` (shading ops, §6.8) · `glyph` (baked flat ops).

> **`view` is RETIRED and MUST NOT be emitted.** The view-space lens stage was retired at the
> roster, descriptor, emit and mount seams together (`app/js/formats/_ops-canon.js:1258`
> `VIEW_OPS_RETIRED = true`, honoured at `:1359` and `:1696`). The shipped DECLARE emitter
> still initialises an empty `view` map (`app/js/formats/_glsl-emit.js:260`) which can only
> ever serialize as `{}`; a conforming producer omits the scope entirely, and a consumer that
> meets one treats it as an unknown scope (ignore).

**The roster is normative and versioned — Appendix A.** Queue item 4 accepts that the roster
is a table this standard owns and grows. It is published rather than described because an
op name without a published meaning is a private extension wearing a defined key's clothes.
Source of truth for the `world` scope: `app/js/formats/_ops-canon.js:453`
(`INJECTED_OP_NAMES`, 20 entries); for `raymarch`: `app/js/formats/_raymarch-ops.js:50`
(`OPS`, 5 entries). See **Appendix A** below.

- **Conformance:** **Level 3** (§6.18).
- **Reference renderer: PARSE + VALIDATE — RULED 2026-09-19 (queue-clarification, §6.7/§6.11).**
  Appendix A publishes the op names, the coordinate space each scope injects into, and the
  composition order — but no GLSL. An oracle that must invent the injected math from a name
  list is not one; "IMPLEMENT" overstated what is published today. The reference renderer
  validates every name against Appendix A and reports unknown names (identity degradation);
  it does not yet splice the prelude. §11.1 step (vi) is the named future step that closes this
  — publish the injected GLSL, then implement against it.
- **Producer:** MUST emit when any op is active. (`A8GLSLEmit` already does —
  `app/js/formats/_glsl-emit.js:271` — which is the §6.2 annotation's point.)
- **PORTABLE** for the published roster; unknown names degrade cleanly.

### 6.8 `A8_RAYMARCH_OPS` — the raymarch shading capability — RATIFIED 2026-09-19

A live, undefined header key. It declares that the body carries the raymarch shade HOOK
MARKERS, so a host may splice shading operators into them.

```json
"A8_RAYMARCH_OPS": {
  "base": "rm",
  "hooks": ["normal", "occ", "shade", "post"],
  "starters": ["ao", "softShadow", "fresnel", "refract", "palette"],
  "renderScale": 1.0
}
```

| Field | Semantics |
|---|---|
| `base` | Uniform-name prefix for spliced ops: `<base>_<opKey>` and `<base>_<opKey>_<arg>` |
| `hooks` | Which of `normal` / `occ` / `shade` / `post` splice points the body marks |
| `starters` | Ops the author intends offered first; presentation only. **RULED 2026-09-19: because this field is presentation-only, a malformed `starters` (not an array, or an entry outside the Appendix A.2 roster) VALIDATES as a WARNING, never an error** — unlike `hooks`, which is structural |
| `renderScale` | OPTIONAL per-shader override of the host's `'auto'` render scale (`app/js/formats/isf.js:1971`). A hero look that must load crisp declares `1.0` |

The block is read at `loadSource` (`app/js/formats/isf.js:847`) and the op roster it draws on
is §6.7's `raymarch` scope — same active-set, same `A8_OPS` carrier, same identity-at-rest
rule (`specs/raymarch-ops.md:330`).

- **Conformance:** Level 1 parse + preserve; **Level 3** honours it by offering + splicing
  the ops. A host that ignores it renders the body's own baked default shade, which is the
  degradation guarantee working.
- **Reference renderer:** PARSE-AND-IGNORE + VALIDATE (`hooks` ⊆ the four names; `starters` ⊆
  the Appendix A raymarch roster).
- **Producer:** emit when the body carries the hook markers.
- **PORTABLE**.

### 6.9 `A8_FOLD` — compile-fold driver hint — RATIFIED 2026-09-19

A live, undefined header key; purely an optimisation hint, and the one block in this set a
host may ignore with **zero** visual consequence.

```json
"A8_FOLD": {
  "flags":   { "<feature>": 0 },
  "drivers": { "<feature>": ["<inputName>", "…"] },
  "guarded": ["<feature>"],
  "refused": ["<feature>"],
  "overlap": ["<feature>"]
}
```

`drivers` is the normative member: it names, per compile-folded feature, the inputs whose
change requires a RECOMPILE rather than a uniform push. `flags` / `guarded` / `refused` /
`overlap` are the composer's own bookkeeping (`app/js/formats/_sdf-template.js:10423`) and are
advisory. A host with no fold model ignores the whole block and pushes every input as a
uniform — correct, just not optimal.

The A8os consumer reads `drivers` alone and flattens it to a name set
(`app/js/formats/isf.js:1748`), which is exactly the portable contract.

- **Conformance:** Level 1 parse + preserve. No level honours it — it is a hint.
- **Reference renderer:** PARSE-AND-IGNORE. **Producer:** emit when it compile-folds.
- **PORTABLE**.

### 6.10 `A8_PASS_PROGRAMS` — one compiled program per pass — RATIFIED 2026-09-19

**The one block the reference renderer ALREADY IMPLEMENTS** — and the sharpest illustration
of §6.2's problem, since the reference implementation uses a top-level name the standard
forbids producers to use privately.

```json
"A8_PASS_PROGRAMS": true
```

Baseline ISF runs every pass of a multipass shader through ONE fragment program branched on
`PASSINDEX`, so the heaviest pass carries the register footprint of every other pass. With
this flag the parser sets `perPassPrograms` and builds `PASSES.length` programs from the same
source, each prefixed `#define A8_PASS <i>` immediately after the `#version` line, so a pass
wraps its body in `#if A8_PASS == i` and the preprocessor removes every other pass's code
(`~/gits/ISF2` `ANIM8-FORK.md` §Update 10).

Normative for a host that implements it: non-texture uniforms are pushed to EVERY program;
textures are bound once (units are global GL state) with the sampler location set on every
program; the final pass's program remains the one every single-program path sees.

**A host that ignores the flag still renders correctly** — one branched program, just slower.
That is the degradation guarantee doing its job on a performance feature, which is why this
binds Level 2 hosts *that implement multipass* rather than a new level.

> **The A8os producer emits it nowhere — deliberately.** The template split that would have
> used it was REVERTED on measurement: same record, same 390 params, same 1080p base —
> pre-split 42.2 ms, split 48.3 ms (**+14 %**), output digest identical
> (`design/regression-sentinel-set.txt:423`). A regression sentinel now REDs if the split
> shape returns. Publishing the key is therefore about the RENDERER's capability and about
> third-party producers, not about A8os emission.

- **Conformance:** Level 2 hosts implementing multipass.
- **Reference renderer:** **ALREADY IMPLEMENTED.** **Producer:** optional; A8os emits none.
- **PORTABLE**.

### 6.11 `A8_CAMERA` reconciled — capability + authored view — RATIFIED 2026-09-19 (queue item 3)

§6.2.2 defines a capability FLAG; the shipped emitter writes camera STATE under the same key
(see the §6.2.2 annotation). Two incompatible shapes, one name, both deployed. The
reconciliation keeps the flag and gives the state a home beside it, rather than moving the
state into `A8_PRESETS.camera` — because the authored view is a property of the FILE (it is
how the author framed the piece), while a preset slot's `camera` is one saved variation of it.
Both exist; §6.5's per-slot `camera` overrides this one on recall.

```json
"A8_CAMERA": {
  "mode": "ray",
  "model": "scene",
  "state": { "iCamZoom": 0.3, "iCamPanX": 0.0, "iCamRotY": 12.0 }
}
```

| Field | Required | Semantics |
|---|---|---|
| `mode` | optional | The §6.2.2 capability flag. `"ray"` ⇒ the body calls `a8CameraRay(uv, ro, rd)`. Absent ⇒ no ray hook; the host's 2D coordinate warp applies instead |
| `model` | optional | `"scene"` (in-content tilt / keystone) · `"plane"` (rigid canvas rotate) · `"planeinf"` (infinite plane — runs both). Default `"scene"` |
| `state` | optional | Authored camera position: `{ <iCamName>: <number\|string> }` over the Appendix B roster |

**`state` is in the STATE DOMAIN, normatively.** It is the value a host pushes through its
own `setParam` — *never* the post-conversion uniform value. The shipped emitter says exactly
why in its own comment (`app/js/formats/_glsl-emit.js:243`): DECLARE preserves the host's
conversion seam, so writing the uniform domain here double-converts (a baked linear zoom
re-read as an exponent). BAKE bakes the uniform domain precisely because it *replaces* the
seam. A host that writes `state` straight to a uniform is non-conforming.

**The `iCam*` roster is published as Appendix B** so a foreign player knows what `iCamZoom`
means. Source of truth: `app/js/formats/_camera-canon.js:129`. The §6.2.2 reservation of the
`iCam*` namespace and V8 are unchanged and still bind.

- **Conformance:** Level 1 parse; **Level 2** honours `mode` (already); **Level 3** honours
  `state`. A host without a camera ignores `state` and renders at the shader's own defaults —
  which is the existing §6.2.2 contract, unchanged.
- **Reference renderer: PARSE + VALIDATE — RULED 2026-09-19 (queue-clarification, §6.7/§6.11).**
  Appendix B publishes every `iCam*` domain name but no transform — the same gap as §6.7: a
  renderer that invents the `mode`/`model`/`state` → uniform conversion from a roster of names
  is not an oracle for it. The reference renderer validates `state` keys against Appendix B and
  the `mode`/`model` enums; it does not yet own the injection seam. §11.1 step (vi) closes this.
- **Producer:** MUST emit for any file whose body carries the `a8CameraRay` marker.
  `A8GLSLEmit` already emits a `state`-shaped block; conforming means adding `mode` and
  lifting `iCamModel` out of the state map into `model`.
- **PORTABLE**.

### 6.12 `A8_LAYERS` — texture slots — RATIFIED 2026-09-19 (queue item 7)

Defines the second name §6.2 reserves. A shader whose header declares a layer group gets a
texture slot; this block says what is IN the slot.

```json
"A8_LAYERS": {
  "bg": {
    "ref": { "kind": "isf", "name": "Color Bars" },
    "mode": "texture", "blend": "normal", "opacity": 1.0
  },
  "layers": {
    "0": { "slot": "fill0", "mapping": "triplanar",
           "ref": { "kind": "isf", "name": "Mineral", "path": "materials/mineral/Mineral.fs" } }
  }
}
```

**How a slot comes to exist.** A group DECLARES that it hosts a slot; it is never recognised
by a prefix in its id. The host registry is `A8LayerCanon.declareSlotHost(gid, {role, slot,
layerIndex})` (`app/js/formats/_layer-canon.js:1315`), and a baked header declares into it at
ingest by the group id's SHAPE — `bg` ⇒ the background slot, `layer:<n>` ⇒ fill layer *n*
(`app/js/formats/isf.js:873`). That shape scan is the portable rule: **any** fragment shader
declaring such a group gets a slot, with no card type to check.

**`ref` is the one place this standard admits an external dependency.** Queue item 7 answers
how far that goes: **inline is ALLOWED.**

- A `ref` MAY be `{kind, name, path?}` — an external, **host-resolved** name. A host that
  cannot resolve it leaves the slot EMPTY and renders with the slot's declared default.
  **Never a failed load.**
- A `ref` MAY instead be `{ "data": "data:image/png;base64,…" }` — an inline data URI — so a
  file can be **fully self-contained**. Where both are present, `data` wins and `name`/`path`
  degrade to attribution.
- Inline content carries the same provenance obligation as the file (§6.2.3): embedding a
  ref does not launder its origin.

`mapping` names how the texture meets the surface — `triplanar` · `planar` · `object` ·
`screen` · `spherical` · `cylindrical` (`specs/sdf-cards.md` §4c.11 E, `A8TexMappingCanon`).
Absent ⇒ host default.

- **Conformance:** **Level 4** (§6.18).
- **Reference renderer:** PARSE-AND-IGNORE + VALIDATE (`layers` keys are integer strings;
  every declared slot has a declaring group). Slot filling is a host act.
- **Producer:** emit when a slot is bound. The A8os card already serializes exactly this state
  (`app/js/card.js:5670`).
- **PORTABLE** in shape; **content resolution is host-local** except for inline `data`.

### 6.13 `A8_PLAYBACK` — the artifact's playback semantics — RATIFIED 2026-09-19

Four per-artifact playback levers that are not app chrome: get them wrong and the piece plays
at the wrong speed, at the wrong size, in the wrong aspect, or recalls into the wrong state.

```json
"A8_PLAYBACK": {
  "timeScale": 1.0,
  "renderScale": "auto",
  "scaleMode": "fit",
  "processRecall": "seed",
  "clock": { "bpm": 120, "meter": [4, 4], "source": "internal", "rate": 1.0 }
}
```

| Field | Semantics |
|---|---|
| `timeScale` | The rate the host advances the shader's clock. **This is the one a foreign player silently gets wrong**: A8os drives an INJECTED `iTimeSpeed` uniform (`app/js/formats/isf.js:107`), not raw `TIME`, so a player running the body at `TIME` plays the piece at the wrong speed with nothing to see |
| `renderScale` | Per-artifact FBO sizing lever: `"auto"` or a number. `"auto"` is the host's own policy (§6.8 `renderScale` overrides it per-shader) |
| `scaleMode` | How the output meets a differently-shaped target: `aspect` · `fit` · `fill` · `copy` |
| `processRecall` | For a shader with a `PERSISTENT` pass (§7.4) — its output depends on its own prior frame. `"seed"` clears the persistent buffers on recall so the piece is the one the preset describes; `"state"` leaves the live evolution running. **Default `"seed"`.** A player that ignores this recalls a feedback shader into whatever it had drifted into |
| `clock` | Musical transport: `{bpm, nudge, meter, divisions, source, rate, loop}` |

**`clock.position` is deliberately absent and MUST NOT be added.** Recall never teleports
time — the same rule that keeps a modulation lane continuous across a preset change
(`app/js/card.js:5493`).

- **Conformance:** Level 1 parse; **Level 3** honours it.
- **Reference renderer:** IMPLEMENT `timeScale` (it owns the uniform); the rest
  PARSE-AND-IGNORE (they are host composition decisions).
- **Producer:** emit `timeScale` whenever it is not `1`, and `processRecall` for any file
  declaring a `PERSISTENT` pass.
- **PORTABLE**.

### 6.14 The published presentation family — §6.3 extended — RATIFIED 2026-09-19

**The standing violation this closes.** X2 (§6.3) reserves *every* underscore-prefixed input
field not listed in §6.3. Thirteen such fields are live in the app and stamped into the
shipped corpus — so the corpus violates the standard, not the other way round. Without them a
foreign player renders a flat, wrongly-labelled, wrongly-ordered control list: it can show the
controls but cannot show the surface the author built.

**The family is named and its membership is this table; the SPELLINGS are frozen as shipped.**
Renaming would break E2 (§9.2, byte-stable re-emit) for every already-published file, exactly
as N6 (§9.2.1) reasons about `_glyOp*`. They keep §6.3's leading-underscore convention, which
is what makes them degradation-safe: an ISF 2.0 parser passes unknown input fields through
untouched.

Every row satisfies **X3** — none alters `TYPE`, `NAME`, uniform mapping or value semantics —
so V6 extension-neutrality holds unchanged.

**A. PORTABLE presentation** — a foreign player honours these with no A8os knowledge.

| Field | Type | Semantics | Live in corpus |
|---|---|---|---|
| `_rowId` | string | Inputs sharing a `_rowId` render as ONE row (selector clusters) | 1 |
| `_groupParent` | string | This input's group nests under the named group | 27 |
| `_stackOrder` | number | Rank within the group; where the body consumes it, also the composite paint rank | 16 |
| `_valueSubgroups` | object | `{ <driverValue>: <subgroupId> }` — which sub-group is live is a function of a driver input's value | 6 |
| `_labelBy` | object | `{ param, map: {<value>: <label>}, default }` — this row's LABEL is a function of another input's value | 37 |
| `_contextRange` | object | The `_contextGate` twin for RANGE: a driver's value narrows this input's usable span. Same grammar as §6.3.1 | 0 (live in `app/js`) |
| `_derive` | object | This row's displayed value is a PROJECTION of another param — not independently settable | 29 |
| `_noTimeTwin` | bool | Suppress the host's auto-minted `<NAME>_time` modulation lane | 35 |
| `_layerRow` / `_slotEntryRow` | bool | Sub-roster presence + ownership: this row belongs to a layer / slot entry rather than the group body | 18 / 11 |
| `_blendable` | bool | This colour group takes a blend-mode header. Neutral name; `_groupBlendable` is the grandfathered synonym | 0 (live in `app/js`) |
| `_transportDomain` | bool | The input belongs to the player TRANSPORT block, not a slider row. Neutral name; **`TRANSPORT_DOMAIN` is the grandfathered synonym** and is the only extension field in the whole standard that escapes X2 by not being underscore-prefixed | 0 (live in `app/js`) |

**B. DECLARED ROLES** — the two fields that exist because a capability must belong to the
MEDIUM, not to a card type. Both replaced a prefix match on a group id, which is the
`PER-TYPE-IDENTIFIER-NAMESPACE` failure (`specs/CLAUDE.md:329`).

| Field | Type | Semantics | Live in corpus |
|---|---|---|---|
| `_lightRig` | bool | This input's group IS the light rig. A declared ROLE, never inferred from the group's id | 17 |
| `_shapeMath` | bool | This float is part of the shader's OWN shape math — eligible for a deterministic seed roll. Read at `app/js/formats/isf.js:614` | 6 |

**C. A8OS-SPECIFIC — published so they are not private, honoured by nobody but the host.**
A foreign player parses, preserves and IGNORES these; they describe host bookkeeping, not the
artifact. They are listed so X2 stops being violated, **not** so anyone implements them:
`_engineOnly` · `_a8DebugTap` · `_a8Synthetic` (markers the engine stamps on descriptors it
mints at runtime — `_a8DebugTap` / `_a8Synthetic` at `app/js/formats/isf.js:602`, `_engineOnly` at `app/js/components.js:11377`) and `_hueFamily` (a hover-cue tint).

**D. `_bind` — the per-input modulation shorthand — RATIFIED 2026-09-19 (queue item 11).**
`_bind` was the standing X2 violation the enumeration above MISSED: it is mandated by the producer prompt
(`design/prompts/producers/shader-glsl.md:413` Rule 11), FAILED-ON by the gate when absent
(`checkShipsAlive`, `app/tools/verify-portrait.js:190`), and wired live at
`app/js/editors/_base.js:1902`-1918 — yet the string `_bind` appears nowhere in this standard
and nowhere in `roadmap/isf2-authoring-contract-gap.md`. **A gated field is by definition
load-bearing; an authoring-surface audit must walk what the GATE requires as well as what the
app reads.**

| Field | Type | Semantics | Live in corpus |
|---|---|---|---|
| `_bind` | object | `{ source, min, max }` — this input ships ALIVE, bound to the named modulator source, sweeping the bracket `[min, max]` | 4 (1 published portrait) |

It is listed here rather than in group A because it is **behaviour, not presentation**: its
`source` is an A8OS-SPECIFIC id (§6.6) and a foreign player cannot honour it blind.

**Normative desugar — one `_bind` IS one `A8_MODULATION` receiver** (§6.6), the same
mechanical upgrade §6.6 already writes for `A8_ANIMATE`:

The canonical exemplar is the published `Koine.fs`, which carries four real `_bind` blocks —
one waveform per bound input:

```
{ "NAME": "weave", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.0, "MAX": 1.0,
  "_groupId": "koine", "_bind": { "source": "lf:1:sine", "min": 0.25, "max": 0.7 } }

  →  A8_MODULATION.receivers[]: { target: "weave",
                                  source: { id: "lf:1:sine", kind: "lfo" },
                                  transform: { min: 0.25, max: 0.7 },
                                  active: true }
```

**`_bind.min/max` is the BRACKET, not `transform.dstRange`** (normative). The live path pushes
them through `window.sxSetRange` BEFORE binding (`app/js/editors/_base.js:1914`), which is the
performer's operating window (§6.5 `ranges`), not an affine output range. §6.6's receiver
carries BOTH `transform.dstRange` and `transform.min/max`; the desugar above targets
`min`/`max` and leaves `dstRange` absent. Where an author means an affine remap they write the
full §6.6 receiver; `_bind` is shorthand for the bracket case only.

- **Conformance:** Level 1 parses + preserves; **Level 4** (§6.18) honours it, identically to
  the receiver it desugars to. Producers MAY emit either spelling; `A8_MODULATION` wins where
  both name the same input. **RULED 2026-09-19 (queue-clarification):** a bracket-only `_bind`
  still demands Level 4, never a lesser rung — the file is asking for a host that RUNS
  modulation, and the bracket-vs-affine-remap distinction two paragraphs below is a shorthand
  question, not a conformance question. A producer that wants Level 3 conformance emits no
  `_bind` at all.
- **Validation:** V11 (§9.3) — `_bind.min/max` MUST lie inside the input's declared
  `[MIN, MAX]`. A bracket outside its domain binds to nothing.

**Gate-grammar extension (§6.3.1).** `_contextGate` / `_contextHeaderGate` / `_contextRange`
take the grammar §6.3.1 defines **plus** the three constructs the shipped evaluator already
accepts (`app/js/components.js:3008`) — see the §6.3.1 annotation: `in: [...]` (alias of
`anyOf`), `{ any: [ …gates ] }` (OR, composing with the array-AND form), and `def: <value>`
(the clause's own statement of what an ABSENT driver means, overriding G2's fail-open for
that clause only). A driver value that is boolean normalises to `1`/`0` before comparison.
**V7 MUST accept all three**, or it REDs the host's own camera rig
(`app/js/formats/_camera-canon.js:175`).

- **Conformance:** Level 1 parses + preserves ALL of them; **Level 3** honours group A + B.
  All OPTIONAL (X1) — a host implementing none still renders each input as a plain control.
- **Reference renderer:** PARSE + VALIDATE only — it draws no UI. Validation: every `param`
  and every group-id reference resolves to something declared, exactly as V7 does today.
- **Producer:** MUST emit `_lightRig` · `_shapeMath` · `_stackOrder`; the rest as its
  composition uses them.
- **X2 amendment:** this table + §6.3's table are the complete published set at `A8VSN 2`.
  Unlisted underscore names stay reserved.

#### 6.14 E — The canonical group-id profile — RATIFIED 2026-09-19 (queue item 13)

`_groupId` (§6.3) already permits any stable convention. This profile names the FOUR
group ids every A8os card renders as its shared accordions, so that a conforming player
draws the same four sections in the same place, and a composer's stack partition can read
a knob's home by id instead of by guess:

| `_groupId` | Holds | Live home |
|---|---|---|
| `camera` | the camera rig's exposed inputs (§6.11) | `app/js/formats/_camera-canon.js` |
| `base:transform` | scale · rotation · position of the whole image | `app/js/editors/_base.js` |
| `base:color` | the palette as `TYPE:"color"` swatches | `app/js/editors/_base.js` |
| `<title> controls` | the shader's own knobs — label = `_groupLabel`, id = the producer's stable namespaced string | the producer |

- **Level:** a **SHOULD** on producers at Level 3 — a producer that groups a camera,
  transform or palette input uses these ids and no synonym. It is NOT a MUST and it does NOT
  bound the count of author groups: a file with three to five author groups (12 of the 14
  published portraits) stays conformant. The one-author-group rule of the portrait kit
  (`skills/a8os-loom-portrait-SKILL.md:63`) is an A8os authoring policy and is not imported.
- **Consumer:** a host that implements none of this profile still renders every input as a
  plain control (X1). A host that implements it MAY render the three shared groups in a fixed
  position and the author groups after them, in `_stackOrder` where declared.
- **Validator:** V7 unchanged (every group reference resolves). No new rule — a profile,
  not a constraint.
- **Producer:** the A8os emitter already writes these ids (measured in the portrait skill
  Rules 6–12); the composer reads them in `STACK_AXES`.
- **Retired spelling:** the §6.3 example `"gly:layer:0"` is the retired per-type namespace
  (`PER-TYPE-IDENTIFIER-NAMESPACE`); the live form is `"layer:0"`.

### 6.15 Source identity — what "the same shader" means — RATIFIED 2026-09-19 (queue item 8)

Two apps that both hold a file need to agree on ONE question before they can share anything
keyed to it: *is this the same shader?* Publishing the derivation costs nothing and makes a
preset bank, a provenance chain and a cache portable across implementations.

> **Normative.** The **source identity** of an ISF2 file is
> `"sha256:" + hex(SHA-256(UTF-8(canonical source text)))`.

**The canonical source text** is the file's own bytes for a single-file `.fs`. Where a host's
internal representation is not a single string (a multi-part source object), it is normalised
to ONE text before hashing by walking the object's string-valued and object-valued fields in a
STABLE key order with dotted keys — and **`params` is skipped, because state is never
identity**. Two surfaces holding the same shader in different internal shapes must therefore
hash identically (`specs/preset-json.md:197`).

Matching implementation: `prvHashContent` (`app/js/provenance.js:48`) produces exactly this
`sha256:<hex>` form, and it is already the key A8os derives a source-keyed preset bank from.

**What this does NOT standardise.** Where a host keeps the thing it keys — a path, an
endpoint, a table — is storage, not format, and stays out (§6.4). This publishes the KEY, not
the store.

- **Conformance:** Level 1 — any host computing a source identity MUST compute this one. A
  host that computes none is unaffected.
- **Reference renderer:** SHOULD expose it (`ISF2.sourceId(model)`) so no implementer
  re-derives the normalisation. **Producer:** n/a.
- **PORTABLE**.

### 6.16 `A8_PROVENANCE` — receipts, and the save-path obligation — RATIFIED 2026-09-19

Two additions. Neither changes P1–P3.

**(1) `generation` — model-composition receipts.** When a preset or a composition is produced
by a decision model, the record of that decision IS provenance, so it belongs inside the
provenance block rather than in a parallel top-level key. Carried by the file as
`A8_PROVENANCE.generation` and by a preset slot as `generation` (§6.5).

```json
"A8_PROVENANCE": {
  "version": "1.0",
  "origin": { "…": "…" },
  "chain":  [ ],
  "generation": [
    { "schemaVersion": "a8os.jev.receipt.v1",
      "providerId": "local", "model": "<the model string the provider RETURNED>",
      "questionId": "shape_look", "providerChoice": "…", "selectedChoice": "…",
      "selectionMode": "model", "provenance": "live" }
  ]
}
```

Two rules travel with the shape (`specs/ai/decision-models.md:468`): **`provenance: "synthetic"` is never
laundered**, and **`model` is what the provider RETURNED, never what was sent** — so a silent
substitution is visible in the record rather than hidden by it. A consumer that does not
understand receipts still MUST preserve them (P2).

**(2) P4 — the producer obligation binds the SAVE path, not only the re-emit path.** P2 binds
"a tool exporting or republishing". The app's normal editor save writes the chain into its
LIBRARY ENTRY, and a hand-exported `.fs` can leave without one — measured: **zero** files
under `app/user-media/**` carry an `A8_PROVENANCE` block. One sentence closes it:

> **P4.** An ISF2 producer writing a `.fs` file MUST write the provenance chain it holds. A
> producer that holds a chain and emits a file without it is non-conforming — the chain is not
> optional at the moment of writing merely because the block is optional in the format.

- **Conformance:** Level 1. V5 extends to `generation` well-formedness (an array of objects
  each carrying `schemaVersion`); receipts are otherwise opaque to the validator.
- **Reference renderer:** `appendProvenanceEvent` is ALREADY IMPLEMENTED (§11); `generation`
  is additive and parse-only.
- **Producer:** MUST, per P4.
- **PORTABLE**.

### 6.17 Reserved-name hygiene — RATIFIED 2026-09-19 (queue items 2, 11)

Replaces §6.2's reserved list, so the live keys stop being private-use violations the moment
this lands.

| Name | Status at `A8VSN 2` |
|---|---|
| `A8_ANIMATE` | DEFINED (§6.2.1) — **DEPRECATED**, superseded by `A8_MODULATION` (§6.6) |
| `A8_CAMERA` | DEFINED (§6.2.2 + §6.11) |
| `A8_PROVENANCE` | DEFINED (§6.2.3 + §6.16) |
| `A8_PRESETS` | DEFINED (§6.5) |
| `A8_MODULATION` | DEFINED (§6.6) |
| `A8_OPS` | DEFINED (§6.7) |
| `A8_RAYMARCH_OPS` | DEFINED (§6.8) |
| `A8_FOLD` | DEFINED (§6.9) |
| `A8_PASS_PROGRAMS` | DEFINED (§6.10) |
| `A8_LAYERS` | DEFINED (§6.12) |
| `A8_PLAYBACK` | DEFINED (§6.13) |
| `A8_CARD_PRESETS` | **GRANDFATHERED** — read-only synonym of `A8_PRESETS.bank` AND still-valid producer output until `A8VSN 2`; consumers MUST accept it forever, producers SHOULD emit `A8_PRESETS` now and MUST from `A8VSN 2` |
| `A8_GROUP_BANKS` | **GRANDFATHERED** — read-only synonym of `A8_PRESETS.groupBanks` AND still-valid producer output until `A8VSN 2`; same rule |
| `A8_MODE`, `A8_MATERIAL` | RESERVED, undefined |

Every other `A8_`-prefixed top-level name stays reserved; producers MUST NOT use them
privately. That rule is unchanged — what changes is that it is now TRUE of the shipped
producer, which it was not.

**Grade — 2026-09-19 step (iv).** A producer emitting an undefined `A8_*` key is a
**producer conformance violation** (MUST NOT, this section); a consumer that encounters one
anyway MUST NOT fail the file over it — per §10's forward-compatibility rule it is a
**WARNING**, tolerated and preserved on re-emit like any other unknown key (`a8-unknown-key`,
`src/ISF2.js:556-558`; the parallel `a8-reserved-key` warning for a name reserved-but-undefined
sits at `:549-553`). §9.3 V-series applies the same grade to `warn-unknown-a8-key.fs`.

### 6.18 Conformance classes — two new rungs — RATIFIED 2026-09-19

§9.1's ladder stops at "grouping, gating, warp-op activation, `A8_ANIMATE`, camera hook". The
blocks above are a different ORDER of capability, and a host should be able to claim the
middle honestly rather than over- or under-claim Level 2.

| Class | Adds |
|---|---|
| **Level 0 / 1 / 2** | Unchanged (§9.1) |
| **Level 3 — state** | `A8_PRESETS` recall in the §6.5 normative order · `A8_CAMERA.state` (§6.11) · `A8_OPS` (§6.7) · `A8_RAYMARCH_OPS` splicing (§6.8) · `A8_PLAYBACK` (§6.13) · the §6.14 presentation family (groups A + B) |
| **Level 4 — performance** | `A8_MODULATION` with either resolution or a declared `unresolved` (§6.6) · `A8_LAYERS` slot filling (§6.12) |

Each rung is cumulative: a Level 4 host implements Levels 0–3. A host MAY claim a rung only
if it implements every item at that rung — **partial implementation claims the rung below**.

**Level 1 is unchanged and still carries the whole preservation burden:** every block in this
set is parsed and preserved at Level 1 even where it is honoured only at 3 or 4, so a Level 1
round trip never destroys state it does not use (E2/E3, §9.2).

### Appendix A — the `A8_OPS` roster (normative, versioned) — RATIFIED 2026-09-19 (queue item 4)

This roster is a table the standard OWNS and GROWS. It is versioned
with `A8VSN`; additions within a major version are backward-compatible because an unknown op
name is ignored (§6.7).

**A.1 — `world` scope.** The screen-space warp roster applicable to any injected fragment
shader: tile / radial / attractor / flow / xor / truchet families. It excludes the SDF-only
3D warps and any op needing a bound texture slot. Source of truth
`app/js/formats/_ops-canon.js:453` (`INJECTED_OP_NAMES`, **20** entries):

`u_tile` · `u_radialTile` · `u_hexTile` · `u_triTile` · `u_rays` · `u_spiralN` · `u_wave` ·
`u_zoom` · `u_zoomDrift` · `u_mirrorX` · `u_mirrorY` · `u_opClifford` · `u_opDeJong` ·
`u_opIkeda` · `u_opLorenzSlice` · `u_opRosslerSlice` · `u_opCurlNoise` · `u_opXor` ·
`u_opTruchet` · `u_opGoldenSpiral`

Three properties a conforming host needs:

- **Coordinate space.** Ops operate on a NORMALIZED, aspect-correct, y-unit coordinate
  (`(px − 0.5·RES) / RES.y`) and map back to the shader's pixel space, so a pixel-reading body
  (`gl_FragCoord.xy`) and a normalized-reading body (`isf_FragNormCoord`) see the same warp
  (`app/js/formats/_ops-canon.js:442`).
- **Origin pair.** Eleven ops take a bindable origin (`<op>_originX` / `<op>_originY`); the
  host wraps the call `fn(p − origin, …) + origin`, identity at `0,0`
  (`app/js/formats/_ops-canon.js:491`). Folding centred content about the exact centre is
  invisible; an off-centre origin is what makes a mirror fold visible at all.
- **Composition order.** CAMERA FIRST, THEN OPS:
  `content( _a8OpsWarpWorld( _a8CamFragCoord() ) )` (`app/js/formats/_ops-canon.js:427`).

**A.2 — `raymarch` scope.** Shading operators spliced at the §6.8 hook markers. Source of
truth `app/js/formats/_raymarch-ops.js:50` (`OPS`, **5** entries):

| Key | Hook | Amount range | Identity | Companion args |
|---|---|---|---|---|
| `ao` | `occ` | 0 – 1 | 0 | `radius` |
| `softShadow` | `occ` | 0 – 1 | 0 | `softness` |
| `fresnel` | `shade` | 0 – 2 | 0 | `power`, `tint` (color) |
| `refract` | `occ` | 0 – 1 | 0 | `ior`, `tint` (color) |
| `palette` | `shade` | 0 – 1 | 0 | `drive`, `shift` |

Every amount's **identity is 0**, so an op present at identity is a byte-exact no-op — which
is what makes active-only compilation (§6.7) safe rather than merely fast.

**A.3 — `sdf` and `glyph` scopes** are the per-term field ops and the baked flat ops. Their
names are the same `u_*` vocabulary as A.1 where they overlap; the distinction is WHERE the
host splices them, not what they mean. A host without the corresponding splice seam ignores
the scope.

> **`view` is not in this roster.** It was retired at every seam (§6.7); a producer MUST NOT
> emit it and a consumer treats it as an unknown scope.

### Appendix B — the `iCam*` roster (normative) — RATIFIED 2026-09-19 (queue item 3)

The names `A8_CAMERA.state` (§6.11) may carry. Source of truth
`app/js/formats/_camera-canon.js:129`. All values are in the STATE domain (§6.11).

| Name | Meaning | Domain | Notes |
|---|---|---|---|
| `iCamZoom` | camera zoom | −1 … 1, default 0 | **The base-10 EXPONENT**: 0 neutral, +1 = 10× in, −1 = 10× out. Bipolar |
| `iCamFov` | field of view | 10 … 120, default 50 | Not bipolar — it has no symmetric inverse |
| `iCamPanX` / `iCamPanY` | camera pan | −1 … 1, default 0 | Bipolar. Ignored in the reduced skybox scope |
| `iCamRotX` / `iCamRotY` | camera tilt (in-content keystone warp) | −180 … 180, default 0 | Bipolar, **NOT wrapped** — the taper is monotone through the pole, so wrapping would reverse it. Live in `scene` + `planeinf` models |
| `iCamCanvasX` / `iCamCanvasY` / `iCamRotZ` | canvas rotate x / y / z (rigid) | −180 … 180, default 0 | Bipolar and **WRAPPED** — a true 360-periodic rotation, so −180 and +180 render the same frame and an endless spin has no wall |
| `iCamTiltSpinX` / `iCamTiltSpinY` | tilt auto-rotate | −6 … 6, default 0 | Follows the tilt family (`scene` + `planeinf`) |
| `iCamSpinX` / `iCamSpinY` | canvas auto-rotate | −6 … 6, default 0 | Follows the canvas family (`plane` + `planeinf`) |
| `iCamModel` | camera model | `scene` \| `plane` \| `planeinf` | Lifted OUT of `state` into `A8_CAMERA.model` (§6.11) |
| `iCamScope` | scope | `scene` \| `element` \| `skybox` | Host-set; absent ⇒ `scene` |

**Why the wrapped/not-wrapped split is normative and not cosmetic:** it is the difference
between a rotation that can be performed continuously and one that hits a wall mid-gesture.
A host that wraps the tilt pair manufactures a taper reversal at ±180.

---

## 7. GLSL execution environment

### 7.1 Dialect

The ISF2 reference implementation compiles shader bodies as **GLSL ES 3.00**
(`#version 300 es`). For compatibility with the existing ISF corpus, conforming
ISF2 hosts MUST accept bodies written in the traditional ISF ES 1.00 idiom and
normalize them, including at minimum:

- `texture2D(…)` / `texture2DLod(…)` → `texture(…)` / `textureLod(…)`,
- `gl_FragColor` (and `gl_FragData[0]`) → the host's declared `out vec4`,
- `varying`/`attribute` storage qualifiers → `in`/`out` per stage,
- stripping author-supplied `#version` and `precision` directives (the host
  skeleton owns the preamble); `#extension` directives are hoisted between
  `#version` and the precision block.

Bodies MUST NOT rely on a specific `#version` line of their own; the host owns the
shader skeleton. Authors who need the file to run on legacy ES 1.00 ISF hosts
SHOULD restrict themselves to the ES 1.00-compatible common subset (no dynamic
loop bounds, no `textureLod` in fragment code, no dynamic array indexing);
authors targeting ISF2 hosts may use the full ES 3.00 feature set, accepting D4's
degradation consequence.

### 7.2 Entry point and built-in uniforms

The body declares `void main()` and writes one RGBA fragment color (via the
`gl_FragColor` idiom or a self-declared `out vec4`). The host provides:

| Uniform | GLSL type | Semantics |
|---------|-----------|-----------|
| `PASSINDEX` | `int` | Index of the currently rendering pass (0-based) |
| `RENDERSIZE` | `vec2` | Current render target size in pixels |
| `TIME` | `float` | Seconds since rendering started |
| `TIMEDELTA` | `float` | Seconds since the previous frame |
| `FRAMEINDEX` | `int` | Frame counter |
| `DATE` | `vec4` | Year, month, day, seconds-since-midnight |
| `isf_FragNormCoord` | `vec2` (varying/in) | Normalized fragment coordinate, 0–1 |
| `isf_FragCoord` | `vec2` | Pixel-space fragment coordinate |

### 7.3 Image sampling — the `IMG_*` functions

Shader bodies sample images exclusively through the ISF macro functions; hosts
expand them at compile time. For each `image`-typed input `NAME` the host also
maintains companion uniforms (`_NAME_imgRect` `vec4`, `_NAME_imgSize` `vec2`,
`_NAME_flip` `bool`) that the expansions consume — bodies MUST NOT reference the
companions directly.

| Function | Expansion semantics |
|----------|---------------------|
| `IMG_THIS_PIXEL(img)` | Sample `img` at the current fragment (normalized coordinate) |
| `IMG_THIS_NORM_PIXEL(img)` | Identical to `IMG_THIS_PIXEL` |
| `IMG_PIXEL(img, xy)` | Sample `img` at pixel coordinate `xy` (host divides by `RENDERSIZE`) |
| `IMG_NORM_PIXEL(img, xy)` | Sample `img` at normalized coordinate `xy`, honoring the image's sub-rect and flip state |
| `IMG_SIZE(img)` | The image's size in pixels (`vec2`) |

### 7.4 Multipass rendering — `PASSES`

`PASSES` is an ordered array; each entry renders the same body once with
`PASSINDEX` advanced:

| Field | Type | Semantics |
|-------|------|-----------|
| `TARGET` | string | Names the pass's render target; the name becomes a `sampler2D` uniform readable by subsequent passes (and by the same pass on later frames when persistent) |
| `PERSISTENT` | bool | The target's contents survive across frames (temporal feedback). Default false |
| `WIDTH`, `HEIGHT` | string/number | Target size expressions; `"$WIDTH"`/`"$HEIGHT"` denote the host render size (default) |
| `FLOAT` | bool | Request a float-precision target. Default false |

The final pass renders to the host output. A file without `PASSES` is a
single-pass generator/filter.

### 7.5 `IMPORTED` resources

Each key of the `IMPORTED` object names an external image resource and becomes a
`sampler2D` uniform (with §7.3 companions). Keys MUST be valid GLSL identifiers.
Consumers encountering legacy files with non-identifier keys (e.g. numeric `"0"`)
SHOULD synthesize a stable identifier alias rather than fail.

### 7.6 Filters and transitions

As in ISF 2.0: a file declaring an `image` input named `inputImage` is a
**filter**; a file declaring `startImage`, `endImage`, and a `float` input
`progress` is a **transition**; all other files are **generators**. Hosts use this
classification for routing only — it changes nothing about compilation.

---

## 8. Input-type semantics

### 8.1 Scalar, color, enum, event

`float`, `bool`, `color`, `long` behave per §5.1. `event` is momentary: the
uniform reads `true` for exactly one rendered frame after each trigger, then
returns to `false`.

### 8.2 `point2D` — the pixel-vs-raw convention (normative)

Two interpretations of `point2D` exist in deployed ISF hosts. ISF2 makes the
disambiguation rule normative, matching the dominant legacy behavior:

- **Raw mode** — the declaration carries **both** `MIN` and `MAX` as two-element
  arrays. The host passes the stored value through to the `vec2` uniform
  unchanged. The declared range is the value's domain.
- **Pixel mode** — `MIN` and `MAX` are **not both present**. The shader consumes
  **pixel coordinates**: the host stores/edits the value in normalized 0–1 space
  and multiplies by the **live render size** at uniform-upload time, every frame.

Consequences hosts MUST honor in pixel mode:

- Scaling happens at upload time against the *current* render size, so a stored
  value keeps meaning "the same fractional position" across render-size changes.
  Baking pixel values at edit time against a then-current size is non-conforming.
- `DEFAULT` for a pixel-mode `point2D` is expressed in normalized 0–1 space
  (`[0.5, 0.5]` = center).

Authors SHOULD declare `MIN`/`MAX` (raw mode) for new files; pixel mode exists for
corpus compatibility.

### 8.3 `audio` and `audioFFT`

An `audio` input requests time-domain waveform data; an `audioFFT` input requests
frequency-domain magnitude data. ISF2 hosts MUST accept both declarations. The
reference delivery convention is a texture bound to the input's `sampler2D`:

- `audio`: sample values along the texture's horizontal axis (recent waveform
  window), encoded 0–1 with 0.5 = zero amplitude.
- `audioFFT`: FFT magnitude bins along the horizontal axis, 0–1 normalized
  magnitude.

Bodies sample audio inputs with `IMG_NORM_PIXEL(input, vec2(position, 0.5))`,
treating the horizontal normalized coordinate as the sample/bin position. Hosts
without an audio source MUST bind silence (a black texture) so the shader still
compiles and renders.

A degradation-safe alternative encoding, used by ISF2 emitters for maximum host
reach, is to declare the input as `TYPE: "image"` tagged `_audioRole: "wave"` or
`_audioRole: "fft"` (§6.3): legacy hosts see an ordinary optional image input;
ISF2 hosts route audio into it.

---

## 9. Conformance

### 9.1 Conformance classes

| Class | Requirements |
|-------|--------------|
| **ISF2 file (producer output)** | Satisfies every MUST in §3–§8 that addresses files/emitters, including strict JSON (D7) and extension-neutrality (V6) |
| **Level 0 host** (any ISF 2.0 host) | Renders the file ignoring all extension content — guaranteed by construction, no ISF2 knowledge required |
| **Level 1 host** (ISF2-aware) | Additionally: parses and preserves `A8VSN` + all `A8_*` blocks + per-input extension fields; implements §8.2 point2D and §8.3 audio binding; validates per §9.3; honors P1/P2 provenance rules in any re-emit path |
| **Level 2 host** (full) | Additionally implements the presentation/orchestration semantics: input grouping/gating (§6.3), warp-operator activation with identity values, `A8_ANIMATE` oscillators, and the `A8_CAMERA` ray hook |

### 9.2 Producer (emitter) requirements

- **E1.** Emit the metadata block as the first comment, strict JSON, header before
  body.
- **E2.** Deterministic, byte-stable output: `emit(parse(file))` with no model
  changes reproduces `file` byte-for-byte.
- **E3.** Preserve unknown keys and fields through parse→emit round trips.
- **E4.** Append (never rewrite) provenance on every transforming emit (P1).
- **E5 — the machinery-at-emit resolver (SHIPPED S81, `A8GLSLEmit`).** An emitter MUST resolve
  every A8-injected symbol before the source leaves the app, so the emitted symbol set ⊆ the
  target's declared+builtin set. Two verbs by target capability: **DECLARE** (control-surface
  target — ISF2 itself) turns the injected inputs into target-native declared inputs (camera
  `iCam*` → `A8_CAMERA`, minted/magic `u_*` → `INPUTS` with the current value as default, active
  ops → `A8_OPS`), the helper fns riding along as ordinary GLSL a conforming host compiles; **BAKE**
  (surface-less target — Shadertoy/CodePen/twigl) substitutes each injected value as a GLSL constant
  and folds out every A8-only identifier (`_a8*` / `iCam*` / minted-`u_*`), byte-clean at rest. An
  emit that would ship an un-resolvable A8-only symbol to a host that never declared it is a FAILED
  emit (`INGESTED-SOURCE-MISSES-SHARED-CAPABILITY` read in REVERSE). Home:
  `specs/publishing-adapters.md` §2.5; gate: the emission-parity macros
  (`emit.no-a8-only-symbol-leak` + `<target>.emit-runs` + `shadertoy.emit-roundtrip`).

#### 9.2.1 Emission normalization (normative)

E2 is not achievable by serializing the metadata object: a corpus of
hand-authored files carries author indentation, line breaks, key order and number
spellings (`1.0`, not `1`) that no serializer reproduces, plus the lenient-JSON
files V1 tolerates. A conforming emitter therefore performs **minimal-diff
textual surgery** on the metadata text it parsed — it does not re-serialize what
it did not change:

| | Handling |
|---|---|
| unchanged key | re-emitted as the author's own bytes — whitespace, position, number spelling intact |
| changed key | the `"KEY"` text and the member's POSITION are kept; only the VALUE is re-serialized |
| added key | serialized canonically at the file's detected indent, appended as the LAST member |
| removed key | the member and its following separator are dropped |

Normalization applies **only where there is no authored text to preserve**:

- **N1 (added).** A new key has no author bytes; it is serialized canonically and
  appended last. Appending never perturbs the offsets of anything before it.
- **N2 (changed).** A changed value loses the author's spelling *inside that
  value* (`1.0` re-emits as `1`; line breaks inside the value follow the
  emitter's layout). Scoped to the key the caller actually changed.
- **N3 (removed).** Removing every member leaves `{}` with the original interior
  whitespace.
- **N4 (order).** An emitter MUST NOT reorder keys, in any path. Retained keys
  hold parsed order; added keys follow in model order. This standard defines no
  canonical key ordering — inventing one would break E2.
- **N5 (leniency).** Lenient JSON MUST NOT be repaired on the default path: a
  file the emitter did not otherwise edit round-trips byte-exact, leniency
  included. Text the emitter *writes* is always strict JSON, so a lenient file
  that gains a key becomes part-lenient. A `canonical` emission mode MUST be
  offered that re-serializes every member and repairs leniency wholesale, at the
  cost of the author's formatting.
- **N6 (legacy spellings).** `_glyOp*` fields are re-emitted as `_glyOp*`. The
  §6.3 "producers MUST emit the neutral names" rule binds a producer *authoring*
  an input, not a round trip through a file it did not otherwise touch —
  rewriting on sight would break E2 for every already-published file. Migration
  is a model-level edit and converges at the next natural rebake.
- **N7 (array layout).** In serialized text, an all-scalar array is emitted on
  one line (`[0.5, 0.5]`); an array containing an object or array is emitted one
  element per line.
- **N8 (body).** The GLSL body is concatenated verbatim. Emission never
  normalizes, reformats or dialect-converts it; `normalizeGLSL` is a separate,
  explicitly-invoked operation.

**Write surface.** `model.meta` is the emitter's only input. Any derived
extension view (`model.a8`) is READ-ONLY with respect to emission; a conforming
implementation offers a setter that updates both.

### 9.3 Validation rules

A Level 1 validator MUST check at minimum:

- **V1.** Metadata block present, first comment, strict-JSON parseable (report
  leniency repairs as warnings).
- **V2.** Every `INPUTS` entry has a `NAME` (valid, unique GLSL identifier) and a
  known `TYPE`; `DEFAULT`/`MIN`/`MAX` shapes match the type.
- **V3.** `PASSES` entries well-formed; every `TARGET` is a valid identifier;
  size expressions parseable.
- **V4.** Every `A8_ANIMATE[].input` names a declared input; `curve`, `rate`,
  `depth` present and type-correct.
- **V5.** `A8_PROVENANCE`, when present, has `version`, `origin`, and a
  well-formed `chain` (every entry carrying `action`, `timestamp`, `by`,
  `contentHash`).
- **V6.** **Extension neutrality:** stripping every `A8_*` top-level key and every
  §6.3 per-input field from the file MUST leave the extracted vanilla input set —
  names, types, defaults, ranges, order — unchanged. Extension content never
  smuggles inputs.
- **V7.** Every gate predicate is well-formed per §6.3.1 (a `param` plus exactly
  one of `eq`/`not`/`anyOf`, `anyOf` an array), and every
  `_contextGate`/`_contextHeaderGate` `param` and every `_opCompanion`
  (`_glyOpCompanion`) reference resolves to a declared input.
- **V8.** No author-declared uniform in the reserved `iCam*` namespace unless the
  file declares `A8_CAMERA`.
- **V9.** The body compiles under the host's GLSL environment (§7.1). A validator
  without a GL context reports this check as skipped, never as passed.

**RATIFIED 2026-09-19 (queue item 12) — V10/V11/V12.** All three are structural and
header-only. They were checked by NEITHER this section NOR the portrait gate
(`app/tools/verify-portrait.js`) — the `GATE-FAILS-OPEN` shape, measured: 148 of 169 published
inputs carry no `DESCRIPTION`, `LONG_DESCRIPTION` is present in 0 of 14 files, and every file
passed. Ratifying the rule and the gate leg in one increment is deliberate: a validator and a
gate that agree by construction cannot drift the way two disciplined-but-separate lists do.

- **V10.** Every `A8_PRESETS` / `A8_CARD_PRESETS` slot's `params`, `ranges` and
  `inverts` key names a **declared input**. §6.5 already requires the reference renderer to do
  this; nothing validated it, and a `params` key that is a typo is a silent no-op. ERROR.
- **V11.** `_bind.min/max` (§6.14 D) lies inside the input's declared `[MIN, MAX]`. A bracket
  outside its own domain binds to nothing. ERROR.
- **V12.** Per-input `DESCRIPTION` present on every declarable input, and top-level
  `LONG_DESCRIPTION` present. **"Declarable" reads as AUTHORED** — an input carrying a §6.14 C
  host-minted marker (`_engineOnly` / `_a8DebugTap` / `_a8Synthetic`) was stamped by the engine
  at runtime, so no author could have described it, and V12 does not check it (`src/ISF2.js:1707`).
  §5.2 mandates both already; §9.3 never checked either. Cheapest
  check in the set (pure header parse) and the highest-leverage, because it is simultaneously
  the composability gate of `specs/ai/decision-models.md` §P2.4. **WARNING at Level 1** — a
  legacy ISF file legitimately carries neither, and a conformance validator must not reject one
  — and an **ERROR in an authoring gate**, which judges work being commissioned rather than a
  file's conformance. `app/tools/verify-portrait.js` is such a gate and implements it as an
  error (§9.3's own line: *ISF2 conformance is a property of the FILE; `verify-portrait` is a
  property of the WORK*).

**What does NOT come here, and why the line is drawn.** The portrait gate's GROUPS-lowercase,
BESPOKE-ACCORDION, SHIPS-ALIVE, `PRESET_MIN ≥ 4` and NOVELTY checks are **A8os authoring
policy**, not format rules — none describes a malformed file, and importing any of them would
RED conformant foreign files. The gate's COMPILE / MOTION / SLIDER-STRENGTH / REDUNDANCY /
GEOMETRY / PALETTE / COUNTS checks need a GL context and a rendered sweep; V9 is the standing
precedent for keeping those out of a Level 1 validator. Stated once: **ISF2 conformance is a
property of the FILE; `verify-portrait` is a property of the WORK.**

---

## 10. Versioning and compatibility policy

- **ISFVSN is frozen at `"2"`** for ISF2 files. The extension surface versions
  independently via `A8VSN`. Overloading `ISFVSN` (e.g. `"2.a8"`) is forbidden —
  it risks breaking legacy-host version parsing.
- **`A8VSN` increments** when extension keys/fields are added or their semantics
  change. Within a major `A8VSN`, additions are backward-compatible: a consumer
  of `A8VSN 1` reading a hypothetical `1.x` file ignores what it doesn't know.
- **Reading order for any host:**
  1. ISF 1.0 markers present (§2.2) → upgrade, then treat as 2.0.
  2. Otherwise → parse as ISF 2.0.
  3. If ISF2-aware → additionally consume `A8VSN` + extension content.
- **Degradation guarantee (restated):** because every extension lives in ignored
  JSON keys/fields and the body remains a standard ISF shader, every ISF2 file is
  playable on every conforming ISF 2.0 host, losing only the extension semantics
  (grouping, animation, camera, provenance-awareness).
- **Forward compatibility:** ISF2 consumers MUST tolerate unknown `A8_*` keys and
  unknown underscore-prefixed input fields (preserve on re-emit, ignore in
  behavior).

### 10.1 `A8VSN 2` — RATIFIED 2026-09-19 (queue item 9)

The §6.4–§6.18 block set lands as **`A8VSN: "2"`**, not as `1.x`.

**Why a major, when almost everything in the set is additive.** The rule above is that
additions within a major are backward-compatible. Nineteen of the twenty items qualify. **One
does not: §6.6 DEPRECATES `A8_ANIMATE`** — it changes what a conforming PRODUCER must emit for
a file it authors, and a deprecation is not an addition. That single item is what forces the
increment; without it the set would be `1.x`.

**What BREAKS (producers only — no consumer breaks, no file breaks):**

| | |
|---|---|
| A producer authoring animation | MUST now emit `A8_MODULATION` (§6.6) rather than `A8_ANIMATE`. Mechanical, and §6.6 gives the one-line mapping |
| A producer emitting camera state | MUST emit the `{mode, model, state}` shape (§6.11), not a flat `iCam*` map |
| A producer emitting a preset bank | MUST emit `A8_PRESETS` (§6.5) from `A8VSN 2`. Until then `A8_CARD_PRESETS` / `A8_GROUP_BANKS` remain valid producer output (§6.17), so no published file and no producer gate breaks on the day this ratifies |
| A producer writing a `.fs` while holding a provenance chain | MUST write the chain (§6.16 P4) |

**What is GRANDFATHERED (every already-published file keeps working, byte-for-byte):**

- `A8_ANIMATE` — consumers MUST accept it forever; a file carrying it is valid at `A8VSN 2`.
- `A8_CARD_PRESETS` · `A8_GROUP_BANKS` — read-only synonyms (§6.17).
- `_glyOp*` — unchanged (§6.3), with N6's re-emit rule intact.
- `TRANSPORT_DOMAIN` · `_groupBlendable` — synonyms of `_transportDomain` / `_blendable` (§6.14).
- The flat `A8_CAMERA` state map the shipped emitter writes — a consumer meeting a block with
  no `mode` and no `state` treats its members as `state` (the shape is unambiguous: every key
  is an `iCam*` name).

**The E2 consequence, and it is the one implementers get wrong.** *None of these upgrades is
performed on sight.* N6 (§9.2.1) binds: a producer authoring an input emits the neutral,
current name; a producer ROUND-TRIPPING a file it did not otherwise edit re-emits exactly what
it read. Rewriting a legacy spelling on read would break byte-stable re-emit for every
published file, which is a far worse outcome than a slow migration. Convergence happens at
each file's next natural rebake.

**Reading order (§10) is unchanged.** A consumer implementing `A8VSN 1` that meets a
`"2"` file still renders it, ignoring what it does not know — the same degradation contract as
a legacy ISF 2.0 host. That is why this increment costs nothing at the consumer.

---

## 11. Public reference implementation contract

The reference implementation ships as a standalone, dependency-light module
(`ISF2`) alongside the reference parser/renderer. It is DOM-free and
environment-neutral (browser or server), exposing:

```js
ISF2.parse(fsText)
  // → model { meta, inputs[], body,
  //           a8: { animate, camera, provenance, ui }, warnings[] }
ISF2.validate(model)      // → { ok, errors[], warnings[] }   (§9.3 rules)
ISF2.emit(model)          // → fsText — deterministic, byte-stable, header-first
ISF2.normalizeGLSL(body, opts)
  // → body' — the §7.1 dialect normalization, reusable by external tooling
```

Two helpers accompany `emit`, resolving what the API surface alone leaves
ambiguous:

```js
ISF2.setExtension(model, 'A8_CAMERA', { mode: 'ray' })
  // the sanctioned extension write — updates model.meta AND the derived view
ISF2.appendProvenanceEvent(model, { action, timestamp, by, contentHash })
  // E4 / P1 — appends; never rewrites an existing event, never invents an origin
```

> **Implementation status (2026-07-20).** `parse`, `validate`, `emit` and
> `normalizeGLSL` are all live in the reference implementation
> (`ISF2/src/ISF2.js`, exported as `interactiveShaderFormat.ISF2`).
> `emit` implements §9.2.1 minimal-diff emission over the metadata text `parse`
> retains (the raw source, the raw metadata string, the untouched metadata object
> and the exact body offset). Measured acceptance: **2,261 / 2,261** parseable
> corpus files round-trip byte-identical (`emit(parse(x)) === x`, 0 text diffs,
> 0 model diffs, 0 emitter failures), including **220 / 220** of the published
> GLY-baked set; and over the same 2,261 files an emission that *gains* an
> `A8_PROVENANCE` block leaves every pre-existing key, its order, and the GLSL
> body byte-identical (0 violations). 62 further corpus files carry metadata that
> is undecodable by any conforming parser (duplicate JSON keys, malformed arrays)
> and never reach the emitter.

Properties external implementers can rely on:

- `parse` preserves unknown keys/fields on the model; `emit(parse(x)) === x` for
  unmodified models (E2/E3).
- `validate` implements exactly the §9.3 rule set; V9 is reported as skipped
  outside a GL environment.
- The renderer accompanying the module is the conformance oracle: an ISF2 file is
  valid iff it parses, validates, and compiles there. A corpus regression harness
  (compile + frame-hash + control-surface-hash over the full published corpus)
  gates every change to the implementation.

### 11.1 Canonical home — RATIFIED 2026-09-19 (queue item 10), MOVE PERFORMED

**This file IS the canonical copy**, at `SPEC/isf2-standard.md` in the public ISF2 repo
(`https://github.com/LoomA8osAgent/ISF2`, local clone `~/gits/ISF2`). The A8os/visualeyes
tree carries a pointer stub at `specs/isf2-standard.md` and nothing else: the standard is
**EDITED here and READ from here**.

**Why.** A document cannot be the authoring contract for other applications while its
canonical copy lives in a private spec tree. It belongs beside the reference implementation
that is its own conformance oracle (§11 above).

**The move, as performed 2026-09-19:**

1. **Relocated** to `~/gits/ISF2/SPEC/isf2-standard.md` (GitHub `LoomA8osAgent/ISF2`) —
   the repo already named as the public home in the header note.
2. **Audit appendix stripped.** Its repo-internal `file:line` citations do not resolve outside
   A8os and are not published. (The body's remaining `app/js/**` citations are evidence for
   normative claims and are retained, marked as A8os-internal by their path.)
3. **A pointer stub replaced the A8os copy** at `specs/isf2-standard.md`: the public URL, the
   local clone path, and the rule — *the standard is EDITED in ISF2 and READ from there.*
4. **`ROUTING.md` re-pointed**, with a note that a change to the standard is a change in a
   SECOND repo, so no A8os commit can silently edit it.
5. **One clause added to `specs/CLAUDE.md` §Library-first**: *the ISF2 standard is the
   authoring contract for fragment shaders; a new per-input field or `A8_*` key is a STANDARD
   change, made in the ISF2 repo, BEFORE the producer emits it.* That clause is the thing that
   prevents the next `_labelBy` — a field shipped to a corpus with no schema to read it by,
   which is the whole condition §6.14 exists to clear.

**Sequencing — the renderer conforms before the A8os producer.** The reference renderer is the
conformance oracle, so it must validate the new blocks first; otherwise the producer conforms
to a draft rather than to a schema that has been proven to accept it. Order:

| Step | Work | State |
|---|---|---|
| (i) | Queue items 1–13 ratified (operator, 2026-09-19: *"1-15 accepted"*) | **DONE** |
| (ii) | §6.4–§6.18 + Appendices A/B ratified into this file (the PROPOSED fences deleted); §9.3 V10–V12 normative | **DONE** |
| (iii) | **THE MOVE** — steps 1–5 above | **DONE** |
| (iv) | Reference renderer parses the new blocks: `ISF2.parse` model fields · `ISF2.validate` rules · `ISF2.emit` round trip with E2 byte-stability re-proven over the corpus · `ISF2.applyPreset` · `ISF2.sourceId` · the §6.11 camera reconciliation | **NEXT** |
| (v) | A8os producer conforms: `_glsl-emit.js` DECLARE emits `A8VSN`, the reconciled `A8_CAMERA`, `A8_OPS`, `A8_PRESETS`; `card.js` / `isf.js` read the neutral keys with the grandfathered synonyms; corpus rebake ONLY where a header actually changes (N5/N6 — a file the emitter did not otherwise edit round-trips byte-exact) | after (iv) |
| (vi) | Publish the injected GLSL for Appendix A (`A8_OPS`) and Appendix B (`A8_CAMERA`) — the prelude each op name and each `iCam*` name actually splices — so a third party can implement §6.7/§6.11 instead of trusting the reference renderer's word for the math; the reference renderer then implements them against that publication (§6.7/§6.11 ruling 2026-09-19: today it PARSES + VALIDATES the rosters, not implements the injection) | after (v), no date promised |

**One trap, named because it is load-bearing:** a rebake rewrites `.fs` files on disk but does
NOT reach saved library entries, which EMBED their source verbatim
(`REBAKE-MISSES-A8L-EMBEDDED-SOURCE`, `specs/CLAUDE.md:314`). Step (v) reaches both or it
reaches neither.

---

## 12. Worked example

A minimal generator using standard inputs, one pixel-mode `point2D`, grouped
controls, an authored oscillator, and a provenance block:

```glsl
/*{
  "ISFVSN": "2",
  "A8VSN": "1",
  "DESCRIPTION": "Radial pulse generator",
  "CREDIT": "Example Author",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    { "NAME": "center", "TYPE": "point2D", "DEFAULT": [0.5, 0.5] },
    { "NAME": "radius", "TYPE": "float", "DEFAULT": 0.25,
      "MIN": 0.0, "MAX": 1.0,
      "_groupId": "shape", "_groupLabel": "Shape" },
    { "NAME": "softness", "TYPE": "float", "DEFAULT": 0.1,
      "MIN": 0.0, "MAX": 0.5, "_groupId": "shape" },
    { "NAME": "tint", "TYPE": "color", "DEFAULT": [0.2, 0.8, 1.0, 1.0],
      "_groupId": "shape", "_headerSlot": true }
  ],
  "A8_ANIMATE": [
    { "input": "radius", "curve": "sine", "rate": 0.5,
      "depth": 0.3, "bipolar": true, "baseValue": 0.25 }
  ],
  "A8_PROVENANCE": {
    "version": "1.0",
    "origin": { "source": "user", "author": "Example Author", "license": "MIT" },
    "chain": [
      { "action": "create", "timestamp": "2026-09-19T09:14:20.192Z",
        "by": "Example Author", "contentHash": "9f2c…" }
    ]
  }
}*/

void main() {
  // `center` is pixel-mode point2D (no MIN/MAX): the host uploads pixel coords.
  vec2 c = center / RENDERSIZE;
  float d = distance(isf_FragNormCoord, c);
  float a = 1.0 - smoothstep(radius - softness, radius + softness, d);
  gl_FragColor = vec4(tint.rgb * a, a);
}
```

On a legacy ISF host: four plain controls, no animation, no grouping — renders
identically at defaults. On a Level 2 ISF2 host: a "Shape" group with a header
swatch, and `radius` oscillating out of the box.

---

## OPEN RULINGS — ALL RATIFIED (operator, 2026-07-12, per agent-reports/rulings-queue-s78.md §A)

> **Verdicts:** (1) embed FULL chain at A8VSN 1, `chainRef` RESERVED for a future
> minor rev; (2) draft confirmed — optional in-file, MUST-preserve/append,
> requiredness at the export gate; (3) draft reading confirmed — 4 defined + 4
> reserved; (4) option (b) — neutral `_op*` names canonical, `_glyOp*`
> grandfathered synonyms, new emissions neutral, corpus converges at the next
> natural rebake; (5) draft confirmed — `bipolar` + `baseValue` included,
> optional. The body sections above already state each verdict's position.
> Verdict (4)'s editorial pass is **DONE** (2026-07-20): §6.3 now carries the
> neutral `_op*` names in the canonical column with `_glyOp*` in a Synonym
> column, and the reference implementation accepts both.
> Original questions retained below for provenance.
>
> **Schema correction (2026-07-20, reference-implementation build).** Two §6.3
> field descriptions in the pre-implementation draft did not match the shipped
> corpus that ruling (2) blessed as canon, and were corrected to the as-built
> grammar (verified against 1,928 corpus files and the host's single gate
> evaluator, `app/js/components.js panelEvalContextGate:1690`):
> `_headerSlot` is a **boolean placement flag**, not a slot-name string (2,945
> corpus occurrences, all boolean); and a gate is `{ param, eq|not|anyOf }` or an
> AND-array of those (§6.3.1), not `{ input, values }` (6,318 corpus
> occurrences). The draft's shapes would have invalidated the entire baked
> corpus and the host's own camera rig.

1. **`A8_PROVENANCE` chain: embedded vs referenced.** The schema ruling names
   "origin/license/author/**chain-ref**"; the prior ratified description is "the
   append-only chain object" embedded in full. This draft embeds the full chain
   (§6.2.3). Rule whether long chains may/must degrade to a hash reference
   (`chainRef`) with the full chain external, and where the externalized chain
   lives.
2. **`A8_PROVENANCE` required-in-file vs required-at-export.** Listed as an open
   decision in the G2.3 design (W3 queue) and not answered by the schema ruling.
   This draft makes the block optional in-file with MUST-preserve/append semantics
   (P1/P2); export-gate requiredness is left to host policy. Confirm or tighten.
3. **Reserved top-level names.** `specs/a8os.md` §7 lists `A8_MODE` / `A8_LAYERS`
   / `A8_OPS` / `A8_MATERIAL` in the ISF2 key family; the schema ruling scopes
   A8VSN 1 to four keys (`A8VSN`, `A8_ANIMATE`, `A8_PROVENANCE`, `A8_CAMERA`).
   This draft reconciles by listing the other four as RESERVED names (§6.2).
   Confirm that reading.
4. **Public field naming for `_glyOp*`.** The ruling blesses the shipped per-input
   `_` fields as-is (no rebake), but `_glyOp` / `_glyOpIdentity` / `_glyOpAuthored`
   / `_glyOpCompanion` publish an internal working name ("gly") into the external
   standard, in tension with the substrate naming canon (GLY = one ingestion
   frontend, not the substrate). Options: (a) publish as-is (this draft's
   position, matching the 220 shipped files), (b) define neutral aliases
   (`_op`, `_opIdentity`, …) with `_glyOp*` grandfathered as synonyms, (c) rename
   + corpus rebake + library refresh. Needs a ruling before external publication.
5. **`A8_ANIMATE` optional fields.** The ruling's inline shape is
   `{input, curve, rate, depth, phase}` "mirroring the gly directive form"; the
   directive form also carries `bipolar` and `baseValue`. This draft includes both
   as optional (§6.2.1). Confirm.

