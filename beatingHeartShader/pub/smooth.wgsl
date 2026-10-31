// Joint bilateral smoothing before lighting and edge extraction. Background
// stays empty; depth and normal discontinuities stop blur crossing anatomy.
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var filtered: texture_storage_2d<rgba16float,write>;
@compute @workgroup_size(8,8) fn smoothGeometry(@builtin(global_invocation_id) id: vec3u) {
  let size=textureDimensions(source);
  if(any(id.xy>=size)) {return;}
  let p=vec2i(id.xy);
  let center=textureLoad(source,p,0);
  if(center.w==0.0) {textureStore(filtered,p,vec4f(0));return;}
  var sum=vec4f(0); var total=0.0;
  for(var y=-3;y<=3;y++) {for(var x=-3;x<=3;x++) {
    let q=textureLoad(source,clamp(p+vec2i(x,y),vec2i(0),vec2i(size)-1),0);
    if(q.w==0.0) {continue;}
    let dz=(q.w-center.w)/0.12;
    let bend=max(0.0,1.0-dot(center.xyz,q.xyz));
    let weight=exp(-f32(x*x+y*y)/8.0-dz*dz*0.5-bend*3.0);
    sum+=q*weight; total+=weight;
  }}
  let mean=sum/total;
  textureStore(filtered,p,vec4f(normalize(mean.xyz),mean.w));
}
