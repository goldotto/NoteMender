export function readPcm16Wav(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (text(0, 4) !== 'RIFF' || text(8, 4) !== 'WAVE') throw Error('需要 PCM16 WAV');
  let format, offset, size;
  for (let position = 12; position + 8 <= bytes.length;) {
    const id = text(position, 4);
    const length = view.getUint32(position + 4, true);
    const start = position + 8;
    if (start + length > bytes.length) throw Error('WAV 数据不完整');
    if (id === 'fmt ' && length >= 16) {
      format = {
        code: view.getUint16(start, true),
        channels: view.getUint16(start + 2, true),
        rate: view.getUint32(start + 4, true),
        bits: view.getUint16(start + 14, true),
        blockSize: view.getUint16(start + 12, true)
      };
    }
    if (id === 'data') {
      offset = start;
      size = length;
    }
    position = start + length + length % 2;
  }
  if (format?.code !== 1 || format.bits !== 16 || !format.channels || !format.rate ||
      format.blockSize !== format.channels * 2 || !size || size % format.blockSize) {
    throw Error('需要非空的 PCM16 WAV');
  }
  const {rate, channels, blockSize} = format;
  const samples = new Float32Array(size / blockSize);
  for (let i = 0; i < samples.length; i++) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel++) {
      sum += view.getInt16(offset + i * blockSize + 2 * channel, true);
    }
    samples[i] = sum / (channels * 32768);
  }
  return {samples, rate};
}
