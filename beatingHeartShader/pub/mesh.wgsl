struct Settings { grid: vec2u, resolution: vec2f, angles: vec2f, zoom: f32, beat: f32, mode: u32, pan: vec2f }
@group(0) @binding(0) var<uniform> s: Settings;
struct Vertex { @builtin(position) position: vec4f, @location(0) normal: vec3f, @location(1) depth: f32 }
fn rotate(p: vec3f) -> vec3f {
  let a = s.angles.x; let b = s.angles.y;
  let q = vec3f(cos(a)*p.x + sin(a)*p.z, p.y, -sin(a)*p.x + cos(a)*p.z);
  return vec3f(q.x, cos(b)*q.y - sin(b)*q.z, sin(b)*q.y + cos(b)*q.z);
}
@vertex fn vs(@location(0) position: vec3f, @location(1) normal: vec3f) -> Vertex {
  let strength = 1.0 - smoothstep(-0.2, 0.75, position.y);
  let contraction = vec3f(1.0 - 0.045*s.beat*strength, 1.0 + 0.018*s.beat*strength, 1.0 - 0.045*s.beat*strength);
  let p = rotate(position * contraction);
  let distance = 3.8 - p.z;
  let size = 2.9 * s.zoom;
  var out: Vertex;
  out.position = vec4f(p.x * size * s.resolution.y/s.resolution.x + s.pan.x*distance, p.y * size + s.pan.y*distance, (distance-0.1)*10.0/9.9, distance);
  out.normal = rotate(normal / contraction);
  out.depth = distance;
  return out;
}
@fragment fn fs(in: Vertex, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  let n = normalize(in.normal) * select(-1.0, 1.0, front);
  // Preserve all normal components and linear depth for internal edge detection.
  return vec4f(n, in.depth);
}
