import math from 'mathjs-expression-parser';

import ISFGLState from './ISFGLState';
import ISFGLProgram from './ISFGLProgram';
import ISFBuffer from './ISFBuffer';
import ISFParser from './ISFParser';
import ISFTexture from './ISFTexture';
import LineMapper from './ISFLineMapper';

const mathJsEval = math.eval;

function ISFRenderer(gl) {
  this.gl = gl;
  this.uniforms = [];
  this.contextState = new ISFGLState(this.gl);
  this.setupPaintToScreen();
  this.startTime = Date.now();
  this.lastRenderTime = Date.now();
  this.frameIndex = 0;
  // [anim8 fork] Optional per-instance render-size override. null = use the
  // destination canvas's own width/height (upstream behaviour). When set to
  // {width,height}, draw() renders the final pass + RENDERSIZE + viewport +
  // PASSES evaluateSize at this size instead of destination.width/height —
  // so a host can render a shader at a reduced (or enlarged) resolution into
  // a sub-region of a larger shared canvas without resizing that canvas.
  // Enables Anim8 per-card renderScale (subsample-for-perf / supersample-for-
  // zoom) against the single shared SRA OffscreenCanvas.
  this._renderSize = null;
  // [anim8 fork Update 8] Optional caller-owned FINAL-PASS render target.
  // null = the final visible pass renders to the DEFAULT framebuffer (upstream
  // behaviour, byte-identical). When set to {fb,width,height}, the FINAL pass
  // (the no-TARGET pass in draw(), or paintToScreen() when the last pass wrote
  // to a buffer) binds THIS framebuffer + viewports to width,height instead of
  // the default FB. PASSES intermediates + PERSISTENT buffers are UNTOUCHED
  // (renderer-internal FBOs). The renderer NEVER deletes/resizes/creates this
  // fb — the host owns it. Enables Anim8's SRA to feed the card's RGBA slot FBO
  // straight in so the shader's gl_FragColor.a survives (the default drawing
  // buffer is alpha:false — the final blit to it discards alpha, reading back
  // 0,0,0,255); it also removes the per-card default-FB→slot blit entirely.
  this._renderTargetFB = null;
}

// [anim8 fork] Set (or clear) the per-instance render-size override.
// w,h <= 0 (or omitted) clears the override → revert to destination dims.
ISFRenderer.prototype.setRenderSize = function setRenderSize(w, h) {
  w = w | 0; h = h | 0;
  this._renderSize = (w > 0 && h > 0) ? { width: w, height: h } : null;
};

// [anim8 fork Update 8] Set (or clear) the caller-owned final-pass render
// target framebuffer. Pass a WebGLFramebuffer + its dimensions; null/undefined
// clears (revert to default-FB behaviour, byte-identical to upstream). The fb
// MUST belong to the same GL context passed to `new ISFRenderer(gl)`. Existence
// of this method is the host's capability flag (mirror setValueGLTexture) —
// `typeof renderer.setRenderTargetFramebuffer === 'function'`.
ISFRenderer.prototype.setRenderTargetFramebuffer = function setRenderTargetFramebuffer(fb, w, h) {
  if (fb === null || fb === undefined) {
    this._renderTargetFB = null;
    return;
  }
  this._renderTargetFB = { fb, width: (w | 0) || 1, height: (h | 0) || 1 };
};

// [anim8 fork Update 11] opts.program = { program, vShader, fShader, vertexShader,
// fragmentShader } — a caller-owned WebGLProgram ALREADY LINKED from exactly the GLSL
// strings this parser will emit for `fragmentISF` (the host parsed the same source with
// the same ISFParser). setupGL adopts it (ISFGLProgram.adopt) instead of compiling +
// linking again, when: single-program mode, the parsed vertex + fragment strings equal
// the ones handed over byte-for-byte, and LINK_STATUS is true. Any miss falls back to
// the ordinary compile path and leaves the caller's objects UNTOUCHED (the caller owns
// them until `renderer.adoptedProgram === true`). Capability flag for hosts:
// ISFRenderer.supportsProgramAdopt.
ISFRenderer.supportsProgramAdopt = true;

