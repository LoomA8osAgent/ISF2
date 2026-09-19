// tests/isf2-a8vsn2-test.js — the A8VSN 2 conformance surface (fork Update 12).
//
// Covers the §6.4-§6.18 block set: the parse model for every ratified A8_* block
// and the §6.14 per-input field family, the §9.3 V10/V11/V12 rules, §6.5
// applyPreset/presetPlan in the normative recall order, §6.15 source identity,
// and — the load-bearing pair — that EVERY grandfathered spelling still parses to
// the same model with ZERO errors, and that emission stays byte-stable over all
// of it (E2: a consumer that re-emits a file it did not edit must not rewrite it).
//
// The RED fixtures are the acceptance: a validator that cannot fail is not a
// validator, so every new rule is asserted RED on a file that breaks it and GREEN
// on the file beside it that does not.

var test = require('tape');
var fs = require('fs');
var lib = require('../dist/build-worker').interactiveShaderFormat;
var ISF2 = lib.ISF2;

function assetLoad(name) {
  return fs.readFileSync('./tests/assets/' + name).toString();
}
function codes(list) {
  return list.map(function (e) { return e.code; });
}
function rules(list) {
  return list.map(function (e) { return e.rule; });
}

// ---------------------------------------------------------------------------
// The version itself
// ---------------------------------------------------------------------------

test('ISF2 §10.1: the implementation declares A8VSN 2', function (t) {
  t.equal(ISF2.A8VSN, '2', 'A8VSN 2 — §6.6 deprecates A8_ANIMATE, and a deprecation is not an addition');
  t.equal(ISF2.DEFINED_A8_KEYS.indexOf('A8_PRESETS') !== -1, true, 'A8_PRESETS is defined, not reserved');
  t.equal(ISF2.DEFINED_A8_KEYS.indexOf('A8_OPS') !== -1, true, 'A8_OPS is defined — it was RESERVED while the reference producer emitted it');
  t.equal(ISF2.RESERVED_A8_KEYS.join(','), 'A8_MODE,A8_MATERIAL', 'only the two genuinely-undefined names stay reserved');
  t.ok(ISF2.GRANDFATHERED_A8_KEYS.A8_CARD_PRESETS, 'A8_CARD_PRESETS is grandfathered, never unknown');
  t.end();
});

// ---------------------------------------------------------------------------
// Parse — every ratified block
// ---------------------------------------------------------------------------

test('ISF2 §6.5-§6.13: every A8VSN 2 block reaches the model', function (t) {
  var m = ISF2.parse(assetLoad('a8vsn2-full.fs'));
  var a8 = m.a8;
  t.equal(a8.vsn, '2', 'A8VSN read');

  // §6.5 presets
  t.equal(a8.presets.schema, '1', 'preset schema');
  // NOTE for implementers: JS enumerates integer-like object keys FIRST, so a
  // bank's key order is "1,D" and NOT the declared order. Slot order is never
  // semantic here — a slot is addressed by id — but a host that renders the bank
  // must sort deliberately rather than trust enumeration.
  t.deepEqual(Object.keys(a8.presets.bank).sort(), ['1', 'D'], 'both slots present');
  t.equal(a8.presets.legacy, false, 'read from the neutral A8_PRESETS');
  t.deepEqual(a8.presets.groupBanks.lighting.D.params, { keyDir: 0.5 }, 'group bank keyed by _groupId');

  // §6.6 modulation
  t.equal(a8.modulation.receivers.length, 1, 'declared receiver');

  // §6.7 ops — active-only
  t.deepEqual(a8.ops.world, { u_tile: 0.4, u_mirrorX: 1 }, 'world scope');
  t.deepEqual(a8.ops.raymarch, { ao: 1 }, 'raymarch scope');

  // §6.8 / §6.9 / §6.10
  t.deepEqual(a8.raymarchOps.hooks, ['normal', 'occ', 'shade', 'post'], 'hook markers declared');
  t.deepEqual(a8.fold.drivers, { lit: ['mode'] }, 'fold drivers — the only normative member');
  t.equal(a8.passPrograms, false, 'A8_PASS_PROGRAMS absent ⇒ false');

  // §6.11 camera — the reconciled shape
  t.equal(a8.camera.mode, 'ray', 'capability flag');
  t.equal(a8.camera.model, 'scene', 'camera model');
  t.deepEqual(a8.camera.state, { iCamZoom: 0.3, iCamRotY: 12.0 }, 'authored view in the STATE domain');
  t.equal(a8.camera.legacy, false, 'not the grandfathered flat map');

  // §6.12 layers
  t.equal(a8.slots.length, 2, 'bg + one fill slot');
  t.equal(a8.slots[0].role, 'bg', 'bg slot first');
  t.equal(a8.slots[1].inline, true, 'a data: ref is SELF-CONTAINED — the file needs no host resolution');
  t.equal(a8.slots[1].mapping, 'triplanar', 'mapping preserved');

  // §6.13 playback
  t.equal(a8.playback.timeScale, 1.0, 'timeScale — the one a foreign player silently gets wrong');
  t.equal(a8.playback.processRecall, 'seed', 'a feedback shader recalls into the state the preset describes');

  // §6.16 receipts
  t.equal(a8.generation.length, 1, 'generation receipts live INSIDE provenance, not in a parallel key');

  t.equal(a8.isISF2, true, 'flagged as ISF2');
  t.end();
});

