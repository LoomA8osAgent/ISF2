// ISF2.js — anim8 fork Update 6 (G2.3 Stage 3): the ISF2 extension schema.
//
// ISF2 is a strict, backward-degradable SUPERSET of ISF 2.0: every extension
// lives in JSON keys a vanilla ISF host ignores, so every valid ISF2 file is
// also a valid ISF 2.0 file. This module is the reference implementation of
// the schema half of the standard (`anim8-spec/specs/isf2-standard.md`):
//
//   ISF2.parse(fsText, opts?)   → model  (metadata + body + the A8_* view)
//   ISF2.validate(model)        → { ok, errors[], warnings[], skipped[] }   (§9.3 V1-V9)
//   ISF2.emit(model, opts?)     → fsText — deterministic, byte-stable (§9.2 E1-E3)
//   ISF2.normalizeGLSL(src,opt) → delegate to GLSLNormalize (§7.1 dialect normalize)
//
// Stage 4 added `emit` (below, §emit). It is MINIMAL-DIFF TEXTUAL SURGERY over
// the metadata text `parse` retained — never a re-serialization of the whole
// header — which is what makes E2 (`emit(parse(x)) === x`) and E3 (unknown keys
// survive) hold BY CONSTRUCTION rather than by luck: an untouched key is
// re-emitted as the author's own bytes, comments-in-whitespace, key order,
// number spelling (`1.0` stays `1.0`) and all.
//
// ZERO effect on the vanilla path. ISFParser.js is UNTOUCHED by this stage:
// this module is a separate, additive layer. A classic ISF shader with no
// A8_* keys parses, compiles and renders exactly as before — proven by a
// full-corpus emitted-GLSL differential (see the fork changelog Update 6).
//
// Preservation, for the record: unknown top-level keys and unknown per-input
// fields survive parsing by construction — MetadataExtractor returns the WHOLE
// decoded JSON object (`objectValue`, MetadataExtractor.js:44) and both
// ISFParser (`this.metadata = metadata`, ISFParser.js:34) and this module hold
// a reference to it rather than a filtered copy. `model.meta` IS that object.
//
// Pure string/JSON. No GL, no DOM, no window (fork-revisit §7.2/7.3
// environment-neutral rule) — usable in a browser bake harness or in node.

/* global globalThis, TextEncoder */
// `globalThis` + `TextEncoder` are the only runtime globals this module touches,
// both feature-detected inside sourceId (§6.15). Declared rather than enabling an
// eslint `env`, because neither `browser` nor `node` describes a module that must
// run in both and assume neither.

import MetadataExtractor from './MetadataExtractor';
import GLSLNormalize from './GLSLNormalize';

// ---------------------------------------------------------------------------
// Constants — the schema surface (standard §5, §6)
// ---------------------------------------------------------------------------

// The A8VSN this implementation implements (standard §6.1, §10.1).
//
// [fork Update 12] A8VSN 2. §6.4-§6.18 + Appendices A/B are ratified; §6.6
// DEPRECATES A8_ANIMATE, and a deprecation is not an addition, which is exactly
// what forces the major (standard §10.1). NOTHING here rejects an A8VSN 1 file:
// every superseded spelling is GRANDFATHERED into the same model (§6.17), and N6
// still forbids rewriting a legacy spelling on sight.
const A8VSN = '2';

// Standard ISF 2.0 input types → GLSL uniform (standard §5.1). `audio` /
// `audioFFT` are part of the ISF 2.0 type vocabulary and are legal to DECLARE;
// the fork's ISFParser.typeUniformMap does not carry them (a host-side concern
// — the Anim8 app demotes them to `image` + `_audioRole` before parse, standard
// §8.3), so validation accepts them while a renderer may still refuse. That
// divergence is reported as a warning, never an error.
const INPUT_TYPES = {
  float: 'float',
  bool: 'bool',
  event: 'bool',
  long: 'int',
  color: 'vec4',
  point2D: 'vec2',
  image: 'sampler2D',
  audio: 'sampler2D',
  audioFFT: 'sampler2D',
};

// Types the bundled ISFParser can actually build a uniform for.
const RENDERABLE_INPUT_TYPES = ['float', 'bool', 'event', 'long', 'color', 'point2D', 'image'];

// Top-level extension blocks DEFINED at A8VSN 2 (standard §6.17 — the table that
// replaces §6.2's reserved list, so the live keys stop being private-use
// violations).
const DEFINED_A8_KEYS = [
  'A8_ANIMATE',          // §6.2.1 — DEPRECATED at A8VSN 2, accepted forever
  'A8_CAMERA',           // §6.2.2 + §6.11
  'A8_PROVENANCE',       // §6.2.3 + §6.16
  'A8_PRESETS',          // §6.5
  'A8_MODULATION',       // §6.6
  'A8_OPS',              // §6.7
  'A8_RAYMARCH_OPS',     // §6.8
  'A8_FOLD',             // §6.9
  'A8_PASS_PROGRAMS',    // §6.10 — the one block the renderer already implements
  'A8_LAYERS',           // §6.12
  'A8_PLAYBACK',         // §6.13
];

// GRANDFATHERED synonyms (standard §6.17, §10.1). Consumers MUST accept them
// FOREVER; they are read into the same model as their neutral name and are never
// rewritten on sight (N6). They are NOT "unknown keys" and never warn as such.
const GRANDFATHERED_A8_KEYS = {
  A8_CARD_PRESETS: 'A8_PRESETS.bank',
  A8_GROUP_BANKS: 'A8_PRESETS.groupBanks',
};

// Reserved for future versions of the standard — producers MUST NOT use them
// for private purposes (standard §6.17 tail).
const RESERVED_A8_KEYS = ['A8_MODE', 'A8_MATERIAL'];

// Per-input extension fields (standard §6.3).
//
// NAMING (standard OPEN RULING 4, verdict (b), ratified 2026-07-12): the
// NEUTRAL `_op*` names are canonical; the shipped `_glyOp*` names are
// grandfathered SYNONYMS ("gly" is one ingestion frontend, not the substrate),
// so the 220 already-baked corpus files keep working untouched and new
// emissions use the neutral names. Both spellings parse to the same model
// field; a file carrying the legacy spelling gets an informational warning.
const OP_FIELD_SYNONYMS = {
  _op: '_glyOp',
  _opIdentity: '_glyOpIdentity',
  _opAuthored: '_glyOpAuthored',
  _opCompanion: '_glyOpCompanion',
};

// Non-operator field synonyms (standard §6.14 A, §10.1 grandfathered list). Same
// rule as the _glyOp* family: the neutral name is canonical, the shipped spelling
// is accepted forever and re-emitted as itself (N6).
//
// `TRANSPORT_DOMAIN` is called out in §6.14 A as "the only extension field in the
// whole standard that escapes X2 by not being underscore-prefixed" — which is why
// it must be listed EXPLICITLY here: the catch-all that sweeps unrecognized
// extension fields keys on a leading underscore and would never see it, and the V6
// neutrality strip would leave it in the vanilla tuple.
const FIELD_SYNONYMS = {
  _blendable: '_groupBlendable',
  _transportDomain: 'TRANSPORT_DOMAIN',
};

// Underscore-prefixed extension fields (canonical spellings).
//
// The §6.14 family is the STANDING X2 VIOLATION the A8VSN 2 ratification closes:
// thirteen fields were live in the shipped corpus while X2 reserved every
// underscore name §6.3 did not list, so the corpus violated the standard rather
// than the other way round. Spellings are FROZEN AS SHIPPED — renaming would break
// E2 byte-stable re-emit for every already-published file (§6.14 preamble).
const INPUT_EXT_UNDERSCORE = [
  // §6.3 — A8VSN 1
  '_groupId', '_groupLabel', '_headerSlot',
  '_contextGate', '_contextHeaderGate', '_menuOnly',
  '_op', '_opIdentity', '_opAuthored', '_opCompanion',
  '_a8ManagedSlot', '_audioRole',
  // §6.14 A — PORTABLE presentation
  '_rowId', '_groupParent', '_stackOrder', '_valueSubgroups', '_labelBy',
  '_contextRange', '_derive', '_noTimeTwin', '_layerRow', '_slotEntryRow',
  '_blendable', '_transportDomain',
  // §6.14 B — DECLARED ROLES (a capability belongs to the MEDIUM, not a card type)
  '_lightRig', '_shapeMath',
  // §6.14 C — A8OS-SPECIFIC host bookkeeping: published so they are not private,
  // parsed + preserved + IGNORED by everyone else. Listed so X2 stops being violated,
  // NOT so anyone implements them.
  '_engineOnly', '_a8DebugTap', '_a8Synthetic', '_hueFamily',
  // §6.14 D — the per-input modulation shorthand
  '_bind',
];

// Uppercase slider-affordance flags (standard §6.3 tail) + the one non-underscore
// grandfathered synonym (§6.14 A).
const INPUT_EXT_FLAGS = ['BIPOLAR', 'TICKS', 'SNAP_TICKS', 'PLAIN', 'TRANSPORT_DOMAIN'];

// Markers the host stamps on descriptors it MINTS at runtime (§6.14 C). An input
// carrying one was not authored, so the §5.2 DESCRIPTION obligation (V12) cannot
// bind it.
const HOST_MINTED_MARKERS = ['_engineOnly', '_a8DebugTap', '_a8Synthetic'];

// Every ext field name (canonical + grandfathered) — the set stripped for the
// V6 extension-neutrality check.
const INPUT_EXT_FIELDS = INPUT_EXT_UNDERSCORE
  .concat(Object.keys(OP_FIELD_SYNONYMS).map(k => OP_FIELD_SYNONYMS[k]))
  .concat(Object.keys(FIELD_SYNONYMS).map(k => FIELD_SYNONYMS[k]))
  .concat(INPUT_EXT_FLAGS);

// Standard (non-extension) input fields — the vanilla surface a legacy host
// extracts. V6 asserts extensions never perturb this tuple.
const INPUT_STD_FIELDS = ['NAME', 'TYPE', 'LABEL', 'DESCRIPTION', 'DEFAULT', 'MIN', 'MAX', 'VALUES', 'LABELS'];

// Oscillator waveforms this implementation recognises (standard §6.2.1 —
// unknown curves degrade to no animation, so an unknown curve is a WARNING).
const KNOWN_CURVES = ['sine', 'cosine', 'triangle', 'saw', 'sawdown', 'square', 'pulse', 'noise', 'random'];

// §6.6 — the PORTABLE half of a modulation source. A foreign player with its own
// clock can honour a `clock`-kind bind without ever knowing what `ck:phase` is.
const MODULATION_KINDS = ['clock', 'audio-band', 'audio-rms', 'beat', 'lfo', 'sequencer', 'param', 'host'];

// §6.6 — the A8OS-SPECIFIC id namespace, published so `kind` can be RECOVERED from
// a bare `_bind.source` string (§6.14 D carries an id and no kind). Longest prefix
// wins; an id matching nothing leaves `kind` UNDEFINED rather than guessed.
const MODULATION_ID_KINDS = [
  ['aa:band:', 'audio-band'],
  ['aa:rms', 'audio-rms'],
  ['aa:beat', 'beat'],
  ['ck:', 'clock'],
  ['lf:', 'lfo'],
  ['sq:', 'sequencer'],
  ['sx:', 'param'],
];

// §6.11 — camera models. `scene` = in-content tilt / keystone, `plane` = rigid
// canvas rotate, `planeinf` = infinite plane (runs both).
const CAMERA_MODELS = ['scene', 'plane', 'planeinf'];

// §6.11 — camera scopes (host-set; absent ⇒ scene).
const CAMERA_SCOPES = ['scene', 'element', 'skybox'];

// Appendix B — the normative `iCam*` roster A8_CAMERA.state may carry. ALL VALUES
// ARE IN THE STATE DOMAIN (§6.11): the value a host pushes through its own
// setParam, never the post-conversion uniform value. `wrapped` is normative, not
// cosmetic — it is the difference between a rotation that can be performed
// continuously and one that hits a wall mid-gesture.
const CAMERA_STATE = {
  iCamZoom: { min: -1, max: 1, def: 0, bipolar: true, note: 'base-10 EXPONENT: +1 = 10x in' },
  iCamFov: { min: 10, max: 120, def: 50, bipolar: false },
  iCamPanX: { min: -1, max: 1, def: 0, bipolar: true },
  iCamPanY: { min: -1, max: 1, def: 0, bipolar: true },
  iCamRotX: { min: -180, max: 180, def: 0, bipolar: true, wrapped: false },
  iCamRotY: { min: -180, max: 180, def: 0, bipolar: true, wrapped: false },
  iCamCanvasX: { min: -180, max: 180, def: 0, bipolar: true, wrapped: true },
  iCamCanvasY: { min: -180, max: 180, def: 0, bipolar: true, wrapped: true },
  iCamRotZ: { min: -180, max: 180, def: 0, bipolar: true, wrapped: true },
  iCamTiltSpinX: { min: -6, max: 6, def: 0, bipolar: true },
  iCamTiltSpinY: { min: -6, max: 6, def: 0, bipolar: true },
  iCamSpinX: { min: -6, max: 6, def: 0, bipolar: true },
  iCamSpinY: { min: -6, max: 6, def: 0, bipolar: true },
  iCamModel: { enum: CAMERA_MODELS, note: 'lifted OUT of state into A8_CAMERA.model (§6.11)' },
  iCamScope: { enum: CAMERA_SCOPES },
};

// Appendix A.1 — the `world` scope roster (20 entries). Screen-space warps
// applicable to any injected fragment shader; excludes the SDF-only 3D warps and
// any op needing a bound texture slot.
const OPS_WORLD = [
  'u_tile', 'u_radialTile', 'u_hexTile', 'u_triTile', 'u_rays', 'u_spiralN',
  'u_wave', 'u_zoom', 'u_zoomDrift', 'u_mirrorX', 'u_mirrorY', 'u_opClifford',
  'u_opDeJong', 'u_opIkeda', 'u_opLorenzSlice', 'u_opRosslerSlice', 'u_opCurlNoise',
  'u_opXor', 'u_opTruchet', 'u_opGoldenSpiral',
];

// Appendix A.2 — the `raymarch` scope roster (5 entries). EVERY amount's identity
// is 0, which is what makes active-only compilation (§6.7) safe rather than merely
// fast: an op present at identity is a byte-exact no-op.
const OPS_RAYMARCH = ['ao', 'softShadow', 'fresnel', 'refract', 'palette'];

// §6.7 — scopes are OPEN, not enumerated (the serializer walks whatever scope keys
// the engine declares, so a new scope costs no schema change). These are the ones
// defined today; `view` is RETIRED and MUST NOT be emitted (Appendix A tail).
const OPS_SCOPES = ['world', 'sdf', 'raymarch', 'glyph'];
const OPS_SCOPES_RETIRED = ['view'];

// §6.8 — the four shade splice points a body may mark.
const RAYMARCH_HOOKS = ['normal', 'occ', 'shade', 'post'];

// §6.13 — playback levers.
const PLAYBACK_SCALE_MODES = ['aspect', 'fit', 'fill', 'copy'];
const PLAYBACK_RECALL_MODES = ['seed', 'state'];

// §6.12 — how a texture meets the surface (A8TexMappingCanon). Absent ⇒ host default.
const TEX_MAPPINGS = ['triplanar', 'planar', 'object', 'screen', 'spherical', 'cylindrical'];

// §6.5 — `D` is the reset baseline, `1`-`11` are user slots, an absent slot is
// ABSENT (never null-padded).
const PRESET_SLOT_IDS = ['D', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];

// §6.5 — the slot fields that map 1:1 to the card snapshot.
const PRESET_SLOT_FIELDS = [
  'name', 'params', 'ranges', 'inverts', 'deactivated', 'opacity', 'blend',
  'renderState', 'ops', 'camera', 'arrangement', 'modulation', 'generation',
];

// §6.5 — THE NORMATIVE RECALL ORDER, published here because a host will otherwise
// invent one:
//
//     ops -> camera -> arrangement -> ranges -> params -> modulation
//
// `ops` FIRST because activating an op MINTS INPUTS that later steps write to.
// `ranges` BEFORE `params` because a value push CLAMPS to the live bracket:
// restoring values against a stale narrow window silently lands the default inside
// it and the slot never recalls (BOUND-D-RESET-CLAMPED-BY-STALE-BRACKET).
const PRESET_RECALL_ORDER = ['ops', 'camera', 'arrangement', 'ranges', 'params', 'modulation'];

const GLSL_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

const ERROR_CODES = {
  NOT_A_STRING: 'not-a-string',
  NO_METADATA: 'no-metadata',
  METADATA_JSON: 'metadata-json',
  METADATA_NOT_OBJECT: 'metadata-not-object',
  // emit (Stage 4)
  EMIT_NO_MODEL: 'emit-no-model',
  EMIT_NO_META: 'emit-no-meta',
  EMIT_UNSCANNABLE: 'emit-unscannable',
  EMIT_UNSERIALIZABLE: 'emit-unserializable',
  EMIT_NOT_EXTENSION_KEY: 'emit-not-extension-key',
  EMIT_NO_PROVENANCE: 'emit-no-provenance',
  // sourceId (Update 12)
  NO_DIGEST: 'no-digest',
};

