// tests/isf2-test.js — ISF2 extension schema (fork Update 6, G2.3 Stage 3).
//
// Covers: the A8_* parse surface, per-input extension fields (neutral + the
// grandfathered _glyOp* synonyms), the §9.3 V1-V9 validation rules, the error
// surface for malformed input, and — the load-bearing one — strict back-compat:
// a classic ISF file with no extension content parses to exactly the vanilla
// model, and ISF2's presence changes nothing about ISFParser's output.

var test = require('tape');
var fs = require('fs');
var lib = require('../dist/build-worker').interactiveShaderFormat;
var ISF2 = lib.ISF2;
var ISFParser = lib.Parser;

function assetLoad(name) {
  return fs.readFileSync('./tests/assets/' + name).toString();
}

function fs2(meta, body) {
  return '/*' + JSON.stringify(meta, null, 2) + '*/\n\n' + (body || 'void main() { gl_FragColor = vec4(1.0); }\n');
}

var FULL = {
  ISFVSN: '2',
  A8VSN: '1',
  DESCRIPTION: 'Radial pulse generator',
  LONG_DESCRIPTION: 'A soft radial pulse. The radius oscillates.',
  CREDIT: 'Example Author',
  CATEGORIES: ['Generator'],
  INPUTS: [
    { NAME: 'center', TYPE: 'point2D', DEFAULT: [0.5, 0.5] },
    { NAME: 'radius', TYPE: 'float', DEFAULT: 0.25, MIN: 0.0, MAX: 1.0,
      DESCRIPTION: 'How big the ring is.', _groupId: 'shape', _groupLabel: 'Shape' },
    { NAME: 'softness', TYPE: 'float', DEFAULT: 0.1, MIN: 0.0, MAX: 0.5, _groupId: 'shape' },
    { NAME: 'tint', TYPE: 'color', DEFAULT: [0.2, 0.8, 1.0, 1.0], _groupId: 'shape', _headerSlot: true }
  ],
  A8_ANIMATE: [
    { input: 'radius', curve: 'sine', rate: 0.5, depth: 0.3, bipolar: true, baseValue: 0.25 }
  ],
  A8_PROVENANCE: {
    version: '1.0',
    origin: { source: 'user', author: 'Example Author', license: 'MIT' },
    chain: [{ action: 'create', timestamp: 1775067260192, by: 'Example Author', contentHash: '9f2c' }]
  }
};

// ---------------------------------------------------------------------------
// Back-compat — the hard gate
// ---------------------------------------------------------------------------

test('ISF2: classic ISF file yields a clean, extension-free model', function (t) {
  var model = ISF2.parse(assetLoad('generator.fs'));
  t.equal(model.a8.isISF2, false, 'not flagged as ISF2');
  t.equal(model.a8.vsn, null, 'no A8VSN');
  t.equal(model.a8.animate, null, 'no A8_ANIMATE');
  t.equal(model.a8.provenance, null, 'no A8_PROVENANCE');
  t.deepEqual(model.a8.ui, {}, 'no per-input extension fields');
  t.deepEqual(model.warnings, [], 'no warnings on a clean classic file');
  t.equal(model.type, 'generator', 'filter type matches the vanilla classification');
  t.equal(model.isfVersion, 2, 'ISF version 2');
  t.end();
});

test('ISF2: model classification agrees with ISFParser on the classic corpus fixtures', function (t) {
  ['generator.fs', 'image-filter.fs', 'transition.fs', 'version1_basic.fs'].forEach(function (name) {
    var src = assetLoad(name);
    var p = new ISFParser();
    p.parse(src);
    var m = ISF2.parse(src);
    t.equal(m.type, p.type, name + ': type matches ISFParser');
    t.equal(m.isfVersion, p.isfVersion, name + ': isfVersion matches ISFParser');
    t.deepEqual(m.inputs, p.inputs || [], name + ': inputs identical to ISFParser');
    t.equal(m.body, p.rawFragmentMain, name + ': body identical to ISFParser rawFragmentMain');
  });
  t.end();
});

test('ISF2: presence does not perturb ISFParser output', function (t) {
  // The emitted GLSL for a classic file must be identical whether or not the
  // extension layer ran over it first (ISF2 never mutates the metadata object).
  var src = assetLoad('img_norm_pixel_isf.fs');
  var a = new ISFParser(); a.parse(src);
  var model = ISF2.parse(src);
  ISF2.validate(model);
  var b = new ISFParser(); b.parse(src);
  t.equal(b.fragmentShader, a.fragmentShader, 'fragment shader byte-identical');
  t.equal(b.vertexShader, a.vertexShader, 'vertex shader byte-identical');
  t.deepEqual(b.inputs, a.inputs, 'inputs byte-identical');
  t.end();
});

