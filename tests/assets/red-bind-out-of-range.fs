/*{
  "ISFVSN": "2",
  "A8VSN": "2",
  "DESCRIPTION": "V11 RED — a _bind bracket lies outside the input's declared domain.",
  "LONG_DESCRIPTION": "`weave` declares MIN 0 / MAX 1 and ships bound to a bracket of [0.25, 1.8]. A bracket outside its own domain binds to nothing: the modulator sweeps a span the input can never reach, which reads as a dead control rather than as a malformed file.",
  "CREDIT": "ISF2 reference fixtures",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    { "NAME": "weave", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.0, "MAX": 1.0,
      "DESCRIPTION": "How dense the lattice is — wide open at the low end, packed tight at the high end.",
      "_bind": { "source": "lf:1:sine", "min": 0.25, "max": 1.8 } }
  ]
}*/

void main() { gl_FragColor = vec4(vec3(weave), 1.0); }