// ---------------------------------------------------------------------------
// Error surface
// ---------------------------------------------------------------------------

// Fatal, structural failures throw ISF2Error — the file cannot yield a model
// at all (no metadata block / undecodable JSON / metadata is not an object).
// EVERYTHING else is non-fatal and surfaces as `model.warnings` (parse) or
// `validate().errors` / `.warnings` (schema), so a caller can always tell
// "this is not an ISF file" apart from "this is an ISF file with problems".
function ISF2Error(code, message, extra) {
  const e = new Error(message);
  e.name = 'ISF2Error';
  e.code = code;
  e.isISF2Error = true;
  if (extra) {
    if (extra.line !== undefined) e.line = extra.line;
    if (extra.position !== undefined) e.position = extra.position;
    if (extra.cause !== undefined) e.cause = extra.cause;
  }
  return e;
}

function warn(list, code, message, path) {
  list.push(path === undefined ? { code, message } : { code, message, path });
}

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

// parse(fsText, opts?) → model
//
//   opts.vertexShader : optional companion .vs source. Only used for ISF 1.0
//                       marker detection (standard §2.2), mirroring
//                       ISFParser.inferISFVersion (ISFParser.js:213-222).
//
// model = {
//   meta            the FULL decoded metadata object (every key, incl. unknown)
//   inputs[]        meta.INPUTS by reference (never a filtered copy)
//   passes[]        meta.PASSES by reference (undeclared ⇒ [])
//   imports{}       meta.IMPORTED by reference
//   body            the GLSL after the metadata comment
//   raw{}           { source, metadataString, bodyStart } — the emitter's input
//   isfVersion      1 | 2                       (standard §2.2)
//   type            generator | filter | transition   (standard §7.6)
//   point2D{}       NAME → 'pixel' | 'raw'      (standard §8.2)
//   a8{}            the extension view (below)
//   warnings[]      non-fatal parse findings
// }
//
// a8 = {
//   vsn          the file's A8VSN string, or null
//   animate      A8_ANIMATE array, or null           (§6.2.1, DEPRECATED)
//   camera       RECONCILED { mode, model, state, legacy }   (§6.11)
//   provenance   A8_PROVENANCE object, or null       (§6.2.3 + §6.16)
//   generation   A8_PROVENANCE.generation receipts, or null  (§6.16)
//   presets      { schema, bank, groupBanks, legacy } or null (§6.5)
//   modulation   A8_MODULATION object, or null       (§6.6)
//   receivers[]  the RESOLVED union of A8_MODULATION + _bind + A8_ANIMATE, one
//                entry per target, each tagged `from` (§6.6 + §6.14 D desugars)
//   ops          A8_OPS scope → { opName: amount }, or null  (§6.7)
//   raymarchOps  A8_RAYMARCH_OPS object, or null     (§6.8)
//   fold         A8_FOLD object, or null             (§6.9)
//   passPrograms true when A8_PASS_PROGRAMS is set   (§6.10)
//   layers       A8_LAYERS object, or null           (§6.12)
//   slots[]      the flattened layer slots, each { key, role, ref, inline, … }
//   playback     A8_PLAYBACK object, or null         (§6.13)
//   ui{}         NAME → normalized per-input extension fields (§6.3 + §6.14)
//   reserved{}   reserved A8_* keys the file uses anyway (preserved, ignored)
//   unknown{}    unrecognized A8_* keys (preserved, ignored — standard §10)
//   legacyKeys{} grandfathered key → the neutral name it was read as (§6.17)
//   isISF2       true when the file carries ANY extension content
// }
//
// EVERY block above is parsed and PRESERVED even where the standard honours it
// only at Level 3 or 4, so a Level 1 round trip never destroys state it does not
// use (§6.18 tail, E2/E3). The model is a VIEW: `model.meta` stays the write
// surface and the emitter reads it and never `a8`.
function parse(fsText, opts) {
  const options = opts || {};
  const warnings = [];

  if (typeof fsText !== 'string') {
    throw ISF2Error(ERROR_CODES.NOT_A_STRING, 'ISF2.parse: source must be a string.');
  }

  // --- F1/F2: the metadata block ------------------------------------------
  let info;
  try {
    info = MetadataExtractor(fsText);
  } catch (e) {
    const msg = (e && e.message) || String(e);
    if (/no metadata/i.test(msg)) {
      throw ISF2Error(ERROR_CODES.NO_METADATA,
        'ISF2.parse: no metadata block — an ISF2 file must open with a /* … */ JSON header (standard §3 F1).',
        { cause: e });
    }
    throw ISF2Error(ERROR_CODES.METADATA_JSON, 'ISF2.parse: ' + msg,
      { line: e && e.lineNumber, position: e && e.position, cause: e });
  }

  const meta = info.objectValue;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    throw ISF2Error(ERROR_CODES.METADATA_NOT_OBJECT,
      'ISF2.parse: the metadata block must contain a single JSON OBJECT (standard §3 F2).');
  }

  // F1 belt: anything other than whitespace / line comments before the header
  // means the JSON block is not the first thing in the file. MetadataExtractor
  // always takes the FIRST /* … */, so this can only be code or a stray token.
  const lead = fsText.slice(0, info.startIndex);
  if (lead.replace(/\/\/[^\n]*/g, '').trim() !== '') {
    warn(warnings, 'header-not-first',
      'Non-comment content precedes the metadata block; the JSON header should be the first thing in the file (standard §3 F1).');
  }

  // D7: emitted ISF2 MUST be strictly-parseable JSON. MetadataExtractor decodes
  // with the vendored Crockford json_parse, which accepts a few things strict
  // JSON forbids — in the corpus, overwhelmingly RAW CONTROL CHARACTERS inside
  // strings (a literal tab or newline in a DESCRIPTION) and numbers with a
  // leading zero. Those files decode fine here and would decode fine in most
  // hosts, but they are not conformant emitter output, so they are reported.
  // (Malformations the vendored parser also rejects — trailing commas, single
  // quotes, unquoted keys, comments inside the JSON — never reach this point:
  // they throw above as a typed METADATA_JSON error with a line + position.)
  try {
    JSON.parse(info.stringValue);
  } catch (e) {
    warn(warnings, 'json-lenient',
      'Metadata decoded only under lenient JSON rules (typically a raw control character inside a '
      + 'string, or a leading-zero number). Consumers MAY repair it; ISF2 emitters MUST NOT produce '
      + 'it (standard D7, §9.3 V1). Strict parser said: ' + ((e && e.message) || String(e)));
  }

  // --- body ---------------------------------------------------------------
  // Byte-identical to ISFParser.js:43-45 so `model.body` is exactly the text
  // the parser compiles.
  const bodyStart = fsText.indexOf(info.stringValue) + info.stringValue.length + 2;
  const body = fsText.substring(bodyStart);

  const inputs = Array.isArray(meta.INPUTS) ? meta.INPUTS : [];
  if (meta.INPUTS !== undefined && !Array.isArray(meta.INPUTS)) {
    warn(warnings, 'inputs-not-array', 'INPUTS is present but is not an array; treated as empty (standard §4).');
  }
  const passes = Array.isArray(meta.PASSES) ? meta.PASSES : [];
  if (meta.PASSES !== undefined && !Array.isArray(meta.PASSES)) {
    warn(warnings, 'passes-not-array', 'PASSES is present but is not an array; treated as absent (standard §4).');
  }
  const imports = (meta.IMPORTED && typeof meta.IMPORTED === 'object') ? meta.IMPORTED : {};

  return {
    meta,
    inputs,
    passes,
    imports,
    body,
    raw: { source: fsText, metadataString: info.stringValue, bodyStart },
    isfVersion: inferISFVersion(meta, fsText, options.vertexShader || ''),
    type: inferFilterType(inputs),
    point2D: point2DModes(inputs),
    a8: extractA8(meta, inputs, warnings),
    warnings,
  };
}

// standard §2.2 — mirror of ISFParser.inferISFVersion (ISFParser.js:213-222).
function inferISFVersion(meta, fragSrc, vertSrc) {
  if (meta.PERSISTENT_BUFFERS
      || fragSrc.indexOf('vv_FragNormCoord') !== -1
      || vertSrc.indexOf('vv_vertShaderInit') !== -1
      || vertSrc.indexOf('vv_FragNormCoord') !== -1) return 1;
  return 2;
}

// standard §7.6 — mirror of ISFParser.inferFilterType (ISFParser.js:193-211).
function inferFilterType(inputs) {
  const has = (type, name) => inputs.some(i => i && i.TYPE === type && i.NAME === name);
  if (has('image', 'inputImage')) return 'filter';
  if (has('image', 'startImage') && has('image', 'endImage') && has('float', 'progress')) return 'transition';
  return 'generator';
}

// standard §8.2 — the normative pixel-vs-raw rule. BOTH MIN and MAX present as
// two-element arrays ⇒ raw; otherwise the shader consumes PIXEL coordinates and
// the host scales a stored 0-1 value by the LIVE render size at upload time.
// (Same predicate the Anim8 ISF engine uses to build its `_p2dPixel` set.)
function point2DModes(inputs) {
  const modes = {};
  inputs.forEach((input) => {
    if (!input || input.TYPE !== 'point2D' || !input.NAME) return;
    const raw = Array.isArray(input.MIN) && input.MIN.length === 2
             && Array.isArray(input.MAX) && input.MAX.length === 2;
    modes[input.NAME] = raw ? 'raw' : 'pixel';
  });
  return modes;
}

// standard §6 — build the extension view without mutating `meta`.
function extractA8(meta, inputs, warnings) {
  const a8 = {
    vsn: null,
    animate: null,
    camera: null,
    provenance: null,
    generation: null,
    presets: null,
    modulation: null,
    receivers: [],
    ops: null,
    raymarchOps: null,
    fold: null,
    passPrograms: false,
    layers: null,
    slots: [],
    playback: null,
    ui: {},
    reserved: {},
    unknown: {},
    legacyKeys: {},
    isISF2: false,
  };

  if (meta.A8VSN !== undefined) {
    a8.vsn = String(meta.A8VSN);
    if (typeof meta.A8VSN !== 'string') {
      warn(warnings, 'a8vsn-not-string', 'A8VSN must be a string (standard §6.1).');
    }
    // §6.1 — a newer extension version MUST still render; unknown extension
    // content is ignored, exactly as a legacy host would.
    if (compareVsn(a8.vsn, A8VSN) > 0) {
      warn(warnings, 'a8vsn-ahead',
        'File declares A8VSN "' + a8.vsn + '"; this implementation implements "' + A8VSN
        + '". Unrecognized extension content is ignored (standard §6.1, §10).');
    }
  }

  Object.keys(meta).forEach((key) => {
    if (key.indexOf('A8_') !== 0) return;
    if (DEFINED_A8_KEYS.indexOf(key) !== -1) return;      // handled below
    if (Object.prototype.hasOwnProperty.call(GRANDFATHERED_A8_KEYS, key)) {
      // §6.17 / §10.1 — a grandfathered synonym is NOT an unknown key and never
      // warns as one; consumers MUST accept it forever. It is read into the
      // neutral model below and re-emitted as ITSELF (N6).
      a8.legacyKeys[key] = GRANDFATHERED_A8_KEYS[key];
      return;
    }
    if (RESERVED_A8_KEYS.indexOf(key) !== -1) {
      a8.reserved[key] = meta[key];
      warn(warnings, 'a8-reserved-key',
        key + ' is RESERVED for a future version of the standard and is ignored '
        + 'by this implementation (standard §6.2).', key);
      return;
    }
    a8.unknown[key] = meta[key];
    warn(warnings, 'a8-unknown-key',
      'Unknown extension key ' + key + ' — preserved and ignored (standard §10 forward compatibility).', key);
  });

  if (meta.A8_ANIMATE !== undefined) {
    a8.animate = Array.isArray(meta.A8_ANIMATE) ? meta.A8_ANIMATE : null;
    if (a8.animate === null) {
      warn(warnings, 'a8-animate-not-array', 'A8_ANIMATE must be an array (standard §6.2.1); ignored.');
    }
  }
  if (meta.A8_CAMERA !== undefined) {
    a8.camera = (meta.A8_CAMERA && typeof meta.A8_CAMERA === 'object' && !Array.isArray(meta.A8_CAMERA))
      ? meta.A8_CAMERA : null;
    if (a8.camera === null) {
      warn(warnings, 'a8-camera-not-object', 'A8_CAMERA must be an object (standard §6.2.2); ignored.');
    }
  }
  if (meta.A8_PROVENANCE !== undefined) {
    a8.provenance = (meta.A8_PROVENANCE && typeof meta.A8_PROVENANCE === 'object' && !Array.isArray(meta.A8_PROVENANCE))
      ? meta.A8_PROVENANCE : null;
    if (a8.provenance === null) {
      warn(warnings, 'a8-provenance-not-object', 'A8_PROVENANCE must be an object (standard §6.2.3); ignored.');
    }
  }

  // --- §6.11 camera: the RECONCILIATION ------------------------------------
  // §6.2.2 defines a capability FLAG; the shipped emitter writes camera STATE
  // under the same key. Two incompatible shapes, one name, both deployed. The
  // flat map is grandfathered (§10.1): "a consumer meeting a block with no `mode`
  // and no `state` treats its members as `state` (the shape is unambiguous: every
  // key is an iCam* name)", and `iCamModel` lifts OUT of state into `model`.
  if (a8.camera) a8.camera = reconcileCamera(a8.camera, warnings);

  // --- §6.16 generation receipts (inside provenance, never a parallel key) ---
  if (a8.provenance && a8.provenance.generation !== undefined) {
    a8.generation = Array.isArray(a8.provenance.generation) ? a8.provenance.generation : null;
    if (a8.generation === null) {
      warn(warnings, 'a8-generation-not-array',
        'A8_PROVENANCE.generation must be an array of receipts (standard §6.16); ignored.');
    }
  }

  // --- §6.5 presets (+ the two grandfathered halves) ------------------------
  a8.presets = extractPresets(meta, warnings);

  // --- §6.6 modulation ------------------------------------------------------
  if (meta.A8_MODULATION !== undefined) {
    a8.modulation = plainObject(meta.A8_MODULATION);
    if (a8.modulation === null) {
      warn(warnings, 'a8-modulation-not-object', 'A8_MODULATION must be an object (standard §6.6); ignored.');
    }
  }

  // --- §6.7 ops (active-only; an op nobody activated is ABSENT) -------------
  if (meta.A8_OPS !== undefined) {
    a8.ops = plainObject(meta.A8_OPS);
    if (a8.ops === null) {
      warn(warnings, 'a8-ops-not-object', 'A8_OPS must be an object of scope → { opName: amount } (standard §6.7); ignored.');
    }
  }

  // --- §6.8 / §6.9 / §6.10 / §6.13 -----------------------------------------
  ['A8_RAYMARCH_OPS', 'A8_FOLD', 'A8_PLAYBACK'].forEach((key) => {
    if (meta[key] === undefined) return;
    const field = key === 'A8_RAYMARCH_OPS' ? 'raymarchOps' : (key === 'A8_FOLD' ? 'fold' : 'playback');
    a8[field] = plainObject(meta[key]);
    if (a8[field] === null) {
      warn(warnings, 'a8-block-not-object', key + ' must be an object; ignored.', key);
    }
  });
  if (meta.A8_PASS_PROGRAMS !== undefined) {
    a8.passPrograms = !!meta.A8_PASS_PROGRAMS;
  }

  // --- §6.12 layers ---------------------------------------------------------
  if (meta.A8_LAYERS !== undefined) {
    a8.layers = plainObject(meta.A8_LAYERS);
    if (a8.layers === null) {
      warn(warnings, 'a8-layers-not-object', 'A8_LAYERS must be an object (standard §6.12); ignored.');
    } else {
      a8.slots = flattenLayerSlots(a8.layers);
    }
  }

  // The legacy-spelling notice is a FILE-level property, not a per-input
  // defect (the shipped corpus carries `_glyOp*` on tens of thousands of
  // inputs and is explicitly NOT scheduled for migration), so it is reported
  // once per field name per file.
  const legacySeen = {};
  inputs.forEach((input, idx) => {
    if (!input || typeof input !== 'object') return;
    const ui = extractInputExt(input, idx, warnings, legacySeen);
    if (ui) a8.ui[input.NAME !== undefined ? input.NAME : ('#' + idx)] = ui;
  });

  // --- §6.6 + §6.14 D — the RESOLVED receiver set ---------------------------
  // Built AFTER the per-input walk, because `_bind` lives on an input. One entry
  // per target: A8_MODULATION wins over `_bind`, `_bind` wins over A8_ANIMATE.
  a8.receivers = resolveReceivers(a8, inputs, warnings);

  a8.isISF2 = !!(a8.vsn || a8.animate || a8.camera || a8.provenance
    || a8.presets || a8.modulation || a8.ops || a8.raymarchOps || a8.fold
    || a8.layers || a8.playback || a8.passPrograms
    || Object.keys(a8.ui).length
    || Object.keys(a8.reserved).length
    || Object.keys(a8.unknown).length
    || Object.keys(a8.legacyKeys).length);
  return a8;
}

