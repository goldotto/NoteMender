// A missing optional tempo analyzer must not prevent browser transcription.
export async function transcriptionTempo({manual, bpm, analyze, signal}) {
  if (!Number.isFinite(bpm) || bpm < 30 || bpm > 300) throw Error('BPM 须在 30–300 之间');
  if (manual) return {bpm, beats: []};
  try { return await analyze(); }
  catch (error) {
    if (signal?.aborted || error.name === 'AbortError') throw error;
    return {bpm, beats: [], warning: `未能自动测量节拍，暂按 ${bpm} BPM 排谱；可修改速度与原音对齐点。`};
  }
}
