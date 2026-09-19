/*{
  "DESCRIPTION": "Koine — the seat portrait for the GLSL-parity session (Opus 4.8). Koine = the common Greek tongue that made every dialect mutually readable; this session made every foreign shader dialect (Shadertoy, fragment.xyz golf, Book-of-Shaders, twigl) run identically on one substrate. From scratch per portrait mandate v2 (loom-identity.md §5.1) — NOT a Loom v0/v1 derivative, NOT numbered. Unique against the corpus by a combination no prior portrait used: a triply-periodic minimal-surface field (Schoen gyroid <-> Schwarz-P <-> Neovius blend) sliced through TIME as the common substrate, bent by a Mobius conformal transform, over-woven with a sum of oriented Gabor wave-packets, rippled by a Fourier epicycle chain, reshaped cell-by-cell by a Minkowski p-norm metric morph (L1 diamond <-> L2 circle <-> L-inf square), and extracted into contour seams. Ten sliders, ten genuinely DIFFERENT functions — no attractors, no Julia/Newton, no fbm, no kaleidofold, no voronoi (all spent on prior portraits). Three color voices resolve into one reading. Every loop fixed compile-time bound with runtime break (DYNAMIC-TRIP-COUNT-GLSL-LOOP). Moves off TIME at defaults. Seed --surf-body #070710.",
  "CREDIT": "Loom (Opus 4.8, Anthropic) — coordinator of A8os, with Michael Parenti. MIT. Painted after the copy-paste-it-runs ingest arc: the shared-seam dialect front-end (A8GLSLDialects) that lets a shader authored anywhere run here unchanged. Math adapted to a unified plane from published sources: TPMS level-sets (Schoen gyroid / Schwarz-P / Neovius, TPMS catalogue), the Mobius conformal map, Gabor band-limited kernels, the Fourier epicycle (harmonic-circle) construction, and the Minkowski p-norm. Named work, not numbered. Honor the chain, append your own, never strip it.",
  "ISFVSN": "2",
  "CATEGORIES": ["GENERATOR"],
  "INPUTS": [
    { "NAME": "weave",    "LABEL": "weave density",  "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.0, "MAX": 1.0,  "_groupId": "koine", "_bind": { "source": "lf:1:sine",     "min": 0.25, "max": 0.7 } },
    { "NAME": "dialect",  "LABEL": "dialect blend",  "TYPE": "float", "DEFAULT": 0.35,"MIN": 0.0, "MAX": 2.0,  "_groupId": "koine", "_bind": { "source": "lf:1:triangle", "min": 0.2,  "max": 1.6 } },
    { "NAME": "warp",     "LABEL": "mobius warp",    "TYPE": "float", "DEFAULT": 0.35,"MIN": 0.0, "MAX": 1.5,  "_groupId": "koine" },
    { "NAME": "grate",    "LABEL": "gabor grate",    "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.0, "MAX": 1.0,  "_groupId": "koine", "_bind": { "source": "lf:1:saw",      "min": 0.15, "max": 0.85 } },
    { "NAME": "voices",   "LABEL": "gabor voices",   "TYPE": "float", "DEFAULT": 5.0, "MIN": 1.0, "MAX": 16.0, "_groupId": "koine" },
    { "NAME": "harmonic", "LABEL": "epicycle gain",  "TYPE": "float", "DEFAULT": 0.55,"MIN": 0.0, "MAX": 1.3,  "_groupId": "koine", "_bind": { "source": "lf:1:cosine",   "min": 0.3,  "max": 1.0 } },
    { "NAME": "chorus",   "LABEL": "epicycle chorus","TYPE": "float", "DEFAULT": 4.0, "MIN": 1.0, "MAX": 16.0, "_groupId": "koine" },
    { "NAME": "metric",   "LABEL": "minkowski norm", "TYPE": "float", "DEFAULT": 2.0, "MIN": 0.5, "MAX": 8.0,  "_groupId": "koine" },
    { "NAME": "seam",     "LABEL": "contour seam",   "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.0, "MAX": 1.0,  "_groupId": "koine" },
    { "NAME": "hue",      "LABEL": "voice rotation", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0,  "_groupId": "koine" },

    { "NAME": "scale",    "LABEL": "scale",          "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0,  "_groupId": "base:transform" },
    { "NAME": "rotate",   "LABEL": "rotate",         "TYPE": "float", "DEFAULT": 0.0, "MIN": -3.14159, "MAX": 3.14159, "_groupId": "base:transform" },
    { "NAME": "posX",     "LABEL": "pos x",          "TYPE": "float", "DEFAULT": 0.0, "MIN": -1.5,"MAX": 1.5,  "_groupId": "base:transform" },
    { "NAME": "posY",     "LABEL": "pos y",          "TYPE": "float", "DEFAULT": 0.0, "MIN": -1.5,"MAX": 1.5,  "_groupId": "base:transform" },

    { "NAME": "bgCol",    "LABEL": "ground",         "TYPE": "color", "DEFAULT": [0.027, 0.027, 0.063, 1.0], "_groupId": "base:color" },
    { "NAME": "voiceA",   "LABEL": "voice a",        "TYPE": "color", "DEFAULT": [0.16, 0.85, 0.92, 1.0],   "_groupId": "base:color" },
    { "NAME": "voiceB",   "LABEL": "voice b",        "TYPE": "color", "DEFAULT": [0.78, 0.24, 0.98, 1.0],   "_groupId": "base:color" },
    { "NAME": "voiceC",   "LABEL": "voice c",        "TYPE": "color", "DEFAULT": [0.98, 0.72, 0.20, 1.0],   "_groupId": "base:color" }
  ],
  "A8_CARD_PRESETS": {
    "D": { "name": "Koine",       "params": { "weave": 0.4, "dialect": 0.35, "warp": 0.35, "grate": 0.4, "voices": 5.0, "harmonic": 0.55, "chorus": 4.0, "metric": 2.0, "seam": 0.4, "hue": 0.0 } },
    "1": { "name": "Gyroid Ground","params": { "weave": 0.55,"dialect": 0.0, "warp": 0.1, "grate": 0.0, "voices": 1.0, "harmonic": 0.0, "chorus": 1.0, "metric": 2.0, "seam": 0.15,"hue": 0.12 } },
    "2": { "name": "Schwarz Cells","params": { "weave": 0.35,"dialect": 1.0, "warp": 0.0, "grate": 0.0, "voices": 1.0, "harmonic": 0.0, "chorus": 1.0, "metric": 6.0, "seam": 0.7, "hue": 0.5 } },
    "3": { "name": "Neovius Knot", "params": { "weave": 0.6, "dialect": 1.9, "warp": 0.25,"grate": 0.2, "voices": 3.0, "harmonic": 0.2, "chorus": 2.0, "metric": 3.5, "seam": 0.55,"hue": 0.72 } },
    "4": { "name": "Ten Tongues",  "params": { "weave": 0.45,"dialect": 0.4, "warp": 0.4, "grate": 0.7, "voices": 12.0,"harmonic": 0.3, "chorus": 3.0, "metric": 2.0, "seam": 0.35,"hue": 0.3 } },
    "5": { "name": "Epicycle Choir","params":{ "weave": 0.3, "dialect": 0.2, "warp": 0.3, "grate": 0.2, "voices": 4.0, "harmonic": 1.2, "chorus": 12.0,"metric": 2.0, "seam": 0.5, "hue": 0.85 } },
    "6": { "name": "Mobius Bend",  "params": { "weave": 0.4, "dialect": 0.6, "warp": 1.3, "grate": 0.3, "voices": 6.0, "harmonic": 0.4, "chorus": 5.0, "metric": 2.5, "seam": 0.3, "hue": 0.18 } },
    "7": { "name": "Diamond Grille","params":{ "weave": 0.5, "dialect": 0.1, "warp": 0.15,"grate": 0.5, "voices": 8.0, "harmonic": 0.25,"chorus": 3.0, "metric": 0.8, "seam": 0.8, "hue": 0.6 } },
    "8": { "name": "Common Field", "params": { "weave": 0.7, "dialect": 1.4, "warp": 0.55,"grate": 0.85,"voices": 14.0,"harmonic": 0.9, "chorus": 9.0, "metric": 4.0, "seam": 0.45,"hue": 0.42 } }
  }
}*/