// A JSON object (not an array, not null), or null.
function plainObject(v) {
  return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null;
}

// §6.11 — { mode, model, state }, with the flat `iCam*` state map grandfathered.
function reconcileCamera(raw, warnings) {
  const hasNewShape = raw.mode !== undefined || raw.model !== undefined || raw.state !== undefined;
  if (hasNewShape) {
    const state = plainObject(raw.state) || {};
    if (raw.state !== undefined && plainObject(raw.state) === null) {
      warn(warnings, 'a8-camera-state-not-object', 'A8_CAMERA.state must be an object of iCam* names (standard §6.11); ignored.');
    }
    return {
      mode: raw.mode !== undefined ? raw.mode : null,
      model: raw.model !== undefined ? raw.model : null,
      state,
      legacy: false,
      raw,
    };
  }
  // GRANDFATHERED flat map (§10.1). `iCamModel` is lifted out of the state map.
  const state = {};
  let model = null;
  Object.keys(raw).forEach((k) => {
    if (k === 'iCamModel') { model = raw[k]; return; }
    state[k] = raw[k];
  });
  if (Object.keys(raw).length) {
    warn(warnings, 'a8-camera-flat-state',
      'A8_CAMERA carries a flat iCam* state map with no `mode`/`state` — read as A8_CAMERA.state '
      + 'and GRANDFATHERED (standard §10.1). Producers emit the { mode, model, state } shape from A8VSN 2 (§6.11).');
  }
  return { mode: null, model, state, legacy: true, raw };
}

// §6.5 + §6.17 — one preset model from A8_PRESETS and/or the two grandfathered
// halves. Neither half is invented: an absent half stays an empty object.
function extractPresets(meta, warnings) {
  const block = meta.A8_PRESETS !== undefined ? plainObject(meta.A8_PRESETS) : undefined;
  if (meta.A8_PRESETS !== undefined && block === null) {
    warn(warnings, 'a8-presets-not-object', 'A8_PRESETS must be an object (standard §6.5); ignored.');
  }
  const legacyBank = meta.A8_CARD_PRESETS !== undefined ? plainObject(meta.A8_CARD_PRESETS) : undefined;
  const legacyGroups = meta.A8_GROUP_BANKS !== undefined ? plainObject(meta.A8_GROUP_BANKS) : undefined;
  if (block === undefined && legacyBank === undefined && legacyGroups === undefined) return null;

  const neutralBank = block ? plainObject(block.bank) : null;
  const neutralGroups = block ? plainObject(block.groupBanks) : null;

  // The neutral key wins where BOTH halves are declared — a synonym that
  // disagrees with its neutral name is an authoring mistake, not a merge.
  if (neutralBank && legacyBank) {
    warn(warnings, 'a8-presets-both-spellings',
      'Both A8_PRESETS.bank and the grandfathered A8_CARD_PRESETS are present; A8_PRESETS.bank wins (standard §6.17).');
  }
  if (neutralGroups && legacyGroups) {
    warn(warnings, 'a8-presets-both-spellings',
      'Both A8_PRESETS.groupBanks and the grandfathered A8_GROUP_BANKS are present; A8_PRESETS.groupBanks wins (standard §6.17).');
  }

  return {
    schema: block && block.schema !== undefined ? block.schema : null,
    bank: neutralBank || legacyBank || {},
    groupBanks: neutralGroups || legacyGroups || {},
    legacy: !neutralBank && !!legacyBank,
    raw: block || null,
  };
}

// §6.12 — flatten `bg` + `layers` into one slot list. `inline` records whether
// the ref is self-contained (`data:` URI) — where both are present `data` wins
// and name/path degrade to attribution.
function flattenLayerSlots(layers) {
  const slots = [];
  const push = (key, role, entry, layerIndex) => {
    const e = plainObject(entry);
    if (!e) return;
    const ref = plainObject(e.ref) || {};
    slots.push({
      key,
      role,
      layerIndex: layerIndex === undefined ? null : layerIndex,
      slot: e.slot !== undefined ? e.slot : null,
      mode: e.mode !== undefined ? e.mode : null,
      blend: e.blend !== undefined ? e.blend : null,
      opacity: e.opacity !== undefined ? e.opacity : null,
      mapping: e.mapping !== undefined ? e.mapping : null,
      ref,
      inline: typeof ref.data === 'string' && ref.data.length > 0,
      entry: e,
    });
  };
  if (layers.bg !== undefined) push('bg', 'bg', layers.bg);
  const fills = plainObject(layers.layers);
  if (fills) {
    Object.keys(fills).forEach((k) => { push('layers.' + k, 'fill', fills[k], k); });
  }
  return slots;
}

// §6.6 — recover the PORTABLE `kind` from an A8OS-SPECIFIC id. Longest published
// prefix wins; an id matching nothing leaves `kind` UNDEFINED rather than guessed
// (a guessed kind is worse than an absent one — it makes an unresolvable source
// look honourable).
function kindFromSourceId(id) {
  if (typeof id !== 'string') return undefined;
  let best;
  MODULATION_ID_KINDS.forEach((pair) => {
    if (id.indexOf(pair[0]) !== 0) return;
    if (!best || pair[0].length > best[0].length) best = pair;
  });
  return best ? best[1] : undefined;
}

// §6.6 + §6.14 D — the resolved receiver set. Three sources, one entry per target:
//
//   A8_MODULATION  (§6.6)      wins wherever it names a target
//   _bind          (§6.14 D)   the per-input shorthand; min/max are the BRACKET
//   A8_ANIMATE     (§6.2.1)    DEPRECATED; a receiver with no source
//
// The `_bind` > `A8_ANIMATE` half of that order is this implementation's reading:
// the standard fixes A8_MODULATION above BOTH (§6.6, §6.14 D) but never ranks the
// two shorthands against each other. `_bind` is ranked higher because it is the
// live, gated spelling and A8_ANIMATE is deprecated at this very version.
function resolveReceivers(a8, inputs, warnings) {
  const out = [];
  const byTarget = {};
  const put = (entry) => {
    if (!entry || typeof entry.target !== 'string') return;
    if (Object.prototype.hasOwnProperty.call(byTarget, entry.target)) return;   // first wins
    byTarget[entry.target] = true;
    out.push(entry);
  };

  const declared = a8.modulation && Array.isArray(a8.modulation.receivers)
    ? a8.modulation.receivers : [];
  declared.forEach((r) => {
    const rec = plainObject(r);
    if (!rec) return;
    const src = typeof rec.source === 'string' ? { id: rec.source } : (plainObject(rec.source) || null);
    put({
      target: rec.target,
      source: src ? {
        id: src.id,
        kind: src.kind !== undefined ? src.kind : kindFromSourceId(src.id),
        range: src.range,
      } : null,
      transform: plainObject(rec.transform) || null,
      oscillator: plainObject(rec.oscillator) || null,
      active: rec.active === undefined ? true : !!rec.active,
      from: 'A8_MODULATION',
    });
  });

  // §6.14 D — the normative desugar: one `_bind` IS one A8_MODULATION receiver.
  // `_bind.min/max` is the BRACKET (the performer's operating window), NOT
  // `transform.dstRange` — the live path pushes them through sxSetRange BEFORE
  // binding. A host writing them as an affine output range sweeps the wrong span,
  // which looks like a broken modulator and is not.
  inputs.forEach((input) => {
    if (!input || typeof input !== 'object' || input._bind === undefined) return;
    const b = plainObject(input._bind);
    if (!b) {
      warn(warnings, 'bind-not-object',
        String(input.NAME) + ': _bind must be an object { source, min, max } (standard §6.14 D); ignored.',
        String(input.NAME));
      return;
    }
    const id = typeof b.source === 'string' ? b.source : (plainObject(b.source) ? b.source.id : undefined);
    const transform = {};
    if (b.min !== undefined) transform.min = b.min;
    if (b.max !== undefined) transform.max = b.max;
    put({
      target: input.NAME,
      source: { id, kind: kindFromSourceId(id) },
      transform: Object.keys(transform).length ? transform : null,
      oscillator: null,
      active: true,
      from: '_bind',
    });
  });

  // §6.6 — A8_ANIMATE is EXACTLY a receiver with no source, so the upgrade is
  // mechanical. Accepted forever; never rewritten in the file (N6).
  (a8.animate || []).forEach((d) => {
    const dir = plainObject(d);
    if (!dir) return;
    put({
      target: dir.input,
      source: null,
      transform: null,
      oscillator: {
        curve: dir.curve,
        rate: dir.rate,
        depth: dir.depth,
        phase: dir.phase,
        bipolar: dir.bipolar,
        base: dir.baseValue,
      },
      active: true,
      from: 'A8_ANIMATE',
    });
  });

  return out;
}

// Per-input extension fields → one normalized object (standard §6.3). Returns
// null when the input carries no extension content at all.
function extractInputExt(input, idx, warnings, legacySeen) {
  const where = input.NAME !== undefined ? String(input.NAME) : ('INPUTS[' + idx + ']');
  const ui = {};
  let any = false;

  const take = (field, target) => {
    if (input[field] === undefined) return;
    ui[target] = input[field];
    any = true;
  };

  take('_groupId', 'groupId');
  take('_groupLabel', 'groupLabel');
  take('_headerSlot', 'headerSlot');
  take('_contextGate', 'contextGate');
  take('_contextHeaderGate', 'contextHeaderGate');
  take('_menuOnly', 'menuOnly');
  take('_a8ManagedSlot', 'managedSlot');
  take('_audioRole', 'audioRole');
  take('BIPOLAR', 'bipolar');
  take('TICKS', 'ticks');
  take('SNAP_TICKS', 'snapTicks');
  take('PLAIN', 'plain');

  // §6.14 A — PORTABLE presentation. A foreign player honours these with no A8os
  // knowledge; without them it renders a flat, wrongly-labelled, wrongly-ordered
  // control list — it can show the controls but not the surface the author built.
  take('_rowId', 'rowId');
  take('_groupParent', 'groupParent');
  take('_stackOrder', 'stackOrder');
  take('_valueSubgroups', 'valueSubgroups');
  take('_labelBy', 'labelBy');
  take('_contextRange', 'contextRange');
  take('_derive', 'derive');
  take('_noTimeTwin', 'noTimeTwin');
  take('_layerRow', 'layerRow');
  take('_slotEntryRow', 'slotEntryRow');
  // §6.14 B — DECLARED ROLES. Both replaced a PREFIX MATCH on a group id, which
  // is the PER-TYPE-IDENTIFIER-NAMESPACE failure: a capability must belong to the
  // MEDIUM, never to a card type.
  take('_lightRig', 'lightRig');
  take('_shapeMath', 'shapeMath');
  // §6.14 C — A8OS-SPECIFIC host bookkeeping. Parsed, preserved, IGNORED.
  take('_engineOnly', 'engineOnly');
  take('_a8DebugTap', 'a8DebugTap');
  take('_a8Synthetic', 'a8Synthetic');
  take('_hueFamily', 'hueFamily');
  // §6.14 D — the per-input modulation shorthand. Behaviour, not presentation.
  take('_bind', 'bind');

  // Synonym fields: the neutral canonical name wins; the shipped spelling is a
  // grandfathered synonym accepted forever (OPEN RULING 4 verdict (b) for the
  // `_glyOp*` family; §6.14 A + §10.1 for `_groupBlendable` / `TRANSPORT_DOMAIN`).
  const synonyms = {};
  Object.keys(OP_FIELD_SYNONYMS).forEach((k) => { synonyms[k] = OP_FIELD_SYNONYMS[k]; });
  Object.keys(FIELD_SYNONYMS).forEach((k) => { synonyms[k] = FIELD_SYNONYMS[k]; });
  Object.keys(synonyms).forEach((canon) => {
    const legacy = synonyms[canon];
    const target = canon.slice(1);            // _op → op, _opIdentity → opIdentity
    const hasCanon = input[canon] !== undefined;
    const hasLegacy = input[legacy] !== undefined;
    if (!hasCanon && !hasLegacy) return;
    if (hasCanon && hasLegacy && input[canon] !== input[legacy]) {
      warn(warnings, 'op-field-conflict',
        where + ': both ' + canon + ' and legacy ' + legacy + ' are present with different values; '
        + canon + ' wins (standard §6.3 naming ruling).', where);
    } else if (!hasCanon && legacySeen && !legacySeen[legacy]) {
      legacySeen[legacy] = true;
      // The OP family keeps its own code — the `_glyOp*` notice predates the
      // §6.14 synonyms and callers group on it.
      warn(warnings,
        Object.prototype.hasOwnProperty.call(OP_FIELD_SYNONYMS, canon) ? 'op-field-legacy' : 'field-legacy-synonym',
        legacy + ' is a grandfathered synonym for ' + canon
        + '; new emissions should use the neutral name (standard §6.3 naming ruling). '
        + 'Reported once per file (first seen on ' + where + ').', where);
    }
    ui[target] = hasCanon ? input[canon] : input[legacy];
    any = true;
  });

  // X2 — unrecognized underscore fields are RESERVED: preserve, ignore, warn.
  Object.keys(input).forEach((key) => {
    if (key.charAt(0) !== '_') return;
    if (INPUT_EXT_FIELDS.indexOf(key) !== -1) return;
    if (!ui.unknown) ui.unknown = {};
    ui.unknown[key] = input[key];
    any = true;
    warn(warnings, 'input-ext-unknown',
      where + ': unknown extension field ' + key + ' — reserved for a future version, '
      + 'preserved and ignored (standard §6.3 X2, §10).', where);
  });

  return any ? ui : null;
}

