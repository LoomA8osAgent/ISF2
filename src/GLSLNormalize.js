// GLSLNormalize.js — anim8 fork Update 4 (G2.3 Stage 1).
//
// Fork-native home of the ES 1.00 → ES 3.00 GLSL normalize inventory that
// previously lived ONLY app-side as a WebGL2RenderingContext.prototype
// shaderSource monkeypatch (Anim8 `app/js/formats/isf-es300.js`). Ported
// VERBATIM (fidelity first — port, don't improve): every regex, roster,
// prelude line and the S73 brace-depth-gated dedup are byte-level copies of
// the app shim so the same input text produces the same output text.
//
// Transform inventory (T-numbers per the Anim8 G2.3 execution design §1.3):
//   T1  strip user `precision` lines + `#version` directives
//   T2  numeric-IMPORTED rename `uniform sampler2D 0;` → `iChannel<N>`
//       (+ `_<N>_imgRect` etc companions) — regex belt; the parser-source
//       fix lands at Stage 2
//   T3  texture API rename texture2D(Lod/Proj)/textureCube(Lod) → texture/…
//   T4  legacy names vv_FragNormCoord / vv_FragCoord / isf_FragColor
//   T5  `#extension` hoist between `#version` and `precision`
//   T6  global-scope duplicate-declaration dedup (S73 depth gating VERBATIM
//       — function-local same-name decls are distinct variables, never dedup)
//   T7  user-redeclared ES3 built-in fn rename → `_u_<name>` (26-name roster)
//   T8  reserved-word identifier rename (`sample`/`filter`/… roster)
//   T9  user-declared `out vec4 <name>` detection → gl_FragColor maps to it,
//       else inject `_isf_outFrag`
//   T10 gl_FragColor / gl_FragData[i] → out var
//   T11 mod(/clamp( callsite rename → _isf_mod(/_isf_clamp( + overload prelude
//   T12 MadMapper MM_SHADER_THIS_(NORM_)PIXEL + IMG_THIS_PIXEL #define shims
//       (inside the prelude; the IMG_THIS_PIXEL define is a belt over the
//       parser macro expansion — kept)
//   T13 frag/vert stage split: varying→in(frag)/out(vert), attribute→in
//   T14 the legacy-source gate (`isLegacyISFSource`) — ported as a PURE
//       PREDICATE only. The prototype monkeypatch INSTALLER is environment-
//       bound (WebGL2RenderingContext) and stays app-side
//       (isfInstallShaderSourcePatch) as the capability fallback.
//
// ORDER DEPENDENCIES (found during the port — the pipeline order is
// load-bearing, preserved exactly):
//   1. storage-qualifier rewrite (T13) runs BEFORE dedup (T6): `attribute
//      vec2 position` + `varying vec2 position` only COLLIDE after both
//      become `in vec2 position` — dedup must see the post-rewrite text.
//   2. _detectFragOut (T9) runs AFTER _renameReservedIdents (T8): a reserved
//      word used as the out-var name is renamed first, so the detected sink
//      matches the rewritten body.
//   3. _extractExtensions (T5) runs LAST on the body, so hoisted #extension
//      lines land between `#version 300 es` and the `precision` lines in the
//      assembled head (GLSL requires extensions before other declarations).
//   4. T1 (#version/precision strip) runs FIRST (inside _commonRewrites) so
//      the canonical preamble is the only one emitted.
//
// Pure string→string. No GL, no DOM, no window — emitter/harness-reusable
// (fork-revisit §7.2/7.3 environment-neutral rule).
//
// API:
//   normalizeGLSL(source, { target: 'es100'|'es300', stage: 'frag'|'vert' })
//     target 'es100' (default) → NO-OP passthrough (the parser still emits
//     ES 1.00; this is the Stage-1 0-DIFF proof). target 'es300' → the full
//     rewrite, identical to the app monkeypatch's output for the same input.
//   upgradeES300(fragSrc, vertSrc) → { frag, vert }   (mirror of the app
//     shim's isfUpgradeES300 surface)
//   isLegacyISFSource(src) → bool   (T14 gate predicate)