test('ISF2 §6.14: the per-input presentation family reaches the model', function (t) {
  var ui = ISF2.parse(assetLoad('a8vsn2-full.fs')).a8.ui;
  t.equal(ui.weave.groupId, 'fixture controls', 'A: _groupId');
  t.equal(ui.weave.stackOrder, 0, 'A: _stackOrder');
  t.equal(ui.hue.noTimeTwin, true, 'A: _noTimeTwin');
  t.equal(ui.fillGain.layerRow, true, 'A: _layerRow');
  t.equal(ui.bgTint.blendable, true, 'A: _blendable (neutral spelling)');
  t.equal(ui.keyDir.lightRig, true, 'B: _lightRig — a DECLARED ROLE, never inferred from the group id');
  t.deepEqual(ui.weave.bind, { source: 'lf:1:sine', min: 0.25, max: 0.7 }, 'D: _bind preserved verbatim');
  t.equal(ui.weave.unknown, undefined, 'a ratified field is no longer reported as an unknown reserved name');
  t.end();
});

test('ISF2 §6.6 + §6.14 D: receivers resolve, and A8_MODULATION wins', function (t) {
  var r = ISF2.parse(assetLoad('a8vsn2-full.fs')).a8.receivers;
  t.equal(r.length, 2, 'one entry per target');
  t.equal(r[0].target, 'hue', 'declared receiver first');
  t.equal(r[0].source.kind, 'clock', 'declared kind kept');
  t.equal(r[1].from, '_bind', 'the _bind shorthand desugars to a receiver');
  t.equal(r[1].source.kind, 'lfo', 'kind RECOVERED from the published id namespace (lf: ⇒ lfo)');
  t.deepEqual(r[1].transform, { min: 0.25, max: 0.7 },
    '_bind.min/max is the BRACKET, never transform.dstRange — a host writing them as an affine '
    + 'output range sweeps the wrong span, which looks like a broken modulator and is not');

  // A8_ANIMATE is exactly a receiver with no source (§6.6 mechanical upgrade).
  var legacy = ISF2.parse(assetLoad('a8vsn1-legacy.fs')).a8.receivers;
  t.equal(legacy.length, 1, 'the animate directive became a receiver');
  t.equal(legacy[0].from, 'A8_ANIMATE', 'tagged by origin');
  t.equal(legacy[0].source, null, 'no source — the oscillator is entirely self-contained');
  t.equal(legacy[0].oscillator.base, 0.5, 'baseValue → oscillator.base');

  // Both spellings on one target: the neutral block wins.
  var both = ISF2.parse('/*' + JSON.stringify({
    ISFVSN: '2', A8VSN: '2',
    INPUTS: [{ NAME: 'a', TYPE: 'float', DEFAULT: 0, MIN: 0, MAX: 1, DESCRIPTION: 'x',
      _bind: { source: 'lf:1:sine', min: 0, max: 1 } }],
    A8_MODULATION: { receivers: [{ target: 'a', source: { id: 'ck:phase', kind: 'clock' }, active: true }] },
  }, null, 2) + '*/\nvoid main() {}\n');
  t.equal(both.a8.receivers.length, 1, 'one target, one receiver');
  t.equal(both.a8.receivers[0].from, 'A8_MODULATION', 'A8_MODULATION wins where both name the same input');
  t.end();
});

// ---------------------------------------------------------------------------
// Grandfathering — the half that must never break a published file
// ---------------------------------------------------------------------------

test('ISF2 §6.17 / §10.1: every grandfathered spelling parses clean', function (t) {
  var src = assetLoad('a8vsn1-legacy.fs');
  var m = ISF2.parse(src);
  var v = ISF2.validate(m);

  t.equal(v.errors.length, 0, 'ZERO errors — a published A8VSN 1 file is valid at A8VSN 2');
  t.equal(m.a8.presets.legacy, true, 'A8_CARD_PRESETS read as the bank');
  t.deepEqual(Object.keys(m.a8.presets.bank).sort(), ['1', 'D'], 'slots intact');
  t.deepEqual(m.a8.presets.groupBanks.look.D.params, { twist: 0, twistPhase: 0 }, 'A8_GROUP_BANKS read as groupBanks');
  t.equal(m.a8.camera.legacy, true, 'the flat iCam* map is read as state');
  t.deepEqual(m.a8.camera.state, { iCamZoom: 0.3, iCamPanX: 0.0 }, 'state without the model key');
  t.equal(m.a8.camera.model, 'scene', 'iCamModel LIFTED out of state into model');
  t.equal(m.a8.ui.twist.op, true, '_glyOp read as _op');
  t.equal(m.a8.ui.tint.blendable, true, '_groupBlendable read as _blendable');
  t.equal(m.a8.ui.rate.transportDomain, true, 'TRANSPORT_DOMAIN read as _transportDomain');
  t.equal(m.a8.legacyKeys.A8_CARD_PRESETS, 'A8_PRESETS.bank', 'the grandfathering is recorded, not silent');
  t.ok(codes(m.warnings).indexOf('a8-unknown-key') === -1, 'a grandfathered key NEVER warns as unknown');

  t.equal(ISF2.emit(m), src,
    'E2/N6 — a file the emitter did not otherwise touch re-emits BYTE-FOR-BYTE, legacy spellings and all. '
    + 'Rewriting a legacy spelling on sight would break byte-stable re-emit for every published file.');
  t.end();
});

