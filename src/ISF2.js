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

import MetadataExtractor from './MetadataExtractor';
import GLSLNormalize from './GLSLNormalize';

// ---------------------------------------------------------------------------
// Constants — the schema surface (standard §5, §6)
// ---------------------------------------------------------------------------

// The A8VSN this implementation implements (standard §6.1).
const A8VSN = '1';

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

// Top-level extension blocks defined at A8VSN 1 (standard §6.2).
const DEFINED_A8_KEYS = ['A8_ANIMATE', 'A8_CAMERA', 'A8_PROVENANCE'];

// Reserved for future versions of the standard — producers MUST NOT use them
// for private purposes (standard §6.2).
const RESERVED_A8_KEYS = ['A8_MODE', 'A8_LAYERS', 'A8_OPS', 'A8_MATERIAL'];

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

// Underscore-prefixed extension fields (canonical spellings).
const INPUT_EXT_UNDERSCORE = [
  '_groupId', '_groupLabel', '_headerSlot',
  '_contextGate', '_contextHeaderGate', '_menuOnly',
  '_op', '_opIdentity', '_opAuthored', '_opCompanion',
  '_a8ManagedSlot', '_audioRole',
];

// Uppercase slider-affordance flags (standard §6.3 tail).
const INPUT_EXT_FLAGS = ['BIPOLAR', 'TICKS', 'SNAP_TICKS', 'PLAIN'];

// Every ext field name (canonical + grandfathered) — the set stripped for the
// V6 extension-neutrality check.
const INPUT_EXT_FIELDS = INPUT_EXT_UNDERSCORE
  .concat(Object.keys(OP_FIELD_SYNONYMS).map(k => OP_FIELD_SYNONYMS[k]))
  .concat(INPUT_EXT_FLAGS);

// Standard (non-extension) input fields — the vanilla surface a legacy host
// extracts. V6 asserts extensions never perturb this tuple.
const INPUT_STD_FIELDS = ['NAME', 'TYPE', 'LABEL', 'DESCRIPTION', 'DEFAULT', 'MIN', 'MAX', 'VALUES', 'LABELS'];

// Oscillator waveforms this implementation recognises (standard §6.2.1 —
// unknown curves degrade to no animation, so an unknown curve is a WARNING).
const KNOWN_CURVES = ['sine', 'cosine', 'triangle', 'saw', 'sawdown', 'square', 'pulse', 'noise', 'random'];

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
//   vsn         the file's A8VSN string, or null
//   animate     A8_ANIMATE array, or null
//   camera      A8_CAMERA object, or null
//   provenance  A8_PROVENANCE object, or null
//   ui{}        NAME → normalized per-input extension fields
//   reserved{}  reserved A8_* keys the file uses anyway (preserved, ignored)
//   unknown{}   unrecognized A8_* keys (preserved, ignored — standard §10)
//   isISF2      true when the file carries ANY extension content
// }
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
    ui: {},
    reserved: {},
    unknown: {},
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

  a8.isISF2 = !!(a8.vsn || a8.animate || a8.camera || a8.provenance
    || Object.keys(a8.ui).length
    || Object.keys(a8.reserved).length
    || Object.keys(a8.unknown).length);
  return a8;
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

  // Operator fields: neutral canonical name wins; legacy `_glyOp*` accepted as
  // a synonym (standard OPEN RULING 4 verdict (b)).
  Object.keys(OP_FIELD_SYNONYMS).forEach((canon) => {
    const legacy = OP_FIELD_SYNONYMS[canon];
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
      warn(warnings, 'op-field-legacy',
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

// validate(model) → { ok, errors[], warnings[], skipped[] }
//
// `ok` is true iff errors[] is empty. Every entry carries `{ rule, code,
// message, path? }` so a caller can group by rule (V1..V9) or by file location.
// V9 (does the body compile) is always reported in `skipped[]` — this module
// has no GL context and the standard forbids reporting it as passed.
function validate(model) {
  const errors = [];
  const warnings = [];
  const skipped = [];

  if (!model || typeof model !== 'object') {
    return {
      ok: false,
      errors: [{ rule: 'V1', code: 'no-model', message: 'validate() requires a model from ISF2.parse().' }],
      warnings: [],
      skipped: [],
    };
  }

  const err = (rule, code, message, path) => errors.push(path === undefined
    ? { rule, code, message } : { rule, code, message, path });
  const wrn = (rule, code, message, path) => warnings.push(path === undefined
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

  // A8_CAMERA (standard §6.2.2). Not a numbered rule; V8 depends on it.
  if (a8.camera) {
    if (a8.camera.mode !== 'ray') {
      wrn('V8', 'camera-unknown-mode', 'A8_CAMERA.mode "' + a8.camera.mode
        + '" is not defined at A8VSN 1 (only { "mode": "ray" }); ignored (standard §6.2.2).');
    } else if (model.body && model.body.indexOf('a8CameraRay(') === -1) {
      wrn('V8', 'camera-hook-missing', 'A8_CAMERA declares mode "ray" but the body contains no '
        + 'a8CameraRay(uv, ro, rd) call site (standard §6.2.2).');
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
        if (ev.timestamp !== undefined && typeof ev.timestamp !== 'number') {
          err('V5', 'prov-event-timestamp', where + ': `timestamp` must be a number (ms epoch).', where);
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
    ['_contextGate', '_contextHeaderGate'].forEach((field) => {
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

  // V9 — compilation. No GL here, and the standard forbids reporting it passed.
  skipped.push({
    rule: 'V9',
    reason: 'no GL context — body compilation is not checked by ISF2.validate (standard §9.3 V9). '
      + 'Compile via ISFParser/ISFRenderer or the corpus regression harness.',
  });

  return { ok: errors.length === 0, errors, warnings, skipped };
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
    const ops = ['eq', 'not', 'anyOf'].filter(o => g[o] !== undefined);
    if (ops.length > 1) {
      err('V7', 'gate-multiple-ops', label + ': ' + where + ' declares ' + ops.join(' + ')
        + '; a predicate carries exactly one of eq / not / anyOf.', label);
    }
    if (g.anyOf !== undefined && !Array.isArray(g.anyOf)) {
      err('V7', 'gate-bad-anyof', label + ': ' + where + '.anyOf must be an array of values.', label);
    }
  };

  if (Array.isArray(gate)) {
    gate.forEach((g, i) => one(g, field + '[' + i + ']'));
    return;
  }
  one(gate, field);
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
  ISF2Error,
  ERROR_CODES,
  // Schema introspection — tooling (editors, linters, the bake harnesses) reads
  // these rather than re-declaring the key rosters.
  DEFINED_A8_KEYS,
  RESERVED_A8_KEYS,
  INPUT_EXT_FIELDS,
  INPUT_EXT_UNDERSCORE,
  INPUT_EXT_FLAGS,
  OP_FIELD_SYNONYMS,
  INPUT_TYPES,
  KNOWN_CURVES,
};
