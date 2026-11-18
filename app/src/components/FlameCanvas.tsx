import { useEffect, useRef } from 'react';

const VERTEX = `
  attribute vec2 a_pos;
  void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAGMENT = `
  precision highp float;
  uniform vec2 u_res;
  uniform float u_time;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
    return v;
  }
  void main() {
    vec2 uv = gl_FragCoord.xy / u_res.xy;
    float aspect = u_res.x / u_res.y;
    vec2 p = vec2(uv.x * aspect, uv.y);
    float t = u_time * 0.42;

    vec2 sp = vec2(p.x * 3.1, p.y * 1.25 - t * 0.85);
    vec2 warp = vec2(fbm(sp + vec2(0.0, t * 0.45)), fbm(sp + vec2(5.2, 1.3)));
    float n = fbm(sp * 1.15 + warp * 2.3);

    float env = smoothstep(1.15, 0.0, uv.y) * smoothstep(0.0, 0.03, uv.y);
    float body = smoothstep(0.28, 0.56, n * env * 1.5);

    vec2 eg = vec2(floor(uv.x * 80.0), floor((uv.y + t * 0.6) * 60.0));
    vec2 ef = fract(vec2(uv.x * 80.0, (uv.y + t * 0.6) * 60.0)) - 0.5;
    float spark = step(0.993, hash(eg)) *
                  (1.0 - smoothstep(0.04, 0.16, length(ef))) * env;
    body = max(body, spark * 0.6);

    vec3 col = vec3(0.0);
    col += vec3(0.65, 0.06, 0.0) * smoothstep(0.02, 0.36, body);
    col += vec3(1.0, 0.32, 0.0) * smoothstep(0.28, 0.64, body);
    col += vec3(1.0, 0.82, 0.22) * smoothstep(0.58, 0.88, body);
    col += vec3(1.0, 1.0, 0.86) * smoothstep(0.92, 1.0, body);

    float alpha = clamp(body * 1.3 + spark * 0.5, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
  }
`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/** Transparent flame canvas; fills its parent. */
export function FlameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
    });
    if (!gl) return;

    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    if (!vertex || !fragment) return;
    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      return;
    }
    // oxlint-disable-next-line react/hooks -- WebGL's useProgram is not a React hook.
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const resolution = gl.getUniformLocation(program, 'u_res');
    const time = gl.getUniformLocation(program, 'u_time');

    function draw(seconds: number) {
      if (!canvas || !gl) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.round(canvas.clientWidth * dpr);
      const height = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(resolution, canvas.width, canvas.height);
      gl.uniform1f(time, seconds);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let start = 0;
    let visible = true;
    const loop = (now: number) => {
      if (!visible || reduced.matches) return;
      draw((now - start) / 1000);
      frame = requestAnimationFrame(loop);
    };
    const startLoop = () => {
      if (frame || reduced.matches || !visible) return;
      start = performance.now();
      frame = requestAnimationFrame(loop);
    };
    const stopLoop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };
    const onMotionChange = () => {
      stopLoop();
      if (reduced.matches) draw(4);
      else startLoop();
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      if (visible) startLoop();
      else stopLoop();
    });
    observer.observe(canvas);
    if (reduced.matches) draw(4);
    else startLoop();
    reduced.addEventListener('change', onMotionChange);

    return () => {
      stopLoop();
      observer.disconnect();
      reduced.removeEventListener('change', onMotionChange);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    };
  }, []);

  return <canvas ref={canvasRef} className="bar-flame" aria-hidden="true" />;
}
