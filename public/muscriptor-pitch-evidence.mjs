import {signalRms} from './candidate-tools.mjs';

export const PITCH_HOP = .1;
const RATE = 8000;
const FRAME_SIZE = 640;
const MIN_LAG = 8;
const MAX_LAG = Math.floor(RATE / 45);

// Average samples when decimating to reduce aliasing from percussion.
function downsample(samples, rate) {
  if (rate < RATE) throw Error('异常检测需要至少 8000 Hz 的 WAV');
  if (rate === RATE) return samples;
  const ratio = rate / RATE;
  const mono = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0, from = 0; i < mono.length; i++) {
    const to = Math.floor((i + 1) * ratio);
    let sum = 0;
    for (let j = from; j < to; j++) sum += samples[j];
    mono[i] = sum / (to - from);
    from = to;
  }
  return mono;
}

// The first strong local minimum of the normalized difference favors the
// fundamental period over its integer multiples.
function pitchAt(samples, start, differences) {
  let sum = 0;
  for (let lag = 1; lag <= MAX_LAG; lag++) {
    let difference = 0;
    for (let i = start; i < start + FRAME_SIZE - MAX_LAG; i++) {
      const delta = samples[i] - samples[i + lag];
      difference += delta * delta;
    }
    sum += difference;
    const normalized = sum ? difference * lag / sum : 1;
    differences[lag] = normalized;
    const candidate = lag - 1;
    if (candidate < MIN_LAG) continue;
    const center = differences[candidate], left = differences[candidate - 1];
    if (center >= .20 || center >= left || center >= normalized) continue;
    const shift = (left - normalized) / (2 * (left - 2 * center + normalized));
    return 69 + 12 * Math.log2(RATE / ((candidate + shift) * 440));
  }
  return null;
}

export function audioPitchEvidence({samples, rate, start = 0}, source, {hopSeconds=PITCH_HOP}={}) {
  const mono = downsample(samples, rate);
  const hop = Math.round(hopSeconds * RATE);
  const differences = new Float64Array(MAX_LAG + 1);
  const frames = [];
  for (let offset = 0; offset + FRAME_SIZE <= mono.length; offset += hop) {
    const rms = signalRms(mono.subarray(offset, offset + FRAME_SIZE));
    frames.push({second: start + (offset + (hopSeconds===PITCH_HOP?hop:FRAME_SIZE) / 2) / RATE, rms, pitch: null});
  }
  const levels = frames.map(frame => frame.rms).sort((a, b) => a - b);
  const reference = levels[Math.floor(levels.length * .85)] ?? 0;
  const rmsFloor = Math.max(source === 'original' ? .002 : .0015, reference * .08);
  const minMidi = source === 'vocals' ? 43 : 48;
  let pending = [];
  const flush = () => {
    if (pending.length >= 3) {
      for (const {frame, pitch} of pending) frame.pitch = pitch;
    }
    pending = [];
  };
  for (const [index, frame] of frames.entries()) {
    const pitch = frame.rms >= rmsFloor ? pitchAt(mono, index * hop, differences) : null;
    if (pitch === null || pitch < minMidi) {
      flush();
      continue;
    }
    const prior = pending.at(-1);
    if (prior && Math.abs(pitch - prior.pitch) > 4) flush();
    pending.push({frame, pitch});
  }
  flush();
  return frames;
}