// "1" vs "1.2" vs "2" — numeric-segment compare, tolerant of junk.
function compareVsn(a, b) {
  const pa = String(a).split('.');
  const pb = String(b).split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const na = parseInt(pa[i], 10) || 0;
    const nb = parseInt(pb[i], 10) || 0;
    if (na !== nb) return na < nb ? -1 : 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// validate — standard §9.3, rules V1..V9
// ---------------------------------------------------------------------------

// validate(model | fsText) → { ok, level, levelDetail[], errors[], warnings[], info[], skipped[] }
//
// `ok` is true iff errors[] is empty. Every entry carries `{ rule, code,
// message, path? }` so a caller can group by rule (V1..V12) or by file location.
// V9 (does the body compile) is always reported in `skipped[]` — this module
// has no GL context and the standard forbids reporting it as passed.
//
// `level` is the CONFORMANCE CLASS the file DEMANDS (§6.18): the highest host rung
// required to honour everything the file declares, 0 (vanilla ISF) .. 4
// (performance). §9.1/§6.18 define the ladder for HOSTS, so a file's level is
// stated as the demand it places on one — which is the only reading that makes
// "what does a player need in order to play this correctly?" answerable from the
// file alone. `levelDetail[]` says which declaration forced each rung.
//
// A string argument is parsed first; a file that cannot yield a model at all
// reports that as the single V1 error rather than throwing, so a caller can batch
// a corpus without a try/catch per file.
function validate(model) {
  const errors = [];
  const warnings = [];
  const info = [];
  const skipped = [];

  if (typeof model === 'string') {
    try {
      model = parse(model);
    } catch (e) {
      return {
        ok: false,
        level: null,
        levelDetail: [],
        errors: [{ rule: 'V1', code: (e && e.code) || 'metadata-json', message: (e && e.message) || String(e) }],
        warnings: [],
        info: [],
        skipped: [],
      };
    }
  }

  if (!model || typeof model !== 'object') {
    return {
      ok: false,
      level: null,
      levelDetail: [],
      errors: [{ rule: 'V1', code: 'no-model', message: 'validate() requires a model from ISF2.parse(), or ISF2 source text.' }],
      warnings: [],
      info: [],
      skipped: [],
    };
  }

  const err = (rule, code, message, path) => errors.push(path === undefined
    ? { rule, code, message } : { rule, code, message, path });
  const wrn = (rule, code, message, path) => warnings.push(path === undefined
    ? { rule, code, message } : { rule, code, message, path });
  const inf = (rule, code, message, path) => info.push(path === undefined
    ? { rule, code, message } : { rule, code, message, path });

  // V1 — structure. parse() already threw on a missing/undecodable block, so
  // reaching validate means V1's hard half passed; carry the parse findings
  // (json leniency, header position, unknown keys) through as warnings.
  (model.warnings || []).forEach((w) => {
    warnings.push({ rule: w.code === 'json-lenient' || w.code === 'header-not-first' ? 'V1' : 'V-parse',
      code: w.code, message: w.message, path: w.path });
  });

  const inputs = model.inputs || [];
  const names = {};

  // V2 — inputs.
  inputs.forEach((input, idx) => {
    const where = 'INPUTS[' + idx + ']';
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      err('V2', 'input-not-object', where + ' is not an object.', where);
      return;
    }
    const name = input.NAME;
    const label = input.NAME !== undefined ? String(input.NAME) : where;

    if (name === undefined || name === null || name === '') {
      err('V2', 'input-no-name', where + ' has no NAME (standard §5).', where);
    } else if (typeof name !== 'string' || !GLSL_IDENT.test(name)) {
      err('V2', 'input-bad-name', where + ': NAME "' + name + '" is not a valid GLSL identifier.', label);
    } else if (name.indexOf('gl_') === 0) {
      err('V2', 'input-reserved-name', label + ': NAME may not use the reserved gl_ prefix.', label);
    } else if (names[name]) {
      err('V2', 'input-duplicate-name', 'Duplicate input NAME "' + name + '" (must be unique within the file).', label);
    } else {
      names[name] = true;
    }

    const type = input.TYPE;
    if (type === undefined) {
      err('V2', 'input-no-type', label + ' has no TYPE (standard §5).', label);
    } else if (!Object.prototype.hasOwnProperty.call(INPUT_TYPES, type)) {
      err('V2', 'input-bad-type', label + ': unknown TYPE "' + type + '" (standard §5.1).', label);
    } else if (RENDERABLE_INPUT_TYPES.indexOf(type) === -1) {
      // audio / audioFFT — legal to declare, but the bundled renderer builds no
      // uniform for them; hosts satisfy them as image samplers (standard §8.3).
      wrn('V2', 'input-type-needs-host-support',
        label + ': TYPE "' + type + '" is declared-legal but the reference renderer maps no uniform for it; '
        + 'hosts satisfy it as an image sampler carrying audio texture data, or bind silence (standard §8.3, D6).', label);
    }

    if (input.LABEL !== undefined && typeof input.LABEL !== 'string') {
      err('V2', 'input-bad-label', label + ': LABEL must be a string (an explicit "" is valid and means "no label").', label);
    }
    if (input.DESCRIPTION !== undefined && typeof input.DESCRIPTION !== 'string') {
      err('V2', 'input-bad-description', label + ': DESCRIPTION must be a string (standard §5, §5.2).', label);
    }

    validateInputValueShapes(input, label, err, wrn);
    validateInputExtShapes(input, label, err);
  });

  // V3 — passes.
  (model.passes || []).forEach((pass, idx) => {
    const where = 'PASSES[' + idx + ']';
    if (!pass || typeof pass !== 'object' || Array.isArray(pass)) {
      err('V3', 'pass-not-object', where + ' is not an object.', where);
      return;
    }
    if (pass.TARGET !== undefined) {
      if (typeof pass.TARGET !== 'string' || !GLSL_IDENT.test(pass.TARGET)) {
        err('V3', 'pass-bad-target', where + ': TARGET "' + pass.TARGET + '" is not a valid GLSL identifier '
          + '(it becomes a sampler2D uniform — standard §7.4).', where);
      } else if (names[pass.TARGET]) {
        err('V3', 'pass-target-collision', where + ': TARGET "' + pass.TARGET
          + '" collides with a declared input name.', where);
      }
    }
    if (pass.PERSISTENT !== undefined && typeof pass.PERSISTENT !== 'boolean'
        && pass.PERSISTENT !== 0 && pass.PERSISTENT !== 1 && pass.PERSISTENT !== 'true' && pass.PERSISTENT !== 'false') {
      wrn('V3', 'pass-persistent-shape', where + ': PERSISTENT should be a boolean (standard §7.4).', where);
    }
    if (pass.FLOAT !== undefined && typeof pass.FLOAT !== 'boolean') {
      wrn('V3', 'pass-float-shape', where + ': FLOAT should be a boolean (standard §7.4).', where);
    }
    ['WIDTH', 'HEIGHT'].forEach((dim) => {
      if (pass[dim] === undefined) return;
      if (typeof pass[dim] === 'number') return;
      if (typeof pass[dim] !== 'string') {
        err('V3', 'pass-bad-size-type', where + ': ' + dim + ' must be a number or a size-expression string.', where);
        return;
      }
      const bad = sizeExpressionProblem(pass[dim], names);
      if (bad) err('V3', 'pass-bad-size-expr', where + ': ' + dim + ' expression "' + pass[dim] + '" — ' + bad, where);
    });
  });

  // V4 — A8_ANIMATE.
  const a8 = model.a8 || {};
  if (model.meta && model.meta.A8_ANIMATE !== undefined && !Array.isArray(model.meta.A8_ANIMATE)) {
    err('V4', 'animate-not-array', 'A8_ANIMATE must be an array (standard §6.2.1).');
  }
  (a8.animate || []).forEach((d, idx) => {
    const where = 'A8_ANIMATE[' + idx + ']';
    if (!d || typeof d !== 'object' || Array.isArray(d)) {
      err('V4', 'animate-not-object', where + ' is not an object.', where);
      return;
    }
    if (typeof d.input !== 'string' || !d.input) {
      err('V4', 'animate-no-input', where + ': `input` is required and must name a declared input.', where);
    } else if (!names[d.input]) {
      err('V4', 'animate-unknown-input', where + ': `input` "' + d.input + '" is not a declared INPUT.', where);
    }
    if (typeof d.curve !== 'string' || !d.curve) {
      err('V4', 'animate-no-curve', where + ': `curve` is required and must be a string.', where);
    } else if (KNOWN_CURVES.indexOf(d.curve) === -1) {
      wrn('V4', 'animate-unknown-curve', where + ': unknown curve "' + d.curve
        + '" — hosts degrade to no animation (standard §6.2.1).', where);
    }
    if (typeof d.rate !== 'number' || !isFinite(d.rate)) {
      err('V4', 'animate-bad-rate', where + ': `rate` is required and must be a finite number (Hz).', where);
    }
    if (typeof d.depth !== 'number' || !isFinite(d.depth)) {
      err('V4', 'animate-bad-depth', where + ': `depth` is required and must be a finite number.', where);
    }
    if (d.phase !== undefined && (typeof d.phase !== 'number' || !isFinite(d.phase))) {
      err('V4', 'animate-bad-phase', where + ': `phase` must be a number (0-1 of one cycle).', where);
    }
    if (d.bipolar !== undefined && typeof d.bipolar !== 'boolean') {
      err('V4', 'animate-bad-bipolar', where + ': `bipolar` must be a boolean.', where);
    }
    if (d.baseValue !== undefined && (typeof d.baseValue !== 'number' || !isFinite(d.baseValue))) {
      err('V4', 'animate-bad-basevalue', where + ': `baseValue` must be a number.', where);
    }
  });

  // A8_CAMERA (standard §6.2.2 + §6.11 reconciled). Not a numbered rule; V8
  // depends on it. `mode` is the capability FLAG and `state` is the authored view
  // — two incompatible shapes lived under one name, and the flat state map is
  // GRANDFATHERED, so an ABSENT `mode` is correct and must never warn.
  if (a8.camera) {
    if (a8.camera.mode !== null && a8.camera.mode !== 'ray') {
      wrn('V8', 'camera-unknown-mode', 'A8_CAMERA.mode "' + a8.camera.mode
        + '" is not defined (only "ray"); ignored (standard §6.2.2, §6.11).');
    } else if (a8.camera.mode === 'ray' && model.body && model.body.indexOf('a8CameraRay(') === -1) {
      wrn('V8', 'camera-hook-missing', 'A8_CAMERA declares mode "ray" but the body contains no '
        + 'a8CameraRay(uv, ro, rd) call site (standard §6.2.2).');
    }
    if (a8.camera.model !== null && CAMERA_MODELS.indexOf(a8.camera.model) === -1) {
      err('V8', 'camera-bad-model', 'A8_CAMERA.model "' + a8.camera.model + '" is not one of '
        + CAMERA_MODELS.join(' / ') + ' (standard §6.11).');
    }
    Object.keys(a8.camera.state).forEach((k) => {
      if (!Object.prototype.hasOwnProperty.call(CAMERA_STATE, k)) {
        wrn('V8', 'camera-unknown-state', 'A8_CAMERA.state carries "' + k
          + '", which is not in the Appendix B iCam* roster; preserved and ignored (standard §10).', k);
        return;
      }
      const dom = CAMERA_STATE[k];
      const v = a8.camera.state[k];
      if (dom.enum) {
        if (dom.enum.indexOf(v) === -1) {
          err('V8', 'camera-bad-state-enum', 'A8_CAMERA.state.' + k + ' must be one of '
            + dom.enum.join(' / ') + ' (Appendix B).', k);
        }
        return;
      }
      if (typeof v !== 'number' || !isFinite(v)) {
        err('V8', 'camera-bad-state-value', 'A8_CAMERA.state.' + k
          + ' must be a finite number in the STATE domain (standard §6.11, Appendix B).', k);
      } else if (v < dom.min || v > dom.max) {
        wrn('V8', 'camera-state-out-of-domain', 'A8_CAMERA.state.' + k + ' = ' + v
          + ' is outside the Appendix B domain [' + dom.min + ', ' + dom.max + '].', k);
      }
    });
    if (a8.camera.legacy) {
      inf('V8', 'camera-grandfathered', 'A8_CAMERA carries the grandfathered flat iCam* state map; '
        + 'read as { model, state } (standard §10.1).');
    }
  }

  // V5 — A8_PROVENANCE.
  if (a8.provenance) {
    const p = a8.provenance;
    if (typeof p.version !== 'string' || !p.version) {
      err('V5', 'prov-no-version', 'A8_PROVENANCE.version is required (currently "1.0").');
    }
    if (!p.origin || typeof p.origin !== 'object' || Array.isArray(p.origin)) {
      err('V5', 'prov-no-origin', 'A8_PROVENANCE.origin is required and must be an object.');
    } else if (typeof p.origin.license !== 'string' || !p.origin.license) {
      wrn('V5', 'prov-no-license', 'A8_PROVENANCE.origin.license is missing; license aggregation and the '
        + 'export gate depend on it (standard §6.2.3 P3).');
    }
    // §6.16 (1) — model-composition RECEIPTS. The record of a decision IS
    // provenance, so it lives inside the block rather than in a parallel
    // top-level key. Otherwise opaque to the validator: a consumer that does not
    // understand receipts still MUST preserve them (P2).
    if (p.generation !== undefined) {
      if (!Array.isArray(p.generation)) {
        err('V5', 'prov-generation-not-array', 'A8_PROVENANCE.generation must be an array of receipts (standard §6.16).');
      } else {
        p.generation.forEach((g, gi) => {
          const gw = 'A8_PROVENANCE.generation[' + gi + ']';
          if (!plainObject(g)) {
            err('V5', 'prov-generation-not-object', gw + ' is not an object.', gw);
          } else if (typeof g.schemaVersion !== 'string' || !g.schemaVersion) {
            err('V5', 'prov-generation-no-schema', gw + ': `schemaVersion` is required on every receipt (standard §6.16).', gw);
          }
        });
      }
    }
    if (!Array.isArray(p.chain)) {
      err('V5', 'prov-no-chain', 'A8_PROVENANCE.chain is required and must be an array of events.');
    } else {
      p.chain.forEach((ev, idx) => {
        const where = 'A8_PROVENANCE.chain[' + idx + ']';
        if (!ev || typeof ev !== 'object' || Array.isArray(ev)) {
          err('V5', 'prov-event-not-object', where + ' is not an object.', where);
          return;
        }
        ['action', 'timestamp', 'by', 'contentHash'].forEach((f) => {
          if (ev[f] === undefined || ev[f] === null || ev[f] === '') {
            err('V5', 'prov-event-field', where + ': `' + f + '` is required on every chain event.', where);
          }
        });
        // §6.2.3's table says "(ms epoch)"; the SHIPPED producer writes an
        // ISO-8601 STRING (prvAppend, app/js/provenance.js:35), and the standard
        // annotates its own table to say so — "any validator tightening it to a
        // number would REJECT the whole A8os output". Both are accepted; the
        // string form is reported so the divergence stays visible rather than
        // becoming silent precedent.
        if (ev.timestamp !== undefined && typeof ev.timestamp === 'string') {
          inf('V5', 'prov-event-timestamp-iso', where + ': `timestamp` is an ISO-8601 string; the §6.2.3 '
            + 'table says ms-epoch number. Both accepted (standard §6.2.3 annotation).', where);
        } else if (ev.timestamp !== undefined && typeof ev.timestamp !== 'number') {
          err('V5', 'prov-event-timestamp', where + ': `timestamp` must be a number (ms epoch) '
            + 'or an ISO-8601 string.', where);
        }
      });
    }
  }

  // V6 — extension neutrality. Stripping every A8_* top-level key and every
  // per-input extension field MUST leave the vanilla input set unchanged, and
  // no extension block may smuggle input-shaped declarations.
  validateNeutrality(model, err);

  // V7 — gate / companion references resolve.
  inputs.forEach((input, idx) => {
    if (!input || typeof input !== 'object') return;
    const label = input.NAME !== undefined ? String(input.NAME) : ('INPUTS[' + idx + ']');
    // §6.14 gate-grammar extension: `_contextRange` takes the SAME grammar.
    ['_contextGate', '_contextHeaderGate', '_contextRange'].forEach((field) => {
      if (input[field] !== undefined) validateGate(input[field], field, label, names, err);
    });
    const companion = input._opCompanion !== undefined ? input._opCompanion : input._glyOpCompanion;
    if (companion !== undefined && (typeof companion !== 'string' || !names[companion])) {
      err('V7', 'companion-unknown-input', label + ': operator companion "' + companion
        + '" does not resolve to a declared input.', label);
    }
  });

  // V8 — the iCam* namespace is reserved for host camera integration.
  if (model.body) {
    const camRe = /\buniform\s+\w+\s+(iCam\w*)/g;
    let m = camRe.exec(model.body);
    while (m) {
      if (!a8.camera) {
        err('V8', 'icam-declared', 'The body declares uniform "' + m[1]
          + '"; the iCam* namespace is reserved for host camera integration (standard §6.2.2, V8).');
      }
      m = camRe.exec(model.body);
    }
  }

  // ---- A8VSN 2 blocks (§6.5 - §6.13) + V10 / V11 / V12 --------------------
  validatePresets(a8, names, err, wrn, inf);
  validateModulation(a8, names, err, wrn);
  validateOps(a8, err, wrn, inf);
  validateRaymarchOps(a8, err);
  validateFold(a8, names, wrn);
  validateLayers(a8, inputs, err, wrn);
  validatePlayback(a8, err, wrn);
  validateBinds(inputs, err);                      // V11
  validateDescriptions(model, inputs, wrn);        // V12

  // V9 — compilation. No GL here, and the standard forbids reporting it passed.
  skipped.push({
    rule: 'V9',
    reason: 'no GL context — body compilation is not checked by ISF2.validate (standard §9.3 V9). '
      + 'Compile via ISFParser/ISFRenderer or the corpus regression harness.',
  });

  const lv = conformanceLevel(model);
  lv.detail.forEach((d) => {
    inf('L' + d.level, 'level-demand', 'Level ' + d.level + ' — ' + d.why, d.path);
  });

  return { ok: errors.length === 0, level: lv.level, levelDetail: lv.detail, errors, warnings, info, skipped };
}

// ---------------------------------------------------------------------------
// A8VSN 2 block validation (standard §6.5 - §6.13, V10 - V12)
// ---------------------------------------------------------------------------

