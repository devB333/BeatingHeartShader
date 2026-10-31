struct Settings { grid: vec2u, resolution: vec2f, angles: vec2f, zoom: f32, beat: f32, mode: u32 }
@group(0) @binding(0) var<uniform> s: Settings;
@group(0) @binding(1) var heart: texture_2d<f32>;
@group(0) @binding(2) var atlas: texture_2d<f32>;
@group(0) @binding(3) var linearSampler: sampler;
@group(0) @binding(4) var<storage, read> letters: array<u32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
  return vec4f(p[i],0,1);
}
fn sampleCell(p: vec2i) -> vec4f { return textureLoad(heart, clamp(p,vec2i(0),vec2i(s.grid)-1),0); }
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
  let xy=p.xy/s.resolution*vec2f(s.grid);
  let cell=min(vec2u(xy),s.grid-1u);
  let anatomy=sampleCell(vec2i(cell));
  if(s.mode==0u) {
    let background=vec3f(.018);
    if(anatomy.a<.4) {return vec4f(background,1);}
    // Eight density levels, fixed ink brightness: . : - = + * # @
    let ramp=array<u32,8>(46u,58u,45u,61u,43u,42u,35u,64u);
    let tone=clamp((anatomy.r-.10)/.82,0.0,1.0);
    let code=ramp[min(u32(tone*8.0),7u)];
    let index=code-32u;
    let uv=(vec2f(f32(index%16u),f32(index/16u))+fract(xy))/vec2f(16,6);
    let ink=textureSampleLevel(atlas,linearSampler,uv,0).a;
    return vec4f(background+vec3f(smoothstep(.06,.55,ink)*.94),1);
  }
  var code=letters[cell.y*s.grid.x+cell.x];
  let background=vec3f(.018);
  if(anatomy.a<.4 || code<=32u) { return vec4f(background,1); }
  let index=code-32u;
  let uv=(vec2f(f32(index%16u),f32(index/16u))+fract(xy))/vec2f(16,6);
  let ink=textureSampleLevel(atlas,linearSampler,uv,0).a;
  // Keep shadowed words legible, retain a broad grayscale range for volume.
  // Quantize the softened shading, never the character identity.
 let tone=clamp((anatomy.r-.10)/0.75,0.0,1.0);
 let contrast = smoothstep(.53, .73, tone);
let contourAccent=select(0.0,select(0.80 ,-0.40,anatomy.a>0.5),anatomy.a>.65);
let luminance=clamp(.23 + .60* contrast + contourAccent, 0.0, .98);
let weight=smoothstep(.06,.55,ink);
  return vec4f(background+vec3f(weight*luminance),1);
}