ISFRenderer.prototype.loadSource = function loadSource(fragmentISF, vertexISFOpt, opts) {
  const parser = new ISFParser();
  parser.parse(fragmentISF, vertexISFOpt);
  this._adoptSpec = (opts && opts.program) || null;
  this.adoptedProgram = false;
  try {
    this.sourceChanged(parser.fragmentShader, parser.vertexShader, parser);
  } finally {
    this._adoptSpec = null;
  }
};

ISFRenderer.prototype.sourceChanged = function sourceChanged(fragmentShader, vertexShader, model) {
  this.fragmentShader = fragmentShader;
  this.vertexShader = vertexShader;
  this.model = model;
  if (!this.model.valid) {
    this.valid = false;
    this.error = this.model.error;
    this.errorLine = this.model.errorLine;
    return;
  }
  try {
    this.valid = true;
    this.error = null;
    this.errorLine = null;
    this.setupGL();
    this.initUniforms();
    for (let i = 0; i < model.inputs.length; i++) {
      const input = model.inputs[i];
      if (input.DEFAULT !== undefined) {
        this.setValue(input.NAME, input.DEFAULT);
      }
    }
  } catch (e) {
    this.valid = false;
    this.error = e;
    this.errorLine = LineMapper(e, this.fragmentShader, this.model.rawFragmentShader);
  }
};

ISFRenderer.prototype.initUniforms = function initUniforms() {
  this.uniforms = this.findUniforms(this.fragmentShader);
  const inputs = this.model.inputs;
  for (let i = 0; i < inputs.length; ++i) {
    const input = inputs[i];
    const uniform = this.uniforms[input.NAME];
    if (!uniform) {
      continue;
    }
    uniform.value = this.model[input.NAME];
    if (uniform.type === 't') {
      uniform.texture = new ISFTexture({}, this.contextState);
    }
  }
  this.pushTextures();
};

ISFRenderer.prototype.setValue = function setValue(name, value) {
  this.program.use();

  const uniform = this.uniforms[name];
  if (!uniform) {
    console.error(`No uniform named ${name}`);
    return;
  }
  uniform.value = value;
  if (uniform.type === 't') {
    uniform.textureLoaded = false;
    // [anim8 fork] a plain setValue supersedes any external-GL-texture bind:
    // clear it so pushTexture takes the standard texImage2D/canvas path.
    uniform.externalTexture = null;
  }
  this.pushUniform(uniform);
};

// [anim8 fork] Bind a caller-owned WebGLTexture directly to an image input,
// bypassing texImage2D / CPU upload entirely. This is the GPU-pure image path:
// the host renders content into its own FBO (e.g. Anim8's SRA cross-card
// inputImage) and feeds that FBO's colour texture straight in — zero
// GPU→CPU→GPU readback round-trip.
//
//   name      — an ISF image/sampler2D input NAME (e.g. 'inputImage').
//   glTexture — a WebGLTexture owned by the CALLER. The renderer NEVER
//               deletes, resizes, or texImage2D's into it — it only binds it to
//               a texture unit + points the sampler at it each push.
//   width/height — the source texture dimensions, used for the input's
//               companion `_<name>_imgSize` uniform (drives IMG_PIXEL /
//               IMG_NORM_PIXEL / IMG_THIS_PIXEL sampling). The texture itself
//               must be created in THIS renderer's GL context.
//
// Orientation: the texture is bound raw (no UNPACK_FLIP_Y, no texImage2D), so
// it keeps GL bottom-left origin and `_<name>_flip` is set false — a straight
// GL-to-GL feed. Call once per frame per input before draw(); mirrors setValue.
ISFRenderer.prototype.setValueGLTexture = function setValueGLTexture(name, glTexture, width, height) {
  this.program.use();
  const uniform = this.uniforms[name];
  if (!uniform) {
    console.error(`No uniform named ${name}`);
    return;
  }
  if (uniform.type !== 't') {
    console.error(`setValueGLTexture called on non-image uniform ${name}`);
    return;
  }
  if (glTexture === null || glTexture === undefined) {
    // Clear the external binding → fall back to the standard value/texture path.
    uniform.externalTexture = null;
    uniform.value = { complete: false, readyState: 0 };
    uniform.textureLoaded = false;
    return;
  }
  uniform.externalTexture = glTexture;
  uniform.externalSize = [(width | 0) || 1, (height | 0) || 1];
  uniform.value = glTexture; // truthy so pushUniform proceeds to pushTexture
  uniform.textureLoaded = false; // re-push imgSize companions on (re)bind
  this.pushUniform(uniform);
};

