// Durations are in seconds, independent of both BPM and rendered frame rate.
export const CONTRACTION_HOLD_SECONDS = 0.15;
export const CONTRACTION_GAP_SECONDS = 0.40;
export const HEARTBEAT_POSE_SECONDS = 0.01;
const FIRST_PEAK_SECONDS = 1/12;
const RAMP_SECONDS = 1/30;

function heldContraction(offset) {
  const ramp=Math.max(0,Math.min(1,(Math.abs(offset)-CONTRACTION_HOLD_SECONDS/2)/RAMP_SECONDS));
  // Smoothly enter and leave a flat, 100 ms peak without changing its strength.
  return 1-ramp*ramp*(3-2*ramp);
}

export function heartbeatAt(cycleSeconds) {
  return heldContraction(cycleSeconds-FIRST_PEAK_SECONDS)
    + .45*heldContraction(cycleSeconds-FIRST_PEAK_SECONDS-CONTRACTION_GAP_SECONDS);
}

// Match the reference PC's 10 FPS pose holds without tying tempo to frame count.
// Restart sampling within each cycle: 1.25-second cycles must not alternate
// between two different sampling phases on the 100 ms pose grid.
export function heartbeatPoseTime(elapsedSeconds,cycleSeconds) {
  const cycleStart=Math.floor(elapsedSeconds/cycleSeconds)*cycleSeconds;
  const withinCycle=elapsedSeconds-cycleStart;
  return cycleStart+Math.floor(withinCycle/HEARTBEAT_POSE_SECONDS+1e-9)*HEARTBEAT_POSE_SECONDS;
}