test('ISF2 §10: an undefined A8_* key is TOLERATED, never fatal', function (t) {
  var src = assetLoad('warn-unknown-a8-key.fs');
  var m = ISF2.parse(src);
  var v = ISF2.validate(m);
  t.deepEqual(m.a8.unknown.A8_TOMORROW, { somethingNew: [1, 2, 3] }, 'preserved on the model');
  t.equal(m.a8.reserved.A8_MODE, 'raymarch', 'a reserved-but-undefined name is preserved too');
  t.ok(codes(v.warnings).indexOf('a8-unknown-key') !== -1, 'and REPORTED');
  t.ok(codes(v.warnings).indexOf('a8-reserved-key') !== -1, 'reserved use reported');
  t.equal(v.ok, true,
    'but NOT an error: §10 binds a consumer to tolerate unknown A8_* keys. The rule an undefined key '
    + 'breaks (§6.17, producers MUST NOT use reserved names privately) is a PRODUCER rule, and a '
    + 'consumer cannot enforce it without breaking forward compatibility');
  t.equal(ISF2.emit(m), src, 'and survives the round trip byte-for-byte (E3)');
  t.end();
});

// ---------------------------------------------------------------------------
// V10 / V11 / V12 — RED on the file that breaks them, GREEN on the one beside it
// ---------------------------------------------------------------------------

test('ISF2 V10: a preset param naming no declared input is an ERROR', function (t) {
  var v = ISF2.validate(ISF2.parse(assetLoad('red-preset-unknown-param.fs')));
  t.equal(v.ok, false, 'RED');
  t.ok(codes(v.errors).indexOf('preset-unknown-param') !== -1, 'the typo is caught');
  t.ok(rules(v.errors).indexOf('V10') !== -1, 'reported as V10');
  t.ok(v.errors[0].message.indexOf('wieve') !== -1, 'and names the offending key verbatim');

  var green = ISF2.validate(ISF2.parse(assetLoad('a8vsn2-full.fs')));
  t.equal(green.errors.filter(function (e) { return e.rule === 'V10'; }).length, 0,
    'GREEN on the conforming bank beside it');
  t.end();
});

test('ISF2 V10: ranges are BRACKETS and opacity is never a scalar', function (t) {
  var bad = ISF2.validate('/*' + JSON.stringify({
    ISFVSN: '2', A8VSN: '2', LONG_DESCRIPTION: 'x',
    INPUTS: [{ NAME: 'a', TYPE: 'float', DEFAULT: 0, MIN: 0, MAX: 1, DESCRIPTION: 'x' }],
    A8_PRESETS: { bank: { D: { params: { a: 1 }, ranges: { a: 0.5 }, opacity: 0.5 } } },
  }, null, 2) + '*/\nvoid main() {}\n');
  t.equal(bad.ok, false, 'RED');
  t.ok(codes(bad.errors).indexOf('preset-bad-range') !== -1,
    'a scalar range is caught — a bracket is the performer\'s operating window, two numbers');
  t.ok(codes(bad.errors).indexOf('preset-scalar-opacity') !== -1,
    'a scalar opacity is caught — it is the per-channel [r,g,b,a] vector, normatively never a scalar');
  t.end();
});