// ---- per-pass text rewrites shared by frag + vert ----
function _commonRewrites(s) {
  // Strip caller-supplied precision lines + #version directives — we re-emit
  // the canonical preamble.
  s = s.replace(/^\s*precision\s+(highp|mediump|lowp)\s+(float|int)\s*;\s*$/gm, '');
  s = s.replace(/^\s*#\s*version\b[^\n]*\n/gm, '');

  // ISFParser bug: when an IMPORTED entry's NAME is missing or numeric, the
  // generated GLSL declares `uniform sampler2D 0;` — invalid identifier.
  // Rename to Shadertoy convention `iChannel<N>` because user code in those
  // shaders typically references iChannel0/iChannel1 (auto-converted from
  // Shadertoy). Companion identifiers `_<N>_imgRect` etc rename in lockstep.
  s = s.replace(/(uniform\s+sampler(?:2D|Cube|3D))\s+(\d+)(\s*;)/g, '$1 iChannel$2$3');
  s = s.replace(/\b_(\d+)_(imgRect|imgSize|flip|normTexCoord|texCoord)\b/g, '_iChannel$1_$2');

  // Texture API rename: ES 1.00 → ES 3.00.
  s = s.replace(/\btexture2DLod\s*\(/g, 'textureLod(');
  s = s.replace(/\btexture2DProjLod\s*\(/g, 'textureProjLod(');
  s = s.replace(/\btexture2DProj\s*\(/g, 'textureProj(');
  s = s.replace(/\btexture2D\s*\(/g, 'texture(');
  s = s.replace(/\btextureCubeLod\s*\(/g, 'textureLod(');
  s = s.replace(/\btextureCube\s*\(/g, 'texture(');

  // Legacy ISF macro names.
  s = s.replace(/\bvv_FragNormCoord\b/g, 'isf_FragNormCoord');
  s = s.replace(/\bvv_FragCoord\b/g, 'isf_FragCoord');
  s = s.replace(/\bisf_FragColor\b/g, '_isf_outFrag');

  return s;
}

function _extractExtensions(s) {
  const ex = [];
  s = s.replace(/^\s*#\s*extension\b[^\n]*\n/gm, (m) => { ex.push(m.trim()); return ''; });
  return { src: s, ext: ex };
}

// Dedup any `<storage> <type> <ident>;` whose ident already declared.
// Catches the `attribute vec2 position` + `varying vec2 position` →
// post-rewrite both become `in vec2 position` collision. Also any
// duplicate uniform decls (auto-injected ISF + user redeclared).
function _dedupDeclarations(s) {
  const seen = {};
  const lines = s.split('\n');
  // Match ALL declarations — with or without storage qualifier — to catch
  // both `in vec2 position;` AND `vec2 position;`. Exclude assignments
  // (anything containing `=` before the semicolon).
  const rx = /^\s*(?:(?:in|out|uniform|attribute|varying)\s+)*(?:lowp\s+|mediump\s+|highp\s+)?(?:vec\d|float|int|bool|sampler\w+|mat\d|ivec\d|uvec\d|uint)\s+([\w\d_]+)\s*;\s*$/;
  // S73 — dedup ONLY at GLOBAL scope (brace depth 0). Dedup is meant for
  // top-level globals ISFRenderer may double-declare (`in vec2 position;`).
  // A FUNCTION-LOCAL declaration (depth > 0) with the same NAME in two
  // different functions is a DISTINCT variable, NOT a duplicate — blanking
  // the 2nd left its loop referencing an undeclared identifier. This bit
  // every GLY-baked fractal shader: the stdlib declares `float i;` at
  // function scope in mandelbrotSet / trinaryJuliaSet / … → the 2nd+ were
  // stripped → `ERROR: 'i' : undeclared identifier`. Scope-gating fixes
  // every ISF shader with same-named function-local decls, not just GLY.
  // (Comment-brace edge: GLSL machine-gen source doesn't unbalance braces in
  // comments; a full tokenizer is overkill here.)
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(rx);
    if (m && depth === 0) {
      if (seen[m[1]]) lines[i] = '';
      else seen[m[1]] = true;
    }
    for (let ci = 0; ci < line.length; ci++) {
      const ch = line.charCodeAt(ci);
      if (ch === 123) depth++; // {
      else if (ch === 125) depth--; // }
    }
  }
  return lines.join('\n');
}

// ES 3.00 built-in functions that user shaders sometimes redeclare. ES 1.00
// permitted user override; ES 3.00 strict-rejects with "Name of a built-in
// function cannot be redeclared as function". Detect user-defined functions
// with these names + rename to `_u_<name>` plus rewrite all callsites.
// Spec: https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf §8
const _BUILTIN_FNS = [
  'sign', 'cross', 'round', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
  'inverse', 'transpose', 'determinant', 'noise', 'noise1', 'noise2', 'noise3', 'noise4',
  'isnan', 'isinf', 'floatBitsToInt', 'floatBitsToUint', 'intBitsToFloat', 'uintBitsToFloat',
  'packSnorm2x16', 'unpackSnorm2x16', 'packUnorm2x16', 'unpackUnorm2x16',
  'packHalf2x16', 'unpackHalf2x16', 'outerProduct', 'trunc', 'roundEven',
  'modf', 'dFdx', 'dFdy', 'fwidth',
  // ES 3.00 texture family — user shaders sometimes define their own
  // `vec3 texture(...)` etc., colliding with the built-in.
  'texture', 'textureLod', 'textureProj', 'textureProjLod', 'textureGrad',
  'textureSize', 'texelFetch',
];
function _renameBuiltinCollisions(s) {
  // Match user-defined function: `<retType> <name>(args) {` OR
  // `<retType> <name>(args);` (forward decl). Cheap regex pre-pass to
  // detect WHICH names actually collide in this source — only rename
  // those, leaves call sites of ACTUAL built-ins untouched.
  const collisions = [];
  for (let i = 0; i < _BUILTIN_FNS.length; i++) {
    const name = _BUILTIN_FNS[i];
    // Look for a function-definition / forward-decl that uses the name as
    // identifier (not as call). Pattern: WORD WORD WS* `(` ... `)` followed
    // by `{` or `;`.
    const defRx = new RegExp(
      '(?:^|\\n)\\s*(?:lowp\\s+|mediump\\s+|highp\\s+)?'
      + '\\w+\\s+' + name + '\\s*\\([^)]*\\)\\s*[{;]'
    );
    if (defRx.test(s)) collisions.push(name);
  }
  if (!collisions.length) return s;
  for (let j = 0; j < collisions.length; j++) {
    const nm = collisions[j];
    // Rename every `\bname\b` that's followed by `(` (call or def) — leaves
    // identifier-as-component (e.g. `.sign`) untouched. Built-in callsites
    // for this name in this same file collapse together — but the user
    // already overrode the built-in in their source so that's a wash.
    const renameRx = new RegExp('\\b' + nm + '\\b(?=\\s*\\()', 'g');
    s = s.replace(renameRx, '_u_' + nm);
  }
  return s;
}

// ES 3.00 reserved keywords that some legacy shaders use as identifiers.
// Spec: https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf §3.6
const _RESERVED_AS_IDENT = ['sample', 'filter', 'common', 'partition', 'active', 'class', 'union', 'enum', 'typedef', 'template', 'this', 'packed', 'goto', 'inline', 'noinline', 'volatile', 'public', 'static', 'extern', 'external', 'interface', 'long', 'short', 'double', 'half', 'fixed', 'unsigned', 'superp', 'input', 'output', 'hvec2', 'hvec3', 'hvec4', 'dvec2', 'dvec3', 'dvec4', 'fvec2', 'fvec3', 'fvec4', 'sampler3DRect', 'sizeof', 'cast', 'namespace', 'using'];
function _renameReservedIdents(s) {
  for (let i = 0; i < _RESERVED_AS_IDENT.length; i++) {
    const w = _RESERVED_AS_IDENT[i];
    // Skip if not present at all.
    if (s.indexOf(w) < 0) continue;
    // Detect actual usage as identifier (followed by space/comma/semicolon/
    // paren/bracket/equals/operator, NOT followed by paren-as-call).
    // For safety, only rename when prefixed by a type token (declaration).
    const declRx = new RegExp(
      '(\\b(?:vec\\d|float|int|bool|mat\\d|ivec\\d|uvec\\d|uint|sampler\\w+|in|out|uniform|attribute|varying|highp|mediump|lowp)\\s+)' + w + '\\b',
      'g'
    );
    if (declRx.test(s)) {
      s = s.replace(declRx, '$1_u_' + w);
      // Rewrite usage references too (word-boundary match).
      const useRx = new RegExp('\\b' + w + '\\b', 'g');
      s = s.replace(useRx, '_u_' + w);
    }
  }
  return s;
}

// Detect existing `out vec4 <name>;` in fragment source. If user-declared,
// we map gl_FragColor to that name + skip injecting our own _isf_outFrag.
function _detectFragOut(s) {
  const m = s.match(/^\s*out\s+vec4\s+(\w+)\s*;\s*$/m);
  return m ? m[1] : null;
}

// ES 3.00 mod() built-in lacks int overloads; user shaders frequently pass
// ivec/int arguments. clamp() same problem. Polyfill: rename every callsite
// to `_isf_mod(` / `_isf_clamp(` + define exhaustive overloads in prelude.
// Plain text substitution (NOT a #define macro) so the GLSL compiler
// resolves the overload statically against our user-defined functions.
// Exhaustive _isf_mod / _isf_clamp overloads. ES 3.00 built-ins lack int +
// mixed-type variants; user shaders mix freely. Prelude defines all reasonable
// combinations so any callsite resolves regardless of arg types.
const _MOD_CLAMP_PRELUDE = [
  // mod — float family
  'float _isf_mod(float a, float b){return a-b*floor(a/b);}',
  'vec2  _isf_mod(vec2 a, vec2 b){return a-b*floor(a/b);}',
  'vec3  _isf_mod(vec3 a, vec3 b){return a-b*floor(a/b);}',
  'vec4  _isf_mod(vec4 a, vec4 b){return a-b*floor(a/b);}',
  'vec2  _isf_mod(vec2 a, float b){return a-b*floor(a/b);}',
  'vec3  _isf_mod(vec3 a, float b){return a-b*floor(a/b);}',
  'vec4  _isf_mod(vec4 a, float b){return a-b*floor(a/b);}',
  // mod — int family
  'int   _isf_mod(int a, int b){return a-b*(a/b);}',
  'ivec2 _isf_mod(ivec2 a, ivec2 b){return a-b*(a/b);}',
  'ivec3 _isf_mod(ivec3 a, ivec3 b){return a-b*(a/b);}',
  'ivec4 _isf_mod(ivec4 a, ivec4 b){return a-b*(a/b);}',
  'ivec2 _isf_mod(ivec2 a, int b){return a-b*(a/b);}',
  'ivec3 _isf_mod(ivec3 a, int b){return a-b*(a/b);}',
  'ivec4 _isf_mod(ivec4 a, int b){return a-b*(a/b);}',
  // mod — cross-type (auto cast to float, return float family)
  'float _isf_mod(int a, float b){return float(a)-b*floor(float(a)/b);}',
  'float _isf_mod(float a, int b){return a-float(b)*floor(a/float(b));}',
  'vec2  _isf_mod(vec2 a, int b){return a-float(b)*floor(a/float(b));}',
  'vec3  _isf_mod(vec3 a, int b){return a-float(b)*floor(a/float(b));}',
  'vec4  _isf_mod(vec4 a, int b){return a-float(b)*floor(a/float(b));}',
  'vec2  _isf_mod(ivec2 a, vec2 b){return vec2(a)-b*floor(vec2(a)/b);}',
  'vec3  _isf_mod(ivec3 a, vec3 b){return vec3(a)-b*floor(vec3(a)/b);}',
  'vec4  _isf_mod(ivec4 a, vec4 b){return vec4(a)-b*floor(vec4(a)/b);}',
  'vec2  _isf_mod(ivec2 a, float b){return vec2(a)-b*floor(vec2(a)/b);}',
  'vec3  _isf_mod(ivec3 a, float b){return vec3(a)-b*floor(vec3(a)/b);}',
  'vec4  _isf_mod(ivec4 a, float b){return vec4(a)-b*floor(vec4(a)/b);}',
  // clamp — float family (forward to native, just to give us a name)
  'float _isf_clamp(float a,float lo,float hi){return clamp(a,lo,hi);}',
  'vec2  _isf_clamp(vec2 a,vec2 lo,vec2 hi){return clamp(a,lo,hi);}',
  'vec3  _isf_clamp(vec3 a,vec3 lo,vec3 hi){return clamp(a,lo,hi);}',
  'vec4  _isf_clamp(vec4 a,vec4 lo,vec4 hi){return clamp(a,lo,hi);}',
  'vec2  _isf_clamp(vec2 a,float lo,float hi){return clamp(a,lo,hi);}',
  'vec3  _isf_clamp(vec3 a,float lo,float hi){return clamp(a,lo,hi);}',
  'vec4  _isf_clamp(vec4 a,float lo,float hi){return clamp(a,lo,hi);}',
  // clamp — int family
  'int   _isf_clamp(int a,int lo,int hi){return a<lo?lo:(a>hi?hi:a);}',
  'ivec2 _isf_clamp(ivec2 a,ivec2 lo,ivec2 hi){return ivec2(_isf_clamp(a.x,lo.x,hi.x),_isf_clamp(a.y,lo.y,hi.y));}',
  'ivec3 _isf_clamp(ivec3 a,ivec3 lo,ivec3 hi){return ivec3(_isf_clamp(a.x,lo.x,hi.x),_isf_clamp(a.y,lo.y,hi.y),_isf_clamp(a.z,lo.z,hi.z));}',
  // clamp — cross-type (cast int to float).
  // No `float _isf_clamp(int,int,int)` here — it would conflict on
  // arg-type with `int _isf_clamp(int,int,int)`. GLSL overload
  // resolution ignores return type.
  'float _isf_clamp(float a,int lo,int hi){return clamp(a,float(lo),float(hi));}',
  'float _isf_clamp(int a,float lo,float hi){return clamp(float(a),lo,hi);}',
  'vec2  _isf_clamp(vec2 a,int lo,int hi){return clamp(a,float(lo),float(hi));}',
  'vec3  _isf_clamp(vec3 a,int lo,int hi){return clamp(a,float(lo),float(hi));}',
  'vec4  _isf_clamp(vec4 a,int lo,int hi){return clamp(a,float(lo),float(hi));}',
  // Conservative MadMapper macro shims — define the simple texture-sample
  // macros only. Helper functions (rgb2hue/hsv2rgb) are NOT defined here
  // because user shaders frequently provide their own and the GLSL
  // function-redefinition error is unrecoverable. MM shaders that need
  // those funcs supply them in source.
  '#define MM_SHADER_THIS_NORM_PIXEL(_n) (texture(_n, isf_FragNormCoord))',
  '#define MM_SHADER_THIS_PIXEL(_n) (texture(_n, isf_FragNormCoord))',
  '#define IMG_THIS_PIXEL(_n) (texture(_n, isf_FragNormCoord))',
].join('\n') + '\n';

function _rewriteModClamp(s) {
  // Substitute callsites only — leaves identifiers like `module`, `clamping`
  // untouched via word-boundary + paren lookahead.
  s = s.replace(/\bmod\s*\(/g, '_isf_mod(');
  s = s.replace(/\bclamp\s*\(/g, '_isf_clamp(');
  return s;
}

function _rewriteFrag(s) {
  s = _commonRewrites(s);
  s = s.replace(/\bvarying\b/g, 'in');
  s = s.replace(/\battribute\b/g, 'in');
  // Built-in fn collisions (sign / cross / round / etc.) — rename user defs.
  s = _renameBuiltinCollisions(s);
  // Reserved-word identifier collisions (sample / filter / etc.).
  s = _renameReservedIdents(s);
  // mod/clamp callsites → polyfill names.
  s = _rewriteModClamp(s);
  // Determine output sink: user-declared out OR our injected _isf_outFrag.
  const userOut = _detectFragOut(s);
  const outName = userOut || '_isf_outFrag';
  s = s.replace(/\bgl_FragColor\b/g, outName);
  s = s.replace(/\bgl_FragData\s*\[\s*\d+\s*\]/g, outName);
  s = _dedupDeclarations(s);
  const ex = _extractExtensions(s); s = ex.src;
  let head = '#version 300 es\n';
  if (ex.ext.length) head += ex.ext.join('\n') + '\n';
  head += 'precision highp float;\nprecision highp int;\n';
  if (!userOut) head += 'out vec4 _isf_outFrag;\n';
  head += _MOD_CLAMP_PRELUDE;
  return head + s;
}

function _rewriteVert(s) {
  s = _commonRewrites(s);
  s = s.replace(/\battribute\b/g, 'in');
  s = s.replace(/\bvarying\b/g, 'out');
  s = _renameBuiltinCollisions(s);
  s = _renameReservedIdents(s);
  s = _rewriteModClamp(s);
  s = _dedupDeclarations(s);
  const ex = _extractExtensions(s); s = ex.src;
  let head = '#version 300 es\n';
  if (ex.ext.length) head += ex.ext.join('\n') + '\n';
  head += 'precision highp float;\nprecision highp int;\n';
  head += _MOD_CLAMP_PRELUDE;
  return head + s;
}

// Mirror of the app shim's `isfUpgradeES300(fragSrc, vertSrc)` surface.
function upgradeES300(fragSrc, vertSrc) {
  return {
    frag: fragSrc ? _rewriteFrag(fragSrc) : '',
    vert: vertSrc ? _rewriteVert(vertSrc) : '',
  };
}

// T14 gate predicate. Detect ES 1.00-flavored ISF source. Conservative —
// never matches modern shaders with `#version 300 es` already declared.
function isLegacyISFSource(src) {
  if (typeof src !== 'string') return false;
  if (/^\s*#\s*version\s+300\s+es/.test(src)) return false;
  return /\b(gl_FragColor|attribute\s+|varying\s+)/.test(src);
}

// Primary entry. `target: 'es100'` (default) is a strict NO-OP passthrough —
// the parser keeps emitting ES 1.00 and the app-side monkeypatch keeps
// owning the upgrade (Stage-1 0-DIFF proof). `target: 'es300'` runs the full
// rewrite for the given stage.
function normalizeGLSL(source, opts) {
  const o = opts || {};
  const target = o.target || 'es100';
  if (target === 'es100') return source;
  if (target !== 'es300') throw new Error('GLSLNormalize: unknown target "' + target + '"');
  const stage = o.stage || 'frag';
  if (typeof source !== 'string') return source;
  return stage === 'vert' ? _rewriteVert(source) : _rewriteFrag(source);
}

export default {
  normalizeGLSL,
  upgradeES300,
  isLegacyISFSource,
  MOD_CLAMP_PRELUDE: _MOD_CLAMP_PRELUDE,
};