// ---------------------------------------------------------------------------
// The A8_* surface
// ---------------------------------------------------------------------------

test('ISF2: full extension file parses and validates', function (t) {
  var model = ISF2.parse(fs2(FULL));
  t.equal(model.a8.isISF2, true, 'flagged as ISF2');
  t.equal(model.a8.vsn, '1', 'A8VSN read');
  t.equal(model.a8.animate.length, 1, 'A8_ANIMATE read');
  t.equal(model.a8.provenance.origin.license, 'MIT', 'A8_PROVENANCE read');
  t.equal(model.a8.ui.radius.groupId, 'shape', 'per-input _groupId read');
  t.equal(model.a8.ui.tint.headerSlot, true, 'per-input _headerSlot read');
  t.equal(model.point2D.center, 'pixel', 'point2D without MIN/MAX is pixel-consuming (§8.2)');

  var v = ISF2.validate(model);
  t.equal(v.ok, true, 'validates clean: ' + JSON.stringify(v.errors));
  t.equal(v.skipped.length, 1, 'V9 reported as skipped, never passed');
  t.equal(v.skipped[0].rule, 'V9', 'the skipped rule is V9');
  t.end();
});

test('ISF2: point2D raw mode needs BOTH MIN and MAX (§8.2)', function (t) {
  var m = ISF2.parse(fs2({ INPUTS: [
    { NAME: 'raw', TYPE: 'point2D', DEFAULT: [0, 0], MIN: [-1, -1], MAX: [1, 1] },
    { NAME: 'half', TYPE: 'point2D', DEFAULT: [0, 0], MIN: [-1, -1] }
  ] }));
  t.equal(m.point2D.raw, 'raw', 'both bounds ⇒ raw');
  t.equal(m.point2D.half, 'pixel', 'one bound ⇒ pixel');
  var v = ISF2.validate(m);
  t.ok(v.warnings.some(function (w) { return w.code === 'point2d-one-sided-range'; }), 'one-sided range warns');
  t.end();
});

test('ISF2: operator fields — neutral canonical, _glyOp* grandfathered', function (t) {
  var neutral = ISF2.parse(fs2({ INPUTS: [
    { NAME: 'twist', TYPE: 'float', DEFAULT: 0, _op: true, _opIdentity: 0 }
  ] }));
  t.equal(neutral.a8.ui.twist.op, true, '_op read');
  t.equal(neutral.a8.ui.twist.opIdentity, 0, '_opIdentity read');
  t.equal(neutral.warnings.length, 0, 'neutral names produce no warning');

  var legacy = ISF2.parse(fs2({ INPUTS: [
    { NAME: 'twist', TYPE: 'float', DEFAULT: 0, _glyOp: true, _glyOpIdentity: 0, _glyOpAuthored: true }
  ] }));
  t.equal(legacy.a8.ui.twist.op, true, 'legacy _glyOp maps to the same field');
  t.equal(legacy.a8.ui.twist.opAuthored, true, 'legacy _glyOpAuthored maps through');
  t.ok(legacy.warnings.some(function (w) { return w.code === 'op-field-legacy'; }), 'legacy spelling warns');
  t.equal(ISF2.validate(legacy).ok, true, 'legacy spelling still validates (grandfathered)');

  // The notice is a FILE-level property: the shipped corpus carries _glyOp* on
  // tens of thousands of inputs and is explicitly not scheduled for migration,
  // so it must not produce one warning per input.
  var many = [];
  for (var i = 0; i < 40; i += 1) {
    many.push({ NAME: 'op' + i, TYPE: 'float', DEFAULT: 0, _glyOp: true, _glyOpIdentity: 0 });
  }
  var bulk = ISF2.parse(fs2({ INPUTS: many }));
  t.equal(bulk.warnings.filter(function (w) { return w.code === 'op-field-legacy'; }).length, 2,
    'one notice per legacy field name (_glyOp, _glyOpIdentity), not per input');
  t.end();
});

test('ISF2: unknown + reserved A8_* keys are preserved and ignored (§10)', function (t) {
  var m = ISF2.parse(fs2({ A8VSN: '1', A8_MODE: 'raymarch', A8_FUTURE: { x: 1 },
    INPUTS: [{ NAME: 'a', TYPE: 'float', DEFAULT: 0 }] }));
  t.equal(m.a8.reserved.A8_MODE, 'raymarch', 'reserved key preserved on the model');
  t.deepEqual(m.a8.unknown.A8_FUTURE, { x: 1 }, 'unknown key preserved on the model');
  t.equal(m.meta.A8_FUTURE.x, 1, 'and still present on meta for re-emission');
  t.ok(m.warnings.some(function (w) { return w.code === 'a8-reserved-key'; }), 'reserved key warns');
  t.ok(m.warnings.some(function (w) { return w.code === 'a8-unknown-key'; }), 'unknown key warns');
  t.equal(ISF2.validate(m).ok, true, 'forward-compat content is not an error');
  t.end();
});

