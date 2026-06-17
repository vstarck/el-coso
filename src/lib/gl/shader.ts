/* Shader compilation + linking + uniform setting. Compiles the vertex
 * and fragment stages, checks COMPILE_STATUS / LINK_STATUS and throws
 * with the INFO_LOG on failure (where you'll spend most of your
 * debugging time — bad shaders fail at construction with a readable
 * message).
 *
 * Uniform setters are *typed* (one per WebGL uniform shape). They do
 * NOT auto-bind the program — call `use()` first, then set. Matches
 * WebGL convention; avoids hidden state changes.
 *
 * Uniform locations are cached on first access. A uniform name that
 * doesn't exist in the linked program (typo, or optimized away
 * because the value isn't used) returns `null` from
 * `gl.getUniformLocation`; the setters silently no-op in that case.
 * Add a dev-mode warn if a typo bites.
 */

export type Shader = {
  program: WebGLProgram;
  use: () => void;
  setUniform1f: (name: string, value: number) => void;
  setUniform2f: (name: string, x: number, y: number) => void;
  setUniform3f: (name: string, x: number, y: number, z: number) => void;
  setUniform4f: (name: string, x: number, y: number, z: number, w: number) => void;
  setUniformMatrix4fv: (name: string, value: Float32Array) => void;
  setUniform1i: (name: string, value: number) => void;
  getAttribLocation: (name: string) => number;
  destroy: () => void;
};

export function createShader(
  gl: WebGL2RenderingContext,
  vertex_src: string,
  fragment_src: string,
): Shader {
  const vs = compileStage(gl, gl.VERTEX_SHADER, vertex_src, "vertex");
  const fs = compileStage(gl, gl.FRAGMENT_SHADER, fragment_src, "fragment");

  const program = gl.createProgram();
  if (program === null) throw new Error("gl.createProgram returned null");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "(no log)";
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    throw new Error(`Shader link failed:\n${log}`);
  }
  // After link the individual stages can be detached + deleted; the
  // program owns the linked binary.
  gl.detachShader(program, vs);
  gl.detachShader(program, fs);
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  const uniform_cache = new Map<string, WebGLUniformLocation | null>();
  function loc(name: string): WebGLUniformLocation | null {
    const cached = uniform_cache.get(name);
    if (cached !== undefined) return cached;
    const l = gl.getUniformLocation(program, name);
    uniform_cache.set(name, l);
    return l;
  }

  return {
    program,
    use: () => {
      gl.useProgram(program);
    },
    setUniform1f: (name, value) => {
      const l = loc(name);
      if (l !== null) gl.uniform1f(l, value);
    },
    setUniform2f: (name, x, y) => {
      const l = loc(name);
      if (l !== null) gl.uniform2f(l, x, y);
    },
    setUniform3f: (name, x, y, z) => {
      const l = loc(name);
      if (l !== null) gl.uniform3f(l, x, y, z);
    },
    setUniform4f: (name, x, y, z, w) => {
      const l = loc(name);
      if (l !== null) gl.uniform4f(l, x, y, z, w);
    },
    setUniformMatrix4fv: (name, value) => {
      const l = loc(name);
      if (l !== null) gl.uniformMatrix4fv(l, false, value);
    },
    setUniform1i: (name, value) => {
      const l = loc(name);
      if (l !== null) gl.uniform1i(l, value);
    },
    getAttribLocation: (name) => gl.getAttribLocation(program, name),
    destroy: () => {
      gl.deleteProgram(program);
    },
  };
}

function compileStage(
  gl: WebGL2RenderingContext,
  type: number,
  src: string,
  label: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error(`gl.createShader(${label}) returned null`);
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "(no log)";
    gl.deleteShader(shader);
    throw new Error(`${label} shader compile failed:\n${log}\n\nSource:\n${src}`);
  }
  return shader;
}
