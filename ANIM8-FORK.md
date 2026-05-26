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