test('ISF2: a newer A8VSN still parses (§6.1)', function (t) {
  var m = ISF2.parse(fs2({ A8VSN: '99', INPUTS: [] }));
  t.equal(m.a8.vsn, '99', 'version read verbatim');
  t.ok(m.warnings.some(function (w) { return w.code === 'a8vsn-ahead'; }), 'ahead-of-implementation warns');
  t.equal(ISF2.validate(m).ok, true, 'and is not an error — unknown content is ignored');
  t.end();
});

// ---------------------------------------------------------------------------
// Validation rules
// ---------------------------------------------------------------------------

function codes(list) { return list.map(function (e) { return e.code; }); }

test('ISF2 V2: input name/type/shape errors', function (t) {
  var v = ISF2.validate(ISF2.parse(fs2({ INPUTS: [
    { NAME: '2bad', TYPE: 'float' },
    { NAME: 'ok', TYPE: 'nosuchtype' },
    { NAME: 'dup', TYPE: 'float' },
    { NAME: 'dup', TYPE: 'float' },
    { NAME: 'rng', TYPE: 'float', MIN: 5, MAX: 1 },
    { NAME: 'col', TYPE: 'color', DEFAULT: 'red' },
    { TYPE: 'float' }
  ] })));
  t.equal(v.ok, false, 'not ok');
  var c = codes(v.errors);
  t.ok(c.indexOf('input-bad-name') !== -1, 'invalid identifier caught');
  t.ok(c.indexOf('input-bad-type') !== -1, 'unknown TYPE caught');
  t.ok(c.indexOf('input-duplicate-name') !== -1, 'duplicate NAME caught');
  t.ok(c.indexOf('input-inverted-range') !== -1, 'MIN > MAX caught');
  t.ok(c.indexOf('input-bad-color-default') !== -1, 'bad color DEFAULT caught');
  t.ok(c.indexOf('input-no-name') !== -1, 'missing NAME caught');
  t.end();
});

test('ISF2 V2: audio types are declarable but flagged as host-dependent (§8.3)', function (t) {
  var v = ISF2.validate(ISF2.parse(fs2({ INPUTS: [{ NAME: 'aud', TYPE: 'audioFFT' }] })));
  t.equal(v.ok, true, 'declaring audioFFT is legal');
  t.ok(codes(v.warnings).indexOf('input-type-needs-host-support') !== -1, 'host-support warning raised');
  t.end();
});

test('ISF2 V3: pass targets and size expressions', function (t) {
  var v = ISF2.validate(ISF2.parse(fs2({
    INPUTS: [{ NAME: 'scale', TYPE: 'float', DEFAULT: 1 }],
    PASSES: [
      { TARGET: 'bufA', WIDTH: '$WIDTH/2', HEIGHT: '$HEIGHT*$scale' },
      { TARGET: '2bad' },
      { TARGET: 'bufC', WIDTH: '$WIDTH/(2' },
      { TARGET: 'bufD', WIDTH: '$NOPE' },
      { TARGET: 'scale' },
      {}
    ]
  })));
  var c = codes(v.errors);
  t.ok(c.indexOf('pass-bad-target') !== -1, 'invalid TARGET identifier caught');
  t.ok(c.indexOf('pass-bad-size-expr') !== -1, 'malformed size expression caught');
  t.ok(c.indexOf('pass-target-collision') !== -1, 'TARGET colliding with an input caught');
  t.equal(v.errors.filter(function (e) { return e.code === 'pass-bad-size-expr'; }).length, 2,
    'both the unbalanced paren and the undeclared $var are caught');
  t.end();
});

test('ISF2 V4: A8_ANIMATE references and shapes', function (t) {
  var v = ISF2.validate(ISF2.parse(fs2({
    INPUTS: [{ NAME: 'radius', TYPE: 'float', DEFAULT: 0 }],
    A8_ANIMATE: [
      { input: 'nope', curve: 'sine', rate: 1, depth: 1 },
      { input: 'radius', curve: 'sine', depth: 1 },
      { input: 'radius', curve: 'wobble', rate: 1, depth: 1 }
    ]
  })));
  var c = codes(v.errors);
  t.ok(c.indexOf('animate-unknown-input') !== -1, 'undeclared target input caught');
  t.ok(c.indexOf('animate-bad-rate') !== -1, 'missing rate caught');
  t.ok(codes(v.warnings).indexOf('animate-unknown-curve') !== -1, 'unknown curve degrades to a warning');
  t.end();
});

