import test from 'node:test';
import assert from 'node:assert/strict';
import { heartbeatAt, heartbeatPoseTime } from './heartbeat.js';

test('each contraction holds its original strength for 100 ms',()=>{
  for(const [center,strength] of [[1/12,1],[1/12+.25,.45]]) {
    for(const offset of [-.05,-.025,0,.025,.05]) {
      assert.ok(Math.abs(heartbeatAt(center+offset)-strength)<1e-12);
    }
    assert.ok(heartbeatAt(center-.06)<strength);
    assert.ok(heartbeatAt(center+.06)<strength);
  }
});

test('both held peaks remain visible at 10, 60, and 120 FPS',()=>{
  for(const fps of [10,60,120]) {
    for(const frameOffset of [0,.011,.049,.091]) {
      const peaks=[0,0];
      for(let time=frameOffset;time<.5;time+=1/fps) {
        const index=time<.17 ? 0 : 1;
        peaks[index]=Math.max(peaks[index],heartbeatAt(time));
      }
      assert.ok(Math.abs(peaks[0]-1)<1e-12,`${fps} FPS must show the first peak`);
      assert.ok(Math.abs(peaks[1]-.45)<1e-12,`${fps} FPS must show the second peak`);
    }
  }
});

test('contractions release fully between pulses and during the rest of the cycle',()=>{
  for(const time of [0,.17,.5,.8,1.249])assert.ok(Math.abs(heartbeatAt(time))<1e-12);
});

test('the same time within each cycle produces the same pose',()=>{
  for(let cycle=0;cycle<48;cycle++) {
    for(const within of [.01,.05,.1,.15,.2,.25,.3,.4,.5,1.24]) {
      const pose=heartbeatPoseTime(cycle*1.25+within,1.25);
      const reference=heartbeatPoseTime(within,1.25);
      assert.ok(Math.abs(pose-cycle*1.25-reference)<1e-10);
      assert.ok(Math.abs(heartbeatAt(pose%1.25)-heartbeatAt(reference))<1e-10);
    }
  }
});

test('pose cadence uses elapsed time after dropped frames without accumulating BPM drift',()=>{
  assert.ok(Math.abs(heartbeatPoseTime(.19,1.25)-.1)<1e-12);
  assert.ok(Math.abs(heartbeatPoseTime(.43,1.25)-.4)<1e-12);
  assert.equal(heartbeatPoseTime(60,1.25)/1.25,48);
});

test('each successive cycle displays two separate pulses at 10 FPS',()=>{
  const cycles=Array.from({length:48},()=>[]);
  for(let frame=0;frame<600;frame++) {
    const time=frame/10;
    cycles[Math.floor(time/1.25)].push(heartbeatAt(heartbeatPoseTime(time,1.25)%1.25));
  }
  for(const [index,samples] of cycles.entries()) {
    let pulses=0,previous=0;
    for(const value of samples) {
      if(value>.1 && previous<=.1)pulses++;
      previous=value;
    }
    assert.equal(pulses,2,`Cycle ${index+1} must show both pulses separated by relaxation`);
  }
});