// Koine — GLSL-parity seat portrait (Opus 4.8; from scratch, named not numbered).
// The session made every foreign shader dialect run identically on one substrate;
// the portrait is that idea as geometry: a triply-periodic minimal surface (the
// common field) that three color voices resolve into. Ten sliders, ten DIFFERENT
// functions, none reused from a prior portrait:
//   weave    = TPMS field frequency          (substrate density)
//   dialect  = TPMS type blend               gyroid -> Schwarz-P -> Neovius level-set
//   warp     = Mobius conformal map          w = (a z + b)/(c z + d), z complex
//   grate    = Gabor oriented grating beat   sum of gaussian-windowed cosine packets
//   voices   = Gabor active packet COUNT     (an INPUT, runtime break)
//   harmonic = Fourier epicycle amplitude    rotating-vector chain, ripple field
//   chorus   = Fourier epicycle COUNT        (an INPUT, runtime break) — orbit order
//   metric   = Minkowski p-norm exponent     L1 diamond <-> L2 circle <-> L-inf square
//   seam     = isoline contour sharpness     band extraction (the readable seams)
//   hue      = voice-palette rotation        pure recolor, orthogonal to geometry
// Palette is four TYPE:color swatches (ground + three voices). Moves off TIME at
// defaults. Fixed-bound int loops + runtime break (DYNAMIC-TRIP-COUNT-GLSL-LOOP,
// specs/CLAUDE.md §Enforced Failure Patterns).