test('ISF2 V5: provenance chain shape', function (t) {
  var v = ISF2.validate(ISF2.parse(fs2({
    INPUTS: [],
    A8_PROVENANCE: { origin: { source: 'user' }, chain: [{ action: 'create', by: 'x' }] }
  })));
  var c = codes(v.errors);
  t.ok(c.indexOf('prov-no-version') !== -1, 'missing version caught');
  t.ok(c.indexOf('prov-event-field') !== -1, 'incomplete chain event caught');
  t.ok(codes(v.warnings).indexOf('prov-no-license') !== -1, 'missing license warns (export gate depends on it)');
  t.end();
});

test('ISF2 V6: extension neutrality — no smuggled inputs', function (t) {
  var v = ISF2.validate(ISF2.parse(fs2({
    INPUTS: [{ NAME: 'a', TYPE: 'float', DEFAULT: 0 }],
    A8_OPS: { extra: [{ NAME: 'secret', TYPE: 'float', DEFAULT: 1 }] }
  })));
  t.equal(v.ok, false, 'not ok');
  t.ok(codes(v.errors).indexOf('neutrality-smuggled-input') !== -1, 'input-shaped extension content caught');
  t.end();
});

test('ISF2 V7: the real gate grammar — { param, eq|not|anyOf } and AND-arrays', function (t) {
  var v = ISF2.validate(ISF2.parse(fs2({ INPUTS: [
    { NAME: 'mode', TYPE: 'long', VALUES: [0, 1, 2], LABELS: ['a', 'b', 'c'] },
    { NAME: 'scope', TYPE: 'long', VALUES: [0, 1], LABELS: ['a', 'b'] },
    // resolvable — all three operators, single and AND-array form
    { NAME: 'ok1', TYPE: 'float', DEFAULT: 0, _contextGate: { param: 'mode', eq: 1 } },
    { NAME: 'ok2', TYPE: 'float', DEFAULT: 0, _contextGate: { param: 'mode', not: 0 } },
    { NAME: 'ok3', TYPE: 'float', DEFAULT: 0, _contextGate: { param: 'mode', anyOf: [1, 2] } },
    { NAME: 'ok4', TYPE: 'float', DEFAULT: 0,
      _contextGate: [{ param: 'mode', eq: 2 }, { param: 'scope', not: 1 }] },
    { NAME: 'ok5', TYPE: 'color', DEFAULT: [0, 0, 0, 1], _headerSlot: true,
      _contextHeaderGate: { param: 'mode', not: 1 } },
    // broken
    { NAME: 'bad1', TYPE: 'float', DEFAULT: 0, _contextGate: { param: 'ghost', eq: 1 } },
    { NAME: 'bad2', TYPE: 'float', DEFAULT: 0, _contextGate: { eq: 1 } },
    { NAME: 'bad3', TYPE: 'float', DEFAULT: 0, _contextGate: { param: 'mode', anyOf: 3 } },
    { NAME: 'bad4', TYPE: 'float', DEFAULT: 0, _contextGate: { param: 'mode', eq: 1, not: 2 } },
    { NAME: 'bad5', TYPE: 'float', DEFAULT: 0,
      _contextGate: [{ param: 'mode', eq: 1 }, { param: 'ghost', eq: 1 }] },
    { NAME: 'bad6', TYPE: 'float', DEFAULT: 0, _opCompanion: 'ghost' }
  ] })));
  var c = codes(v.errors);
  t.ok(c.indexOf('gate-unknown-input') !== -1, 'dangling param caught');
  t.ok(c.indexOf('gate-no-param') !== -1, 'predicate without param caught');
  t.ok(c.indexOf('gate-bad-anyof') !== -1, 'non-array anyOf caught');
  t.ok(c.indexOf('gate-multiple-ops') !== -1, 'multiple operators caught');
  t.ok(c.indexOf('companion-unknown-input') !== -1, 'dangling companion caught');
  t.equal(v.errors.filter(function (e) { return e.code === 'gate-unknown-input'; }).length, 2,
    'the AND-array member is checked too');
  t.equal(v.errors.length, 6, 'no false positives on the five resolvable gates');
  t.end();
});

