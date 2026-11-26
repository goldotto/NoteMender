// A missing optional tempo analyzer must not prevent browser transcription.
export async function transcriptionTempo({bpm, analyze, signal}) {
  if (!Number.isFinite(bpm) || bpm < 30 || bpm > 300) throw Error('BPM 须在 30–300 之间');
  try { return await analyze(); }
  catch (error) {
    if (signal?.aborted || error.name === 'AbortError') throw error;
    return {bpm, beats: [], warning: `未能自动测量节拍，暂按 ${bpm} BPM 排谱；可用原曲时间对齐点校准。`};
  }
}