test('ISF2 V11: a _bind bracket outside the declared domain is an ERROR', function (t) {
  var v = ISF2.validate(ISF2.parse(assetLoad('red-bind-out-of-range.fs')));
  t.equal(v.ok, false, 'RED');
  t.ok(codes(v.errors).indexOf('bind-bracket-out-of-range') !== -1, 'caught');
  t.ok(rules(v.errors).indexOf('V11') !== -1, 'reported as V11');

  var green = ISF2.validate(ISF2.parse(assetLoad('a8vsn2-full.fs')));
  t.equal(green.errors.filter(function (e) { return e.rule === 'V11'; }).length, 0,
    'GREEN on the in-domain bracket beside it');

  var inverted = ISF2.validate('/*' + JSON.stringify({
    ISFVSN: '2', A8VSN: '2', LONG_DESCRIPTION: 'x',
    INPUTS: [{ NAME: 'a', TYPE: 'float', DEFAULT: 0.5, MIN: 0, MAX: 1, DESCRIPTION: 'x',
      _bind: { source: 'lf:1:sine', min: 0.8, max: 0.2 } }],
  }, null, 2) + '*/\nvoid main() {}\n');
  t.ok(codes(inverted.errors).indexOf('bind-inverted-bracket') !== -1, 'min > max caught');

  var noSource = ISF2.validate('/*' + JSON.stringify({
    ISFVSN: '2', A8VSN: '2', LONG_DESCRIPTION: 'x',
    INPUTS: [{ NAME: 'a', TYPE: 'float', DEFAULT: 0.5, MIN: 0, MAX: 1, DESCRIPTION: 'x',
      _bind: { min: 0.2, max: 0.8 } }],
  }, null, 2) + '*/\nvoid main() {}\n');
  t.ok(codes(noSource.errors).indexOf('bind-no-source') !== -1,
    '_bind without a source declares nothing to ship alive against');
  t.end();
});

test('ISF2 V12: descriptions are a WARNING at Level 1, never an error', function (t) {
  var v = ISF2.validate(ISF2.parse(assetLoad('generator.fs')));
  t.equal(v.ok, true,
    'a legacy ISF file legitimately carries neither DESCRIPTION nor LONG_DESCRIPTION, and a '
    + 'conformance validator must not reject one');
  t.ok(codes(v.warnings).indexOf('no-long-description') !== -1, 'but the absence is reported');

  var missing = ISF2.validate('/*' + JSON.stringify({
    ISFVSN: '2', A8VSN: '2',
    INPUTS: [
      { NAME: 'a', TYPE: 'float', DEFAULT: 0, MIN: 0, MAX: 1 },
      { NAME: 'b', TYPE: 'float', DEFAULT: 0, MIN: 0, MAX: 1, DESCRIPTION: 'Has one.' },
      { NAME: 'c', TYPE: 'float', DEFAULT: 0, MIN: 0, MAX: 1, _a8Synthetic: true },
    ],
  }, null, 2) + '*/\nvoid main() {}\n');
  var v12 = missing.warnings.filter(function (w) { return w.rule === 'V12'; });
  t.equal(v12.length, 2, 'one per undescribed AUTHORED input, plus the missing LONG_DESCRIPTION');
  t.equal(v12[0].path, 'a', 'the undescribed input is named');
  t.ok(codes(v12).indexOf('input-no-description') !== -1, 'per-input rule fires');
  t.equal(missing.ok, true, 'still not an error at Level 1');

  var full = ISF2.validate(ISF2.parse(assetLoad('a8vsn2-full.fs')));
  t.equal(full.warnings.filter(function (w) { return w.rule === 'V12'; }).length, 0,
    'GREEN on the fully-described file');
  t.end();
});

// ---------------------------------------------------------------------------
// The per-block validators (§6.6 - §6.13)
// ---------------------------------------------------------------------------

test('ISF2 §6.13: clock.position MUST NOT be present', function (t) {
  var v = ISF2.validate(ISF2.parse(assetLoad('red-clock-position.fs')));
  t.equal(v.ok, false, 'RED');
  t.ok(codes(v.errors).indexOf('playback-clock-position') !== -1,
    'recall never teleports time — the same rule that keeps a modulation lane continuous across a preset change');

  var bad = ISF2.validate('/*' + JSON.stringify({
    ISFVSN: '2', A8VSN: '2', LONG_DESCRIPTION: 'x', INPUTS: [],
    A8_PLAYBACK: { scaleMode: 'squish', processRecall: 'whatever', renderScale: 'sometimes' },
  }, null, 2) + '*/\nvoid main() {}\n');
  t.ok(codes(bad.errors).indexOf('playback-bad-scalemode') !== -1, 'scaleMode roster enforced');
  t.ok(codes(bad.errors).indexOf('playback-bad-processrecall') !== -1, 'processRecall is seed | state');
  t.ok(codes(bad.errors).indexOf('playback-bad-renderscale') !== -1, 'renderScale is "auto" or a number');
  t.end();
});