test('ISF2 V7: the shared camera-canon gate shapes validate', function (t) {
  // Verbatim shapes from app/js/formats/_camera-canon.js — the gate grammar's
  // heaviest real consumer. If these do not validate, the schema is wrong.
  var v = ISF2.validate(ISF2.parse(fs2({ INPUTS: [
    { NAME: 'iCamScope', TYPE: 'long', VALUES: [0, 1, 2], LABELS: ['scene', 'element', 'skybox'] },
    { NAME: 'iCamModel', TYPE: 'long', VALUES: [0, 1], LABELS: ['scene', 'plane'] },
    { NAME: 'iCamSpinMode', TYPE: 'long', VALUES: [0, 1], LABELS: ['off', 'on'] },
    { NAME: 'iCamPanX', TYPE: 'float', DEFAULT: 0, MIN: -1, MAX: 1, BIPOLAR: true,
      _contextGate: { param: 'iCamScope', not: 'skybox' } },
    { NAME: 'iCamRotX', TYPE: 'float', DEFAULT: 0, MIN: -90, MAX: 90, BIPOLAR: true,
      _contextGate: { param: 'iCamModel', eq: 'scene' } },
    { NAME: 'iCamTiltSpinX', TYPE: 'float', DEFAULT: 0, MIN: -6, MAX: 6, BIPOLAR: true,
      _contextGate: [{ param: 'iCamSpinMode', not: 0 }, { param: 'iCamModel', eq: 'scene' }] }
  ], A8_CAMERA: { mode: 'ray' } }, 'void main() { vec3 ro, rd; a8CameraRay(vec2(0.0), ro, rd); }\n')));
  t.equal(v.ok, true, 'camera-canon gates validate: ' + JSON.stringify(v.errors));
  t.end();
});

test('ISF2 V8: iCam* is reserved unless A8_CAMERA is declared', function (t) {
  var body = 'uniform float iCamZoom;\nvoid main() { gl_FragColor = vec4(iCamZoom); }\n';
  var bare = ISF2.validate(ISF2.parse(fs2({ INPUTS: [] }, body)));
  t.ok(codes(bare.errors).indexOf('icam-declared') !== -1, 'undeclared iCam* uniform caught');

  var declared = ISF2.validate(ISF2.parse(fs2({ INPUTS: [], A8_CAMERA: { mode: 'ray' } }, body)));
  t.equal(declared.ok, true, 'legal once A8_CAMERA is declared');
  t.ok(codes(declared.warnings).indexOf('camera-hook-missing') !== -1,
    'mode "ray" without an a8CameraRay call site warns');
  t.end();
});

test('ISF2 V8: A8_CAMERA ray hook present ⇒ no warning', function (t) {
  var body = 'void main() { vec3 ro, rd; a8CameraRay(vec2(0.0), ro, rd); gl_FragColor = vec4(rd, 1.0); }\n';
  var v = ISF2.validate(ISF2.parse(fs2({ INPUTS: [], A8_CAMERA: { mode: 'ray' } }, body)));
  t.equal(v.ok, true, 'ok');
  t.equal(codes(v.warnings).indexOf('camera-hook-missing'), -1, 'no hook warning');
  t.end();
});

// ---------------------------------------------------------------------------
// Error surface
// ---------------------------------------------------------------------------

test('ISF2: malformed input produces a typed, diagnosable error', function (t) {
  t.throws(function () { ISF2.parse(42); }, /must be a string/, 'non-string rejected');

  try {
    ISF2.parse('void main() { gl_FragColor = vec4(1.0); }');
    t.fail('should have thrown');
  } catch (e) {
    t.equal(e.name, 'ISF2Error', 'typed error');
    t.equal(e.code, ISF2.ERROR_CODES.NO_METADATA, 'no-metadata code');
    t.ok(/§3 F1/.test(e.message), 'message cites the rule');
  }

  try {
    ISF2.parse(assetLoad('bad-metadata.fs'));
    t.fail('should have thrown');
  } catch (e) {
    t.equal(e.name, 'ISF2Error', 'typed error');
    t.equal(e.code, ISF2.ERROR_CODES.METADATA_JSON, 'metadata-json code');
    t.equal(typeof e.line, 'number', 'carries a line number for the editor');
  }

  try {
    ISF2.parse('/*[1,2,3]*/\nvoid main() {}');
    t.fail('should have thrown');
  } catch (e) {
    t.equal(e.code, ISF2.ERROR_CODES.METADATA_NOT_OBJECT, 'non-object metadata rejected');
  }
  t.end();
});

