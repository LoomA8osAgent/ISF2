/*{
  "ISFVSN": "2",
  "A8VSN": "2",
  "DESCRIPTION": "Every A8VSN 2 block in one conforming file.",
  "LONG_DESCRIPTION": "The reference fixture for the §6.4–§6.18 block set: presets with a normative recall payload, declared modulation, active ops, the raymarch hook declaration, a fold hint, the reconciled camera, a texture slot with an inline ref, and playback semantics. Every block is exercised at its defined shape.",
  "CREDIT": "ISF2 reference fixtures",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    { "NAME": "weave", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.0, "MAX": 1.0,
      "DESCRIPTION": "How dense the lattice is — wide open at the low end, packed tight at the high end.",
      "_groupId": "fixture controls", "_groupLabel": "Fixture", "_stackOrder": 0,
      "_bind": { "source": "lf:1:sine", "min": 0.25, "max": 0.7 } },
    { "NAME": "hue", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0,
      "DESCRIPTION": "Rotates the palette — the authored colours at the low end, all the way round at the high end.",
      "_groupId": "fixture controls", "_stackOrder": 1, "_noTimeTwin": true },
    { "NAME": "mode", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1], "LABELS": ["flat", "lit"],
      "DESCRIPTION": "Which reading the surface gets — flat at the low end, lit at the high end.",
      "_groupId": "fixture controls" },
    { "NAME": "keyDir", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0,
      "DESCRIPTION": "Where the key light sits — raking at the low end, straight on at the high end.",
      "_groupId": "lighting", "_lightRig": true,
      "_contextGate": { "param": "mode", "in": [1] } },
    { "NAME": "bgTint", "TYPE": "color", "DEFAULT": [0.02, 0.02, 0.06, 1.0],
      "DESCRIPTION": "The ground the whole image sits on.",
      "_groupId": "bg", "_headerSlot": true, "_blendable": true },
    { "NAME": "fillGain", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 2.0,
      "DESCRIPTION": "How hard the fill texture reads — invisible at the low end, dominant at the high end.",
      "_groupId": "layer:0", "_layerRow": true }
  ],
  "A8_PRESETS": {
    "schema": "1",
    "bank": {
      "D": { "name": "Default",
             "params": { "weave": 0.4, "hue": 0.0 },
             "ranges": { "weave": [0.0, 1.0] },
             "inverts": { "weave": false },
             "deactivated": [],
             "opacity": [1, 1, 1, 1],
             "blend": "normal",
             "renderState": "active",
             "ops": { "world": { "u_tile": 0.4 } },
             "camera": { "iCamZoom": 0.3 } },
      "1": { "name": "Packed", "params": { "weave": 0.9 }, "ranges": { "weave": [0.6, 1.0] } }
    },
    "groupBanks": { "lighting": { "D": { "params": { "keyDir": 0.5 } } } }
  },
  "A8_MODULATION": {
    "receivers": [
      { "target": "hue",
        "source": { "id": "ck:phase", "kind": "clock", "range": [0, 1] },
        "transform": { "srcRange": [0, 1], "dstRange": [0.2, 0.8], "invert": false, "min": 0.2, "max": 0.8 },
        "active": true }
    ]
  },
  "A8_OPS": { "world": { "u_tile": 0.4, "u_mirrorX": 1 }, "raymarch": { "ao": 1 } },
  "A8_RAYMARCH_OPS": { "base": "rm", "hooks": ["normal", "occ", "shade", "post"],
                       "starters": ["ao", "softShadow"], "renderScale": 1.0 },
  "A8_FOLD": { "flags": { "lit": 0 }, "drivers": { "lit": ["mode"] }, "guarded": ["lit"] },
  "A8_CAMERA": { "mode": "ray", "model": "scene", "state": { "iCamZoom": 0.3, "iCamRotY": 12.0 } },
  "A8_LAYERS": {
    "bg": { "ref": { "kind": "isf", "name": "Color Bars" }, "mode": "texture", "blend": "normal", "opacity": 1.0 },
    "layers": { "0": { "slot": "fill0", "mapping": "triplanar",
                       "ref": { "data": "data:image/png;base64,iVBORw0KGgo=" } } }
  },
  "A8_PLAYBACK": { "timeScale": 1.0, "renderScale": "auto", "scaleMode": "fit",
                   "processRecall": "seed", "clock": { "bpm": 120, "meter": [4, 4], "source": "internal", "rate": 1.0 } },
  "A8_PROVENANCE": {
    "version": "1.0",
    "origin": { "source": "user", "author": "ISF2 reference fixtures", "license": "MIT" },
    "chain": [ { "action": "create", "timestamp": "2026-09-19T12:00:00.000Z",
                 "by": "ISF2 reference fixtures", "contentHash": "sha256:0" } ],
    "generation": [ { "schemaVersion": "a8os.jev.receipt.v1", "providerId": "local",
                      "model": "fixture", "questionId": "shape_look", "providerChoice": "lattice",
                      "selectedChoice": "lattice", "selectionMode": "model", "provenance": "live" } ]
  }
}*/

vec3 ro, rd;
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
  a8CameraRay(uv, ro, rd);
  float v = weave * (0.5 + 0.5 * sin(uv.x * 20.0)) * fillGain + keyDir * float(mode);
  gl_FragColor = vec4(bgTint.rgb + vec3(v * hue, v, v), 1.0);
}
