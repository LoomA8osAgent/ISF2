var test = require('tape');
var fs = require('fs');
var getPixels = require('get-pixels');
var savePixels = require('save-pixels');
var gl = require('gl');
var ndarray = require('ndarray');
var pixelmatch = require('pixelmatch');
var PNG = require('pngjs').PNG;
var ISFRenderer = require('../dist/build-worker').interactiveShaderFormat.Renderer;

if (!fs.existsSync('tmp')) {
  fs.mkdirSync('tmp');
}

function assetLoad(name) {
  return fs.readFileSync('./tests/assets/' + name).toString();
}

var width = 128;
var height = 128;

const destination = {
  width,
  height,
  offsetWidth: width,
  offsetHeight: height,
};

function matchFilterToExpected(src, expected, callbacks) {
  var ctx = gl(128, 128);
  var renderer = new ISFRenderer(ctx);
  renderer.loadSource(src);

  if (callbacks.steps) {
    callbacks.steps(renderer);
  } else {
    renderer.draw(destination);
  }

  var pixels = new Uint8Array(width * height * 4);
  ctx.readPixels(0, 0, width, height, ctx.RGBA, ctx.UNSIGNED_BYTE, pixels);

  var nd = ndarray(pixels, [width, height, 4]);

  var filename = `./tmp/${Math.random()}.png`;

  var writableStream = fs.createWriteStream(filename);

  const currentStream = savePixels(nd, 'png').pipe(writableStream);

  var expectedFilename = expected.split('/')[expected.split('/').length - 1];

  const img1 = fs.createReadStream(filename).pipe(new PNG()).on('parsed', doneReading);
  const img2 = fs.createReadStream(expected).pipe(new PNG()).on('parsed', doneReading);
  let filesRead = 0;

  function doneReading() {
    if (++filesRead < 2) return;
    var diff = new PNG({width: img1.width, height: img1.height});

    const numDiff = pixelmatch(img1.data, img2.data, diff.data, img1.width, img1.height, {
      threshold: 0.1,
    });

    diff.pack().pipe(fs.createWriteStream(expectedFilename));

    const goodEnough = !numDiff;
    console.log(!numDiff ? 'No difference!' : `Got ${numDiff} different pixel(s)`);

    callbacks.finished(goodEnough);
  }
}

test('Basic Generator Rendering', function(t) {
  var generatorSrc = assetLoad('generator.fs')
  var callbacks = {
    finished: (same) => {
      t.equals(same, true);
      t.end();
    },
  };

  matchFilterToExpected(generatorSrc, './tests/expected/generator.png', callbacks);
});

test('Persistent Buffers', function(t) {
  var generatorSrc = assetLoad('persistent-buffers.fs')
  var callbacks = {
    steps: (renderer) => {
      renderer.setValue('xPos', 0);
      renderer.draw(destination);
      renderer.setValue('xPos', 0.5);
      renderer.draw(destination);
      renderer.setValue('xPos', 1.0);
      renderer.draw(destination);
      renderer.draw(destination);
    },

    finished: (same) => {
      t.equals(same, true);
      t.end();
    }
  }

  matchFilterToExpected(generatorSrc, './tests/expected/persistent-buffers.png', callbacks);
});

// [anim8 fork Update 11] loadSource(src, undefined, { program }) adopts a caller-owned
// linked program built from the parser's own strings — no second compile/link — and
// renders identically; a program built from DIFFERENT strings is refused (fallback
// compile, caller's objects untouched).
test('Adopt caller-linked program (Update 11)', function(t) {
  var ISFParser = require('../dist/build-worker').interactiveShaderFormat.Parser;
  var src = assetLoad('generator.fs');
  var ctx = gl(128, 128);
  var parsed = new ISFParser();
  parsed.parse(src);
  function link(vsSrc, fsSrc) {
    var vs = ctx.createShader(ctx.VERTEX_SHADER); ctx.shaderSource(vs, vsSrc); ctx.compileShader(vs);
    var fs = ctx.createShader(ctx.FRAGMENT_SHADER); ctx.shaderSource(fs, fsSrc); ctx.compileShader(fs);
    var prog = ctx.createProgram(); ctx.attachShader(prog, vs); ctx.attachShader(prog, fs); ctx.linkProgram(prog);
    return { program: prog, vShader: vs, fShader: fs, vertexShader: vsSrc, fragmentShader: fsSrc };
  }
  t.equal(ISFRenderer.supportsProgramAdopt, true, 'capability flag published');

  // 1 — matching strings → adopted, same program object, renders to the reference.
  var spec = link(parsed.vertexShader, parsed.fragmentShader);
  var r1 = new ISFRenderer(ctx);
  r1.loadSource(src, undefined, { program: spec });
  t.equal(r1.valid, true, 'adopting renderer is valid');
  t.equal(r1.adoptedProgram, true, 'adoptedProgram reports true');
  t.equal(r1.program.program, spec.program, 'the caller program IS the renderer program');
  r1.draw(destination);
  var px = new Uint8Array(width * height * 4);
  ctx.readPixels(0, 0, width, height, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
  var r2 = new ISFRenderer(ctx);
  r2.loadSource(src);
  r2.draw(destination);
  var px2 = new Uint8Array(width * height * 4);
  ctx.readPixels(0, 0, width, height, ctx.RGBA, ctx.UNSIGNED_BYTE, px2);
  var diff = 0; for (var i = 0; i < px.length; i++) if (px[i] !== px2[i]) diff++;
  t.equal(diff, 0, 'adopted render byte-identical to the compiled render');

  // 2 — strings differ (a stale program from another source) → refused, compiled instead.
  var stale = link(parsed.vertexShader, parsed.fragmentShader + '\n// stale\n');
  var r3 = new ISFRenderer(ctx);
  r3.loadSource(src, undefined, { program: stale });
  t.equal(r3.valid, true, 'fallback renderer is valid');
  t.equal(r3.adoptedProgram, false, 'mismatched strings are NOT adopted');
  t.notEqual(r3.program.program, stale.program, 'renderer compiled its own program');
  t.equal(ctx.isProgram(stale.program), true, 'caller objects left untouched on refusal');

  // 3 — an unlinked program is refused.
  var dead = { program: ctx.createProgram(), vertexShader: parsed.vertexShader, fragmentShader: parsed.fragmentShader };
  var r4 = new ISFRenderer(ctx);
  r4.loadSource(src, undefined, { program: dead });
  t.equal(r4.adoptedProgram, false, 'LINK_STATUS false is refused');
  t.equal(r4.valid, true, 'and falls back to a valid compile');
  t.end();
});