// §6.5 + V10. THE reference-renderer obligation for presets is stated in §6.5
// ("PARSE + VALIDATE — every params / ranges / inverts key names a declared
// input") and was checked by NOTHING before V10 was ratified: a `params` key that
// is a typo is a silent no-op, which is the GATE-FAILS-OPEN shape.
function validatePresets(a8, names, err, wrn, inf) {
  const presets = a8.presets;
  if (!presets) return;
  if (presets.legacy) {
    inf('V10', 'presets-grandfathered', 'Preset bank read from the grandfathered A8_CARD_PRESETS; '
      + 'consumers MUST accept it forever, producers emit A8_PRESETS from A8VSN 2 (standard §6.17).');
  }

  const slot = (where, sl) => {
    if (!plainObject(sl)) {
      err('V10', 'preset-slot-not-object', where + ' is not an object.', where);
      return;
    }
    ['params', 'ranges', 'inverts'].forEach((field) => {
      if (sl[field] === undefined) return;
      const map = plainObject(sl[field]);
      if (!map) {
        err('V10', 'preset-field-not-object', where + '.' + field + ' must be an object keyed by input NAME.', where);
        return;
      }
      Object.keys(map).forEach((k) => {
        if (!names[k]) {
          err('V10', 'preset-unknown-param', where + '.' + field + ' names "' + k
            + '", which is not a declared INPUT (standard §9.3 V10).', where);
        }
      });
    });
    // §6.5 — "`ranges` are BRACKETS, not MIN/MAX": the performer's operating
    // window inside the declared domain, and the span a bound modulator sweeps.
    // A player honouring only MIN/MAX sweeps the wrong span, which looks like a
    // broken modulator and is not.
    const ranges = plainObject(sl.ranges);
    if (ranges) {
      Object.keys(ranges).forEach((k) => {
        const r = ranges[k];
        if (!Array.isArray(r) || r.length !== 2 || !r.every(v => typeof v === 'number' && isFinite(v))) {
          err('V10', 'preset-bad-range', where + '.ranges.' + k + ' must be a two-element numeric bracket '
            + '[lo, hi] (standard §6.5).', where);
        }
      });
    }
    // §6.5 — "opacity is the per-channel [r,g,b,a] vector … Never a scalar."
    if (sl.opacity !== undefined) {
      if (typeof sl.opacity === 'number') {
        err('V10', 'preset-scalar-opacity', where + '.opacity is a scalar; it is the per-channel '
          + '[r,g,b,a] vector, with `a` derived as max(r,g,b) (standard §6.5, normative).', where);
      } else if (!Array.isArray(sl.opacity) || sl.opacity.length !== 4
                 || !sl.opacity.every(v => typeof v === 'number' && isFinite(v))) {
        wrn('V10', 'preset-opacity-arity', where + '.opacity should be four numbers [r,g,b,a] (standard §6.5).', where);
      }
    }
    if (sl.deactivated !== undefined && !Array.isArray(sl.deactivated)) {
      err('V10', 'preset-bad-deactivated', where + '.deactivated must be an array of input NAMEs.', where);
    }
    Object.keys(sl).forEach((k) => {
      if (PRESET_SLOT_FIELDS.indexOf(k) === -1) {
        wrn('V10', 'preset-unknown-slot-field', where + ': unknown slot field "' + k
          + '" — preserved and ignored (standard §10).', where);
      }
    });
  };

  Object.keys(presets.bank).forEach((id) => {
    if (PRESET_SLOT_IDS.indexOf(String(id)) === -1) {
      wrn('V10', 'preset-unknown-slot-id', 'Preset slot "' + id + '" is outside the defined set '
        + '(D, 1-11 — an absent slot is ABSENT, never null-padded; standard §6.5).', String(id));
    }
    slot('A8_PRESETS.bank.' + id, presets.bank[id]);
  });
  Object.keys(presets.groupBanks).forEach((gid) => {
    const bank = plainObject(presets.groupBanks[gid]);
    if (!bank) {
      err('V10', 'group-bank-not-object', 'A8_PRESETS.groupBanks.' + gid + ' must be an object of slots.', gid);
      return;
    }
    Object.keys(bank).forEach((id) => { slot('A8_PRESETS.groupBanks.' + gid + '.' + id, bank[id]); });
  });
}

// §6.6 — PARSE-AND-IGNORE + VALIDATE. The reference renderer hosts no modulation,
// so it never RUNS one; what it owes is that `target` names a declared input,
// `kind` is a defined value, and the transform ranges are two-element numeric
// arrays. An UNRESOLVABLE `source.id` is explicitly NOT an error — it is a missing
// performance input, never a malformed file (§6.6, the three-step fallback).
function validateModulation(a8, names, err, wrn) {
  if (!a8.modulation) return;
  const list = a8.modulation.receivers;
  if (list === undefined) return;
  if (!Array.isArray(list)) {
    err('V4', 'modulation-not-array', 'A8_MODULATION.receivers must be an array (standard §6.6).');
    return;
  }
  list.forEach((r, idx) => {
    const where = 'A8_MODULATION.receivers[' + idx + ']';
    const rec = plainObject(r);
    if (!rec) {
      err('V4', 'modulation-not-object', where + ' is not an object.', where);
      return;
    }
    if (typeof rec.target !== 'string' || !names[rec.target]) {
      err('V4', 'modulation-unknown-target', where + ': `target` "' + rec.target
        + '" is not a declared INPUT (standard §6.6).', where);
    }
    const src = plainObject(rec.source);
    if (src && src.kind !== undefined && MODULATION_KINDS.indexOf(src.kind) === -1) {
      err('V4', 'modulation-bad-kind', where + ': source.kind "' + src.kind + '" is not one of '
        + MODULATION_KINDS.join(' / ') + ' (standard §6.6 — `kind` is the PORTABLE part).', where);
    }
    if (src && src.range !== undefined) numericPair(src.range, where + '.source.range', err);
    const tf = plainObject(rec.transform);
    if (rec.transform !== undefined && !tf) {
      err('V4', 'modulation-bad-transform', where + ': `transform` must be an object (standard §6.6).', where);
    } else if (tf) {
      ['srcRange', 'dstRange'].forEach((f) => {
        if (tf[f] !== undefined) numericPair(tf[f], where + '.transform.' + f, err);
      });
    }
    const osc = plainObject(rec.oscillator);
    if (osc && typeof osc.curve === 'string' && KNOWN_CURVES.indexOf(osc.curve) === -1) {
      // §6.6 — the live oscillator uses a `curveId` into the easing library, not
      // a bare waveform name, so an unrecognized curve is a LIBRARY reference
      // this module cannot resolve, never a malformation.
      wrn('V4', 'modulation-unknown-curve', where + ': curve "' + osc.curve
        + '" is not a built-in waveform; hosts resolve it against their easing library (standard §6.6).', where);
    }
  });
}

function numericPair(v, where, err) {
  if (!Array.isArray(v) || v.length !== 2 || !v.every(n => typeof n === 'number' && isFinite(n))) {
    err('V4', 'modulation-bad-range', where + ' must be a two-element numeric array (standard §6.6).', where);
  }
}

// §6.7 — active-only scope → { opName: amount }. An UNKNOWN OP NAME IS IGNORED,
// which degrades to that op's identity, so it is never an error. `view` is RETIRED
// at every seam and a producer MUST NOT emit it.
function validateOps(a8, err, wrn, inf) {
  if (!a8.ops) return;
  Object.keys(a8.ops).forEach((scope) => {
    if (OPS_SCOPES_RETIRED.indexOf(scope) !== -1) {
      wrn('V7', 'ops-retired-scope', 'A8_OPS.' + scope + ' is RETIRED and MUST NOT be emitted; '
        + 'consumers treat it as an unknown scope (standard §6.7, Appendix A tail).', scope);
    } else if (OPS_SCOPES.indexOf(scope) === -1) {
      inf('V7', 'ops-unknown-scope', 'A8_OPS.' + scope + ' is not a scope defined today; scopes are OPEN, '
        + 'so a host without the splice seam ignores it (standard §6.7).', scope);
    }
    const map = plainObject(a8.ops[scope]);
    if (!map) {
      err('V7', 'ops-scope-not-object', 'A8_OPS.' + scope + ' must be an object of { opName: amount } (standard §6.7).', scope);
      return;
    }
    const roster = scope === 'world' ? OPS_WORLD : (scope === 'raymarch' ? OPS_RAYMARCH : null);
    Object.keys(map).forEach((op) => {
      if (roster && roster.indexOf(op) === -1) {
        inf('V7', 'ops-unknown-name', 'A8_OPS.' + scope + '.' + op + ' is not in the Appendix A roster; '
          + 'unknown op names are IGNORED, which degrades to that op\'s identity (standard §6.7).', op);
      }
    });
  });
}

// §6.8 — PARSE-AND-IGNORE + VALIDATE: `hooks` ⊆ the four names, `starters` ⊆ the
// Appendix A raymarch roster.
function validateRaymarchOps(a8, err) {
  const b = a8.raymarchOps;
  if (!b) return;
  if (b.base !== undefined && (typeof b.base !== 'string' || !b.base)) {
    err('V7', 'raymarch-bad-base', 'A8_RAYMARCH_OPS.base must be a non-empty uniform-name prefix (standard §6.8).');
  }
  if (b.hooks !== undefined) {
    if (!Array.isArray(b.hooks)) {
      err('V7', 'raymarch-hooks-not-array', 'A8_RAYMARCH_OPS.hooks must be an array (standard §6.8).');
    } else {
      b.hooks.forEach((h) => {
        if (RAYMARCH_HOOKS.indexOf(h) === -1) {
          err('V7', 'raymarch-unknown-hook', 'A8_RAYMARCH_OPS.hooks carries "' + h + '"; the splice points are '
            + RAYMARCH_HOOKS.join(' / ') + ' (standard §6.8).', String(h));
        }
      });
    }
  }
  if (b.starters !== undefined) {
    if (!Array.isArray(b.starters)) {
      err('V7', 'raymarch-starters-not-array', 'A8_RAYMARCH_OPS.starters must be an array (standard §6.8).');
    } else {
      b.starters.forEach((op) => {
        if (OPS_RAYMARCH.indexOf(op) === -1) {
          err('V7', 'raymarch-unknown-starter', 'A8_RAYMARCH_OPS.starters carries "' + op
            + '", which is not in the Appendix A.2 raymarch roster (standard §6.8).', String(op));
        }
      });
    }
  }
  if (b.renderScale !== undefined && (typeof b.renderScale !== 'number' || !isFinite(b.renderScale))) {
    err('V7', 'raymarch-bad-renderscale', 'A8_RAYMARCH_OPS.renderScale must be a number (standard §6.8).');
  }
}

// §6.9 — purely an optimisation HINT, and the one block a host may ignore with
// ZERO visual consequence. `drivers` is the only normative member. Nothing here is
// ever an error: a host with no fold model pushes every input as a uniform, which
// is correct, just not optimal.
function validateFold(a8, names, wrn) {
  const f = a8.fold;
  if (!f || f.drivers === undefined) return;
  const drivers = plainObject(f.drivers);
  if (!drivers) {
    wrn('V7', 'fold-drivers-not-object', 'A8_FOLD.drivers should be an object of feature → [inputName] (standard §6.9).');
    return;
  }
  Object.keys(drivers).forEach((feature) => {
    const list = drivers[feature];
    if (!Array.isArray(list)) {
      wrn('V7', 'fold-driver-not-array', 'A8_FOLD.drivers.' + feature + ' should be an array of input NAMEs.', feature);
      return;
    }
    list.forEach((n) => {
      if (!names[n]) {
        wrn('V7', 'fold-unknown-driver', 'A8_FOLD.drivers.' + feature + ' names "' + n
          + '", which is not a declared INPUT; the hint is ignored for it (standard §6.9).', feature);
      }
    });
  });
}

// §6.12 — PARSE-AND-IGNORE + VALIDATE: `layers` keys are integer strings, and
// every declared slot has a DECLARING GROUP. A group DECLARES that it hosts a slot;
// it is never recognised by a prefix in its id — the baked header declares at
// ingest by the group id's SHAPE (`bg` ⇒ background, `layer:<n>` ⇒ fill layer n),
// which is the portable rule: ANY fragment shader declaring such a group gets a
// slot, with no card type to check.
function validateLayers(a8, inputs, err, wrn) {
  if (!a8.layers) return;
  const groups = {};
  inputs.forEach((input) => {
    if (input && typeof input === 'object' && typeof input._groupId === 'string') groups[input._groupId] = true;
  });

  const fills = a8.layers.layers;
  if (fills !== undefined && !plainObject(fills)) {
    err('V7', 'layers-not-object', 'A8_LAYERS.layers must be an object keyed by integer-string layer index (standard §6.12).');
  } else if (fills) {
    Object.keys(fills).forEach((k) => {
      if (!/^\d+$/.test(k)) {
        err('V7', 'layers-bad-key', 'A8_LAYERS.layers key "' + k + '" is not an integer string (standard §6.12).', k);
      }
    });
  }

  a8.slots.forEach((slot) => {
    const gid = slot.role === 'bg' ? 'bg' : ('layer:' + slot.layerIndex);
    if (!groups[gid]) {
      err('V7', 'layer-slot-undeclared', 'A8_LAYERS.' + slot.key + ' fills a slot no group declares — '
        + 'no input carries _groupId "' + gid + '" (standard §6.12).', slot.key);
    }
    if (slot.mapping !== null && TEX_MAPPINGS.indexOf(slot.mapping) === -1) {
      wrn('V7', 'layer-unknown-mapping', 'A8_LAYERS.' + slot.key + '.mapping "' + slot.mapping
        + '" is not in the published roster (' + TEX_MAPPINGS.join(' / ') + '); host default applies.', slot.key);
    }
    // §6.12 — a ref a host cannot resolve leaves the slot EMPTY and renders with
    // the slot's declared default. NEVER a failed load.
    if (!slot.inline && slot.ref && slot.ref.name === undefined && slot.ref.path === undefined) {
      wrn('V7', 'layer-empty-ref', 'A8_LAYERS.' + slot.key + '.ref carries neither inline `data` nor a '
        + 'resolvable name/path; the slot renders empty (standard §6.12).', slot.key);
    }
  });
}

// §6.13 — four per-artifact playback levers that are not app chrome: get them
// wrong and the piece plays at the wrong speed, size, aspect, or recalls into the
// wrong state.
function validatePlayback(a8, err, wrn) {
  const p = a8.playback;
  if (!p) return;
  if (p.timeScale !== undefined && (typeof p.timeScale !== 'number' || !isFinite(p.timeScale))) {
    err('V7', 'playback-bad-timescale', 'A8_PLAYBACK.timeScale must be a number (standard §6.13).');
  }
  if (p.renderScale !== undefined && p.renderScale !== 'auto'
      && (typeof p.renderScale !== 'number' || !isFinite(p.renderScale))) {
    err('V7', 'playback-bad-renderscale', 'A8_PLAYBACK.renderScale must be "auto" or a number (standard §6.13).');
  }
  if (p.scaleMode !== undefined && PLAYBACK_SCALE_MODES.indexOf(p.scaleMode) === -1) {
    err('V7', 'playback-bad-scalemode', 'A8_PLAYBACK.scaleMode must be one of '
      + PLAYBACK_SCALE_MODES.join(' / ') + ' (standard §6.13).');
  }
  if (p.processRecall !== undefined && PLAYBACK_RECALL_MODES.indexOf(p.processRecall) === -1) {
    err('V7', 'playback-bad-processrecall', 'A8_PLAYBACK.processRecall must be "seed" or "state" (standard §6.13).');
  }
  const clock = p.clock !== undefined ? plainObject(p.clock) : null;
  if (p.clock !== undefined && !clock) {
    err('V7', 'playback-bad-clock', 'A8_PLAYBACK.clock must be an object (standard §6.13).');
  } else if (clock) {
    // "clock.position is deliberately absent and MUST NOT be added." Recall never
    // teleports time — the same rule that keeps a modulation lane continuous
    // across a preset change.
    if (clock.position !== undefined) {
      err('V7', 'playback-clock-position', 'A8_PLAYBACK.clock.position MUST NOT be present — recall never '
        + 'teleports time (standard §6.13, normative).');
    }
    if (clock.meter !== undefined
        && (!Array.isArray(clock.meter) || clock.meter.length !== 2
            || !clock.meter.every(v => typeof v === 'number' && isFinite(v)))) {
      wrn('V7', 'playback-bad-meter', 'A8_PLAYBACK.clock.meter should be a two-element numeric array, e.g. [4, 4].');
    }
  }
}

// V11 (§9.3, §6.14 D) — `_bind.min/max` MUST lie inside the input's declared
// [MIN, MAX]. A bracket outside its own domain binds to NOTHING: the min/max are
// the performer's operating window inside the declared domain, pushed through
// sxSetRange before the bind, not an affine output range.
function validateBinds(inputs, err) {
  inputs.forEach((input, idx) => {
    if (!input || typeof input !== 'object' || input._bind === undefined) return;
    const label = input.NAME !== undefined ? String(input.NAME) : ('INPUTS[' + idx + ']');
    const b = plainObject(input._bind);
    if (!b) {
      err('V11', 'bind-not-object', label + ': _bind must be an object { source, min, max } (standard §6.14 D).', label);
      return;
    }
    const srcId = typeof b.source === 'string' ? b.source : (plainObject(b.source) ? b.source.id : undefined);
    if (typeof srcId !== 'string' || !srcId) {
      err('V11', 'bind-no-source', label + ': _bind.source is required — it names the modulator this input '
        + 'ships ALIVE bound to (standard §6.14 D).', label);
    }
    const hasDomain = typeof input.MIN === 'number' && typeof input.MAX === 'number';
    ['min', 'max'].forEach((f) => {
      if (b[f] === undefined) return;
      if (typeof b[f] !== 'number' || !isFinite(b[f])) {
        err('V11', 'bind-bad-bracket', label + ': _bind.' + f + ' must be a number (standard §9.3 V11).', label);
        return;
      }
      if (hasDomain && (b[f] < input.MIN || b[f] > input.MAX)) {
        err('V11', 'bind-bracket-out-of-range', label + ': _bind.' + f + ' = ' + b[f]
          + ' lies outside the declared [' + input.MIN + ', ' + input.MAX + ']. A bracket outside its own '
          + 'domain binds to nothing (standard §9.3 V11).', label);
      }
    });
    if (typeof b.min === 'number' && typeof b.max === 'number' && b.min > b.max) {
      err('V11', 'bind-inverted-bracket', label + ': _bind.min is greater than _bind.max (standard §9.3 V11).', label);
    }
  });
}

