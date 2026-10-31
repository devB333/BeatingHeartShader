// Optional Windows smoke check: opens the local app in headless Chrome with
// SwiftShader, waits for WebGPU initialization, and captures one frame.
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 9223;
const testUrl=new URL(process.env.HEART_URL || 'http://127.0.0.1:5173/pub/index.html');
if(process.argv.includes('--timing'))testUrl.searchParams.set('timing','1');
const appUrl=testUrl.href;
const screenshot = join(tmpdir(), 'poem-heart-webgpu-smoke.png');
const browser = spawn(chromePath, [
  '--headless=new', '--no-first-run', '--disable-gpu-sandbox',
  '--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader',
  '--enable-unsafe-swiftshader', '--remote-allow-origins=*',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${join(tmpdir(), 'poem-heart-smoke-profile')}`,
  '--window-size=1360,1100', appUrl,
], { windowsHide: true, stdio: 'ignore' });

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function findTab() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const tab = tabs.find(item => item.type === 'page' && item.url.startsWith(appUrl));
      if (tab) return tab;
    } catch { /* Chrome is starting. */ }
    await delay(200);
  }
  throw new Error('Could not connect to headless Chrome.');
}

let socket;
try {
  const tab = await findTab();
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const reply = JSON.parse(event.data);
    if (reply.id && pending.has(reply.id)) {
      pending.get(reply.id)(reply);
      pending.delete(reply.id);
    }
  });
  function call(method, params = {}) {
    const id = nextId++;
    return new Promise(resolve => {
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  await call('Runtime.enable');
  await call('Page.navigate',{url:appUrl});
  await delay(500);
  const evaluate=async expression=>{
    const result=await call('Runtime.evaluate',{expression,returnByValue:true});
    if(result.result.exceptionDetails)throw Error('Browser evaluation failed');
    return result.result.result.value;
  };
  let before;
  for(let i=0;i<50;i++){
    before=await evaluate('window.heartDiagnostics');
    if(before)break;
    const error=await evaluate("document.querySelector('#stage-message')?.textContent");
    if(error)throw Error(error);
    await delay(300);
  }
  if(!before||before.textSize!==8||before.visibleCells<100)throw Error('8px heart did not render: '+await evaluate('JSON.stringify({url:location.href,body:document.body?.innerText,diagnostics:window.heartDiagnostics})'));
  if(await evaluate("document.querySelectorAll('textarea').length!==1 || document.querySelectorAll('button').length!==1"))throw Error('Unexpected UI controls');
  const capture=await call('Page.captureScreenshot',{format:'png'});
  await writeFile(screenshot,Buffer.from(capture.result.data,'base64'));
  if(process.argv.includes('--timing')) {
    for(const mobile of [false,true]) {
      await call('Emulation.setDeviceMetricsOverride',{width:mobile?360:1360,height:mobile?760:1100,deviceScaleFactor:mobile?3:1,mobile});
      await delay(500);
      const measurement=await call('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`new Promise(resolve=>{
        const samples=[];
        const started=Date.now();
        const timer=setInterval(()=>{
          const d=window.heartDiagnostics;
          if(d && d.frameTimestamp!==samples.at(-1)?.frameTimestamp) samples.push({...d});
          if(Date.now()-started<6000)return;
          clearInterval(timer);
          const first=samples[0],last=samples.at(-1);
          const seconds=(last.clockWallTime-first.clockWallTime)/1000;
          const renderingSeconds=(last.frameWallTime-first.frameWallTime)/1000;
          const animationSeconds=last.animationSeconds-first.animationSeconds;
          const cycles=new Map();
          for(const sample of samples) {
            const cycle=Math.floor(sample.poseSeconds/sample.cycleSeconds);
            const within=sample.poseSeconds%sample.cycleSeconds;
            if(within>.5)continue;
            const key=within<.17?'first':'second';
            const peaks=cycles.get(cycle)||{};
            if(!peaks[key] || sample.beat>peaks[key].beat)peaks[key]=sample;
            cycles.set(cycle,peaks);
          }
          const sampledPeakGapsMs=[...cycles.values()].filter(p=>p.first?.beat>.5 && p.second?.beat>.2)
            .map(p=>p.second.frameWallTime-p.first.frameWallTime);
          resolve({version:last.timingVersion,renderLimit:last.renderLimit,frameStartFps:(last.frameCount-first.frameCount)*1000/(last.frameTimestamp-first.frameTimestamp),targetBpm:last.bpm,wallSeconds:seconds,animationSeconds,
            measuredBpm:last.bpm*animationSeconds/seconds,renderedFps:(last.frameCount-first.frameCount)/renderingSeconds,
            averageRenderMs:samples.reduce((total,d)=>total+d.renderMs,0)/samples.length,sampledPeakGapsMs});
        },4);
      })`});
      if(measurement.result?.exceptionDetails)throw Error('Timing measurement failed');
      const timing=measurement.result?.result?.value;
      if(!timing || !Number.isFinite(timing.measuredBpm) || Math.abs(timing.measuredBpm/timing.targetBpm-1)>.1)throw Error('Animation clock differs from wall time: '+JSON.stringify(timing));
      if(timing.frameStartFps>timing.renderLimit+.01)throw Error('Render cap exceeded: '+JSON.stringify(timing));
      const timingReadout=await evaluate("document.querySelector('#timing-readout')?.textContent");
      if(!timingReadout?.includes('Sampled peak gap:') || /NaN|Infinity/.test(timingReadout))throw Error('Invalid timing readout: '+timingReadout);
      console.log(JSON.stringify({viewport:mobile?'phone':'desktop',...timing,timingReadout},null,2));
    }
    await call('Emulation.clearDeviceMetricsOverride');
  }
  await evaluate("document.querySelector('#poem').value='A heart made of words'; document.querySelector('#poem').dispatchEvent(new Event('input')); for(let i=0;i<12;i++)document.querySelector('canvas').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'}));");
  await delay(800);
  const after=await evaluate('window.heartDiagnostics');
  if(after.poem!=='A heart made of words'||after.yaw<1)throw Error('Live text or orbit failed');
  await evaluate(`(() => {
    const canvas=document.querySelector('canvas');
    const pointer=(type,id,x,y,shiftKey=false)=>canvas.dispatchEvent(new PointerEvent(type,{pointerId:id,pointerType:'touch',clientX:x,clientY:y,shiftKey,bubbles:true}));
    pointer('pointerdown',1,100,100);pointer('pointermove',1,140,100);pointer('pointerup',1,140,100);
    pointer('pointerdown',1,100,100);pointer('pointerdown',2,200,100);
    pointer('pointermove',1,120,120);pointer('pointermove',2,240,120);
    pointer('pointerup',1,120,120);pointer('pointerup',2,240,120);
  })()`);
  await delay(300);
  const moved=await evaluate('window.heartDiagnostics');
  if(moved.yaw<=after.yaw||moved.panX<=0||moved.panY>=0||moved.zoom<=1)throw Error('Touch rotate, pan, or pinch failed');
  await evaluate("document.querySelector('#reset-view').click()");
  await delay(300);
  const reset=await evaluate('window.heartDiagnostics');
  if(reset.yaw!==0||reset.pitch!==0||reset.zoom!==1||reset.panX!==0||reset.panY!==0)throw Error('Reset view failed');
  await evaluate("document.querySelector('#poem').value='';document.querySelector('#poem').dispatchEvent(new Event('input'));");
  await delay(400);
  if(await evaluate("document.querySelector('#stage-message')?.textContent"))throw Error('Runtime rendering error');
  console.log(JSON.stringify({textSize:before.textSize,visibleCells:before.visibleCells,liveInput:'passed',orbit:'passed',touchGestures:'passed',resetView:'passed',emptyInput:'passed',screenshot},null,2));
} finally {
  socket?.close();
  browser.kill();
}