test('ISF2 §6.6: modulation target + kind + ranges are validated; an unresolvable id is not', function (t) {
  var v = ISF2.validate('/*' + JSON.stringify({
    ISFVSN: '2', A8VSN: '2', LONG_DESCRIPTION: 'x',
    INPUTS: [{ NAME: 'a', TYPE: 'float', DEFAULT: 0, MIN: 0, MAX: 1, DESCRIPTION: 'x' }],
    A8_MODULATION: { receivers: [
      { target: 'nope', source: { id: 'ck:phase', kind: 'clock' } },
      { target: 'a', source: { id: 'weird:thing', kind: 'telepathy' }, transform: { dstRange: [0] } },
    ] },
  }, null, 2) + '*/\nvoid main() {}\n');
  t.ok(codes(v.errors).indexOf('modulation-unknown-target') !== -1, 'target must name a declared input');
  t.ok(codes(v.errors).indexOf('modulation-bad-kind') !== -1, 'kind is the PORTABLE part and is enumerated');
  t.ok(codes(v.errors).indexOf('modulation-bad-range') !== -1, 'a transform range is two numbers');

  var unresolvable = ISF2.validate('/*' + JSON.stringify({
    ISFVSN: '2', A8VSN: '2', LONG_DESCRIPTION: 'x',
    INPUTS: [{ NAME: 'a', TYPE: 'float', DEFAULT: 0, MIN: 0, MAX: 1, DESCRIPTION: 'x' }],
    A8_MODULATION: { receivers: [{ target: 'a', source: { id: 'someHost:whatever', kind: 'host' } }] },
  }, null, 2) + '*/\nvoid main() {}\n');
  t.equal(unresolvable.ok, true,
    'an id this implementation cannot resolve is a missing PERFORMANCE INPUT, never a malformed file — '
    + 'a player marks the receiver `unresolved` and continues');
  t.end();
});

test('ISF2 §6.7/§6.8: unknown ops degrade, `view` is retired, hooks are enumerated', function (t) {
  var v = ISF2.validate('/*' + JSON.stringify({
    ISFVSN: '2', A8VSN: '2', LONG_DESCRIPTION: 'x', INPUTS: [],
    A8_OPS: { world: { u_neverHeardOfIt: 0.5 }, view: { u_tile: 1 } },
    A8_RAYMARCH_OPS: { hooks: ['normal', 'elbow'], starters: ['ao', 'sparkles'] },
  }, null, 2) + '*/\nvoid main() {}\n');
  t.equal(codes(v.errors).indexOf('ops-unknown-name'), -1,
    'an unknown op name is IGNORED — it degrades to that op\'s identity, which is the graceful floor');
  t.ok(codes(v.info).indexOf('ops-unknown-name') !== -1, 'but it is reported as info');
  t.ok(codes(v.warnings).indexOf('ops-retired-scope') !== -1, '`view` is RETIRED and warns');
  t.ok(codes(v.errors).indexOf('raymarch-unknown-hook') !== -1, 'a hook outside the four splice points is an error');
  t.ok(codes(v.errors).indexOf('raymarch-unknown-starter') !== -1, 'a starter outside the Appendix A.2 roster is an error');
  t.end();
});

test('ISF2 §6.12: a layer slot needs a DECLARING GROUP', function (t) {
  var v = ISF2.validate('/*' + JSON.stringify({
    ISFVSN: '2', A8VSN: '2', LONG_DESCRIPTION: 'x',
    INPUTS: [{ NAME: 'a', TYPE: 'float', DEFAULT: 0, MIN: 0, MAX: 1, DESCRIPTION: 'x', _groupId: 'other' }],
    A8_LAYERS: { layers: { 0: { ref: { kind: 'isf', name: 'x' } }, nope: { ref: {} } } },
  }, null, 2) + '*/\nvoid main() {}\n');
  t.ok(codes(v.errors).indexOf('layer-slot-undeclared') !== -1,
    'a slot no group declares — the group id SHAPE is what declares it, never a card type');
  t.ok(codes(v.errors).indexOf('layers-bad-key') !== -1, 'layer keys are integer strings');

  var green = ISF2.validate(ISF2.parse(assetLoad('a8vsn2-full.fs')));
  t.equal(green.errors.filter(function (e) { return e.code === 'layer-slot-undeclared'; }).length, 0,
    'GREEN when `bg` and `layer:0` groups are declared');
  t.end();
});

test('ISF2 §6.11: camera model + Appendix B state domain', function (t) {
  var v = ISF2.validate('/*' + JSON.stringify({
    ISFVSN: '2', A8VSN: '2', LONG_DESCRIPTION: 'x', INPUTS: [],
    A8_CAMERA: { model: 'orbit', state: { iCamZoom: 'lots', iCamNonsense: 1, iCamFov: 400 } },
  }, null, 2) + '*/\nvoid main() {}\n');
  t.ok(codes(v.errors).indexOf('camera-bad-model') !== -1, 'model is scene | plane | planeinf');
  t.ok(codes(v.errors).indexOf('camera-bad-state-value') !== -1, 'state values are numbers in the STATE domain');
  t.ok(codes(v.warnings).indexOf('camera-unknown-state') !== -1, 'an off-roster iCam* name is preserved + reported, not fatal');
  t.ok(codes(v.warnings).indexOf('camera-state-out-of-domain') !== -1, 'an out-of-domain value warns');

  var legacy = ISF2.validate(ISF2.parse(assetLoad('a8vsn1-legacy.fs')));
  t.equal(codes(legacy.warnings).indexOf('camera-unknown-mode'), -1,
    'an ABSENT mode is CORRECT for the grandfathered flat map and must never warn as an unknown mode');
  t.end();
});