ISFRenderer.prototype.setNormalizedValue = function setNormalizedValue(name, normalizedValue) {
  const inputs = this.model.inputs;
  let input = null;
  for (let i = 0; i < inputs.length; i++) {
    const thisInput = inputs[i];
    if (thisInput.NAME === name) {
      input = thisInput;
      break;
    }
  }
  if (input && input.MIN !== undefined && input.MAX !== undefined) {
    this.setValue(name, input.MIN + (input.MAX - input.MIN) * normalizedValue);
  } else {
    console.log('Trying to set normalized value without MIN and MAX input', name, input);
  }
};

ISFRenderer.prototype.setupPaintToScreen = function setupPaintToScreen() {
  this.paintProgram = new ISFGLProgram(this.gl, this.basicVertexShader, this.basicFragmentShader);
  return this.paintProgram.bindVertices();
};

// [anim8 fork Update 10] Per-pass fragment source: `#define A8_PASS <i>` inserted right
// after the `#version` line (an ES 3.00 shader must keep #version first), so the pass's
// own `#if A8_PASS == i` blocks survive and every other pass's body is stripped by the
// preprocessor. No #version → prepended. Pure; exported for the test harness.
ISFRenderer.injectPassDefine = function injectPassDefine(src, i) {
  const line = `#define A8_PASS ${i | 0}\n`;
  const m = /^[ \t]*#version[^\n]*\n/.exec(src);
  if (!m) return line + src;
  const at = m.index + m[0].length;
  return src.slice(0, at) + line + src.slice(at);
};

ISFRenderer.prototype.setupGL = function setupGL() {
  this.cleanup();
  this.programs = null;
  const passes = (this.model && this.model.passes) || [];
  if (this.model && this.model.perPassPrograms && passes.length > 1) {
    // [anim8 fork Update 10] one program per pass; `this.program` stays the FINAL
    // pass's program so every single-program code path (setValue, paintToScreen,
    // the host's uniform table) keeps working unchanged.
    this.programs = [];
    for (let i = 0; i < passes.length; ++i) {
      const p = new ISFGLProgram(this.gl, this.vertexShader,
        ISFRenderer.injectPassDefine(this.fragmentShader, i));
      p.bindVertices();
      this.programs.push(p);
    }
    this.program = this.programs[this.programs.length - 1];
  } else {
    // [anim8 fork Update 11] adopt the caller's linked program when it was built from
    // THESE strings; otherwise compile as before.
    const spec = this._adoptSpec;
    let adopted = null;
    if (spec && spec.program &&
        spec.vertexShader === this.vertexShader &&
        spec.fragmentShader === this.fragmentShader) {
      adopted = ISFGLProgram.adopt(this.gl, spec.program, spec.vShader, spec.fShader);
    }
    this.program = adopted || new ISFGLProgram(this.gl, this.vertexShader, this.fragmentShader);
    this.adoptedProgram = !!adopted;
    this.program.bindVertices();
  }
  this.generatePersistentBuffers();
};

