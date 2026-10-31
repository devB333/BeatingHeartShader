import { layoutText } from './layout.js';
import { decodeHeart } from './model.js';
import { contourLayout } from './contours.js';
import { heartbeatAt, heartbeatPoseTime, HEARTBEAT_POSE_SECONDS, CONTRACTION_HOLD_SECONDS, CONTRACTION_GAP_SECONDS } from './heartbeat.js';
const $ = s => document.querySelector(s);
const canvas = $('#heart-canvas'), stage = $('#stage');
let device, context, meshPipeline, asciiPipeline, uniform, meshGroup, asciiGroup, parts;
let geometry, contourPipeline, contourGroup;
let filteredGeometry, smoothPipeline, smoothGroup;
let target, depth, readback, letters, atlas, sampler, columns, rows, stride;
let needsResize = true, dirty = true, pages = [], page = 0, slots = [];
let edges = [];
const DEFAULT_ZOOM =  window.matchMedia('(max-width: 600px)').matches ? 0.75: 1;
let yaw = 0, pitch = 0, zoom = DEFAULT_ZOOM, panX = 0, panY = 0, elapsed = 0, last = 0, paused = false;
const BEATS_PER_MINUTE = 48;
const RENDER_FPS = 10;
let textSize = 8;
let frameCount=0;
const timingOutput=new URLSearchParams(location.search).has('timing') ? document.createElement('output') : null;
const timingSamples=[];
let lastTimingUpdate=0;
if(timingOutput) {
  timingOutput.id='timing-readout';
  timingOutput.textContent='Measuring heartbeat timing…';
  stage.append(timingOutput);
}
function updateTiming(d) {
  if(!timingOutput)return;
  if(d.paused) {
    timingSamples.length=0;
    timingOutput.textContent='Heartbeat paused';
    return;
  }
  timingSamples.push(d);
  while(timingSamples.length>1 && timingSamples[0].frameWallTime<d.frameWallTime-10000)timingSamples.shift();
  if(d.frameWallTime-lastTimingUpdate<250)return;
  lastTimingUpdate=d.frameWallTime;
  const first=timingSamples[0];
  const seconds=(d.frameWallTime-first.frameWallTime)/1000;
  const clockSeconds=(d.clockWallTime-first.clockWallTime)/1000;
  const measured=clockSeconds>=3 ? (d.bpm*(d.animationSeconds-first.animationSeconds)/clockSeconds).toFixed(1)+' BPM' : 'measuring…';
  const fps=seconds>=3 ? ((d.frameCount-first.frameCount)/seconds).toFixed(1)+' FPS' : 'measuring…';
  // Compare the strongest sampled pose in each contraction, using frame submission
  // times. This estimates visible spacing; it cannot measure physical screen scanout.
  const cycles=new Map();
  const firstCycle=Math.floor(first.poseSeconds/first.cycleSeconds);
  const currentCycle=Math.floor(d.poseSeconds/d.cycleSeconds);
  for(const sample of timingSamples) {
    const cycle=Math.floor(sample.poseSeconds/sample.cycleSeconds);
    const within=sample.poseSeconds%sample.cycleSeconds;
    if(cycle<=firstCycle || cycle>=currentCycle || within>.5)continue;
    const key=within<.17?'first':'second';
    const peaks=cycles.get(cycle)||{};
    if(!peaks[key] || sample.beat>peaks[key].beat)peaks[key]=sample;
    cycles.set(cycle,peaks);
  }
  const gaps=[...cycles.values()].filter(p=>p.first?.beat>.5 && p.second?.beat>.2)
    .map(p=>p.second.frameWallTime-p.first.frameWallTime);
  const sampledGap=gaps.length ? `${Math.round(gaps.reduce((a,b)=>a+b,0)/gaps.length)} ms (${Math.min(...gaps)}–${Math.max(...gaps)})` : 'waiting for clear peak samples…';
  timingOutput.textContent=`${d.timingVersion}\nTarget: ${d.bpm} BPM (beat pairs)\nMeasured clock: ${measured}\nRendering: ${fps} (cap: ${d.renderLimit} FPS)\nHeartbeat pose updates: ${Math.round(1/d.poseStepSeconds)}/second\nPair interval: ${d.cycleSeconds.toFixed(2)} seconds\nProgrammed peak gap: ${Math.round(d.peakGapSeconds*1000)} ms\nPeak hold: ${Math.round(d.holdSeconds*1000)} ms\nSampled peak gap: ${sampledGap}\nPairs with clear samples: ${gaps.length}/${cycles.size}`;
}
function fail(e) {
  $('#stage-message').hidden = false;
  $('#stage-message').textContent = e.message || String(e);
  window.heartError=e.message||String(e);
  console.error(e);
}
function buffer(data, usage) {
  const b = device.createBuffer({size:data.byteLength,usage:usage|GPUBufferUsage.COPY_DST});
  device.queue.writeBuffer(b,0,data); return b;
}
function createAtlas() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 288;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'white'; ctx.font = 'bold 44px Courier, "Courier New", monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let code=32; code<=126; code++) {
    const i=code-32; ctx.fillText(String.fromCharCode(code),(i%16)*32+16,Math.floor(i/16)*48+24);
  }
  const texture=device.createTexture({size:[512,288],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
  device.queue.copyExternalImageToTexture({source:c},{texture},[512,288]); return texture;
}
function resize() {
  const ratio=Math.min(devicePixelRatio||1,2);
  canvas.width=Math.max(1,Math.round(stage.clientWidth*ratio));
  canvas.height=Math.max(1,Math.round(stage.clientHeight*ratio));
  const size=textSize;
  columns=Math.max(1,Math.floor(stage.clientWidth/(size*2/3)));
  rows=Math.max(1,Math.floor(stage.clientHeight/size));
  stride=Math.ceil(columns*4/256)*256;
  for (const item of [target,geometry,filteredGeometry,depth,readback,letters]) item?.destroy();
  target=device.createTexture({size:[columns,rows],format:'rgba8unorm',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});
  geometry=device.createTexture({size:[columns*3,rows*3],format:'rgba16float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
  filteredGeometry=device.createTexture({size:[columns*3,rows*3],format:'rgba16float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING});
  smoothGroup=device.createBindGroup({layout:smoothPipeline.getBindGroupLayout(0),entries:[
    {binding:0,resource:geometry.createView()},{binding:1,resource:filteredGeometry.createView()}
  ]});
  depth=device.createTexture({size:[columns*3,rows*3],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
  contourGroup=device.createBindGroup({layout:contourPipeline.getBindGroupLayout(0),entries:[
    {binding:0,resource:filteredGeometry.createView()},{binding:1,resource:target.createView()}
  ]});
  readback=device.createBuffer({size:stride*rows,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  letters=device.createBuffer({size:columns*rows*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  asciiGroup=device.createBindGroup({layout:asciiPipeline.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:uniform}}, {binding:1,resource:target.createView()},
    {binding:2,resource:atlas.createView()}, {binding:3,resource:sampler},{binding:4,resource:{buffer:letters}}
  ]});
  dirty=true; needsResize=false;
}
function updatePage() {
  if (!pages.length) return;
  page=Math.min(page,pages.length-1);
  device.queue.writeBuffer(letters,0,pages[page]);
}
function reflow() {
  const result=layoutText($('#poem').value,slots,columns);
  pages=result.pages;
  updatePage();
}
async function draw() {
  try {
    // Sample both clocks before rendering so GPU delays cannot skew the BPM readout.
    const now=performance.now();
    // Limit the entire render pipeline, including mesh, readback, and text layout.
    // Slow frames still advance the heartbeat by the full elapsed time below.
    if(last && now-last<1000/RENDER_FPS) {
      requestAnimationFrame(draw);
      return;
    }
    const clockWallTime=Date.now();
    const frameMs=last ? now-last : 0;
    const deltaSeconds=Math.max(0,frameMs/1000);
    if (!paused) elapsed+=deltaSeconds;
    last=now;
    const nextTextSize=8*Math.max(1,zoom);
    if (nextTextSize!==textSize) {textSize=nextTextSize;needsResize=true;}
    if (needsResize) resize();
    const cycleSeconds=60/BEATS_PER_MINUTE;
    // Hold heartbeat poses for 100 ms even when the canvas renders more often.
    const poseSeconds=heartbeatPoseTime(elapsed,cycleSeconds);
    const beat=heartbeatAt(poseSeconds%cycleSeconds);
    const data=new ArrayBuffer(48), u=new DataView(data);
    u.setUint32(0,columns,true); u.setUint32(4,rows,true);
    [canvas.width,canvas.height,yaw,pitch,zoom,beat].forEach((v,i)=>u.setFloat32(8+i*4,v,true));
    u.setUint32(32,1,true);
    u.setFloat32(40,panX,true); u.setFloat32(44,panY,true);
    device.queue.writeBuffer(uniform,0,data);
    const encoder=device.createCommandEncoder();
    const pass=encoder.beginRenderPass({
      colorAttachments:[{view:geometry.createView(),clearValue:[0,0,0,0],loadOp:'clear',storeOp:'store'}],
      depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}
    });
    pass.setPipeline(meshPipeline); pass.setBindGroup(0,meshGroup);
    for (const part of parts) {
      pass.setVertexBuffer(0,part.vertices); pass.setIndexBuffer(part.indices,'uint32'); pass.drawIndexed(part.count);
    }
    pass.end();
    const smoothing=encoder.beginComputePass();
    smoothing.setPipeline(smoothPipeline); smoothing.setBindGroup(0,smoothGroup);
    smoothing.dispatchWorkgroups(Math.ceil(columns*3/8),Math.ceil(rows*3/8)); smoothing.end();
    const detection=encoder.beginComputePass();
    detection.setPipeline(contourPipeline); detection.setBindGroup(0,contourGroup);
    detection.dispatchWorkgroups(Math.ceil(columns/8),Math.ceil(rows/8)); detection.end();
    encoder.copyTextureToBuffer({texture:target},{buffer:readback,bytesPerRow:stride},[columns,rows]);
    device.queue.submit([encoder.finish()]);
    // Small, cell-resolution mask readback preserves CPU word wrapping and pagination.
    // Awaiting it also keeps characters and anatomy from different frames from mixing.
    await readback.mapAsync(GPUMapMode.READ);
    const pixels=new Uint8Array(readback.getMappedRange());
    const layout=contourLayout(pixels,columns,rows,stride);
    const next=layout.slots;
    readback.unmap();
    edges=layout.edges;
    if(dirty || JSON.stringify(next)!==JSON.stringify(slots)) {slots=next; reflow(); dirty=false;}
    const output=device.createCommandEncoder();
    const final=output.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),clearValue:[0,0,0,1],loadOp:'clear',storeOp:'store'}]});
    final.setPipeline(asciiPipeline); final.setBindGroup(0,asciiGroup); final.draw(3); final.end();
    device.queue.submit([output.finish()]);
    window.heartDiagnostics={timingVersion:'cycle-aligned-poses-v7',renderLimit:RENDER_FPS,bpm:BEATS_PER_MINUTE,poseSeconds,poseStepSeconds:HEARTBEAT_POSE_SECONDS,holdSeconds:CONTRACTION_HOLD_SECONDS,peakGapSeconds:CONTRACTION_GAP_SECONDS,animationSeconds:elapsed,frameTimestamp:now,clockWallTime,frameWallTime:Date.now(),frameCount:++frameCount,paused,frameMs,renderMs:performance.now()-now,cycleSeconds,beat,parts:parts.length,triangles:parts.reduce((n,p)=>n+p.count/3,0),columns,rows,yaw,pitch,zoom,panX,panY,pages:pages.length,textSize,poem:$('#poem').value,visibleCells:slots.flat().length,contourCells:edges.length,internalEdges:layout.internalEdges,outerEdges:layout.outerEdges};
    updateTiming(window.heartDiagnostics);
    requestAnimationFrame(draw);
  } catch(e) {fail(e);}
}
async function start() {
  if(!navigator.gpu) alert('WebGPU is unavailable. On iPhone or iPad, update to iOS/iPadOS 26 or later and use the latest Safari or Chrome over HTTPS. On desktop, use a current Chrome, Edge, or Safari browser.');
  const adapter=await navigator.gpu.requestAdapter();
  if(!adapter) throw Error('WebGPU is present, but no compatible GPU adapter is available. Check that hardware acceleration is enabled and try the latest Safari or Chrome.');
  device=await adapter.requestDevice();
  device.addEventListener('uncapturederror',e=>fail(e.error));
  device.lost.then(info=>fail(Error('WebGPU device lost: '+info.message)));
  context=canvas.getContext('webgpu');
  context.configure({device,format:navigator.gpu.getPreferredCanvasFormat(),alphaMode:'opaque'});
  const [meshCode,asciiCode,model,contourCode,smoothCode]=await Promise.all([
    fetch('mesh.wgsl').then(r=>r.text()),fetch('shader.wgsl').then(r=>r.text()),fetch('assets/heart.glb').then(r=>r.arrayBuffer()),fetch('contours.wgsl').then(r=>r.text()),fetch('smooth.wgsl').then(r=>r.text())
  ]);
  const modules=[meshCode,asciiCode,contourCode,smoothCode].map(code=>device.createShaderModule({code}));
  for(const module of modules) {
    const info=await module.getCompilationInfo();
    const errors=info.messages.filter(m=>m.type==='error');
    if(errors.length) throw Error(errors.map(e=>e.message).join('\n'));
  }
  meshPipeline=await device.createRenderPipelineAsync({layout:'auto',
    vertex:{module:modules[0],entryPoint:'vs',buffers:[{arrayStride:24,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'}]}]},
    fragment:{module:modules[0],entryPoint:'fs',targets:[{format:'rgba16float'}]},
    primitive:{topology:'triangle-list',cullMode:'none'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}
  });
  asciiPipeline=await device.createRenderPipelineAsync({layout:'auto',vertex:{module:modules[1],entryPoint:'vs'},fragment:{module:modules[1],entryPoint:'fs',targets:[{format:navigator.gpu.getPreferredCanvasFormat()}]}});
  contourPipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module:modules[2],entryPoint:'detect'}});
  smoothPipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module:modules[3],entryPoint:'smoothGeometry'}});
  parts=decodeHeart(model).map(p=>({vertices:buffer(p.vertices,GPUBufferUsage.VERTEX),indices:buffer(p.indices,GPUBufferUsage.INDEX),count:p.indices.length}));
  uniform=device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  meshGroup=device.createBindGroup({layout:meshPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniform}}]});
  atlas=createAtlas(); sampler=device.createSampler({magFilter:'linear',minFilter:'linear'});
  new ResizeObserver(()=>{needsResize=true;}).observe(stage);
  requestAnimationFrame(draw);
}
$('#poem').oninput=()=>{page=0;dirty=true;};
const pointers=new Map();
let gesture=null;
function snapshot() {
  const points=[...pointers.values()];
  if(points.length===1)return {count:1,x:points[0].x,y:points[0].y};
  if(points.length===2)return {count:2,x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2,distance:Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y)};
  return null;
}
function panBy(dx,dy) {
  const rect=canvas.getBoundingClientRect();
  panX+=2*dx/rect.width; panY-=2*dy/rect.height;
}
function resetView() {yaw=0;pitch=0;zoom=DEFAULT_ZOOM;panX=0;panY=0;}
canvas.onpointerdown=e=>{
  if(e.pointerType==='mouse' && e.button!==0)return;
  pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  canvas.setPointerCapture(e.pointerId);
  gesture=snapshot();
};
canvas.onpointermove=e=>{
  if(!pointers.has(e.pointerId))return;
  pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  const next=snapshot();
  if(gesture && next && gesture.count===next.count) {
    if(next.count===2) {
      panBy(next.x-gesture.x,next.y-gesture.y);
      if(gesture.distance>0)zoom=Math.max(.55,Math.min(1.5,zoom*next.distance/gesture.distance));
    } else if(e.shiftKey)panBy(next.x-gesture.x,next.y-gesture.y);
    else {
      yaw+=(next.x-gesture.x)*.008;
      pitch=Math.max(-1.4,Math.min(1.4,pitch+(next.y-gesture.y)*.008));
    }
  }
  gesture=next;
};
function releasePointer(e) {pointers.delete(e.pointerId);gesture=snapshot();}
canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=releasePointer;
canvas.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(.55,Math.min(1.5,zoom*Math.exp(-e.deltaY*.001)));},{passive:false});
canvas.onkeydown=e=>{
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','Home',' ','PageUp','PageDown'].includes(e.key))return;
  e.preventDefault();
  if(e.key===' ')paused=!paused;
  if(e.key==='PageUp'){page=Math.max(0,page-1);updatePage();}
  if(e.key==='PageDown'){page=Math.min(pages.length-1,page+1);updatePage();}
  if(e.key==='ArrowLeft')yaw-=.1;if(e.key==='ArrowRight')yaw+=.1;
  if(e.key==='ArrowUp')pitch=Math.max(-1.4,pitch-.1);if(e.key==='ArrowDown')pitch=Math.min(1.4,pitch+.1);
  if(e.key==='+')zoom=Math.min(1.5,zoom+.05);if(e.key==='-')zoom=Math.max(.55,zoom-.05);
  if(e.key==='Home')resetView();
};
$('#reset-view').onclick=resetView;
start().catch(fail);
