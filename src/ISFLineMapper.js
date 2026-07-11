function getMainLine(src) {
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    console.log('line', lines[i]);
    if (lines[i].indexOf('main()') !== -1) return i;
  }
  return -1;
}

export default function mapGLErrorToISFLine(error, glsl, isf) {
  // [anim8 fork — Update 3] Null-guard the GLSL error-format regex. Only
  // messages matching "ERROR: n:m: …" carry a mappable line; any other error
  // (runtime TypeError, parser throw, driver-specific format, non-string
  // message) made `regex.exec` return null → "Cannot read properties of null
  // (reading '2')" thrown INSIDE ISFRenderer.sourceChanged's catch — masking
  // the true compile error corpus-wide. Non-matching → return -1 (no line);
  // the caller keeps the original error object intact.
  const message = (error && typeof error.message === 'string') ? error.message : '';
  const regex = /ERROR: (\d+):(\d+): (.*)/g;
  const matches = regex.exec(message);
  if (!matches) return -1;
  const glslMainLine = getMainLine(glsl);
  const isfMainLine = getMainLine(isf);
  const glslErrorLine = matches[2];
  const isfErrorLine = parseInt(glslErrorLine, 10) + isfMainLine - glslMainLine;
  return isfErrorLine;
}
