/*{
  "ISFVSN": "2",
  "A8VSN": "2",
  "DESCRIPTION": "§6.13 RED — A8_PLAYBACK.clock.position is present.",
  "LONG_DESCRIPTION": "Recall never teleports time — the same rule that keeps a modulation lane continuous across a preset change — so `clock.position` is deliberately absent from the standard and MUST NOT be added. A file that carries it asks a host to jump the transport on every recall.",
  "CREDIT": "ISF2 reference fixtures",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    { "NAME": "weave", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.0, "MAX": 1.0,
      "DESCRIPTION": "How dense the lattice is — wide open at the low end, packed tight at the high end." }
  ],
  "A8_PLAYBACK": { "timeScale": 1.0, "clock": { "bpm": 120, "position": 4.0 } }
}*/

void main() { gl_FragColor = vec4(vec3(weave), 1.0); }