// V12 (§9.3, §5.2) — per-input DESCRIPTION on every declarable input, plus a
// top-level LONG_DESCRIPTION. WARNING AT LEVEL 1 AND NOTHING MORE: a legacy ISF
// file legitimately carries neither, and a conformance validator must not reject
// one. An AUTHORING gate implements the same rule as an ERROR, because it judges
// work being commissioned rather than a file's conformance — ISF2 conformance is a
// property of the FILE; verify-portrait is a property of the WORK.
//
// "Declarable" is read as AUTHORED: an input carrying a §6.14 C host-minted marker
// was stamped by the engine at runtime, so no author could have described it.
function validateDescriptions(model, inputs, wrn) {
  inputs.forEach((input, idx) => {
    if (!input || typeof input !== 'object') return;
    if (HOST_MINTED_MARKERS.some(m => input[m])) return;
    const label = input.NAME !== undefined ? String(input.NAME) : ('INPUTS[' + idx + ']');
    if (typeof input.DESCRIPTION !== 'string' || !input.DESCRIPTION.trim()) {
      wrn('V12', 'input-no-description', label + ': no DESCRIPTION. Every input carries a one-line '
        + 'DESCRIPTION — what it does to the image, in the performer\'s words — which the host renders as '
        + 'the control\'s tooltip (standard §5.2, §9.3 V12).', label);
    }
  });
  const meta = model.meta || {};
  if (typeof meta.LONG_DESCRIPTION !== 'string' || !meta.LONG_DESCRIPTION.trim()) {
    wrn('V12', 'no-long-description', 'No top-level LONG_DESCRIPTION (2-3 sentences: what the shader is and '
      + 'how it behaves). The library detail + editor info panel render it (standard §5.2, §9.3 V12).');
  }
}

// ---------------------------------------------------------------------------
// Conformance level (standard §6.18 + §9.1)
// ---------------------------------------------------------------------------
//
// §9.1 and §6.18 define the ladder for HOSTS. A FILE's level is therefore stated
// as the DEMAND it places on one: the highest rung a host must implement to
// honour everything the file declares. Each rung is cumulative, and partial
// implementation claims the rung below — so a file demanding 4 is NOT playable
// "at 3 with a bit missing"; it plays wrong in a named way.
//
//   0  vanilla ISF — no extension content at all
//   1  preservation — extension content exists; a Level 1 host parses + preserves
//      every block even where it honours none, so a round trip never destroys
//      state it does not use
//   2  presentation — grouping / gating, warp-operator activation, A8_ANIMATE,
//      the A8_CAMERA ray hook
//   3  state — A8_PRESETS recall, A8_CAMERA.state, A8_OPS, A8_RAYMARCH_OPS
//      splicing, A8_PLAYBACK, the §6.14 presentation family (groups A + B)
//   4  performance — A8_MODULATION (resolved or declared `unresolved`) and
//      A8_LAYERS slot filling
function conformanceLevel(model) {
  const a8 = model.a8 || {};
  const inputs = model.inputs || [];
  const detail = [];
  const need = (level, why, path) => { detail.push({ level, why, path }); };

  if (!a8.isISF2) return { level: 0, detail: [] };
  need(1, 'the file carries extension content, which a host must parse and PRESERVE (§6.18 tail, E3)');

  const anyInput = (pred) => inputs.some(i => i && typeof i === 'object' && pred(i));

  // --- Level 2: presentation / orchestration (§9.1) -------------------------
  if (anyInput(i => i._groupId !== undefined || i._groupLabel !== undefined
                 || i._contextGate !== undefined || i._contextHeaderGate !== undefined
                 || i._headerSlot !== undefined || i._menuOnly !== undefined)) {
    need(2, 'inputs declare grouping / gating (§6.3)');
  }
  if (anyInput(i => i._op !== undefined || i._glyOp !== undefined)) {
    need(2, 'inputs declare warp operators with identity values (§6.3)');
  }
  if (a8.animate && a8.animate.length) need(2, 'A8_ANIMATE declares authored oscillators (§6.2.1)');
  if (a8.camera && a8.camera.mode === 'ray') need(2, 'A8_CAMERA declares the ray hook (§6.2.2)');

  // --- Level 3: state (§6.18) ----------------------------------------------
  if (a8.presets && (Object.keys(a8.presets.bank).length || Object.keys(a8.presets.groupBanks).length)) {
    need(3, 'A8_PRESETS carries a bank a host must recall in the normative order (§6.5)');
  }
  if (a8.camera && Object.keys(a8.camera.state).length) {
    need(3, 'A8_CAMERA.state carries the authored view (§6.11)');
  }
  if (a8.ops && Object.keys(a8.ops).length) {
    need(3, 'A8_OPS declares ACTIVE operators — ops are injected at load and never baked into the .fs, '
      + 'so a host that ignores this renders a different image, silently (§6.7)');
  }
  if (a8.raymarchOps) need(3, 'A8_RAYMARCH_OPS declares shade hook markers to splice into (§6.8)');
  if (a8.playback) need(3, 'A8_PLAYBACK declares playback semantics (§6.13)');
  const PRESENTATION_AB = ['_rowId', '_groupParent', '_stackOrder', '_valueSubgroups', '_labelBy',
    '_contextRange', '_derive', '_noTimeTwin', '_layerRow', '_slotEntryRow', '_blendable',
    '_groupBlendable', '_transportDomain', 'TRANSPORT_DOMAIN', '_lightRig', '_shapeMath'];
  if (anyInput(i => PRESENTATION_AB.some(f => i[f] !== undefined))) {
    need(3, 'inputs declare the §6.14 presentation family (groups A + B)');
  }

  // --- Level 4: performance (§6.18) ----------------------------------------
  if (a8.modulation) need(4, 'A8_MODULATION declares binds a host resolves or marks `unresolved` (§6.6)');
  if (anyInput(i => i._bind !== undefined)) {
    need(4, '_bind ships an input ALIVE, bound to a modulator source — honoured at Level 4, identically '
      + 'to the receiver it desugars to (§6.14 D)');
  }
  if (a8.layers) need(4, 'A8_LAYERS declares texture slots a host fills (§6.12)');

  const level = detail.reduce((m, d) => (d.level > m ? d.level : m), 0);
  return { level, detail };
}

// V2 value-shape half — DEFAULT / MIN / MAX / VALUES / LABELS per type.
function validateInputValueShapes(input, label, err, wrn) {
  const type = input.TYPE;
  const isNum = v => typeof v === 'number' && isFinite(v);
  const numArray = (v, n) => Array.isArray(v) && v.length === n && v.every(isNum);

  const scalarRange = (field) => {
    if (input[field] === undefined) return;
    if (!isNum(input[field])) {
      err('V2', 'input-bad-' + field.toLowerCase(), label + ': ' + field + ' must be a number for TYPE "' + type + '".', label);
    }
  };

  if (type === 'float' || type === 'long') {
    scalarRange('DEFAULT'); scalarRange('MIN'); scalarRange('MAX');
    if (isNum(input.MIN) && isNum(input.MAX) && input.MIN > input.MAX) {
      err('V2', 'input-inverted-range', label + ': MIN is greater than MAX.', label);
    }
  } else if (type === 'bool' || type === 'event') {
    if (input.DEFAULT !== undefined && typeof input.DEFAULT !== 'boolean'
        && input.DEFAULT !== 0 && input.DEFAULT !== 1) {
      wrn('V2', 'input-bool-default', label + ': DEFAULT for TYPE "' + type + '" should be a boolean (0/1 accepted).', label);
    }
  } else if (type === 'color') {
    if (input.DEFAULT !== undefined) {
      if (!Array.isArray(input.DEFAULT) || !input.DEFAULT.every(isNum)) {
        err('V2', 'input-bad-color-default', label + ': DEFAULT for TYPE "color" must be a numeric array [r,g,b,a].', label);
      } else if (input.DEFAULT.length !== 4) {
        wrn('V2', 'input-color-arity', label + ': DEFAULT for TYPE "color" has ' + input.DEFAULT.length
          + ' components; the standard shape is [r,g,b,a] (standard §5).', label);
      }
    }
  } else if (type === 'point2D') {
    if (input.DEFAULT !== undefined && !numArray(input.DEFAULT, 2)) {
      err('V2', 'input-bad-point-default', label + ': DEFAULT for TYPE "point2D" must be [x,y].', label);
    }
    ['MIN', 'MAX'].forEach((f) => {
      if (input[f] !== undefined && !numArray(input[f], 2)) {
        err('V2', 'input-bad-point-range', label + ': ' + f + ' for TYPE "point2D" must be [x,y] '
          + '(and BOTH MIN and MAX decide raw-vs-pixel mode — standard §8.2).', label);
      }
    });
    const oneSided = (input.MIN === undefined) !== (input.MAX === undefined);
    if (oneSided) {
      wrn('V2', 'point2d-one-sided-range', label + ': only one of MIN/MAX is declared, so this point2D is '
        + 'PIXEL-consuming (standard §8.2 needs BOTH for raw mode). Declare both or neither.', label);
    }
  }

  if (input.VALUES !== undefined) {
    if (type !== 'long') {
      wrn('V2', 'values-on-non-long', label + ': VALUES only applies to TYPE "long" (standard §5).', label);
    } else if (!Array.isArray(input.VALUES)) {
      err('V2', 'bad-values', label + ': VALUES must be an array.', label);
    }
  }
  if (input.LABELS !== undefined) {
    if (!Array.isArray(input.LABELS)) {
      err('V2', 'bad-labels', label + ': LABELS must be an array of strings.', label);
    } else if (Array.isArray(input.VALUES) && input.LABELS.length !== input.VALUES.length) {
      wrn('V2', 'labels-values-arity', label + ': LABELS (' + input.LABELS.length
        + ') and VALUES (' + input.VALUES.length + ') have different lengths.', label);
    }
  }
}

// X3 / §6.3 shape checks on the extension fields themselves.
function validateInputExtShapes(input, label, err) {
  const str = (field) => {
    if (input[field] !== undefined && typeof input[field] !== 'string') {
      err('V2', 'ext-bad-string', label + ': ' + field + ' must be a string (standard §6.3).', label);
    }
  };
  const bool = (field) => {
    if (input[field] !== undefined && typeof input[field] !== 'boolean') {
      err('V2', 'ext-bad-bool', label + ': ' + field + ' must be a boolean (standard §6.3).', label);
    }
  };
  str('_groupId'); str('_groupLabel'); str('_audioRole');
  bool('_headerSlot'); bool('_menuOnly'); bool('_a8ManagedSlot'); bool('_op'); bool('_glyOp');
  bool('_opAuthored'); bool('_glyOpAuthored');
  bool('SNAP_TICKS'); bool('PLAIN'); bool('BIPOLAR');

  if (input._audioRole !== undefined && input._audioRole !== 'wave' && input._audioRole !== 'fft') {
    err('V2', 'ext-bad-audiorole', label + ': _audioRole must be "wave" or "fft" (standard §6.3, §8.3).', label);
  }
  if (input._audioRole !== undefined && input.TYPE !== 'image') {
    err('V2', 'ext-audiorole-non-image', label + ': _audioRole tags an image-typed input carrying audio '
      + 'texture data; TYPE is "' + input.TYPE + '" (standard §8.3).', label);
  }
  const identity = input._opIdentity !== undefined ? input._opIdentity : input._glyOpIdentity;
  if (identity !== undefined && (typeof identity !== 'number' || !isFinite(identity))) {
    err('V2', 'ext-bad-opidentity', label + ': operator identity value must be a number (standard §6.3).', label);
  }
  if (input.TICKS !== undefined && (!Array.isArray(input.TICKS) || !input.TICKS.every(v => typeof v === 'number'))) {
    err('V2', 'ext-bad-ticks', label + ': TICKS must be an array of numbers (standard §6.3).', label);
  }
}

// V7 gate grammar (standard §6.3). A gate is ONE predicate or an ARRAY of
// predicates ANDed together; a predicate names a sibling input via `param` and
// tests it with exactly one of eq / not / anyOf. This is the shape the whole
// A8os surface emits and evaluates — the shared camera canon declares
// `{ param: 'iCamScope', not: 'skybox' }` and `[{ param: 'iCamSpinMode', not: 0 },
// { param: 'iCamModel', eq: 'scene' }]`, and ONE predicate function
// (`panelEvalContextGate`) evaluates every gate app-wide. Semantics that matter
// for validation: an undefined driver param means VISIBLE (default-visible
// until first commit), and a predicate carrying none of eq/not/anyOf is a
// permanent pass — legal but almost certainly an authoring mistake, so it warns
// via the caller rather than erroring.
function validateGate(gate, field, label, names, err) {
  const one = (g, where) => {
    if (!g || typeof g !== 'object' || Array.isArray(g)) {
      err('V7', 'gate-not-object', label + ': ' + where + ' must be a predicate object '
        + '{ "param": "<NAME>", "eq"|"not"|"anyOf": … } or an array of them (standard §6.3).', label);
      return;
    }
    if (typeof g.param !== 'string' || !g.param) {
      err('V7', 'gate-no-param', label + ': ' + where + ' has no `param` naming the driving input.', label);
      return;
    }
    if (!names[g.param]) {
      err('V7', 'gate-unknown-input', label + ': ' + where + '.param "' + g.param
        + '" does not resolve to a declared input.', label);
    }
    // §6.14 gate-grammar extension — `in` is a ratified ALIAS of `anyOf`, and
    // V7 MUST accept it: the host's own camera rig declares
    // `{ param: 'iCamModel', in: ['scene', 'planeinf'] }`, so a G1-strict reading
    // ("exactly one of eq/not/anyOf") REDs a shipped, correct file.
    const ops = ['eq', 'not', 'anyOf', 'in'].filter(o => g[o] !== undefined);
    if (ops.length > 1) {
      err('V7', 'gate-multiple-ops', label + ': ' + where + ' declares ' + ops.join(' + ')
        + '; a predicate carries exactly one of eq / not / anyOf (in = anyOf).', label);
    }
    ['anyOf', 'in'].forEach((o) => {
      if (g[o] !== undefined && !Array.isArray(g[o])) {
        err('V7', 'gate-bad-anyof', label + ': ' + where + '.' + o + ' must be an array of values.', label);
      }
    });
    // `def` states what an ABSENT driver means, overriding G2's fail-open for
    // that clause only. Any value is legal; its presence is not a defect.
  };

  // §6.14 gate-grammar extension — `{ any: [ …gates ] }` is the OR wrapper, and
  // it COMPOSES with the array-AND form, so the walk is recursive.
  const walk = (g, where) => {
    if (Array.isArray(g)) { g.forEach((sub, i) => walk(sub, where + '[' + i + ']')); return; }
    if (g && typeof g === 'object' && Array.isArray(g.any)) {
      g.any.forEach((sub, i) => walk(sub, where + '.any[' + i + ']'));
      return;
    }
    one(g, where);
  };

  walk(gate, field);
}

// V6 — extension neutrality (standard §9.3 V6, D8). Two halves:
//  (a) stripping every extension field from INPUTS must leave the vanilla
//      tuple sequence (NAME/TYPE/DEFAULT/MIN/MAX/VALUES/LABELS, in order)
//      byte-identical — an extension field that collides with a standard
//      field name would perturb it;
//  (b) no A8_* block may carry an input-shaped declaration (a smuggled input
//      that only an ISF2 host would see).
function validateNeutrality(model, err) {
  const inputs = model.inputs || [];
  const vanilla = inputs.map((input) => {
    if (!input || typeof input !== 'object') return input;
    const out = {};
    Object.keys(input).forEach((k) => {
      if (INPUT_EXT_FIELDS.indexOf(k) !== -1) return;
      if (k.charAt(0) === '_') return;            // reserved ext namespace
      out[k] = input[k];
    });
    return out;
  });

  vanilla.forEach((v, idx) => {
    const original = inputs[idx];
    if (!original || typeof original !== 'object') return;
    INPUT_STD_FIELDS.forEach((f) => {
      if (JSON.stringify(v[f]) !== JSON.stringify(original[f])) {
        err('V6', 'neutrality-field-perturbed',
          'INPUTS[' + idx + ']: stripping extension fields changed the vanilla field "' + f
          + '" — extension content must never alter the ISF 2.0 input surface (standard §9.3 V6, D8).',
          String(original.NAME !== undefined ? original.NAME : idx));
      }
    });
  });

  const a8 = model.a8 || {};
  const blocks = {};
  DEFINED_A8_KEYS.forEach((k) => { if (model.meta && model.meta[k] !== undefined) blocks[k] = model.meta[k]; });
  Object.keys(GRANDFATHERED_A8_KEYS).forEach((k) => {
    if (model.meta && model.meta[k] !== undefined) blocks[k] = model.meta[k];
  });
  Object.keys(a8.reserved || {}).forEach((k) => { blocks[k] = a8.reserved[k]; });
  Object.keys(a8.unknown || {}).forEach((k) => { blocks[k] = a8.unknown[k]; });

  Object.keys(blocks).forEach((key) => {
    if (smugglesInputs(blocks[key])) {
      err('V6', 'neutrality-smuggled-input',
        key + ' contains an input-shaped declaration (an object carrying both NAME and TYPE). '
        + 'Extension content never declares inputs — a legacy host would not see it (standard §9.3 V6, D8).', key);
    }
  });
}