// [anim8 fork Update 10] Sampler locations are PER PROGRAM while texture units are
// global GL state: a texture bound once to a unit is addressed from every pass's
// program by setting that program's sampler uniform to the same unit. No-op in
// single-program mode (the original bind already set it on `this.program`).
ISFRenderer.prototype._setSamplerAll = function _setSamplerAll(name, unit) {
  if (!this.programs) return;
  const cur = this.program;
  for (let i = 0; i < this.programs.length; ++i) {
    const p = this.programs[i];
    if (p === cur) continue;
    p.use();
    const loc = p.getUniformLocation(name);
    if (loc !== null && loc !== -1) this.gl.uniform1i(loc, unit);
  }
  cur.use();
};

ISFRenderer.prototype.generatePersistentBuffers = function generatePersistentBuffers() {
  this.renderBuffers = [];
  const passes = this.model.passes;
  for (let i = 0; i < passes.length; ++i) {
    const pass = passes[i];
    const buffer = new ISFBuffer(pass, this.contextState);
    pass.buffer = buffer;
    this.renderBuffers.push(buffer);
  }
};

ISFRenderer.prototype.paintToScreen = function paintToScreen(destination, target) {
  this.paintProgram.use();
  // [anim8 fork Update 8] final paint lands in the caller-provided target
  // framebuffer when set (host RGBA slot FBO, alpha-preserving), else the
  // default framebuffer (upstream).
  const rt = this._renderTargetFB;
  this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, rt ? rt.fb : null);
  // [anim8 fork] honor the caller target (authoritative dims) / render-size
  // override so the multipass final paint lands in the same sub-region the
  // host will read back / blit.
  const ps = rt || this._renderSize || destination;
  this.gl.viewport(0, 0, ps.width, ps.height);
  const loc = this.paintProgram.getUniformLocation('tex');
  target.readTexture().bind(loc);
  this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
  // [anim8 fork Update 8] when a caller target was bound, unbind it so the
  // paint is self-contained — no subsequent renderer op inherits the host FBO.
  // (Unset path leaves FRAMEBUFFER=null exactly as upstream → byte-identical.)
  if (rt) this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
  this.program.use();
};

ISFRenderer.prototype.pushTextures = function pushTextures() {
  Object.keys(this.uniforms).forEach((u) => {
    const uniform = this.uniforms[u];
    if (uniform.type === 't') this.pushTexture(uniform);
  });
};

ISFRenderer.prototype.pushTexture = function pushTexture(uniform) {
  // [anim8 fork] External caller-owned WebGLTexture path (setValueGLTexture).
  // Bind the host's texture directly to a texture unit — NO texImage2D, NO
  // upload, NO ownership (never deleted/resized here). Structurally identical
  // to the ISFTexture.bind path below so texture-unit assignment + draw()
  // ordering match the canvas path exactly; only the pixel source differs.
  if (uniform.externalTexture) {
    const loc = this.program.getUniformLocation(uniform.name);
    if (loc === null || loc === -1) {
      return;
    }
    const newTexUnit = this.contextState.newTextureIndex();
    this.gl.activeTexture(this.gl.TEXTURE0 + newTexUnit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, uniform.externalTexture);
    this.gl.uniform1i(loc, newTexUnit);
    this._setSamplerAll(uniform.name, newTexUnit);   // [Update 10] every pass program
    if (!uniform.textureLoaded) {
      uniform.textureLoaded = true;
      const sz = uniform.externalSize || [1, 1];
      this.setValue(`_${uniform.name}_imgSize`, [sz[0], sz[1]]);
      this.setValue(`_${uniform.name}_imgRect`, [0, 0, 1, 1]);
      this.setValue(`_${uniform.name}_flip`, false);
    }
    return;
  }

  if (!uniform.value) {
    return;
  }

  if (
    uniform.value.constructor.name !== 'OffscreenCanvas' &&
    (
      uniform.value.tagName !== 'CANVAS' &&
      !uniform.value.complete &&
      uniform.value.readyState !== 4)
    ) {
    return;
  }

  const loc = this.program.getUniformLocation(uniform.name);
  const texUnit = uniform.texture.bind(loc);
  this._setSamplerAll(uniform.name, texUnit);   // [Update 10] every pass program
  this.gl.texImage2D(
    this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, uniform.value);
  if (!uniform.textureLoaded) {
    const img = uniform.value;
    uniform.textureLoaded = true;
    const w = img.naturalWidth || img.width || img.videoWidth;
    const h = img.naturalHeight || img.height || img.videoHeight;
    this.setValue(`_${uniform.name}_imgSize`, [w, h]);
    this.setValue(`_${uniform.name}_imgRect`, [0, 0, 1, 1]);
    this.setValue(`_${uniform.name}_flip`, false);
  }
};

