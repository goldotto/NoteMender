import {readFile, writeFile} from 'node:fs/promises';
import {readPcm16Wav} from '../src/pcm-wav.mjs';
import {scanMuScriptor, compareMuScriptorClip} from '../public/muscriptor-review.mjs';

const help = [
  'node scripts/review-muscriptor.mjs 原曲.wav 原始结果.json [选项]',
  '  --vocals WAV / --other WAV   同时间轴、覆盖全曲的可选分轨',
  '  --clip JSON                 已带绝对时间的切分实验结果，可重复',
  '  --clip-cache JSON START     普通 MuScriptor 片段缓存及其原曲起点秒数，可重复',
  '  --compare FROM TO           所有片段共用的比较区间（原曲秒数）',
  '  --output JSON               写入一个新报告文件，默认输出到 stdout'
].join('\n');

const readJson = async file => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const readWav = async file => readPcm16Wav(await readFile(file));

async function main(args) {
  if (!args.length || args[0] === '--help') {
    console.log(help);
    return;
  }
  const [wav, cache, ...options] = args;
  if (!wav || !cache || cache.startsWith('--')) throw Error(help);
  const files = {}, clips = [];
  let output, range;
  const take = () => {
    const value = options.shift();
    if (!value || value.startsWith('--')) throw Error('选项缺少参数');
    return value;
  };
  while (options.length) {
    const flag = options.shift();
    switch (flag) {
      case '--vocals':
      case '--other': files[flag.slice(2)] = take(); break;
      case '--output': output = take(); break;
      case '--clip': clips.push({file: take()}); break;
      case '--clip-cache': clips.push({file: take(), start: Number(take())}); break;
      case '--compare': range = [Number(take()), Number(take())]; break;
      default: throw Error('未知选项 ' + flag);
    }
  }
  const result = await readJson(cache);
  const stems = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([source, file]) =>
    [source, await readWav(file)]
  )));
  const report = scanMuScriptor(await readWav(wav), result, stems);
  const comparisons = [];
  for (const {file, start} of clips) {
    const data = await readJson(file);
    const bounds = start === undefined ? data.clip : [start, start + data.duration];
    if (!Array.isArray(bounds) || bounds.length !== 2 || !bounds.every(Number.isFinite) ||
        bounds[0] < 0 || bounds[1] <= bounds[0] || bounds[1] > result.duration + .05 || !Array.isArray(data.notes)) {
      throw Error('短片段需要合法的原曲起止时间和音符列表');
    }
    const [from, to] = range ?? bounds;
    if (from < bounds[0] || to > bounds[1]) throw Error('比较范围必须在每份短片段范围内');
    const notes = start === undefined ? data.notes : data.notes.map(note =>
      ({...note, start: note.start + start, end: note.end + start})
    );
    comparisons.push({clip: bounds, ...compareMuScriptorClip(result, notes, from, to)});
  }
  const json = JSON.stringify({schema: 1, ...report, comparisons}, null, 2) + '\n';
  if (output) await writeFile(output, json, {flag: 'wx'});
  else process.stdout.write(json);
}

main(process.argv.slice(2)).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
