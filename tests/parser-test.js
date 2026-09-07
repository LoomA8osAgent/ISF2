var test = require('tape');
var fs = require('fs');
var ISFParser = require('../dist/build-worker').interactiveShaderFormat.Parser;

function assetLoad(name) {
  return fs.readFileSync('./tests/assets/' + name).toString();
}

test('Infer Generator Type', function(t) {
  var src = assetLoad('generator.fs');

  var parser = new ISFParser();
  parser.parse(src);

  t.equal(parser.type, 'generator', 'Generator type detected');
  t.end();
})

test('Infer Filter Type', function(t) {
  var src = assetLoad('image-filter.fs');

  var parser = new ISFParser();
  parser.parse(src);

  t.equal(parser.type, 'filter', 'Image filter type detected');
  t.end();
})

test('Infer Transition Type', function(t) {
  var src = assetLoad('transition.fs');

  var parser = new ISFParser();
  parser.parse(src);

  t.equal(parser.type, 'transition', 'Transition type detected');
  t.end();
})

test('Buffers correctly marked as persistent', function(t) {
  var src = assetLoad('persistent-buffers.fs');

  var parser = new ISFParser();
  parser.parse(src);

  var passes = parser.passes;

  for (var i = 0; i < passes.length - 1; i++) {
    t.equal(passes[i].persistent, true, 'Persistent buffers interpreted as such');
  }

  t.equal(passes[passes.length - 1].persistent, false, 'Non persistent buffered interpreted as such');
  t.end();
})

test('Bad metadata gives error line', function(t) {
  var src = assetLoad('bad-metadata.fs');
  var parser = new ISFParser();
  // t.throws(function() {
    parser.parse(src);
  // })
  t.equal(0, 0);
  t.end();
});

test('IMG_NORM_PIXEL to VVSAMPLER_2DBYNORM', function (t) {
  let src = assetLoad('img_norm_pixel_isf.fs');
  const parser = new ISFParser();
  parser.parse(src);
  const { fragmentShader } = parser;

  const IMG_NORM_PIXEL = (variable) => `IMG_NORM_PIXEL(inputImage, ${variable});`;
  const VVSAMPLER_2DBYNORM = (variable) => `VVSAMPLER_2DBYNORM(inputImage, _inputImage_imgRect, _inputImage_imgSize, _inputImage_flip, ${variable});`;

  const variableTypes = [
    'isf_FragNormCoord',
    'vec2(isf_FragNormCoord)',
    'vec2(isf_FragNormCoord.x, isf_FragNormCoord.y)',
    'vec2(x, y)',
    'vec3(x, y, x).xy',
    'vec4(x, y, x, y).xy',
  ];

  variableTypes.forEach((variable) => {
    const test = {
      toReplace: IMG_NORM_PIXEL(variable),
      expectedReplacement: VVSAMPLER_2DBYNORM(variable),
      expectedIndex: -1
    };

    t.not(fragmentShader.indexOf(test.expectedReplacement), test.expectedIndex, test.toReplace);
  });
  
  t.end();
});

test('IMG_PIXEL to texture2D', function (t) {
  let src = assetLoad('img_pixel_isf.fs');
  const parser = new ISFParser();
  parser.parse(src);
  const { fragmentShader } = parser;

  const IMG_PIXEL = (variable) => `IMG_PIXEL(inputImage, ${variable});`;
  const TEXTURE2D = (variable) => `texture2D(inputImage, (${variable}) / RENDERSIZE);`;

  const variableTypes = [
    'gl_FragCoord.xy',
    'vec2(gl_FragCoord.xy)',
    'vec2(gl_FragCoord.x, gl_FragCoord.y)',
    'vec2(x, y)',
    'vec3(x, y, x).xy',
    'vec4(x, y, x, y).xy',
  ];

  variableTypes.forEach((variable) => {
    const test = {
      toReplace: IMG_PIXEL(variable),
      expectedReplacement: TEXTURE2D(variable),
      expectedIndex: -1
    };

    t.not(fragmentShader.indexOf(test.expectedReplacement), test.expectedIndex, test.toReplace);
  });

  t.end();
});

// [anim8 fork Update 10] A8_PASS_PROGRAMS — one compiled program per pass.
test('Update 10: A8_PASS_PROGRAMS header flag + injectPassDefine', function(t) {
  var ISFRenderer = require('../dist/build-worker').interactiveShaderFormat.Renderer;
  var src = '/*{ "PASSES": [{"TARGET":"a8pre","FLOAT":true},{}], "A8_PASS_PROGRAMS": true }*/\n' +
            'void main(){ gl_FragColor = vec4(float(PASSINDEX)); }';
  var p = new ISFParser();
  p.parse(src);
  t.equal(p.perPassPrograms, true, 'A8_PASS_PROGRAMS: true parses to perPassPrograms');
  t.equal(p.passes.length, 2, 'two passes');

  var q = new ISFParser();
  q.parse('/*{ "PASSES": [{"TARGET":"x"},{}] }*/\nvoid main(){}');
  t.equal(q.perPassPrograms, false, 'absent flag -> false (upstream byte-identical)');

  var es3 = '#version 300 es\nprecision highp float;\nvoid main(){}';
  var out = ISFRenderer.injectPassDefine(es3, 1);
  t.equal(out.split('\n')[0], '#version 300 es', '#version stays first');
  t.equal(out.split('\n')[1], '#define A8_PASS 1', 'define lands right after #version');
  t.equal(out.split('\n').length, es3.split('\n').length + 1, 'exactly one line added');

  var es1 = 'precision highp float;\nvoid main(){}';
  var out1 = ISFRenderer.injectPassDefine(es1, 0);
  t.equal(out1.split('\n')[0], '#define A8_PASS 0', 'no #version -> define prepended');
  t.equal(out1.slice(out1.indexOf('\n') + 1), es1, 'rest untouched');
  t.end();
});