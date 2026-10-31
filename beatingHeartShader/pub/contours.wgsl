@group(0) @binding(0) var geometry: texture_2d<f32>;
@group(0) @binding(1) var cells: texture_storage_2d<rgba8unorm,write>;
fn sampleGeometry(p: vec2i) -> vec4f {
  return textureLoad(geometry,clamp(p,vec2i(0),vec2i(textureDimensions(geometry))-1),0);
}
fn internalGradient(p: vec2i) -> vec2f {
  let center=sampleGeometry(p);
  if(center.w==0.0) {return vec2f(0);}
  var gx=vec4f(0); var gy=vec4f(0); var depthSum=0.0;
  for(var y=-1;y<=1;y++) {for(var x=-1;x<=1;x++) {
    let q=sampleGeometry(p+vec2i(x,y));
    // A missing neighbor belongs to the silhouette, not an internal crease.
    if(q.w==0.0) {return vec2f(0);}
    depthSum+=q.w;
    gx+=q*f32(x)*select(1.0,2.0,y==0);
    gy+=q*f32(y)*select(1.0,2.0,x==0);
  }}
  gx*=vec4f(1.2,1.2,1.2,6.0)/4.0;
  gy*=vec4f(1.2,1.2,1.2,6.0)/4.0;
  // Suppress ordinary sloping surfaces; retain depth breaks and grooves.
  let depthBreak=smoothstep(0.008,0.03,abs(depthSum/9.0-center.w));
  gx.w*=depthBreak; gy.w*=depthBreak;
  var gradient=vec2f(0);
  for(var k=0u;k<4u;k++) {
    let candidate=vec2f(gx[k],gy[k]);
    if(dot(candidate,candidate)>dot(gradient,gradient)) {gradient=candidate;}
  }
  return gradient;
}
@compute @workgroup_size(8,8) fn detect(@builtin(global_invocation_id) id: vec3u) {
  if(any(id.xy>=textureDimensions(cells))) {return;}
  let p=vec2i(id.xy)*3+1;
  let center=sampleGeometry(p);
  if(center.w==0.0) {textureStore(cells,vec2i(id.xy),vec4f(0));return;}
  var strongest=vec2f(0);
  // Detect before reduction: retain small vessels inside each 3x3 glyph footprint.
  for(var y=-1;y<=1;y++) {for(var x=-1;x<=1;x++) {
    let q=p+vec2i(x,y);
    let gradient=internalGradient(q);
    let strength=length(gradient);
    if(strength<=0.6 || strength<=length(strongest)) {continue;}
    let step=vec2i(round(normalize(gradient)));
    // Non-maximum suppression keeps grooves thin instead of filling curved regions.
    if(strength>=length(internalGradient(q+step)) && strength>length(internalGradient(q-step))) {
      strongest=gradient;
    }
  }}
  var kind=0.5; // occupied poem cell
  var direction=vec2f(0);
  var nearBoundary=false;
  for(var y=-1;y<=1;y++) {for(var x=-1;x<=1;x++) {
    if(sampleGeometry(p+vec2i(x,y)*3).w==0.0) {nearBoundary=true;}
  }}
  if(length(strongest)>0.6 && !nearBoundary) {
    kind=1.0; direction=normalize(strongest);
  } else {
    var border=vec2f(0);
    for(var y=-1;y<=1;y++) {for(var x=-1;x<=1;x++) {
      let occupied=select(0.0,1.0,sampleGeometry(p+vec2i(x,y)*3).w>0.0);
      border+=vec2f(f32(x)*select(1.0,2.0,y==0),f32(y)*select(1.0,2.0,x==0))*occupied;
    }}
    if(length(border)>2.0) {kind=0.75;direction=normalize(border);}
  }
  let n=normalize(center.xyz);
  let diffuse=max(dot(n,normalize(vec3f(-0.6,0.8,1.2))),0.0);
  let light=clamp(0.10+0.82*diffuse+0.08*pow(1.0-abs(n.z),2.0),0.0,1.0);
  textureStore(cells,vec2i(id.xy),vec4f(light,direction*0.5+0.5,kind));
}
