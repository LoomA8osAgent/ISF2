/*{
  "ISFVSN": "2",
  "A8VSN": "2",
  "DESCRIPTION": "V10 RED — a preset slot names a param no input declares.",
  "LONG_DESCRIPTION": "The `1` slot writes `wieve`, a typo of `weave`. Nothing in the pre-V10 stack noticed: a params key that is a typo is a silent no-op, which is the GATE-FAILS-OPEN shape V10 exists to close.",
  "CREDIT": "ISF2 reference fixtures",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    { "NAME": "weave", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.0, "MAX": 1.0,
      "DESCRIPTION": "How dense the lattice is — wide open at the low end, packed tight at the high end." }
  ],
  "A8_PRESETS": {
    "bank": {
      "D": { "name": "Default", "params": { "weave": 0.4 } },
      "1": { "name": "Typo", "params": { "wieve": 0.9 } }
    }
  }
}*/

void main() { gl_FragColor = vec4(vec3(weave), 1.0); }
