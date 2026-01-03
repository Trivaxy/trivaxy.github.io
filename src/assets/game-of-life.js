(function () {
  const canvas = document.getElementById('background');
  if (!canvas) return;

  const GRID_SIZE = 200;
  const MODES = ['life', 'ant'];

  let running = false;
  let rafId = 0;
  let cleanupFn = null;
  let currentMode = 'life';
  let startToken = 0;

  // Wait for DOM to be fully ready and styles to be computed
  function waitForStyles() {
    return new Promise((resolve) => {
      function checkStyles() {
        const computedStyle = getComputedStyle(document.documentElement);
        const bgColor = computedStyle.getPropertyValue('--bg').trim();
        if (bgColor && bgColor !== '') {
          resolve();
        } else {
          requestAnimationFrame(checkStyles);
        }
      }
      requestAnimationFrame(checkStyles);
    });
  }

  function parseCssColor(input) {
    if (!input) return null;
    const str = input.trim();
    if (!str) return null;
    if (str[0] === '#') {
      let hex = str.slice(1);
      if (hex.length === 3) {
        hex = hex.split('').map((c) => c + c).join('');
      }
      if (hex.length === 6) {
        const value = parseInt(hex, 16);
        if (!Number.isNaN(value)) {
          const r = ((value >> 16) & 255) / 255;
          const g = ((value >> 8) & 255) / 255;
          const b = (value & 255) / 255;
          return [r, g, b];
        }
      }
      return null;
    }
    if (str.startsWith('rgb')) {
      const match = str.match(/rgba?\(([^)]+)\)/i);
      if (match) {
        const parts = match[1].split(',').map((part) => parseFloat(part.trim()));
        if (parts.length >= 3 && parts.every((v) => Number.isFinite(v))) {
          return [parts[0] / 255, parts[1] / 255, parts[2] / 255];
        }
      }
    }
    return null;
  }

  function getThemeColors() {
    const theme = document.documentElement.getAttribute('data-theme');
    const alive = theme === 'dark' ? [1, 1, 1] : [0, 0, 0];
    const bg = theme === 'dark' ? [0, 0, 0] : [1, 1, 1];
    let accent = alive;

    try {
      const style = getComputedStyle(document.documentElement);
      const link = style.getPropertyValue('--link');
      const parsed = parseCssColor(link);
      if (parsed) {
        accent = parsed;
      }
    } catch (e) {}

    return { alive, bg, accent };
  }

  function createFullscreenQuad(gl) {
    return twgl.createBufferInfoFromArrays(gl, {
      position: { numComponents: 2, data: [-1, -1, 1, -1, -1, 1, 1, 1] },
      indices: [0, 1, 2, 2, 1, 3],
    });
  }


  const FULLSCREEN_VS = `#version 300 es
  in vec2 position;
  void main(){
    gl_Position = vec4(position, 0.0, 1.0);
  }`;

  class SeedWriter {
    constructor(size, channels = 4) {
      this.size = size;
      this.channels = channels;
      this.data = new Uint8Array(size * size * channels);
    }
    inBounds(x, y) {
      return x >= 0 && x < this.size && y >= 0 && y < this.size;
    }
    index(x, y) {
      return (y * this.size + x) * this.channels;
    }
    setChannel(x, y, channel, value) {
      if (!this.inBounds(x, y)) return false;
      this.data[this.index(x, y) + channel] = value;
      return true;
    }
    getChannel(x, y, channel = 0) {
      if (!this.inBounds(x, y)) return 0;
      return this.data[this.index(x, y) + channel];
    }
    fillChannel(channel, value) {
      const { data, channels } = this;
      for (let i = channel; i < data.length; i += channels) {
        data[i] = value;
      }
    }
    setRgb(x, y, r = 255, g = 255, b = 255) {
      if (!this.inBounds(x, y)) return false;
      const idx = this.index(x, y);
      this.data[idx] = r;
      this.data[idx + 1] = g;
      this.data[idx + 2] = b;
      return true;
    }
    clearRgb(x, y) {
      return this.setRgb(x, y, 0, 0, 0);
    }
    isEmpty(x, y) {
      if (!this.inBounds(x, y)) return false;
      return this.data[this.index(x, y)] === 0;
    }
  }

  function applyTextureDefaults(gl) {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  function initPingPongTargets(gl, size, seedData) {
    const attachments = [{ internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE }];
    const fboA = twgl.createFramebufferInfo(gl, attachments, size, size);
    const fboB = twgl.createFramebufferInfo(gl, attachments, size, size);

    gl.bindTexture(gl.TEXTURE_2D, fboA.attachments[0]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, seedData || null);
    applyTextureDefaults(gl);

    gl.bindTexture(gl.TEXTURE_2D, fboB.attachments[0]);
    applyTextureDefaults(gl);

    gl.bindTexture(gl.TEXTURE_2D, null);

    return { fboA, fboB };
  }

  function gatherBufferHandles(bufferInfo) {
    const handles = [];
    if (!bufferInfo) return handles;
    const attribs = bufferInfo.attribs || {};
    for (const key in attribs) {
      if (Object.prototype.hasOwnProperty.call(attribs, key)) {
        const buffer = attribs[key].buffer;
        if (buffer) handles.push(buffer);
      }
    }
    if (bufferInfo.elementArrayBuffer) {
      handles.push(bufferInfo.elementArrayBuffer);
    }
    return handles;
  }

  function disposeResources(gl, { programs = [], framebuffers = [], buffers = [] }) {
    try {
      programs.forEach((program) => program && gl.deleteProgram(program));
    } catch (e) {}
    try {
      framebuffers.forEach((fbo) => {
        if (!fbo) return;
        (fbo.attachments || []).forEach((tex) => tex && gl.deleteTexture(tex));
        if (fbo.framebuffer) {
          gl.deleteFramebuffer(fbo.framebuffer);
        }
      });
    } catch (e) {}
    try {
      buffers.forEach((buffer) => buffer && gl.deleteBuffer(buffer));
    } catch (e) {}
  }
  const LIFE_PATTERN_SOURCES = [
    {
      name: 'glider',
      minCount: 4,
      maxCount: 7,
      padding: 6,
      rle: '#N Glider\n#O Richard K. Guy\n#C The smallest, most common, and first discovered spaceship. Diagonal, has period 4 and speed c/4.\n#C www.conwaylife.com/wiki/index.php?title=Glider\nx = 3, y = 3, rule = B3/S23\nbob$2bo$3o!',
    },
    {
      name: 'gosperGliderGun',
      minCount: 1,
      maxCount: 1,
      padding: 10,
      rle: '#N Gosper glider gun\n#O Bill Gosper\n#C A true period 30 glider gun.\n#C The first known gun and the first known finite pattern with unbounded growth.\n#C www.conwaylife.com/wiki/index.php?title=Gosper_glider_gun\nx = 36, y = 9, rule = B3/S23\n24bo11b$22bobo11b$12b2o6b2o12b2o$11bo3bo4b2o12b2o$2o8bo5bo3b2o14b$2o8bo3bob2o4bobo11b$10bo5bo7bo11b$11bo3bo20b$12b2o!',
    },
    {
      name: 'puffer1',
      minCount: 1,
      maxCount: 1,
      padding: 10,
      rle: '#N Puffer 1\n#O Bill Gosper\n#C An orthogonal, period-128 puffer and the first puffer to be discovered\n#C red\n#C http://www.conwaylife.com/wiki/index.php?title=Puffer_1\nx = 27, y = 7, rule = b3/s23\nb3o6bo5bo6b3ob$o2bo5b3o3b3o5bo2bo$3bo4b2obo3bob2o4bo3b$3bo19bo3b$3bo2bo13bo2bo3b$3bo2b2o11b2o2bo3b$2bo3b2o11b2o3bo!',
    },
    {
      name: 'rPentomino',
      minCount: 2,
      maxCount: 4,
      padding: 4,
      rle: '#N R-pentomino\n#C A methuselah with lifespan 1103.\n#C www.conwaylife.com/wiki/index.php?title=R-pentomino\nx = 3, y = 3, rule = B3/S23\nb2o$2ob$bo!',
    },
  ];

  function parseLifeRle(rle) {
    const lines = rle.split(/\r?\n/);
    let dataStarted = false;
    const dataParts = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) {
        continue;
      }
      if (!dataStarted) {
        if (/^x\s*=\s*/i.test(line)) {
          dataStarted = true;
        }
        continue;
      }
      dataParts.push(line);
    }
    const raw = dataParts.join('').replace(/\s+/g, '');
    const cells = [];
    let x = 0;
    let y = 0;
    let count = '';
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (ch >= '0' && ch <= '9') {
        count += ch;
        continue;
      }
      const run = count ? parseInt(count, 10) : 1;
      count = '';
      if (ch === 'o' || ch === 'O') {
        for (let k = 0; k < run; k++) {
          cells.push([x + k, y]);
        }
        x += run;
      } else if (ch === 'b' || ch === 'B') {
        x += run;
      } else if (ch === '$') {
        y += run;
        x = 0;
      } else if (ch === '!') {
        break;
      }
    }
    let width = 0;
    let height = 0;
    for (let i = 0; i < cells.length; i++) {
      const cx = cells[i][0];
      const cy = cells[i][1];
      if (cx + 1 > width) {
        width = cx + 1;
      }
      if (cy + 1 > height) {
        height = cy + 1;
      }
    }
    return { cells, width, height };
  }

  function transformLifePattern(pattern, rotation, mirror) {
    const rot = rotation & 3;
    const w = pattern.width;
    const h = pattern.height;
    const transformed = new Array(pattern.cells.length);
    for (let i = 0; i < pattern.cells.length; i++) {
      const cell = pattern.cells[i];
      const tx = mirror ? w - 1 - cell[0] : cell[0];
      const ty = cell[1];
      let nx;
      let ny;
      if (rot === 0) {
        nx = tx;
        ny = ty;
      } else if (rot === 1) {
        nx = ty;
        ny = w - 1 - tx;
      } else if (rot === 2) {
        nx = w - 1 - tx;
        ny = h - 1 - ty;
      } else {
        nx = h - 1 - ty;
        ny = tx;
      }
      transformed[i] = [nx, ny];
    }
    const newWidth = rot % 2 === 0 ? w : h;
    const newHeight = rot % 2 === 0 ? h : w;
    return { width: newWidth, height: newHeight, cells: transformed };
  }

  function randomInt(min, max) {
    if (max < min) {
      const tmp = min;
      min = max;
      max = tmp;
    }
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  const LIFE_PATTERNS = LIFE_PATTERN_SOURCES.map((pattern) => {
    const parsed = parseLifeRle(pattern.rle);
    return { ...pattern, ...parsed };
  });

  function createLifeSimulation(gl, n) {
    const simfs = `#version 300 es
    precision highp float;
    uniform sampler2D u_texture;
    uniform vec2 u_resolution;
    out vec4 outColor;

    float get(vec2 o){
      return texture(u_texture, (gl_FragCoord.xy + o) / u_resolution).r;
    }
    void main(){
      float sum = 0.0;
      sum += get(vec2(-1.0,-1.0));
      sum += get(vec2(-1.0, 0.0));
      sum += get(vec2(-1.0, 1.0));
      sum += get(vec2( 0.0,-1.0));
      sum += get(vec2( 0.0, 1.0));
      sum += get(vec2( 1.0,-1.0));
      sum += get(vec2( 1.0, 0.0));
      sum += get(vec2( 1.0, 1.0));

      float current = get(vec2(0.0, 0.0));
      float next = current;
      if (current > 0.5) {
        if (sum < 1.5 || sum > 3.5) next = 0.0;
      } else {
        if (sum > 2.5 && sum < 3.5) next = 1.0;
      }
      outColor = vec4(next, 0.0, 0.0, 1.0);
    }`;

    const drawfs = `#version 300 es
    precision highp float;
    uniform sampler2D u_texture;
    uniform vec2 u_canvasSize;
    uniform float u_gridSize;
    uniform vec3 u_aliveColor;
    uniform vec3 u_bgColor;
    out vec4 outColor;
    void main(){
      float s = max(u_canvasSize.x / u_gridSize, u_canvasSize.y / u_gridSize);
      vec2 cellPx = vec2(s, s);
      vec2 gridPx = vec2(u_gridSize) * cellPx;
      vec2 offset = 0.5 * (u_canvasSize - gridPx);
      vec2 p = gl_FragCoord.xy - offset;
      if (p.x < 0.0 || p.y < 0.0 || p.x >= gridPx.x || p.y >= gridPx.y) {
        outColor = vec4(u_bgColor, 1.0);
        return;
      }
      vec2 cell = floor(p / cellPx);
      vec2 uv = (cell + 0.5) / vec2(u_gridSize);
      float state = texture(u_texture, uv).r;
      vec3 color = mix(u_bgColor, u_aliveColor, step(0.5, state));
      outColor = vec4(color, 1.0);
    }`;

    const simProgram = twgl.createProgramInfo(gl, [FULLSCREEN_VS, simfs]);
    const drawProgram = twgl.createProgramInfo(gl, [FULLSCREEN_VS, drawfs]);
    const quad = createFullscreenQuad(gl);

    const seedWriter = new SeedWriter(n);
    seedWriter.fillChannel(3, 255);

    function chooseOffset(size, patternSize, padding) {
      const span = size - patternSize;
      if (span <= 0) {
        return 0;
      }
      const pad = Math.max(0, Math.min(padding | 0, span));
      const min = pad;
      const max = span - pad;
      if (max < min) {
        return Math.floor(Math.random() * (span + 1));
      }
      return min + Math.floor(Math.random() * (max - min + 1));
    }

    function canStamp(cells, offsetX, offsetY) {
      for (let i = 0; i < cells.length; i++) {
        const cx = offsetX + cells[i][0];
        const cy = offsetY + cells[i][1];
        if (!seedWriter.isEmpty(cx, cy)) {
          return false;
        }
      }
      return true;
    }

    function stampPattern(cells, offsetX, offsetY) {
      for (let i = 0; i < cells.length; i++) {
        const x = offsetX + cells[i][0];
        const y = offsetY + cells[i][1];
        seedWriter.setRgb(x, y);
      }
    }

    function placePattern(pattern, padding) {
      const attempts = 80;
      for (let attempt = 0; attempt < attempts; attempt++) {
        const rotation = (Math.random() * 4) | 0;
        const mirror = Math.random() < 0.5;
        const oriented = transformLifePattern(pattern, rotation, mirror);
        const offsetX = chooseOffset(n, oriented.width, padding);
        const offsetY = chooseOffset(n, oriented.height, padding);
        if (!canStamp(oriented.cells, offsetX, offsetY)) {
          continue;
        }
        stampPattern(oriented.cells, offsetX, offsetY);
        return true;
      }
      return false;
    }

    function sprayNoise(attempts, minRadius, maxRadius, density) {
      for (let i = 0; i < attempts; i++) {
        const radius = randomInt(minRadius, maxRadius);
        const cx = Math.floor(Math.random() * n);
        const cy = Math.floor(Math.random() * n);
        const r2 = radius * radius;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (dx * dx + dy * dy > r2) {
              continue;
            }
            const x = cx + dx;
            const y = cy + dy;
            if (!seedWriter.isEmpty(x, y)) {
              continue;
            }
            if (Math.random() < density) {
              seedWriter.setRgb(x, y);
            }
          }
        }
      }
    }

    function seedLifeBoard() {
      for (let i = 0; i < LIFE_PATTERNS.length; i++) {
        const pattern = LIFE_PATTERNS[i];
        const count = randomInt(pattern.minCount, pattern.maxCount);
        const padding = pattern.padding ?? 4;
        let placed = 0;
        while (placed < count) {
          if (!placePattern(pattern, padding)) {
            break;
          }
          placed++;
        }
      }

      sprayNoise(10, 2, 5, 0.3);
      sprayNoise(6, 1, 2, 0.45);
    }

    seedLifeBoard();

    let { fboA, fboB } = initPingPongTargets(gl, n, seedWriter.data);

    function runLifeWarmup(iterations) {
      if (!iterations || iterations <= 0) {
        return;
      }
      gl.useProgram(simProgram.program);
      twgl.setBuffersAndAttributes(gl, simProgram, quad);
      for (let i = 0; i < iterations; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fboB.framebuffer);
        gl.viewport(0, 0, n, n);
        twgl.setUniforms(simProgram, {
          u_texture: fboA.attachments[0],
          u_resolution: [n, n],
        });
        twgl.drawBufferInfo(gl, quad);
        const tmp = fboA;
        fboA = fboB;
        fboB = tmp;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    runLifeWarmup(randomInt(60, 120));

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    let lastStep = 0;

    return {
      step(t, width, height, colors) {
        if (!lastStep) {
          lastStep = t;
        }

        if (t - lastStep > 250) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, fboB.framebuffer);
          gl.viewport(0, 0, n, n);
          gl.useProgram(simProgram.program);
          twgl.setBuffersAndAttributes(gl, simProgram, quad);
          twgl.setUniforms(simProgram, {
            u_texture: fboA.attachments[0],
            u_resolution: [n, n],
          });
          twgl.drawBufferInfo(gl, quad);
          const tmp = fboA;
          fboA = fboB;
          fboB = tmp;
          lastStep = t;
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, width, height);
        gl.useProgram(drawProgram.program);
        twgl.setBuffersAndAttributes(gl, drawProgram, quad);
        twgl.setUniforms(drawProgram, {
          u_texture: fboA.attachments[0],
          u_canvasSize: [width, height],
          u_gridSize: n,
          u_aliveColor: colors.alive,
          u_bgColor: colors.bg,
        });
        twgl.drawBufferInfo(gl, quad);
      },
      dispose() {
        disposeResources(gl, {
          programs: [simProgram.program, drawProgram.program],
          framebuffers: [fboA, fboB],
          buffers: gatherBufferHandles(quad),
        });
      },
    };
  }

  function createAntSimulation(gl, n) {
    const simfs = `#version 300 es
    precision highp float;
    uniform sampler2D u_texture;
    uniform vec2 u_resolution;
    out vec4 outColor;

    vec4 sampleWrap(vec2 offset){
      vec2 res = u_resolution;
      vec2 coord = gl_FragCoord.xy + offset;
      coord = mod(coord - 0.5 + res, res) + 0.5;
      return texture(u_texture, coord / res);
    }

    float decodeDir(float v){
      return floor(v * 4.0 + 0.5);
    }

    float encodeDir(float dir){
      return dir / 4.0;
    }

    float turnRight(float dir){
      return mod(dir + 1.0, 4.0);
    }

    float turnLeft(float dir){
      return mod(dir + 3.0, 4.0);
    }

    void main(){
      vec4 state = texture(u_texture, gl_FragCoord.xy / u_resolution);
      float color = state.r;
      float ant = state.g;
      float dirStored = state.b;

      float nextColor = color;
      float nextAnt = 0.0;
      float nextDirEnc = 0.0;

      if (ant > 0.5) {
        float dir = decodeDir(dirStored);
        float newDir = color < 0.5 ? turnRight(dir) : turnLeft(dir);
        nextColor = 1.0 - color;
      }

      const vec2 offsets[4] = vec2[4](vec2(0.0, -1.0), vec2(1.0, 0.0), vec2(0.0, 1.0), vec2(-1.0, 0.0));
      const float incomingDir[4] = float[4](2.0, 3.0, 0.0, 1.0);

      for (int i = 0; i < 4; ++i) {
        vec4 neighbor = sampleWrap(offsets[i]);
        if (neighbor.g > 0.5 && nextAnt < 0.5) {
          float dir = decodeDir(neighbor.b);
          float newDir = neighbor.r < 0.5 ? turnRight(dir) : turnLeft(dir);
          if (abs(newDir - incomingDir[i]) < 0.5) {
            nextAnt = 1.0;
            nextDirEnc = encodeDir(newDir);
          }
        }
      }

      outColor = vec4(nextColor, nextAnt, nextDirEnc, 1.0);
    }`;

    const drawfs = `#version 300 es
    precision highp float;
    uniform sampler2D u_texture;
    uniform vec2 u_canvasSize;
    uniform float u_gridSize;
    uniform vec3 u_aliveColor;
    uniform vec3 u_bgColor;
    uniform vec3 u_antColor;
    out vec4 outColor;
    void main(){
      float s = max(u_canvasSize.x / u_gridSize, u_canvasSize.y / u_gridSize);
      vec2 cellPx = vec2(s, s);
      vec2 gridPx = vec2(u_gridSize) * cellPx;
      vec2 offset = 0.5 * (u_canvasSize - gridPx);
      vec2 p = gl_FragCoord.xy - offset;
      if (p.x < 0.0 || p.y < 0.0 || p.x >= gridPx.x || p.y >= gridPx.y) {
        outColor = vec4(u_bgColor, 1.0);
        return;
      }
      vec2 cell = floor(p / cellPx);
      vec2 uv = (cell + 0.5) / vec2(u_gridSize);
      vec4 state = texture(u_texture, uv);
      vec3 baseColor = mix(u_bgColor, u_aliveColor, step(0.5, state.r));
      vec3 color = mix(baseColor, u_antColor, step(0.5, state.g));
      outColor = vec4(color, 1.0);
    }`;

    const simProgram = twgl.createProgramInfo(gl, [FULLSCREEN_VS, simfs]);
    const drawProgram = twgl.createProgramInfo(gl, [FULLSCREEN_VS, drawfs]);
    const quad = createFullscreenQuad(gl);

    const seedWriter = new SeedWriter(n);
    seedWriter.fillChannel(3, 255);

    function setTrackCell(x, y, alive) {
      seedWriter.setChannel(x, y, 0, alive ? 255 : 0);
    }

    function drawHorizontalBand(yCenter, thickness) {
      const half = Math.max(0, Math.floor(thickness / 2));
      for (let dy = -half; dy <= half; dy++) {
        const row = yCenter + dy;
        if (row < 0 || row >= n) {
          continue;
        }
        for (let x = 0; x < n; x++) {
          setTrackCell(x, row, true);
        }
      }
    }

    function drawVerticalBand(xCenter, thickness) {
      const half = Math.max(0, Math.floor(thickness / 2));
      for (let dx = -half; dx <= half; dx++) {
        const col = xCenter + dx;
        if (col < 0 || col >= n) {
          continue;
        }
        for (let y = 0; y < n; y++) {
          setTrackCell(col, y, true);
        }
      }
    }

    function drawWrappedDiagonal(offset, thickness, slope) {
      const half = Math.max(0, Math.floor(thickness / 2));
      for (let x = 0; x < n; x++) {
        const baseY = slope > 0 ? (x + offset + n) % n : ((offset - x) % n + n) % n;
        for (let dy = -half; dy <= half; dy++) {
          const y = (baseY + dy + n) % n;
          setTrackCell(x, y, true);
        }
      }
    }

    function carveRandomGaps(count, maxLen) {
      for (let i = 0; i < count; i++) {
        const len = randomInt(2, maxLen);
        const horizontal = Math.random() < 0.5;
        const startX = randomInt(0, n - 1);
        const startY = randomInt(0, n - 1);
        for (let step = 0; step < len; step++) {
          const x = horizontal ? startX + step : startX;
          const y = horizontal ? startY : startY + step;
          if (x >= n || y >= n) {
            break;
          }
          setTrackCell(x, y, false);
        }
      }
    }

    function scatterDust(samples, probability) {
      for (let i = 0; i < samples; i++) {
        const x = randomInt(0, n - 1);
        const y = randomInt(0, n - 1);
        if (Math.random() < probability) {
          setTrackCell(x, y, true);
        }
      }
    }

    function clearAround(x, y, radius) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const cx = x + dx;
          const cy = y + dy;
          if (!seedWriter.inBounds(cx, cy)) {
            continue;
          }
          seedWriter.clearRgb(cx, cy);
        }
      }
    }

    function spawnAnt(x, y, dir) {
      if (!seedWriter.inBounds(x, y)) {
        return;
      }
      seedWriter.clearRgb(x, y);
      seedWriter.setChannel(x, y, 1, 255);
      const encoded = Math.round((((dir % 4) + 4) % 4) * 255 / 4);
      seedWriter.setChannel(x, y, 2, encoded);
    }

    function getVisibleGridBounds() {
      const width = canvas.clientWidth || canvas.width || window.innerWidth || n;
      const height = canvas.clientHeight || canvas.height || window.innerHeight || n;
      if (!width || !height) {
        return { minX: 0, maxX: n - 1, minY: 0, maxY: n - 1 };
      }
      const scale = Math.max(width / n, height / n);
      if (!scale || !Number.isFinite(scale)) {
        return { minX: 0, maxX: n - 1, minY: 0, maxY: n - 1 };
      }
      const gridPx = scale * n;
      const offsetX = 0.5 * (width - gridPx);
      const offsetY = 0.5 * (height - gridPx);

      const pMinX = Math.max(0, -offsetX);
      const pMaxX = Math.min(gridPx, width - offsetX);
      const pMinY = Math.max(0, -offsetY);
      const pMaxY = Math.min(gridPx, height - offsetY);

      let minX = Math.max(0, Math.floor(pMinX / scale));
      let maxX = Math.min(n - 1, Math.ceil(pMaxX / scale) - 1);
      let minY = Math.max(0, Math.floor(pMinY / scale));
      let maxY = Math.min(n - 1, Math.ceil(pMaxY / scale) - 1);

      if (maxX < minX || maxY < minY) {
        return { minX: 0, maxX: n - 1, minY: 0, maxY: n - 1 };
      }

      minX = Math.max(0, minX - 2);
      maxX = Math.min(n - 1, maxX + 2);
      minY = Math.max(0, minY - 2);
      maxY = Math.min(n - 1, maxY + 2);

      return { minX, maxX, minY, maxY };
    }
    function drawTracks() {
      const horizontalCount = randomInt(3, 4);
      for (let i = 0; i < horizontalCount; i++) {
        const base = Math.floor(((i + 1) * n) / (horizontalCount + 1));
        drawHorizontalBand(base + randomInt(-6, 6), randomInt(2, 4));
      }

      const verticalCount = randomInt(3, 4);
      for (let i = 0; i < verticalCount; i++) {
        const base = Math.floor(((i + 1) * n) / (verticalCount + 1));
        drawVerticalBand(base + randomInt(-6, 6), randomInt(2, 4));
      }

      drawWrappedDiagonal(randomInt(0, n - 1), randomInt(1, 2), 1);
      drawWrappedDiagonal(randomInt(0, n - 1), randomInt(1, 2), -1);

      carveRandomGaps(50, Math.max(4, Math.floor(n * 0.08)));
      scatterDust(150, 0.35);
    }

    function spawnAnts() {
      const antCount = randomInt(2, 4);
      const used = new Set();
      const bounds = getVisibleGridBounds();
      const minX = bounds.minX;
      const maxX = bounds.maxX;
      const minY = bounds.minY;
      const maxY = bounds.maxY;
      const spanX = Math.max(1, maxX - minX + 1);
      const spanY = Math.max(1, maxY - minY + 1);
      const maxAttempts = Math.min(n * n, Math.max(100, spanX * spanY * 2));
      for (let i = 0; i < antCount; i++) {
        let placed = false;
        for (let attempt = 0; attempt < maxAttempts && !placed; attempt++) {
          const x = randomInt(minX, maxX);
          const y = randomInt(minY, maxY);
          const key = y * n + x;
          if (used.has(key)) {
            continue;
          }
          clearAround(x, y, 2);
          spawnAnt(x, y, randomInt(0, 3));
          used.add(key);
          placed = true;
        }
        if (!placed) {
          for (let y = minY; y <= maxY && !placed; y++) {
            for (let x = minX; x <= maxX && !placed; x++) {
              const key = y * n + x;
              if (used.has(key)) {
                continue;
              }
              clearAround(x, y, 2);
              spawnAnt(x, y, randomInt(0, 3));
              used.add(key);
              placed = true;
            }
          }
        }
      }
    }
    drawTracks();
    spawnAnts();

    let { fboA, fboB } = initPingPongTargets(gl, n, seedWriter.data);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    const stepMs = 30;
    let lastStep = 0;

    return {
      step(t, width, height, colors) {
        if (!lastStep) {
          lastStep = t - stepMs;
        }

        let iterations = 0;
        while (t - lastStep >= stepMs && iterations < 64) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, fboB.framebuffer);
          gl.viewport(0, 0, n, n);
          gl.useProgram(simProgram.program);
          twgl.setBuffersAndAttributes(gl, simProgram, quad);
          twgl.setUniforms(simProgram, {
            u_texture: fboA.attachments[0],
            u_resolution: [n, n],
          });
          twgl.drawBufferInfo(gl, quad);
          const tmp = fboA;
          fboA = fboB;
          fboB = tmp;
          lastStep += stepMs;
          iterations++;
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, width, height);
        gl.useProgram(drawProgram.program);
        twgl.setBuffersAndAttributes(gl, drawProgram, quad);
        twgl.setUniforms(drawProgram, {
          u_texture: fboA.attachments[0],
          u_canvasSize: [width, height],
          u_gridSize: n,
          u_aliveColor: colors.alive,
          u_bgColor: colors.bg,
          u_antColor: colors.accent,
        });
        twgl.drawBufferInfo(gl, quad);
      },
      dispose() {
        disposeResources(gl, {
          programs: [simProgram.program, drawProgram.program],
          framebuffers: [fboA, fboB],
          buffers: gatherBufferHandles(quad),
        });
      },
    };
  }

  function createSimulation(gl, mode, size) {
    return mode === 'ant' ? createAntSimulation(gl, size) : createLifeSimulation(gl, size);
  }

  function start(mode) {
    if (mode && MODES.includes(mode)) {
      currentMode = mode;
    }

    if (cleanupFn) {
      cleanupFn();
      cleanupFn = null;
    }

    const token = ++startToken;
    running = true;
    document.documentElement.setAttribute('data-sim', 'on');
    document.documentElement.setAttribute('data-sim-mode', currentMode);
    canvas.style.display = 'block';

    waitForStyles().then(() => {
      if (token !== startToken || !running) {
        return;
      }

      const gl = canvas.getContext('webgl2', { antialias: false, alpha: true });
      if (!gl) {
        running = false;
        document.documentElement.setAttribute('data-sim', 'off');
        canvas.style.display = 'none';
        return;
      }

      let sim;
      try {
        sim = createSimulation(gl, currentMode, GRID_SIZE);
      } catch (e) {
        running = false;
        document.documentElement.setAttribute('data-sim', 'off');
        canvas.style.display = 'none';
        return;
      }

      function render(time) {
        if (token !== startToken || !running) {
          return;
        }
        twgl.resizeCanvasToDisplaySize(gl.canvas, window.devicePixelRatio || 1);
        sim.step(time, gl.canvas.width, gl.canvas.height, getThemeColors());
        rafId = requestAnimationFrame(render);
      }

      rafId = requestAnimationFrame(render);

      cleanupFn = function () {
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
        try {
          if (sim) {
            sim.dispose();
          }
        } catch (e) {}
        try {
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
        } catch (e) {}
        canvas.style.display = 'none';
      };
    });
  }

  function stop() {
    if (!running && !cleanupFn) {
      document.documentElement.setAttribute('data-sim', 'off');
      return;
    }
    running = false;
    startToken++;
    if (cleanupFn) {
      cleanupFn();
      cleanupFn = null;
    }
    document.documentElement.setAttribute('data-sim', 'off');
    document.documentElement.setAttribute('data-sim-mode', currentMode);
    canvas.style.display = 'none';
  }

  function setMode(mode) {
    if (!mode || !MODES.includes(mode) || mode === currentMode) {
      return;
    }
    const wasRunning = running;
    currentMode = mode;
    document.documentElement.setAttribute('data-sim-mode', currentMode);
    if (wasRunning) {
      start(mode);
    }
  }

  function getMode() {
    return currentMode;
  }

  window.GOL = {
    start,
    stop,
    isRunning: () => running,
    setMode,
    getMode,
    modes: MODES.slice(),
  };

  start();
})();