ISFRenderer.prototype.pushUniforms = function pushUniforms() {
  for (const uniform of this.uniforms) {
    this.pushUniform(uniform);
  }
};

ISFRenderer.prototype.pushUniform = function pushUniform(uniform) {
  // [anim8 fork Update 10] a non-texture uniform lands on EVERY pass program (values are
  // per program); textures are bound once and their sampler propagated by pushTexture.
  if (this.programs && uniform.type !== 't') {
    const cur = this.program;
    for (let i = 0; i < this.programs.length; ++i) {
      this.program = this.programs[i];
      this.program.use();
      this._pushUniformTo(uniform);
    }
    this.program = cur;
    this.program.use();
    return;
  }
  this._pushUniformTo(uniform);
};

ISFRenderer.prototype._pushUniformTo = function _pushUniformTo(uniform) {
  const loc = this.program.getUniformLocation(uniform.name);
  if (loc !== -1) {
    if (uniform.type === 't') {
      this.pushTexture(uniform);
      return;
    }
    const v = uniform.value;
    switch (uniform.type) {
      case 'f':
        this.gl.uniform1f(loc, v);
        break;
      case 'v2':
        this.gl.uniform2f(loc, v[0], v[1]);
        break;
      case 'v3':
        this.gl.uniform3f(loc, v[0], v[1], v[2]);
        break;
      case 'v4':
        this.gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
        break;
      case 'i':
        this.gl.uniform1i(loc, v);
        break;
      case 'color':
        this.gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
        break;
      default:
        console.log(`Unknown type for uniform setting ${uniform.type}`, uniform);
        break;
    }
  }
};

ISFRenderer.prototype.findUniforms = function findUniforms(shader) {
  const lines = shader.split('\n');
  const uniforms = {};
  const len = lines.length;
  for (let i = 0; i < len; ++i) {
    const line = lines[i].trim();
    if (line.indexOf('uniform') === 0) {
      const tokens = line.split(' ');
      const name = tokens[2].substring(0, tokens[2].length - 1);
      const uniform = this.typeToUniform(tokens[1]);
      uniform.name = name;
      uniforms[name] = uniform;
    }
  }
  return uniforms;
};

ISFRenderer.prototype.typeToUniform = function typeToUniform(type) {
  switch (type) {
    case 'float':
      return {
        type: 'f',
        value: 0,
      };
    case 'vec2':
      return {
        type: 'v2',
        value: [0, 0],
      };
    case 'vec3':
      return {
        type: 'v3',
        value: [0, 0, 0],
      };
    case 'vec4':
      return {
        type: 'v4',
        value: [0, 0, 0, 0],
      };
    case 'bool':
      return {
        type: 'i',
        value: 0,
      };
    case 'int':
      return {
        type: 'i',
        value: 0,
      };
    case 'color':
      return {
        type: 'v4',
        value: [0, 0, 0, 0],
      };
    case 'point2D':
      return {
        type: 'v2',
        value: [0, 0],
        isPoint: true,
      };
    case 'sampler2D':
      return {
        type: 't',
        value: {
          complete: false,
          readyState: 0,
        },
        texture: null,
        textureUnit: null,
      };
    default:
      throw new Error(`Unknown uniform type in ISFRenderer.typeToUniform: ${type}`);
  }
};