// Depth-bounded scan for `{ NAME, TYPE }`-shaped objects inside an extension block.
function smugglesInputs(node, depth) {
  const d = depth || 0;
  if (d > 6 || !node || typeof node !== 'object') return false;
  if (!Array.isArray(node)
      && typeof node.NAME === 'string'
      && typeof node.TYPE === 'string'
      && Object.prototype.hasOwnProperty.call(INPUT_TYPES, node.TYPE)) return true;
  const keys = Array.isArray(node) ? node.map((_, i) => i) : Object.keys(node);
  for (let i = 0; i < keys.length; i += 1) {
    if (smugglesInputs(node[keys[i]], d + 1)) return true;
  }
  return false;
}

// V3 size-expression check (standard §7.4 — "$WIDTH"/"$HEIGHT" and arithmetic
// over them, plus `$<inputName>` substitutions the renderer performs before
// evaluation, ISFRenderer.evaluateSize:458-467). Self-contained: no expression
// library is imported (the module stays dependency-light per the fork's
// environment-neutral rule), so this validates TOKENS and STRUCTURE — charset,
// balanced parentheses, no dangling/duplicated operators — which catches real
// malformations without claiming full arithmetic evaluation.
// Returns a problem string, or '' when the expression looks well-formed.
function sizeExpressionProblem(expr, declaredNames) {
  const s = String(expr).trim();
  if (!s) return 'empty expression.';

  const vars = [];
  const stripped = s.replace(/\$[A-Za-z_][A-Za-z0-9_]*/g, (v) => { vars.push(v.slice(1)); return '1'; });

  for (let i = 0; i < vars.length; i += 1) {
    const v = vars[i];
    if (v !== 'WIDTH' && v !== 'HEIGHT' && !declaredNames[v]) {
      return '$' + v + ' is neither $WIDTH/$HEIGHT nor a declared input.';
    }
  }
  if (/[^0-9+\-*/%().,\s]/.test(stripped)) {
    return 'contains characters that are not part of a size expression '
      + '(allowed: digits, + - * / % ( ) . , whitespace, and $VARIABLE references).';
  }

  let depth = 0;
  for (let i = 0; i < stripped.length; i += 1) {
    if (stripped[i] === '(') depth += 1;
    else if (stripped[i] === ')') { depth -= 1; if (depth < 0) return 'unbalanced parentheses.'; }
  }
  if (depth !== 0) return 'unbalanced parentheses.';

  const compact = stripped.replace(/\s+/g, '');
  if (/[+\-*/%]$/.test(compact)) return 'ends with an operator.';
  if (/[*/%]{2,}/.test(compact)) return 'has repeated operators.';
  if (/^[*/%]/.test(compact)) return 'starts with an operator.';
  if (/\(\)/.test(compact)) return 'has an empty parenthesis group.';
  return '';
}

// ---------------------------------------------------------------------------
// emit — standard §9.2 E1-E4, §11
// ---------------------------------------------------------------------------
//
// emit(model, opts?) → fsText
//
//   opts.canonical : true  ⇒ ignore the retained metadata text and serialize the
//                            WHOLE header canonically (the repair / from-scratch
//                            path — see N5). Default false.
//   opts.indent    : the indent unit used for text this emitter WRITES. Default:
//                            detected from the file, falling back to two spaces.
//
// THE CONTRACT (standard §9.2):
//
//   E1  header first, strict JSON in the first /* … */ comment.
//   E2  byte stability: emit(parse(x)) === x for an unmodified model — for EVERY
//       file that parses, with no carve-outs. Proven over the published corpus.
//   E3  unknown top-level keys and unknown per-input fields survive the round
//       trip. Free here: they are never re-serialized, they are re-emitted as
//       the author's own bytes.
//   E4  provenance is APPENDED, never rewritten — see appendProvenanceEvent.
//
// HOW E2 IS EARNED. The naive emitter (`'/*' + JSON.stringify(meta) + '*/'`)
// cannot be byte-stable against a corpus of hand-authored files: it would
// re-spell every number (`1.0` → `1`), collapse every author line break, reorder
// nothing but reformat everything, and silently "repair" the lenient-JSON files
// §V1 tolerates. So emit does not serialize what it did not change. It scans the
// retained metadata TEXT into top-level member spans, diffs the live `model.meta`
// against a fresh decode of that same text, and rebuilds:
//
//   unchanged key → the original span, verbatim (bytes, whitespace, position)
//   changed key   → key text + position kept, VALUE span re-serialized (N2)
//   added key     → appended before the closing brace, canonical (N1)
//   removed key   → its span dropped, the neighbouring separator repaired (N3)
//
// With nothing changed, every member is verbatim and the separators between them
// are copied gaps, so the output is the input. There is deliberately NO
// "unchanged ⇒ return raw.source" shortcut: the identity result is produced BY
// the splice machinery, so the corpus differential actually exercises it instead
// of measuring a memcpy.
//
// NORMALIZATION RULES (the explicit list §9.2 demands — every one of these is a
// case where there is no author text to preserve, NOT a case where emit chose to
// reformat something it could have kept):
//
//   N1  ADDED key. A key absent from the parsed text has no authored bytes, so
//       it is serialized canonically (§ serializeValue) at the file's detected
//       indent and appended as the LAST member. Position is defined, not
//       arbitrary: appending never perturbs the offsets of anything before it.
//   N2  CHANGED key. The `"KEY"` text and the member's POSITION in the object are
//       preserved (so key ORDER is never disturbed); only the VALUE span is
//       replaced, canonically serialized. Consequence: a changed value loses the
//       author's spelling inside that value — notably `1.0` re-emits as `1`, and
//       author line breaks inside that value are replaced by this emitter's
//       layout. This is scoped to the key the caller actually changed.
//   N3  REMOVED key. The member span is dropped together with the separator that
//       followed it. Removing every member leaves `{}` with the original interior
//       whitespace.
//   N4  emit NEVER REORDERS keys, in any path. Retained keys hold their parsed
//       order; added keys follow in `Object.keys(model.meta)` order. There is no
//       canonical key ordering in this standard and inventing one would break E2.
//   N5  LENIENT JSON IS NOT REPAIRED on the default path. A file whose header
//       decodes only under lenient rules (a raw control character inside a string
//       — the `json-lenient` parse warning) round-trips byte-exact, leniency
//       included, because its members are never re-serialized. Byte stability
//       outranks repair: a consumer that re-emits a file it did not edit must not
//       silently rewrite it. Text this emitter WRITES is always strict JSON, so a
//       lenient file that gains a key ends up part-lenient. Producers wanting a
//       strictly-conformant header call `emit(model, { canonical: true })`, which
//       re-serializes every member and repairs leniency wholesale — at the cost
//       of the author's formatting. That is a deliberate, opt-in trade.
//   N6  LEGACY FIELD SPELLINGS ARE NOT REWRITTEN. `_glyOp*` inputs are re-emitted
//       as `_glyOp*` (§6.3 grandfathered synonyms). "Producers MUST emit the
//       neutral names" binds a producer AUTHORING an input, not a round trip
//       through a file it did not otherwise touch — rewriting on sight would
//       churn the 220 baked corpus files and break E2 for every one of them.
//       Migration is a model-level edit (change INPUTS), and it converges at the
//       next natural rebake exactly as ruling (4) specifies.
//   N7  ARRAY LAYOUT in serialized text: an array whose elements are ALL scalars
//       is emitted on one line (`[0.5, 0.5]`, `["Generator"]`); an array
//       containing an object or array is emitted one element per line. This
//       matches §12's worked example and the shipped corpus.
//   N8  THE BODY IS NEVER TOUCHED. emit concatenates `model.body` verbatim. No
//       normalization, no dialect pass, no whitespace handling — `normalizeGLSL`
//       is a separate, explicitly-invoked operation.
//
// `model.meta` IS THE WRITE SURFACE. `model.a8` is a DERIVED VIEW: emit reads
// `meta` and never `a8`, so assigning `model.a8.provenance = {…}` changes
// nothing. Use `setExtension(model, key, value)` (which writes `meta` AND
// refreshes the view) or write `model.meta` directly. Likewise `model.inputs` is
// `meta.INPUTS` by reference — mutating the array's contents is seen, REPLACING
// `model.inputs` is not.

function emit(model, opts) {
  const options = opts || {};

  if (!model || typeof model !== 'object') {
    throw ISF2Error(ERROR_CODES.EMIT_NO_MODEL, 'ISF2.emit: requires a model from ISF2.parse().');
  }
  const meta = model.meta;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    throw ISF2Error(ERROR_CODES.EMIT_NO_META, 'ISF2.emit: model.meta must be a JSON object (standard §3 F2).');
  }

  const raw = model.raw || {};
  const body = (typeof model.body === 'string')
    ? model.body
    : (typeof raw.source === 'string' ? raw.source.substring(raw.bodyStart) : '');

  // The text before the opening `/*` (normally empty; a leading line comment is
  // the `header-not-first` warning case). Preserved verbatim.
  let prefix = '';
  let metaText = null;
  if (typeof raw.source === 'string' && typeof raw.metadataString === 'string') {
    const contentStart = raw.bodyStart - raw.metadataString.length - 2;
    prefix = raw.source.substring(0, contentStart - 2);
    metaText = raw.metadataString;
  }

  const indentUnit = typeof options.indent === 'string' ? options.indent : null;

  let header;
  if (metaText === null || options.canonical) {
    header = serializeValue(meta, '', indentUnit || '  ');
  } else {
    header = spliceMetadata(metaText, meta, indentUnit);
  }

  return prefix + '/*' + header + '*/' + body;
}

// The minimal-diff rebuild. `text` is the retained metadata text (the bytes
// between `/*` and `*/`); `meta` is the live object.
function spliceMetadata(text, meta, indentOverride) {
  const scan = scanTopLevelMembers(text);
  if (!scan) {
    throw ISF2Error(ERROR_CODES.EMIT_UNSCANNABLE,
      'ISF2.emit: the retained metadata text could not be scanned into top-level members. '
      + 'The file decoded, so this is an emitter defect, not a malformed file — re-emit with '
      + '{ canonical: true } to work around it and please report the source.');
  }

  const members = scan.members;
  const original = decodeMeta(text);
  const indentUnit = indentOverride || scan.indent;
  const multiline = text.indexOf('\n') !== -1;

  // --- which original members survive, and which need their value rewritten ---
  const retained = [];
  members.forEach((m, idx) => {
    if (!Object.prototype.hasOwnProperty.call(meta, m.key)) return;   // N3 removed
    const changed = !deepEqual(original ? original[m.key] : undefined, meta[m.key]);
    retained.push({ idx, member: m, changed });
  });

  const memberText = (entry) => {
    const m = entry.member;
    if (!entry.changed) return text.substring(m.start, m.end);        // verbatim
    // N2 — key text + position kept, value re-serialized at this member's indent.
    return text.substring(m.start, m.valueStart)
      + serializeValue(meta[m.key], m.indent, indentUnit);
  };

  let out;
  if (retained.length === 0) {
    out = text.substring(0, scan.interiorStart) + text.substring(scan.interiorEnd);
  } else {
    out = text.substring(0, members[retained[0].idx].start);
    out += memberText(retained[0]);
    for (let i = 1; i < retained.length; i += 1) {
      // The gap AFTER the previous retained member in the ORIGINAL text. It
      // always begins with that member's trailing comma, so it is a valid
      // separator even when members were dropped in between.
      const prev = retained[i - 1].idx;
      out += text.substring(members[prev].end, members[prev + 1].start);
      out += memberText(retained[i]);
    }
    out += text.substring(members[members.length - 1].end);
  }

  // --- N1: keys the model gained, appended before the closing brace ----------
  const known = {};
  members.forEach((m) => { known[m.key] = true; });
  const added = Object.keys(meta).filter(k => !known[k] && meta[k] !== undefined);
  if (added.length) {
    const closeAt = out.lastIndexOf('}');
    if (closeAt === -1) {
      throw ISF2Error(ERROR_CODES.EMIT_UNSCANNABLE, 'ISF2.emit: metadata text has no closing brace.');
    }
    const head = out.substring(0, closeAt);
    const tail = out.substring(closeAt);
    const memberIndent = scan.indent;
    const sep = multiline ? (',\n' + memberIndent) : ', ';
    const chunk = added
      .map(k => JSON.stringify(k) + ': ' + serializeValue(meta[k], memberIndent, indentUnit))
      .join(sep);
    if (retained.length === 0) {
      // `{}` / `{ }` — open the object up rather than emit `{  "K": v}`.
      out = head.replace(/\s*$/, '') + (multiline ? '\n' + memberIndent : '') + chunk
        + (multiline ? '\n' : '') + tail;
    } else {
      out = head.replace(/\s*$/, '') + sep + chunk + head.substring(head.replace(/\s*$/, '').length) + tail;
    }
  }

  return out;
}

// Decode the retained metadata text back to the object the FILE declared, so the
// diff has an immutable ground truth to compare `model.meta` against (`model.meta`
// IS the parse-time object by reference, so it cannot be its own baseline).
function decodeMeta(text) {
  try {
    return MetadataExtractor('/*' + text + '*/').objectValue;
  } catch (e) {
    return null;              // unreachable for a parsed model; diff degrades to "all changed"
  }
}

// A scanner over the top-level members of a JSON object TEXT. Returns spans, not
// values — the whole point is to keep the author's bytes. Handles the lenient
// constructs the vendored decoder accepts (raw control characters inside strings,
// leading-zero numbers); JSON-with-comments never reaches here because json_parse
// rejects it at parse time.
//
// Each member: { key, start, valueStart, end, indent } where [start, end) spans
// `"KEY": value` and `indent` is the whitespace at the head of the member's line.
function scanTopLevelMembers(text) {
  const n = text.length;
  let i = 0;
  const ws = () => { while (i < n && /\s/.test(text[i])) i += 1; };

  ws();
  if (text[i] !== '{') return null;
  i += 1;
  const interiorStart = i;

  const members = [];
  for (;;) {
    ws();
    if (i >= n) return null;
    if (text[i] === '}') break;
    if (members.length) {
      if (text[i] !== ',') return null;
      i += 1;
      ws();
      if (text[i] === '}') break;        // tolerated trailing comma
    }
    if (text[i] !== '"') return null;

    const start = i;
    const keyEnd = scanString(text, i);
    if (keyEnd === -1) return null;
    let key;
    try {
      key = JSON.parse(text.substring(i, keyEnd));
    } catch (e) {
      // Lenient key text (a raw control char inside the key — pathological but
      // decodable): fall back to the unescaped slice.
      key = text.substring(i + 1, keyEnd - 1);
    }
    i = keyEnd;
    ws();
    if (text[i] !== ':') return null;
    i += 1;
    ws();
    const valueStart = i;
    const valueEnd = scanValue(text, i);
    if (valueEnd === -1) return null;
    i = valueEnd;

    // The member's own line indentation, for re-serializing a changed value.
    const lineStart = text.lastIndexOf('\n', start) + 1;
    const lead = text.substring(lineStart, start);
    members.push({
      key,
      start,
      valueStart,
      end: valueEnd,
      indent: /^[ \t]*$/.test(lead) ? lead : '',
    });
  }

  const interiorEnd = i;
  const indent = members.length && members[0].indent ? members[0].indent : '  ';
  return { members, interiorStart, interiorEnd, indent };
}

// Index just past the closing quote of the string starting at `at`, or -1.
function scanString(text, at) {
  let i = at + 1;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '"') return i + 1;
    i += 1;
  }
  return -1;
}

