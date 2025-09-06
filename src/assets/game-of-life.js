// Conway's Game of Life - WebGL2, 200x200, square upscaled cells
// Requires twgl.js (loaded in base layout)

(function () {
  const canvas = document.getElementById('background');
  if (!canvas) return;

  let running = false;
  let rafId = 0;
  let cleanupFn = null;

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

  function start() {
    // Ensure any previous run is fully stopped
    if (cleanupFn) {
      cleanupFn();
      cleanupFn = null;
    }

    running = true;
    document.documentElement.setAttribute('data-sim','on');
    canvas.style.display = 'block';

    // Initialize the game only after styles are ready
    waitForStyles().then(() => {
      const gl = canvas.getContext('webgl2', { antialias: false, alpha: true });
      if (!gl) {
        running = false;
        return;
      }

      const n = 200; // grid size

      // Shaders
      const vs = `#version 300 es
      in vec2 position;
      void main(){
        gl_Position = vec4(position, 0.0, 1.0);
      }`;

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
          if (sum < 1.5 || sum > 3.5) next = 0.0; // death by under/overpop
        } else {
          if (sum > 2.5 && sum < 3.5) next = 1.0; // birth
        }
        outColor = vec4(next, 0.0, 0.0, 1.0);
      }`;

      const drawfs = `#version 300 es
      precision highp float;
      uniform sampler2D u_texture;
      uniform vec2 u_canvasSize; // in pixels
      uniform float u_gridSize;  // 200.0
      uniform vec3 u_aliveColor; // color for alive cells
      uniform vec3 u_bgColor;    // color for empty space
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

      const simProgram = twgl.createProgramInfo(gl, [vs, simfs]);
      const drawProgram = twgl.createProgramInfo(gl, [vs, drawfs]);

      // Fullscreen quad
      const quad = twgl.createBufferInfoFromArrays(gl, {
        position: { numComponents: 2, data: [-1, -1, 1, -1, -1, 1, 1, 1] },
        indices: [0, 1, 2, 2, 1, 3],
      });

      // 2 ping-pong RGBA8 textures in FBOs
      const attachments = [{ internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE }];
      let fboA = twgl.createFramebufferInfo(gl, attachments, n, n);
      let fboB = twgl.createFramebufferInfo(gl, attachments, n, n);

      // Seed with random Gosper glider guns
      function putGosper(arr, x, y, dx, dy){
        const rot = (px, py) => [px * dx - py * dy, px * dy + py * dx];
        const pts = [
          [5,1],[5,2],[6,1],[6,2],
          [5,11],[6,11],[7,11],
          [4,12],[8,12],
          [3,13],[9,13],
          [3,14],[9,14],
          [6,15],
          [4,16],[8,16],
          [5,17],[6,17],[7,17],
          [6,18],
          [3,21],[4,21],[5,21],
          [3,22],[4,22],[5,22],
          [2,23],[6,23],
          [1,25],[2,25],[6,25],[7,25],
          [3,35],[4,35],
          [3,36],[4,36],
        ];
        for (const [px, py] of pts){
          const [rx, ry] = rot(px, py);
          const cx = x + Math.round(rx);
          const cy = y + Math.round(ry);
          if (cx>=0 && cx<n && cy>=0 && cy<n){
            const i = (cy*n + cx)*4;
            arr[i] = 255; arr[i+1]=0; arr[i+2]=0; arr[i+3]=255;
          }
        }
      }

      const seed = new Uint8Array(n*n*4);
      const count = 3 + Math.floor(Math.random()*3); // 3..5 guns
      for (let i=0;i<count;i++){
        const x = (Math.random()*(n-40))|0;
        const y = (Math.random()*(n-40))|0;
        const r = (Math.random()*4)|0; // 0,1,2,3
        const dx = [1,0,-1,0][r];
        const dy = [0,1,0,-1][r];
        putGosper(seed, x, y, dx, dy);
      }

      // Spray random live-cell clusters
      function spray(arr, cx, cy, radius, density){
        const r2 = radius*radius;
        for (let dy=-radius; dy<=radius; dy++){
          for (let dx=-radius; dx<=radius; dx++){
            if (dx*dx + dy*dy > r2) continue;
            if (Math.random() < density){
              const x = cx + dx;
              const y = cy + dy;
              if (x>=0 && x<n && y>=0 && y<n){
                const i = (y*n + x)*4;
                arr[i] = 255; arr[i+1]=255; arr[i+2]=255; arr[i+3]=255;
              }
            }
          }
        }
      }

      const sprays = 6 + Math.floor(Math.random()*6); // 6..11 sprays
      for (let i=0;i<sprays;i++){
        const sx = (Math.random()*(n))|0;
        const sy = (Math.random()*(n))|0;
        const rad = 2 + (Math.random()*6)|0; // 2..7
        const den = 0.25 + Math.random()*0.5; // 0.25..0.75
        spray(seed, sx, sy, rad, den);
      }

      // Initialize A texture with seed
      gl.bindTexture(gl.TEXTURE_2D, fboA.attachments[0]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, seed);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      // And B texture params
      gl.bindTexture(gl.TEXTURE_2D, fboB.attachments[0]);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);

      let last = 0;

      // Resolve CSS theme colors -> alive/bg for shader
      function getThemeColors(){
        const theme = document.documentElement.getAttribute('data-theme');
        const alive = theme === 'dark' ? [1,1,1] : [0,0,0];
        const bg = theme === 'dark' ? [0,0,0] : [1,1,1];
        return { alive, bg };
      }

      function render(t){
        // Resize canvas to device pixels
        twgl.resizeCanvasToDisplaySize(gl.canvas, window.devicePixelRatio || 1);

        // Step simulation at 4 Hz
        if (t - last > 250){
          gl.bindFramebuffer(gl.FRAMEBUFFER, fboB.framebuffer);
          gl.viewport(0, 0, n, n);
          gl.useProgram(simProgram.program);
          twgl.setBuffersAndAttributes(gl, simProgram, quad);
          twgl.setUniforms(simProgram, { u_texture: fboA.attachments[0], u_resolution: [n, n] });
          twgl.drawBufferInfo(gl, quad);
          // swap
          const tmp = fboA; fboA = fboB; fboB = tmp;
          last = t;
        }

        // Draw to screen with square cells covering the viewport
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        gl.useProgram(drawProgram.program);
        twgl.setBuffersAndAttributes(gl, drawProgram, quad);
        const colors = getThemeColors();
        twgl.setUniforms(drawProgram, {
          u_texture: fboA.attachments[0],
          u_canvasSize: [gl.canvas.width, gl.canvas.height],
          u_gridSize: n,
          u_aliveColor: colors.alive,
          u_bgColor: colors.bg,
        });
        twgl.drawBufferInfo(gl, quad);

        rafId = requestAnimationFrame(render);
      }
      rafId = requestAnimationFrame(render);

      // Provide a cleanup function to stop and clear the canvas
      cleanupFn = function(){
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
        try {
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.clearColor(0,0,0,0);
          gl.clear(gl.COLOR_BUFFER_BIT);
        } catch (e) {}
        canvas.style.display = 'none';
      };
    });
  }

  function stop() {
    if (cleanupFn) {
      cleanupFn();
      cleanupFn = null;
    }
    running = false;
    document.documentElement.setAttribute('data-sim','off');
    canvas.style.display = 'none';
  }

  // Expose a simple control API
  window.GOL = {
    start,
    stop,
    isRunning: function(){ return running; }
  };

  // Auto-start on page load
  start();
})();