test('ISF2 V1: lenient-only JSON is reported, not silently accepted (D7)', function (t) {
  // A raw tab inside a string: the vendored json_parse accepts it, strict JSON
  // does not. This is the common corpus shape (a tabbed DESCRIPTION).
  var m = ISF2.parse('/*{ "DESCRIPTION": "a\tb", "INPUTS": [] }*/\nvoid main() {}');
  t.ok(m.warnings.some(function (w) { return w.code === 'json-lenient'; }), 'raw control char flagged');
  var v = ISF2.validate(m);
  t.ok(v.warnings.some(function (w) { return w.rule === 'V1' && w.code === 'json-lenient'; }),
    'carried into validate as a V1 warning');
  t.equal(v.ok, true, 'consumers MAY be lenient — a warning, not an error');
  t.end();
});

test('ISF2 V1: JSON the extractor cannot decode is a typed error, not a warning', function (t) {
  // Trailing commas / single quotes / unquoted keys are rejected by the
  // vendored parser too — they must surface as a diagnosable parse failure.
  ['/*{ "INPUTS": [], }*/\nvoid main() {}',
    "/*{ 'INPUTS': [] }*/\nvoid main() {}",
    '/*{ INPUTS: [] }*/\nvoid main() {}'].forEach(function (src) {
    try {
      ISF2.parse(src);
      t.fail('should have thrown for ' + JSON.stringify(src.slice(0, 24)));
    } catch (e) {
      t.equal(e.code, ISF2.ERROR_CODES.METADATA_JSON, 'metadata-json error for ' + JSON.stringify(src.slice(2, 22)));
    }
  });
  t.end();
});

test('ISF2: validate() rejects a non-model politely', function (t) {
  var v = ISF2.validate(null);
  t.equal(v.ok, false, 'not ok');
  t.equal(v.errors[0].code, 'no-model', 'clear code');
  t.end();
});

// ---------------------------------------------------------------------------
// emit — standard §9.2 E1-E4, §11 (fork Update 7, G2.3 Stage 4)
// ---------------------------------------------------------------------------

// A hand-authored header: idiosyncratic indentation, an unknown top-level key,
// an unknown per-input field, a legacy _glyOp* spelling, and a number spelled
// `1.0` — every feature a naive re-serializing emitter would silently destroy.
var HAND_AUTHORED = [
  '/*{',
  '    "ISFVSN": "2",',
  '    "DESCRIPTION": "hand authored",',
  '    "VENDOR_PRIVATE": { "keep": [1, 2, 3] },',
  '    "INPUTS": [',
  '        {',
  '            "NAME": "amount",  "TYPE": "float",',
  '            "DEFAULT": 1.0, "MIN": 0.0, "MAX": 2.0,',
  '            "_glyOp": true, "_glyOpIdentity": 1.0,',
  '            "_futureField": "reserved"',
  '        }',
  '    ]',
  '}*/',
  '',
  'void main() { gl_FragColor = vec4(amount); }',
  ''].join('\n');

test('ISF2 E2: emit(parse(x)) === x on the classic fixtures', function (t) {
  ['generator.fs', 'image-filter.fs', 'transition.fs', 'version1_basic.fs',
    'persistent-buffers.fs', 'time-glitch.fs', 'img_pixel_isf.fs', 'img_norm_pixel_isf.fs'].forEach(function (name) {
    var src = assetLoad(name);
    t.equal(ISF2.emit(ISF2.parse(src)), src, name + ': byte-identical round trip');
  });
  t.end();
});

test('ISF2 E2/E3: a hand-authored header round-trips byte-for-byte', function (t) {
  var m = ISF2.parse(HAND_AUTHORED);
  t.equal(ISF2.emit(m), HAND_AUTHORED, 'byte-identical');
  t.equal(m.meta.VENDOR_PRIVATE.keep.length, 3, 'unknown top-level key survives on the model (E3)');
  t.equal(m.a8.ui.amount.op, true, 'legacy _glyOp read as the neutral op field');
  t.ok(m.a8.ui.amount.unknown._futureField, 'unknown per-input field preserved (E3)');
  t.end();
});

test('ISF2 N5: lenient JSON round-trips byte-exact and is NOT repaired', function (t) {
  var src = '/*{ "ISFVSN": "2", "DESCRIPTION": "tab\there" }*/\nvoid main() {}';
  var m = ISF2.parse(src);
  t.ok(m.warnings.some(function (w) { return w.code === 'json-lenient'; }), 'flagged as lenient');
  t.equal(ISF2.emit(m), src, 'default path preserves the file byte-for-byte, leniency included');
  var canonical = ISF2.emit(m, { canonical: true });
  t.notEqual(canonical, src, 'canonical:true re-serializes');
  t.ok(canonical.indexOf('\\t') !== -1, 'and repairs the raw control character to strict JSON');
  var strict = canonical.substring(canonical.indexOf('/*') + 2, canonical.indexOf('*/'));
  t.doesNotThrow(function () { JSON.parse(strict); }, 'canonical output is strict-JSON parseable');
  t.end();
});