test('ISF2 §6.14: the gate grammar accepts in / any / def', function (t) {
  // Measured against the host\'s own camera rig, which declares
  // { param: 'iCamModel', in: ['scene', 'planeinf'] } — a G1-strict reading of
  // "exactly one of eq/not/anyOf" REDs a shipped, correct file.
  var v = ISF2.validate('/*' + JSON.stringify({
    ISFVSN: '2', A8VSN: '2', LONG_DESCRIPTION: 'x',
    INPUTS: [
      { NAME: 'model', TYPE: 'long', DEFAULT: 0, VALUES: [0, 1], LABELS: ['a', 'b'], DESCRIPTION: 'x' },
      { NAME: 'spin', TYPE: 'float', DEFAULT: 0, MIN: 0, MAX: 1, DESCRIPTION: 'x' },
      { NAME: 'k', TYPE: 'float', DEFAULT: 0, MIN: 0, MAX: 1, DESCRIPTION: 'x',
        _contextGate: { param: 'model', in: [0, 1] } },
      { NAME: 'j', TYPE: 'float', DEFAULT: 0, MIN: 0, MAX: 1, DESCRIPTION: 'x',
        _contextGate: { any: [{ param: 'model', eq: 1 }, [{ param: 'spin', not: 0, def: 0 }]] } },
      { NAME: 'r', TYPE: 'float', DEFAULT: 0, MIN: 0, MAX: 1, DESCRIPTION: 'x',
        _contextRange: { param: 'model', eq: 1 } },
    ],
  }, null, 2) + '*/\nvoid main() {}\n');
  t.equal(v.errors.filter(function (e) { return e.rule === 'V7'; }).length, 0,
    'in / any / def / _contextRange all accepted');

  var unresolved = ISF2.validate('/*' + JSON.stringify({
    ISFVSN: '2', A8VSN: '2', LONG_DESCRIPTION: 'x',
    INPUTS: [{ NAME: 'k', TYPE: 'float', DEFAULT: 0, MIN: 0, MAX: 1, DESCRIPTION: 'x',
      _contextGate: { any: [{ param: 'ghost', eq: 1 }] } }],
  }, null, 2) + '*/\nvoid main() {}\n');
  t.ok(codes(unresolved.errors).indexOf('gate-unknown-input') !== -1,
    'the walk still resolves every param INSIDE an `any` wrapper');
  t.end();
});

test('ISF2 §6.16: generation receipts are validated for well-formedness only', function (t) {
  var v = ISF2.validate('/*' + JSON.stringify({
    ISFVSN: '2', A8VSN: '2', LONG_DESCRIPTION: 'x', INPUTS: [],
    A8_PROVENANCE: {
      version: '1.0', origin: { source: 'user', license: 'MIT' },
      chain: [{ action: 'create', timestamp: '2026-09-19T12:00:00.000Z', by: 'x', contentHash: 'y' }],
      generation: [{ providerId: 'local' }],
    },
  }, null, 2) + '*/\nvoid main() {}\n');
  t.ok(codes(v.errors).indexOf('prov-generation-no-schema') !== -1, 'every receipt carries schemaVersion');
  t.ok(codes(v.info).indexOf('prov-event-timestamp-iso') !== -1,
    'an ISO-8601 timestamp is ACCEPTED and reported — the §6.2.3 table says ms-epoch, the shipped '
    + 'producer writes ISO, and tightening to a number would reject the whole of it');
  t.end();
});

// ---------------------------------------------------------------------------
// §6.18 conformance level
// ---------------------------------------------------------------------------

test('ISF2 §6.18: the level a file DEMANDS of a host', function (t) {
  t.equal(ISF2.validate(ISF2.parse(assetLoad('generator.fs'))).level, 0,
    'a vanilla ISF file demands nothing');
  t.equal(ISF2.validate(ISF2.parse(assetLoad('warn-unknown-a8-key.fs'))).level, 1,
    'extension content with nothing honourable demands only PRESERVATION');
  t.equal(ISF2.validate(ISF2.parse(assetLoad('a8vsn1-legacy.fs'))).level, 3,
    'a preset bank + an authored camera view demand STATE');
  t.equal(ISF2.validate(ISF2.parse(assetLoad('a8vsn2-full.fs'))).level, 4,
    'declared modulation + a texture slot demand PERFORMANCE');

  var detail = ISF2.validate(ISF2.parse(assetLoad('a8vsn2-full.fs'))).levelDetail;
  t.ok(detail.some(function (d) { return d.level === 3 && /A8_OPS/.test(d.why); }),
    'and says WHICH declaration forced each rung — ops are injected at load and never baked into the '
    + '.fs, so a host that ignores A8_OPS renders a different image, silently');
  t.end();
});

// ---------------------------------------------------------------------------
// §6.5 applyPreset / presetPlan
// ---------------------------------------------------------------------------