// Index just past the value starting at `at`, or -1.
function scanValue(text, at) {
  const c = text[at];
  if (c === '"') return scanString(text, at);
  if (c === '{' || c === '[') {
    let depth = 0;
    let i = at;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '"') {
        const s = scanString(text, i);
        if (s === -1) return -1;
        i = s;
        continue;
      }
      if (ch === '{' || ch === '[') depth += 1;
      else if (ch === '}' || ch === ']') {
        depth -= 1;
        if (depth === 0) return i + 1;
        if (depth < 0) return -1;
      }
      i += 1;
    }
    return -1;
  }
  // number / true / false / null — runs to the next structural character.
  let i = at;
  while (i < text.length && ',}]'.indexOf(text[i]) === -1) i += 1;
  if (i === at) return -1;
  // Trim trailing whitespace back off the value span so the gap keeps it.
  while (i > at && /\s/.test(text[i - 1])) i -= 1;
  return i;
}

// Canonical serialization — used ONLY for text this emitter writes (N1/N2/N5).
// `indent` is the current line's leading whitespace; `unit` is one indent step.
function serializeValue(value, indent, unit) {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'number') {
    if (!isFinite(value)) {
      throw ISF2Error(ERROR_CODES.EMIT_UNSERIALIZABLE,
        'ISF2.emit: ' + String(value) + ' is not representable in JSON (standard §3 F2).');
    }
    return JSON.stringify(value);
  }
  if (t === 'string') return JSON.stringify(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const scalars = value.every(v => v === null || (typeof v !== 'object' && typeof v !== 'function'));
    if (scalars) {                                                   // N7
      return '[' + value.map(v => serializeValue(v, indent, unit)).join(', ') + ']';
    }
    const inner = indent + unit;
    return '[\n' + value.map(v => inner + serializeValue(v, inner, unit)).join(',\n') + '\n' + indent + ']';
  }

  if (t === 'object') {
    const keys = Object.keys(value).filter(k => value[k] !== undefined);   // N4: no reordering
    if (keys.length === 0) return '{}';
    const inner = indent + unit;
    return '{\n'
      + keys.map(k => inner + JSON.stringify(k) + ': ' + serializeValue(value[k], inner, unit)).join(',\n')
      + '\n' + indent + '}';
  }

  throw ISF2Error(ERROR_CODES.EMIT_UNSERIALIZABLE,
    'ISF2.emit: values of type "' + t + '" cannot appear in an ISF2 metadata block.');
}

// Structural equality, key-order INSENSITIVE. Order insensitivity is correct
// here: two objects with the same members in a different order are the same
// JSON value, and treating that as "unchanged" is what preserves the author's
// original key order in the output (N4).
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== 'object') return a !== a && b !== b;      // NaN === NaN
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i += 1) {
    if (!Object.prototype.hasOwnProperty.call(b, ka[i])) return false;
    if (!deepEqual(a[ka[i]], b[ka[i]])) return false;
  }
  return true;
}

// --- write helpers ---------------------------------------------------------

// setExtension(model, key, value) — the sanctioned way to change extension
// content. `model.meta` is emit's only write surface and `model.a8` is derived,
// so writing the view alone would be silently lost; this writes `meta` and
// refreshes the view together. `undefined` removes the key.
function setExtension(model, key, value) {
  if (!model || !model.meta) {
    throw ISF2Error(ERROR_CODES.EMIT_NO_META, 'ISF2.setExtension: requires a model from ISF2.parse().');
  }
  if (typeof key !== 'string' || key.indexOf('A8') !== 0) {
    throw ISF2Error(ERROR_CODES.EMIT_NOT_EXTENSION_KEY,
      'ISF2.setExtension: only A8VSN / A8_* extension keys go through this helper (got "' + key
      + '"). Write standard ISF keys on model.meta directly.');
  }
  if (value === undefined) delete model.meta[key];
  else model.meta[key] = value;
  // The view is rebuilt from the new meta. Its findings are view-construction
  // notices, not parse findings, so they do not join model.warnings.
  model.a8 = extractA8(model.meta, model.inputs || [], []);
  return model;
}

// appendProvenanceEvent(model, event) — standard §6.2.3 P1 / §9.2 E4. APPENDS to
// the chain; existing events are never touched. A file with no A8_PROVENANCE
// block is not given one implicitly (origin/license are authoring decisions the
// caller must make explicitly via setExtension).
function appendProvenanceEvent(model, event) {
  if (!model || !model.meta) {
    throw ISF2Error(ERROR_CODES.EMIT_NO_META, 'ISF2.appendProvenanceEvent: requires a model from ISF2.parse().');
  }
  const p = model.meta.A8_PROVENANCE;
  if (!p || typeof p !== 'object' || Array.isArray(p) || !Array.isArray(p.chain)) {
    throw ISF2Error(ERROR_CODES.EMIT_NO_PROVENANCE,
      'ISF2.appendProvenanceEvent: the file carries no A8_PROVENANCE block with a chain[]. '
      + 'Establish origin + chain via ISF2.setExtension first (standard §6.2.3).');
  }
  ['action', 'timestamp', 'by', 'contentHash'].forEach((f) => {
    if (event === null || typeof event !== 'object' || event[f] === undefined || event[f] === null || event[f] === '') {
      throw ISF2Error(ERROR_CODES.EMIT_UNSERIALIZABLE,
        'ISF2.appendProvenanceEvent: every chain event requires `' + f + '` (standard §6.2.3, §9.3 V5).');
    }
  });
  p.chain.push(event);
  model.a8 = extractA8(model.meta, model.inputs || [], []);
  return model;
}

// ---------------------------------------------------------------------------
// applyPreset / presetPlan — standard §6.5
// ---------------------------------------------------------------------------
//
// §6.5 asks the reference implementation for this explicitly — "applying is a host
// act, but the module SHOULD expose ISF2.applyPreset(model, slotId) → a flat
// {name: value} map SO HOSTS DO NOT EACH RE-DERIVE THE RECALL ORDER." Two
// functions, because one flat map cannot carry both halves of that order:
//
//   applyPreset  → the flat { inputName: value } map the standard specifies,
//                  built IN recall order, so a host iterating it in insertion
//                  order pushes the camera before the params.
//   presetPlan   → the ordered plan for the steps a flat map CANNOT express:
//                  activating ops MINTS inputs, arrangement re-orders the surface,
//                  and ranges must be pushed BEFORE values or the values clamp.
//
// THE ORDER IS THE WHOLE POINT (§6.5, normative):
//
//     ops → camera → arrangement → ranges → params → modulation
//
// `ops` first because activating an op MINTS INPUTS that later steps write to.
// `ranges` before `params` because a value push CLAMPS to the live bracket:
// restoring values against a stale narrow window silently lands the default inside
// it and the slot never recalls. That lesson cost a live gig once
// (BOUND-D-RESET-CLAMPED-BY-STALE-BRACKET) and is published here so nobody
// relearns it.

// Resolve a slot argument to { id, slot } or null.
//
//   string  → that slot id ("D", "1" … "11")
//   number  → the slot id of the same spelling ("1"), falling back to the Nth
//             DECLARED slot in bank order when no such id exists
//   absent  → "D", the reset baseline
function resolveSlot(bank, slotId) {
  if (!bank) return null;
  const id = slotId === undefined || slotId === null ? 'D' : slotId;
  if (typeof id === 'string') {
    return Object.prototype.hasOwnProperty.call(bank, id) ? { id, slot: bank[id] } : null;
  }
  if (typeof id === 'number' && isFinite(id)) {
    const asId = String(id);
    if (Object.prototype.hasOwnProperty.call(bank, asId)) return { id: asId, slot: bank[asId] };
    const keys = Object.keys(bank);
    return keys[id] !== undefined ? { id: keys[id], slot: bank[keys[id]] } : null;
  }
  return null;
}

// presetPlan(model, slotId, opts?) → the ordered recall plan, or null when the
// slot does not exist (an absent slot is ABSENT, never null-padded — §6.5).
//
//   opts.groupId : recall from A8_PRESETS.groupBanks[groupId] instead of the
//                  card bank. The group bank IS A8_GROUP_BANKS, keyed by _groupId.
function presetPlan(model, slotId, opts) {
  const options = opts || {};
  const a8 = (model && model.a8) || {};
  const presets = a8.presets;
  if (!presets) return null;

  const bank = options.groupId !== undefined
    ? plainObject(presets.groupBanks[options.groupId])
    : presets.bank;
  const hit = resolveSlot(bank, slotId);
  if (!hit || !plainObject(hit.slot)) return null;
  const slot = hit.slot;

  // §6.11 — "§6.5's per-slot `camera` overrides this one on recall". The authored
  // view is a property of the FILE (how the author framed the piece); a slot's
  // camera is one saved variation of it. Both exist; the slot wins per key.
  const camera = {};
  if (a8.camera) Object.keys(a8.camera.state).forEach((k) => { camera[k] = a8.camera.state[k]; });
  const slotCam = plainObject(slot.camera);
  if (slotCam) Object.keys(slotCam).forEach((k) => { camera[k] = slotCam[k]; });

  const steps = [];
  PRESET_RECALL_ORDER.forEach((stage) => {
    let value;
    if (stage === 'camera') value = Object.keys(camera).length ? camera : null;
    else value = slot[stage] !== undefined ? slot[stage] : null;
    if (value === null || value === undefined) return;
    steps.push({ stage, value });
  });

  return {
    id: hit.id,
    name: slot.name !== undefined ? slot.name : null,
    order: PRESET_RECALL_ORDER.slice(),
    steps,
    ops: slot.ops !== undefined ? slot.ops : null,
    camera: Object.keys(camera).length ? camera : null,
    arrangement: slot.arrangement !== undefined ? slot.arrangement : null,
    ranges: slot.ranges !== undefined ? slot.ranges : null,
    params: slot.params !== undefined ? slot.params : null,
    inverts: slot.inverts !== undefined ? slot.inverts : null,
    deactivated: slot.deactivated !== undefined ? slot.deactivated : null,
    opacity: slot.opacity !== undefined ? slot.opacity : null,
    blend: slot.blend !== undefined ? slot.blend : null,
    renderState: slot.renderState !== undefined ? slot.renderState : null,
    modulation: slot.modulation !== undefined ? slot.modulation : null,
    generation: slot.generation !== undefined ? slot.generation : null,
    slot,
  };
}

// applyPreset(model, slotId, opts?) → { inputName: value }, or null when the slot
// does not exist.
//
//   opts.groupId      : recall from a group bank (see presetPlan)
//   opts.withDefaults : seed every declared input's DEFAULT first, so the map is
//                       a COMPLETE state rather than only what the slot overrides.
//                       Off by default — a slot is a diff, and a host that already
//                       holds live state wants only the diff.
//
// The camera keys land in the map under their `iCam*` names because §6.11 puts
// `state` in the STATE DOMAIN: "the value a host pushes through its own setParam,
// never the post-conversion uniform value". A host that writes them straight to a
// uniform is non-conforming — DECLARE preserves the host's conversion seam, so
// writing the uniform domain there double-converts (a baked linear zoom re-read as
// an exponent).
function applyPreset(model, slotId, opts) {
  const options = opts || {};
  const plan = presetPlan(model, slotId, options);
  if (!plan) return null;

  const out = {};
  if (options.withDefaults) {
    (model.inputs || []).forEach((input) => {
      if (!input || typeof input !== 'object' || typeof input.NAME !== 'string') return;
      if (input.DEFAULT !== undefined) out[input.NAME] = input.DEFAULT;
    });
  }
  // Insertion order IS the recall order: camera before params.
  if (plan.camera) Object.keys(plan.camera).forEach((k) => { out[k] = plan.camera[k]; });
  const params = plainObject(plan.params);
  if (params) Object.keys(params).forEach((k) => { out[k] = params[k]; });
  return out;
}

// ---------------------------------------------------------------------------
// sourceId — standard §6.15
// ---------------------------------------------------------------------------
//
// > The SOURCE IDENTITY of an ISF2 file is
// >   "sha256:" + hex(SHA-256(UTF-8(canonical source text)))
//
// Two apps holding a file must agree on ONE question before they can share
// anything keyed to it: is this the same shader? Publishing the derivation costs
// nothing and makes a preset bank, a provenance chain and a cache portable across
// implementations. What this does NOT standardise is where a host keeps the thing
// it keys — that is storage, not format.

// The canonical source text (§6.15). A single-file .fs IS its own bytes. A host
// whose internal representation is a multi-part source OBJECT normalises it to ONE
// text by walking string-valued and object-valued fields in a STABLE key order
// with dotted keys — so two surfaces holding the same shader in different internal
// shapes hash identically.
//
// `params` IS SKIPPED, BECAUSE STATE IS NEVER IDENTITY. That single rule is what
// keeps a field record's own bank from collapsing into every other record's: drop
// it and every document sharing a mode key hashes the same, and a preset saved on
// one is offered on all of them.
function canonicalSourceText(source) {
  if (source === null || source === undefined) return '';
  if (typeof source === 'string') return source;
  if (typeof source !== 'object') return String(source);
  if (typeof source.source === 'string') return source.source;
  if (typeof source.fragmentShader === 'string') return source.fragmentShader;
  if (typeof source.code === 'string') return source.code;

  const parts = [];
  const walk = (o, prefix, depth) => {
    if (depth > 8 || o === null || typeof o !== 'object') return;
    const keys = Object.keys(o).sort();
    for (let i = 0; i < keys.length; i += 1) {
      const k = keys[i];
      if (!prefix && k === 'params') continue;          // state is never identity
      const v = o[k];
      const kk = prefix ? (prefix + '.' + k) : k;
      if (typeof v === 'string') parts.push(kk + ':' + v);
      else if (v && typeof v === 'object') walk(v, kk, depth + 1);
    }
  };
  walk(source, '', 0);
  if (parts.length) return parts.join('\n');
  try {
    return JSON.stringify(source);
  } catch (e) {
    return '';
  }
}

function hexDigest(buffer) {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const h = bytes[i].toString(16);
    hex += h.length === 1 ? ('0' + h) : h;
  }
  return hex;
}

// sourceId(source) → Promise<"sha256:<hex>">.
//
// ONE function, feature-detected: SubtleCrypto is the Web Crypto digest in a
// browser AND on the `globalThis.crypto` a modern Node exposes, so there is a
// single code path and no `require('crypto')` for a bundler to polyfill (this
// module stays DOM-free, dependency-light and environment-neutral). It is
// necessarily ASYNC — SubtleCrypto has no synchronous digest, and offering a
// second sync spelling that only worked in one runtime would be worse than
// awaiting one that works in both. `canonicalSourceText` is exported separately
// and is synchronous, so the NORMALISATION is testable without a digest.
function sourceId(source) {
  const text = canonicalSourceText(source);
  const g = typeof globalThis !== 'undefined' ? globalThis : {};
  const subtle = g.crypto && g.crypto.subtle;
  if (!subtle || typeof subtle.digest !== 'function' || typeof TextEncoder === 'undefined') {
    return Promise.reject(ISF2Error(ERROR_CODES.NO_DIGEST,
      'ISF2.sourceId: no SubtleCrypto digest in this environment. The derivation is published in '
      + 'standard §6.15 — "sha256:" + hex(SHA-256(UTF-8(canonical source text))) — and '
      + 'ISF2.canonicalSourceText() gives the exact input, so a host with its own SHA-256 can '
      + 'compute the identical id.'));
  }
  return Promise.resolve(subtle.digest('SHA-256', new TextEncoder().encode(text)))
    .then(buf => 'sha256:' + hexDigest(buf));
}

// ---------------------------------------------------------------------------
// normalizeGLSL — standard §7.1 / §11, shared with ISFParser
// ---------------------------------------------------------------------------

function normalizeGLSL(source, opts) {
  return GLSLNormalize.normalizeGLSL(source, opts);
}

export default {
  A8VSN,
  parse,
  validate,
  emit,
  setExtension,
  appendProvenanceEvent,
  normalizeGLSL,
  // A8VSN 2 (standard §6.5 / §6.15)
  applyPreset,
  presetPlan,
  sourceId,
  canonicalSourceText,
  ISF2Error,
  ERROR_CODES,
  // Schema introspection — tooling (editors, linters, the bake harnesses) reads
  // these rather than re-declaring the key rosters.
  DEFINED_A8_KEYS,
  GRANDFATHERED_A8_KEYS,
  RESERVED_A8_KEYS,
  INPUT_EXT_FIELDS,
  INPUT_EXT_UNDERSCORE,
  INPUT_EXT_FLAGS,
  OP_FIELD_SYNONYMS,
  FIELD_SYNONYMS,
  INPUT_TYPES,
  KNOWN_CURVES,
  // A8VSN 2 rosters — normative, and published here so tooling reads them rather
  // than re-declaring them (standard Appendices A + B, §6.5 - §6.13).
  MODULATION_KINDS,
  CAMERA_MODELS,
  CAMERA_SCOPES,
  CAMERA_STATE,
  OPS_WORLD,
  OPS_RAYMARCH,
  OPS_SCOPES,
  RAYMARCH_HOOKS,
  PLAYBACK_SCALE_MODES,
  PLAYBACK_RECALL_MODES,
  TEX_MAPPINGS,
  PRESET_SLOT_IDS,
  PRESET_RECALL_ORDER,
};