test('ISF2 N1/N4: an added key is appended last; nothing before it moves', function (t) {
  var m = ISF2.parse(HAND_AUTHORED);
  ISF2.setExtension(m, 'A8_PROVENANCE', {
    version: '1.0',
    origin: { source: 'user', license: 'MIT' },
    chain: [{ action: 'create', timestamp: 1, by: 'test', contentHash: 'ff' }],
  });
  var out = ISF2.emit(m);
  t.ok(out.indexOf('"A8_PROVENANCE"') !== -1, 'key emitted');
  t.equal(out.substring(out.length - m.body.length), m.body, 'body byte-identical (N8)');
  t.ok(out.indexOf('"VENDOR_PRIVATE"') < out.indexOf('"A8_PROVENANCE"'), 'appended AFTER every original key');
  t.ok(out.indexOf(HAND_AUTHORED.substring(0, HAND_AUTHORED.indexOf('"INPUTS"'))) === 0,
    'every byte before the insertion point is unchanged');
  // Removing it again must reproduce the original exactly — the strongest
  // statement of "additive emission perturbs nothing".
  var m2 = ISF2.parse(out);
  ISF2.setExtension(m2, 'A8_PROVENANCE', undefined);
  t.equal(ISF2.emit(m2), HAND_AUTHORED, 'add-then-remove reproduces the source byte-for-byte (N3)');
  t.end();
});

test('ISF2 N2: a changed key keeps its position; only its value is re-serialized', function (t) {
  var m = ISF2.parse(HAND_AUTHORED);
  m.meta.DESCRIPTION = 'changed';
  var out = ISF2.emit(m);
  var keys = out.substring(0, out.indexOf('*/')).match(/"[A-Z_]+":/g);
  t.deepEqual(keys.slice(0, 3), ['"ISFVSN":', '"DESCRIPTION":', '"VENDOR_PRIVATE":'], 'key ORDER unchanged (N4)');
  t.ok(out.indexOf('"DESCRIPTION": "changed"') !== -1, 'new value emitted');
  t.ok(out.indexOf('"MIN": 0.0') !== -1, 'untouched keys keep their author spelling (0.0 not 0)');
  t.equal(ISF2.parse(out).meta.VENDOR_PRIVATE.keep.length, 3, 'unknown key still intact');
  t.end();
});

test('ISF2 N6: legacy _glyOp* spellings are never rewritten on emit', function (t) {
  var m = ISF2.parse(HAND_AUTHORED);
  m.meta.DESCRIPTION = 'force a re-emit';
  var out = ISF2.emit(m);
  t.ok(out.indexOf('"_glyOp"') !== -1, 'legacy spelling survives (E2 for the 220 baked files)');
  t.ok(out.indexOf('"_op"') === -1, 'emit does not silently migrate it');
  t.end();
});