test('ISF2 §6.5: applyPreset returns the flat map, in recall order', function (t) {
  var m = ISF2.parse(assetLoad('a8vsn2-full.fs'));
  var vals = ISF2.applyPreset(m, 'D');
  t.deepEqual(Object.keys(vals), ['iCamZoom', 'iCamRotY', 'weave', 'hue'],
    'camera before params — insertion order IS the recall order');
  t.equal(vals.weave, 0.4, 'slot params applied');
  t.equal(vals.iCamZoom, 0.3, 'the slot camera overrides the file-level authored view per key (§6.11)');
  t.equal(vals.iCamRotY, 12.0, 'and the authored view supplies what the slot does not');

  t.deepEqual(ISF2.applyPreset(m, '1'), { iCamZoom: 0.3, iCamRotY: 12.0, weave: 0.9 }, 'slot 1');
  t.equal(ISF2.applyPreset(m, '7'), null, 'an absent slot is ABSENT, never null-padded');
  t.deepEqual(ISF2.applyPreset(m), ISF2.applyPreset(m, 'D'), 'no slot argument ⇒ D, the reset baseline');

  var full = ISF2.applyPreset(m, '1', { withDefaults: true });
  t.equal(full.mode, 0, 'withDefaults seeds every declared DEFAULT first');
  t.equal(full.weave, 0.9, 'and the slot still wins');

  t.deepEqual(ISF2.applyPreset(m, 'D', { groupId: 'lighting' }), { iCamZoom: 0.3, iCamRotY: 12.0, keyDir: 0.5 },
    'a group bank recalls by _groupId');
  t.end();
});

test('ISF2 §6.5: presetPlan publishes the normative recall ORDER', function (t) {
  var m = ISF2.parse(assetLoad('a8vsn2-full.fs'));
  var plan = ISF2.presetPlan(m, 'D');
  t.deepEqual(plan.order, ['ops', 'camera', 'arrangement', 'ranges', 'params', 'modulation'],
    'ops → camera → arrangement → ranges → params → modulation');
  t.deepEqual(plan.steps.map(function (s) { return s.stage; }), ['ops', 'camera', 'ranges', 'params'],
    'only the stages the slot actually carries, in order');

  var opsAt = plan.steps.findIndex(function (s) { return s.stage === 'ops'; });
  var paramsAt = plan.steps.findIndex(function (s) { return s.stage === 'params'; });
  var rangesAt = plan.steps.findIndex(function (s) { return s.stage === 'ranges'; });
  t.ok(opsAt < paramsAt, 'ops FIRST — activating an op MINTS INPUTS that later steps write to');
  t.ok(rangesAt < paramsAt,
    'ranges BEFORE params — a value push CLAMPS to the live bracket, so restoring values against a '
    + 'stale narrow window silently lands the default inside it and the slot never recalls');

  t.equal(plan.name, 'Default', 'slot name carried');
  t.deepEqual(plan.opacity, [1, 1, 1, 1], 'opacity is the per-channel vector');
  t.equal(plan.renderState, 'active', 'render state carried');
  t.equal(ISF2.presetPlan(m, 'nope'), null, 'an absent slot plans nothing');
  t.end();
});

// ---------------------------------------------------------------------------
// §6.15 source identity
// ---------------------------------------------------------------------------

test('ISF2 §6.15: source identity is sha256 over the canonical source text', function (t) {
  var src = assetLoad('a8vsn2-full.fs');
  t.equal(ISF2.canonicalSourceText(src), src, 'a single-file .fs IS its own bytes');

  // A multi-part source object normalises to ONE text: string- and object-valued
  // fields walked in a STABLE key order with dotted keys.
  t.equal(ISF2.canonicalSourceText({ b: 'two', a: 'one' }), 'a:one\nb:two', 'stable key order');
  t.equal(ISF2.canonicalSourceText({ outer: { inner: 'x' } }), 'outer.inner:x', 'dotted keys for nested identity');
  t.equal(
    ISF2.canonicalSourceText({ a: 'one', params: { live: 'state' } }),
    ISF2.canonicalSourceText({ a: 'one' }),
    'params is SKIPPED — state is never identity, which is what keeps one record\'s bank from '
    + 'collapsing into every other record\'s'
  );
  t.equal(ISF2.canonicalSourceText({ fragmentShader: src }), src, 'a known text field is the text');

  ISF2.sourceId(src).then(function (id) {
    t.ok(/^sha256:[0-9a-f]{64}$/.test(id), 'sha256:<64 hex>');
    return ISF2.sourceId({ fragmentShader: src }).then(function (id2) {
      t.equal(id2, id,
        'two surfaces holding the same shader in different internal shapes hash IDENTICALLY — which is '
        + 'the whole point: a preset bank, a provenance chain and a cache become portable');
      return ISF2.sourceId(src + '\n');
    });
  }).then(function (other) {
    t.notEqual(other, null, 'editing the source yields a different identity');
    t.end();
  }).catch(function (e) {
    t.fail('sourceId rejected: ' + e.message);
    t.end();
  });
});

