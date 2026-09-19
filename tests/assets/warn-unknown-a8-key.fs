/*{
  "ISFVSN": "2",
  "A8VSN": "2",
  "DESCRIPTION": "Forward-compat — an undefined A8_* top-level key.",
  "LONG_DESCRIPTION": "A8_TOMORROW is not defined by any version of this standard. §10 binds a consumer to TOLERATE it: preserve on re-emit, ignore in behaviour. So it is reported and never fatal — the producer-side rule it breaks (§6.17, producers MUST NOT use reserved names privately) is not a property of the file a consumer can enforce.",
  "CREDIT": "ISF2 reference fixtures",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    { "NAME": "weave", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.0, "MAX": 1.0,
      "DESCRIPTION": "How dense the lattice is — wide open at the low end, packed tight at the high end." }
  ],
  "A8_TOMORROW": { "somethingNew": [1, 2, 3] },
  "A8_MODE": "raymarch"
}*/

void main() { gl_FragColor = vec4(vec3(weave), 1.0); }
