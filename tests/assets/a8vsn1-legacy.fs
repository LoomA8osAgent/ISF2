/*{
  "ISFVSN": "2",
  "A8VSN": "1",
  "DESCRIPTION": "Every grandfathered spelling in one file — the A8VSN 1 shape a consumer MUST accept forever.",
  "LONG_DESCRIPTION": "A legacy ISF2 file carrying the superseded spellings: A8_CARD_PRESETS, A8_GROUP_BANKS, A8_ANIMATE, the flat A8_CAMERA state map, _glyOp*, _groupBlendable and TRANSPORT_DOMAIN. Nothing here is rewritten on sight (N6) and nothing here is an error.",
  "CREDIT": "ISF2 reference fixtures",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    { "NAME": "amount", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0,
      "DESCRIPTION": "How strong the wash is — barely there at the low end, fully flooded at the high end.",
      "_groupId": "look", "_groupLabel": "Look" },
    { "NAME": "twist", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 2.0,
      "DESCRIPTION": "Curls the field — straight bands at the low end, a tight spiral at the high end.",
      "_groupId": "look", "_glyOp": true, "_glyOpIdentity": 0.0, "_glyOpAuthored": false },
    { "NAME": "twistPhase", "TYPE": "float", "DEFAULT": 0.0, "MIN": -3.2, "MAX": 3.2,
      "DESCRIPTION": "Where the curl starts — rotates the whole spiral around the centre.",
      "_groupId": "look", "_glyOpCompanion": "twist" },
    { "NAME": "tint", "TYPE": "color", "DEFAULT": [0.2, 0.8, 1.0, 1.0],
      "DESCRIPTION": "The colour the wash carries.",
      "_groupId": "look", "_headerSlot": true, "_groupBlendable": true },
    { "NAME": "rate", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 4.0,
      "DESCRIPTION": "Playback speed — frozen at the low end, four times over at the high end.",
      "_groupId": "look", "TRANSPORT_DOMAIN": true }
  ],
  "A8_ANIMATE": [
    { "input": "amount", "curve": "sine", "rate": 0.25, "depth": 0.4, "bipolar": true, "baseValue": 0.5 }
  ],
  "A8_CAMERA": { "iCamZoom": 0.3, "iCamPanX": 0.0, "iCamModel": "scene" },
  "A8_CARD_PRESETS": {
    "D": { "name": "Default", "params": { "amount": 0.5, "twist": 0.0 } },
    "1": { "name": "Flooded", "params": { "amount": 1.0, "twist": 1.4 }, "ranges": { "amount": [0.4, 1.0] } }
  },
  "A8_GROUP_BANKS": {
    "look": { "D": { "params": { "twist": 0.0, "twistPhase": 0.0 } } }
  }
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  float v = amount * (0.5 + 0.5 * sin((uv.x + uv.y * twist) * 6.2831 + twistPhase));
  gl_FragColor = vec4(tint.rgb * v, 1.0);
}