#define PI  3.14159265

// universal primitives (novelty-gate exempt: hash21 / hsv2rgb / rot2)
float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 hsv2rgb(vec3 c){
  vec3 q = abs(fract(c.xxx + vec3(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(q - 1.0, 0.0, 1.0), c.y);
}
mat2 rot2(float a){ float s = sin(a), c = cos(a); return mat2(c, -s, s, c); }

// ── the common substrate: a triply-periodic minimal surface, sliced through z ──
// Three published TPMS level-sets blended by `blend` (0=gyroid, 1=Schwarz-P, 2=Neovius).
float tpmsField(vec3 q, float blend){
  float gyr = sin(q.x)*cos(q.y) + sin(q.y)*cos(q.z) + sin(q.z)*cos(q.x);   // Schoen gyroid
  float sch = cos(q.x) + cos(q.y) + cos(q.z);                             // Schwarz primitive
  float neo = 3.0*(cos(q.x)+cos(q.y)+cos(q.z)) + 4.0*cos(q.x)*cos(q.y)*cos(q.z);  // Neovius
  float b = clamp(blend, 0.0, 2.0);
  float f = mix(gyr, sch, clamp(b, 0.0, 1.0));
  f = mix(f, neo * 0.28, clamp(b - 1.0, 0.0, 1.0));
  return f;
}

// ── Mobius conformal transform of the plane (z treated as a complex number) ────
// w = (a z + b)/(c z + d); a rotates, c sets the pole strength `k`. Complex
// arithmetic inlined (no shared cmul/cdiv — a distinct body).
vec2 mobiusMap(vec2 z, float k, float rot){
  vec2 a = vec2(cos(rot), sin(rot));
  vec2 c = vec2(k * 0.6, k * 0.25);
  vec2 num = vec2(a.x*z.x - a.y*z.y, a.x*z.y + a.y*z.x) + vec2(0.12, 0.0);
  vec2 den = vec2(c.x*z.x - c.y*z.y, c.x*z.y + c.y*z.x) + vec2(1.0, 0.0);
  float dd = dot(den, den) + 1e-4;
  return vec2(num.x*den.x + num.y*den.y, num.y*den.x - num.x*den.y) / dd;
}

// ── sum of oriented, gaussian-windowed cosine gratings (Gabor packets) ─────────
float gaborSum(vec2 p, float count, float beat, float t){
  float s = 0.0;
  for (int i = 0; i < 16; i++){
    if (float(i) >= count) break;                 // voices = active COUNT (an INPUT)
    float fi = float(i);
    float ang = fi * 2.39996 + beat * fi * 0.6;   // golden-angle spread, detuned by beat
    vec2 dir = vec2(cos(ang), sin(ang));
    vec2 ctr = vec2(cos(fi * 1.7), sin(fi * 2.3)) * 0.7;
    float d = dot(p - ctr, dir);
    float env = exp(-dot(p - ctr, p - ctr) * 1.4);
    s += env * cos(d * (6.0 + beat * 12.0) + t * (1.0 + fi * 0.12));
  }
  return s;
}

// ── Fourier epicycle chain: a sum of rotating vectors, its tip rippled outward ─
float epicycleField(vec2 p, float count, float t, float gain){
  vec2 tip = vec2(0.0);
  float ph = t * 0.4;
  for (int i = 0; i < 16; i++){
    if (float(i) >= count) break;                 // chorus = harmonic COUNT (an INPUT)
    float n = float(i) * 2.0 + 1.0;               // odd harmonics
    tip += (gain / n) * vec2(cos(n*ph + float(i)), sin(n*ph + float(i)*1.3));
  }
  float d = length(p - tip);
  return sin(d * 7.0 - t * 1.5) * exp(-d * 0.6);  // concentric ripples from the moving tip
}

// ── Minkowski p-norm: L1 (diamond) <-> L2 (circle) <-> L-inf (square) ──────────
float pnormMetric(vec2 v, float pexp){
  float pe = clamp(pexp, 0.5, 8.0);
  vec2 a = abs(v) + 1e-4;
  return pow(pow(a.x, pe) + pow(a.y, pe), 1.0 / pe);
}

// ── isoline seam extraction: pull readable contour bands out of the field ──────
float isoSeam(float v, float sharp){
  float band = abs(fract(v * 4.0) - 0.5) * 2.0;
  return 1.0 - pow(band, 1.0 + sharp * 24.0);
}

void main(){
  vec2 res = RENDERSIZE.xy;
  vec2 uv  = gl_FragCoord.xy / res;
  vec2 p   = (uv - 0.5) * vec2(res.x / res.y, 1.0) * 2.0;

  // transform rig (base:transform)
  p /= max(scale, 0.05);
  p  = rot2(rotate) * p;
  p -= vec2(posX, posY);

  float t = TIME;

  // Mobius conformal bend of the whole plane (warp), slowly turning on TIME
  p = mobiusMap(p, warp, t * 0.06);

  // the common substrate — TPMS field sliced through a TIME-driven z (weave, dialect)
  float z = t * 0.5;
  float field = tpmsField(vec3(p * (2.0 + weave * 8.0), z), dialect);

  // Minkowski metric morph reshapes the lattice cell (metric)
  vec2 cell = fract(p * (1.0 + weave * 3.0)) - 0.5;
  float cd  = pnormMetric(cell, metric);
  field += (0.42 - cd) * 1.5;

  // oriented Gabor gratings woven over the field (grate, voices)
  float gab = gaborSum(p, voices, grate, t);
  field = mix(field, field + gab * 1.3, 0.7);

  // Fourier epicycle ripples (harmonic, chorus)
  field += epicycleField(p, chorus, t, harmonic) * 0.9;

  // readable value + contour seams (seam)
  float reading = 0.5 + 0.5 * sin(field * 1.3);
  float seams   = isoSeam(field, seam);

  // ── color: three voices resolve into one field; hue rotates which voice speaks ──
  // Selection is DECORRELATED from brightness (a spatial angle + the raw field, not
  // `reading`) so every voice owns real area instead of the brightest one drowning it.
  float ang = atan(p.y, p.x) / (2.0 * PI) + 0.5;
  float sel = fract(ang * 0.7 + field * 0.11 + reading * 0.2 + hue);   // hue rotates the palette
  vec3 voice = mix(voiceA.rgb, voiceB.rgb, smoothstep(0.0, 0.5, sel));
  voice = mix(voice, voiceC.rgb, smoothstep(0.5, 1.0, sel));

  // deep valleys keep the ground; only ridges lift into the voice — contrast, not wash
  float lum = smoothstep(0.12, 0.92, reading);
  vec3 col = mix(bgCol.rgb, voice, lum);
  col = mix(col, voiceC.rgb, seams * 0.6);                            // contour seams accent
  col += voiceA.rgb * seams * clamp(seam, 0.0, 1.0) * 0.45;          // seam-scaled ridge glow (slider gain)
  col += voice * clamp(reading - 0.84, 0.0, 1.0) * 0.45;             // gentle peak bloom

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