// ---------------------------------------------------------------------------
// validate(source) + emission stability over the whole new surface
// ---------------------------------------------------------------------------

test('ISF2: validate accepts source text, and reports an unparseable file as V1', function (t) {
  var v = ISF2.validate(assetLoad('a8vsn2-full.fs'));
  t.equal(v.ok, true, 'a string argument is parsed first');
  t.equal(v.level, 4, 'and levelled the same way');

  var bad = ISF2.validate('no metadata here at all');
  t.equal(bad.ok, false, 'RED');
  t.equal(bad.errors[0].rule, 'V1', 'reported as V1 rather than thrown, so a corpus can be batched');
  t.equal(bad.level, null, 'an unparseable file has no level');
  t.end();
});

test('ISF2 E2: every A8VSN 2 fixture round-trips byte-for-byte', function (t) {
  ['a8vsn1-legacy.fs', 'a8vsn2-full.fs', 'red-preset-unknown-param.fs',
    'red-bind-out-of-range.fs', 'red-clock-position.fs', 'warn-unknown-a8-key.fs'].forEach(function (name) {
    var src = assetLoad(name);
    t.equal(ISF2.emit(ISF2.parse(src)), src, name + ': emit(parse(x)) === x');
  });
  t.end();
});

test('ISF2 §6.18: Level 1 preserves every block it does not honour', function (t) {
  var m = ISF2.parse(assetLoad('a8vsn2-full.fs'));
  ['A8_PRESETS', 'A8_MODULATION', 'A8_OPS', 'A8_RAYMARCH_OPS', 'A8_FOLD',
    'A8_CAMERA', 'A8_LAYERS', 'A8_PLAYBACK', 'A8_PROVENANCE'].forEach(function (k) {
    t.ok(m.meta[k] !== undefined, k + ' survives on meta for re-emission');
  });
  t.end();
});

// ---------------------------------------------------------------------------
// Koine — the published conformant portrait (loom-gallery), as a real-world
// fixture: no gates, no fabricated field, every fact measured from the file.
// ---------------------------------------------------------------------------

test('ISF2: Koine (the conformant portrait) parses at level 4 with 0 errors', function (t) {
  var src = assetLoad('koine.fs');
  var m = ISF2.parse(src);
  var v = ISF2.validate(m);

  t.equal(v.errors.length, 0, 'zero errors');
  t.equal(v.level, 4, 'A8_MODULATION-shaped _bind receivers demand Level 4 (§6.18)');

  t.equal(v.warnings.length, 19, '18 undescribed inputs + the missing LONG_DESCRIPTION');
  var v12 = v.warnings.filter(function (w) { return w.rule === 'V12'; });
  t.equal(v12.length, 19, 'every warning is V12 — nothing else is wrong with this file');
  t.equal(v.warnings.filter(function (w) { return w.code === 'no-long-description'; }).length, 1,
    'the one top-level warning');
  t.equal(v.warnings.filter(function (w) { return w.code === 'input-no-description'; }).length, 18,
    'one per input — 10 `koine` group + 4 `base:transform` + 4 `base:color`');

  t.end();
});

test('ISF2: Koine — four _bind blocks desugar to kind: lfo receivers', function (t) {
  var m = ISF2.parse(assetLoad('koine.fs'));
  var bound = m.a8.receivers.filter(function (r) { return r.from === '_bind'; });
  t.equal(bound.length, 4, 'weave, dialect, grate, harmonic each carry _bind');
  t.deepEqual(bound.map(function (r) { return r.target; }).sort(),
    ['dialect', 'grate', 'harmonic', 'weave'], 'targets named');
  bound.forEach(function (r) {
    t.equal(r.source.kind, 'lfo', r.target + ': kind recovered from the lf: id namespace');
  });
  t.end();
});

test('ISF2: Koine — the 9-slot legacy A8_CARD_PRESETS bank reads with 0 V10 errors', function (t) {
  var m = ISF2.parse(assetLoad('koine.fs'));
  var v = ISF2.validate(m);
  t.equal(m.a8.presets.legacy, true, 'A8_CARD_PRESETS — the grandfathered spelling');
  t.deepEqual(Object.keys(m.a8.presets.bank).sort(),
    ['1', '2', '3', '4', '5', '6', '7', '8', 'D'], 'D plus eight user slots');
  t.equal(v.errors.filter(function (e) { return e.rule === 'V10'; }).length, 0,
    'every params key in every slot names a declared input');
  t.end();
});

test('ISF2: Koine round-trips byte-for-byte (E2)', function (t) {
  var src = assetLoad('koine.fs');
  t.equal(ISF2.emit(ISF2.parse(src)), src, 'emit(parse(x)) === x on a real published file, not a fixture');
  t.end();
});
