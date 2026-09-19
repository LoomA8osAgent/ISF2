# anim8-isf-renderer (ISF2)

**A8os fork of [msfeldstein/interactive-shader-format-js](https://github.com/msfeldstein/interactive-shader-format-js)** (MIT, unchanged). Brings the ISF renderer current and carries the **ISF2** header extensions the A8os compositor emits and ingests. Fork changelog + interop rules: [ANIM8-FORK.md](ANIM8-FORK.md). Siblings: [A8os](https://github.com/exiledsurfer) (the compositor, `specs/isf2-standard.md`) · [jevisualeyes](https://github.com/LoomA8osAgent/jevisualeyes) (the decision-model composer whose emitter targets this dialect).

---

Renders ISF Effects and Compositions into a canvas

[http://www.interactiveshaderformat.com/]([http://www.interactiveshaderformat.com/])

## Example

```
var gl = canvas.getContext("webgl");

// Instantiate the renderer with your webgl context
var renderer = new ISFRenderer(gl);

// Load up the source
renderer.loadSource(fragmentISF, optionalVertexISF);

// Set up any values passing either numbers, arrays of numbers, or image/video elements
renderer.setValue("someInput", someValue);
// If you pass any image/video elements, you need to call `pushTextures` after to pass the images to webgl
renderer.pushTextures();

// Draw it into the canvas
renderer.draw(canvas);
```

## Raw ISF Parsing

Use the ISFParser class to parse ISF Fragment and Vertex shaders to GLSL shaders and an input data-mapping.

```
var parser = new ISFParser();
parser.parse(fragmentISF, optionalVertexISF);
console.log(parser.fragmentShader, parser.vertexShader, parser.inputs);
```

## Building

Build with browserify

```
npm install -g browserify
browserify main.js -o build/main.js

or

npm install -g watchify
watchify main.js -o build/main.js
```