ISFRenderer.prototype.setDateUniforms = function setDateUniforms() {
  const now = Date.now();
  this.setValue('TIME', (now - this.startTime) / 1000);
  this.setValue('TIMEDELTA', (now - this.lastRenderTime) / 1000);
  this.setValue('FRAMEINDEX', this.frameIndex++);
  const date = new Date();
  this.setValue('DATE', [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds()]);
  this.lastRenderTime = now;
};

ISFRenderer.prototype.draw = function draw(destination) {
  this.contextState.reset();
  this.program.use();
  this.setDateUniforms();

  const buffers = this.renderBuffers;
  for (let i = 0; i < buffers.length; ++i) {
    const buffer = buffers[i];
    const readTexture = buffer.readTexture();
    const loc = this.program.getUniformLocation(buffer.name);
    const unit = readTexture.bind(loc);
    if (buffer.name) this._setSamplerAll(buffer.name, unit);   // [Update 10]
    if (buffer.name) {
      this.setValue(`_${buffer.name}_imgSize`, [buffer.width, buffer.height]);
      this.setValue(`_${buffer.name}_imgRect`, [0, 0, 1, 1]);
      this.setValue(`_${buffer.name}_flip`, false);
    }
  }
  let lastTarget = null;
  const passes = this.model.passes;
  // [anim8 fork] sizeRef drives every render dimension: PASSES intermediate
  // sizes (via evaluateSize $WIDTH/$HEIGHT) + the final-pass viewport +
  // RENDERSIZE. _renderSize override (if set) substitutes for the
  // destination canvas's own dims so the shader rasterizes at the host's
  // requested resolution into a sub-region of the (unchanged) destination.
  const sizeRef = this._renderSize || destination;
  const finalProgram = this.program;
  for (let i = 0; i < passes.length; ++i) {
    const pass = passes[i];
    // [anim8 fork Update 10] pass i draws with ITS program; uniforms and samplers were
    // already pushed to every program, so only the bind changes here.
    if (this.programs) { this.program = this.programs[i]; this.program.use(); }
    this.setValue('PASSINDEX', i);
    const buffer = pass.buffer;
    if (pass.target) {
      const w = this.evaluateSize(sizeRef, pass.width);
      const h = this.evaluateSize(sizeRef, pass.height);
      buffer.setSize(w, h);
      const writeTexture = buffer.writeTexture();
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, buffer.fbo);
      this.gl.framebufferTexture2D(
        this.gl.FRAMEBUFFER,
        this.gl.COLOR_ATTACHMENT0,
        this.gl.TEXTURE_2D,
        writeTexture.texture,
        0);
      this.setValue('RENDERSIZE', [buffer.width, buffer.height]);
      lastTarget = buffer;
      this.gl.viewport(0, 0, w, h);
    } else {
      // [anim8 fork] final pass — render into the caller-provided target
      // framebuffer when set (Update 6; host RGBA slot FBO, alpha-preserving,
      // its dims authoritative), else the default framebuffer at the override
      // size (sub-region of destination) when _renderSize is set, else
      // destination's own dims. Unset → byte-identical to upstream. The
      // per-pass cleanup below (bindFramebuffer null) leaves the bind
      // self-contained, so a caller target never leaks past draw().
      const rt = this._renderTargetFB;
      const renderWidth = rt ? rt.width : sizeRef.width;
      const renderHeight = rt ? rt.height : sizeRef.height;
      // [anim8 fork Update 10] these two `bindTexture(null)` calls unbind whatever texture
      // sits on the ACTIVE unit — under per-pass programs that is the buffer a LATER pass
      // was just pointed at (the same-frame rebind below), so they are skipped there.
      if (!this.programs) this.gl.bindTexture(this.gl.TEXTURE_2D, null);
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, rt ? rt.fb : null);
      this.setValue('RENDERSIZE', [renderWidth, renderHeight]);
      lastTarget = null;
      this.gl.viewport(0, 0, renderWidth, renderHeight);
    }
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
    if (!this.programs) this.gl.bindTexture(this.gl.TEXTURE_2D, null);
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    // [anim8 fork Update 10] SAME-FRAME READ — ISF semantics: a LATER pass reads what an
    // EARLIER pass wrote THIS frame; only a pass reading its OWN target sees the prior
    // frame (PERSISTENT). Upstream binds every buffer's prior-frame texture once before
    // the loop, so every cross-pass read lags a frame (the A8os prepass comment records
    // it). A march→paint split cannot paint last frame's hits along this frame's rays, so
    // under per-pass programs the just-written texture is bound on a fresh unit and every
    // program's sampler is pointed at it. The pre-loop bind stays (the pass's own read).
    if (this.programs && pass.target && buffer) {
      const fresh = buffer.writeTexture();
      const unit = fresh.bind(this.program.getUniformLocation(buffer.name));
      this._setSamplerAll(buffer.name, unit);
    }
  }
  if (this.programs) { this.program = finalProgram; this.program.use(); }   // [Update 10]

  for (let i = 0; i < buffers.length; ++i) {
    buffers[i].flip();
  }
  if (lastTarget) {
    this.paintToScreen(destination, lastTarget);
  }
};

