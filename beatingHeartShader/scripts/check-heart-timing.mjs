// Exercise the actual animation clock at multiple frame rates, including slow frames.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { heartbeatAt, heartbeatPoseTime } from '../pub/heartbeat.js';

const source=await readFile(new URL('../pub/main.js',import.meta.url),'utf8');
const bpmLine=source.match(/const BEATS_PER_MINUTE = [^;]+;/)?.[0];
const clock=source.match(/const frameMs=[\s\S]+?last=now;/)?.[0];
const waveform=source.match(/const cycleSeconds=[\s\S]+?const beat=[^;]+;/)?.[0];
assert.ok(bpmLine && clock && waveform,'Could not locate the animation timing code');
const script=new vm.Script(`{
  ${bpmLine}
  ${clock}
  ${waveform}
  result={elapsed,beat,cycleSeconds,bpm:BEATS_PER_MINUTE};
}`);
function run(frameDurations) {
  const state=vm.createContext({elapsed:0,last:0,paused:false,now:1000,heartbeatAt,heartbeatPoseTime});
  script.runInContext(state);
  const stop=state.now+60000;
  let frame=0;
  while(state.now<stop) {
    state.now=Math.min(stop,state.now+frameDurations[frame++%frameDurations.length]);
    script.runInContext(state);
  }
  assert.ok(Math.abs(state.result.elapsed-60)<1e-8,'Animation clock must track real seconds');
  assert.ok(Math.abs(state.result.elapsed/state.result.cycleSeconds-state.result.bpm)<1e-8,'Cycles per minute must match BPM');
  const beforePause=state.result.elapsed;
  state.paused=true;
  state.now+=5000;
  script.runInContext(state);
  assert.equal(state.result.elapsed,beforePause,'Pause must stop the animation clock');
  state.paused=false;
  state.now+=100;
  script.runInContext(state);
  assert.ok(Math.abs(state.result.elapsed-beforePause-.1)<1e-8,'Resume must exclude paused time');
  return {seconds:60,cycles:state.result.bpm};
}
for(const fps of [10,20,30,60,90,120,144]) {
  console.log(`${fps} FPS: ${JSON.stringify(run([1000/fps]))}`);
}
console.log(`Uneven frames (8–200 ms): ${JSON.stringify(run([8,16,33,100,200,8,50]))}`);

// Exercise the real readout with changing GPU latency. It must still detect an
// actual clock speed mismatch, while ignoring time spent rendering after sampling.
const readout=source.slice(source.indexOf('function updateTiming(d)'),source.indexOf('function fail(e)'));
function measuredReadout(animationSeconds) {
  const state=vm.createContext({timingOutput:{},timingSamples:[],lastTimingUpdate:0});
  vm.runInContext(readout,state);
  const sample={paused:false,bpm:48,cycleSeconds:1.25,beat:0,poseSeconds:0,poseStepSeconds:.1,holdSeconds:.1,peakGapSeconds:.175,timingVersion:'test',animationSeconds:0,
    clockWallTime:1000,frameWallTime:1400,frameCount:1};
  state.sample=sample;
  vm.runInContext('updateTiming(sample)',state);
  state.sample={...sample,animationSeconds,poseSeconds:heartbeatPoseTime(animationSeconds,sample.cycleSeconds),clockWallTime:4000,frameWallTime:4100,frameCount:31};
  vm.runInContext('updateTiming(sample)',state);
  return state.timingOutput.textContent;
}
assert.ok(measuredReadout(3).includes('Measured clock: 48.0 BPM'),'GPU latency must not change reported clock speed');
assert.ok(measuredReadout(3.1875).includes('Measured clock: 51.0 BPM'),'A real 6.25% clock speedup must still be detected');
console.log('Readout ignores changing GPU latency and detects actual clock drift.');