test('ISF2 N7: array layout — scalars inline, structured one per line', function (t) {
  var m = ISF2.parse('/*{ "ISFVSN": "2" }*/\nvoid main() {}');
  m.meta.CATEGORIES = ['Generator', 'Test'];
  m.meta.A8_ANIMATE = [{ input: 'x', curve: 'sine', rate: 1, depth: 1 }];
  var out = ISF2.emit(m);
  t.ok(out.indexOf('["Generator", "Test"]') !== -1, 'all-scalar array inline');
  t.ok(/"A8_ANIMATE": \[\n/.test(out), 'array of objects broken across lines');
  t.end();
});

test('ISF2 E1: from-scratch emit (a model with no retained text) is header-first strict JSON', function (t) {
  var m = { meta: { ISFVSN: '2', INPUTS: [] }, body: '\nvoid main() {}\n' };
  var out = ISF2.emit(m);
  t.equal(out.indexOf('/*{'), 0, 'metadata block is the first thing in the file (E1/F1)');
  var strict = out.substring(2, out.indexOf('*/'));
  t.doesNotThrow(function () { JSON.parse(strict); }, 'strict JSON (F2)');
  t.equal(out.substring(out.indexOf('*/') + 2), '\nvoid main() {}\n', 'body verbatim (N8)');
  t.equal(ISF2.emit(ISF2.parse(out)), out, 'and the result is itself byte-stable');
  t.end();
});

test('ISF2: text before the header and a modified body are both preserved verbatim', function (t) {
  var src = '// leading line comment\n/*{ "ISFVSN": "2" }*/\nvoid main() {}';
  var m = ISF2.parse(src);
  t.equal(ISF2.emit(m), src, 'prefix preserved byte-for-byte');
  m.body = '\nvoid main() { gl_FragColor = vec4(0.0); }\n';
  t.equal(ISF2.emit(m).substring(src.indexOf('*/') + 2), m.body, 'caller-supplied body used verbatim');
  t.end();
});

test('ISF2: model.meta is the write surface; setExtension refreshes the derived view', function (t) {
  var m = ISF2.parse(fs2({ ISFVSN: '2', INPUTS: [] }));
  m.a8.camera = { mode: 'ray' };                       // writing the VIEW alone
  t.equal(ISF2.parse(ISF2.emit(m)).meta.A8_CAMERA, undefined, 'view writes are NOT emitted');
  ISF2.setExtension(m, 'A8_CAMERA', { mode: 'ray' });
  t.deepEqual(m.a8.camera, { mode: 'ray' }, 'setExtension refreshes the view');
  t.deepEqual(ISF2.parse(ISF2.emit(m)).meta.A8_CAMERA, { mode: 'ray' }, 'and IS emitted');
  t.equal(m.a8.isISF2, true, 'the file is now an ISF2 file');
  try {
    ISF2.setExtension(m, 'DESCRIPTION', 'x');
    t.fail('should refuse a non-extension key');
  } catch (e) {
    t.equal(e.code, ISF2.ERROR_CODES.EMIT_NOT_EXTENSION_KEY, 'non-A8 keys are written on meta directly');
  }
  t.end();
});

test('ISF2 E4: provenance is appended, never rewritten', function (t) {
  var m = ISF2.parse(fs2(FULL));
  var first = m.meta.A8_PROVENANCE.chain[0];
  ISF2.appendProvenanceEvent(m, { action: 'rebake', timestamp: 2, by: 'Opus 4.8', contentHash: 'aa' });
  var chain = ISF2.parse(ISF2.emit(m)).meta.A8_PROVENANCE.chain;
  t.equal(chain.length, 2, 'event appended');
  t.deepEqual(chain[0], first, 'the original event is byte-for-byte unchanged (P1)');
  t.equal(chain[1].action, 'rebake', 'new event last');
  ['action', 'timestamp', 'by', 'contentHash'].forEach(function (f) {
    var ev = { action: 'x', timestamp: 1, by: 'y', contentHash: 'z' };
    delete ev[f];
    try {
      ISF2.appendProvenanceEvent(m, ev);
      t.fail('should require ' + f);
    } catch (e) { t.ok(e.isISF2Error, 'missing ' + f + ' rejected (V5)'); }
  });
  var bare = ISF2.parse(fs2({ ISFVSN: '2' }));
  try {
    ISF2.appendProvenanceEvent(bare, { action: 'x', timestamp: 1, by: 'y', contentHash: 'z' });
    t.fail('should refuse to invent an origin');
  } catch (e) { t.equal(e.code, ISF2.ERROR_CODES.EMIT_NO_PROVENANCE, 'no implicit provenance block'); }
  t.end();
});

test('ISF2: emit rejects what cannot be a metadata block', function (t) {
  try { ISF2.emit(null); t.fail('null'); } catch (e) { t.equal(e.code, ISF2.ERROR_CODES.EMIT_NO_MODEL, 'no model'); }
  try { ISF2.emit({ meta: [] }); t.fail('array'); } catch (e) { t.equal(e.code, ISF2.ERROR_CODES.EMIT_NO_META, 'meta must be an object'); }
  var m = ISF2.parse(fs2({ ISFVSN: '2' }));
  m.meta.BROKEN = Infinity;
  try { ISF2.emit(m); t.fail('Infinity'); } catch (e) { t.equal(e.code, ISF2.ERROR_CODES.EMIT_UNSERIALIZABLE, 'non-finite number refused'); }
  t.end();
});

test('ISF2: emitted output re-parses to an equivalent model, and is idempotent', function (t) {
  var m = ISF2.parse(fs2(FULL));
  var out = ISF2.emit(m);
  var m2 = ISF2.parse(out);
  t.deepEqual(m2.meta, m.meta, 'metadata equivalent');
  t.equal(m2.body, m.body, 'body equivalent');
  t.deepEqual(m2.a8.ui, m.a8.ui, 'extension view equivalent');
  t.equal(ISF2.emit(m2), out, 'emit is idempotent');
  t.equal(ISF2.validate(m2).ok, true, 'and still validates');
  t.end();
});