// [anim8 fork Update 9 — DEBT-56] $token substitution is LONGEST-NAME-FIRST and
// GLOBAL. Upstream iterated `this.uniforms` in insertion order with a single-
// occurrence replace, so a declared input whose name is a strict PREFIX of a
// later token corrupted it: an input named `p` turned `$prepassTile` inside a
// PASSES WIDTH/HEIGHT expression into `<value>repassTile`, mathJsEval threw
// "Undefined symbol repassTile" on EVERY draw, and the card rendered nothing —
// silently, since setValue/compile all succeed (the A8os corpus measured 24
// records declaring such prefix inputs; the whole knot/attractor tube family
// was dark, its authoring convention being single-letter symbols). Sorting the
// names longest-first makes prefix collisions impossible by construction
// ($prepassTile is consumed before $p can see it); split/join replaces every
// occurrence instead of the first. $WIDTH/$HEIGHT keep their reserved-word
// substitution ahead of the loop (the parser refuses inputs named WIDTH/HEIGHT).
ISFRenderer.prototype.evaluateSize = function evaluateSize(destination, formula) {
  formula += '';
  let s = formula
    .split('$WIDTH').join(destination.offsetWidth || destination.width)
    .split('$HEIGHT').join(destination.offsetHeight || destination.height);
  const names = Object.keys(this.uniforms)
    .filter((n) => ({}).hasOwnProperty.call(this.uniforms, n))
    .sort((a, b) => b.length - a.length);
  for (const name of names) {
    s = s.split(`$${name}`).join(this.uniforms[name].value);
  }

  return mathJsEval(s);
};

ISFRenderer.prototype.cleanup = function cleanup() {
  this.contextState.reset();
  // [anim8 fork Update 10] the per-pass programs are ours to free; the single-program
  // path keeps upstream's (unchanged) lifetime.
  if (this.programs) {
    for (let i = 0; i < this.programs.length; ++i) {
      try { this.programs[i].cleanup(); } catch (e) { /* context lost */ }
    }
    this.programs = null;
  }
  if (this.renderBuffers) {
    for (let i = 0; i < this.renderBuffers.length; ++i) {
      this.renderBuffers[i].destroy();
    }
  }
};

ISFRenderer.prototype.basicVertexShader = "precision mediump float;\nprecision mediump int;\nattribute vec2 isf_position; // -1..1\nvarying vec2 texCoord;\n\nvoid main(void) {\n  // Since webgl doesn't support ftransform, we do this by hand.\n  gl_Position = vec4(isf_position, 0, 1);\n  texCoord = isf_position;\n}\n";

ISFRenderer.prototype.basicFragmentShader = 'precision mediump float;\nuniform sampler2D tex;\nvarying vec2 texCoord;\nvoid main()\n{\n  gl_FragColor = texture2D(tex, texCoord * 0.5 + 0.5);\n  //gl_FragColor = vec4(texCoord.x);\n}';

export default ISFRenderer;
