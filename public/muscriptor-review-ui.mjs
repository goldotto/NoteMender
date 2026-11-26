import {tr, onLanguageChange} from './i18n.mjs';
import {beatAtTime} from './time-map.mjs';
import {replaceSectionCandidate} from './local-candidates.mjs';
import {validateProject} from './music.mjs';

export function reviewPoints(report, origin, section) {
  const own = ({from, to}) => ({from: Math.max(section.from, from + origin), to: Math.min(section.to, to + origin)});
  const points = [];
  for (const window of report.windows) {
    if (window.status === 'suspected-missing' || window.status === 'no-anomaly') continue;
    const range = own(window), last = points.at(-1);
    if (range.to <= range.from) continue;
    if (last?.status === window.status && Math.abs(last.to - range.from) < .001) last.to = range.to;
    else points.push({...range, status: window.status});
  }
  for (const repair of report.repairs) {
    const range = own(repair);
    if (range.to - range.from >= .25) points.push({...range, status: 'suspected-missing', clipFrom: repair.clipFrom + origin, clipTo: repair.clipTo + origin});
  }
  return points.sort((a, b) => a.from - b.from);
}

export function makeRepairAlternate(base, candidate, point, replacement) {
  const candidateProject = validateProject({...base, notes: candidate.notes, lyrics: candidate.lyrics ?? base.lyrics, alternates: [], vocalSlurs: []});
  const bounds = {start: beatAtTime(base, point.from), end: beatAtTime(base, point.to)};
  return replaceSectionCandidate(candidateProject, bounds, replacement);
}

export function scanInWorker(audio, result, stems, signal) {
  signal.throwIfAborted();
  const worker = new Worker(new URL('./muscriptor-review-worker.mjs', import.meta.url), {type: 'module'});
  let abort;
  return new Promise((resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, {once: true});
    worker.onmessage = ({data}) => data.error ? reject(Error(data.error)) : resolve(data.report);
    worker.onerror = event => reject(Error(event.message || 'MuScriptor scan failed'));
    worker.onmessageerror = () => reject(Error('MuScriptor scan data could not be read'));
    worker.postMessage({audio, result, stems}, [audio.samples.buffer, ...Object.values(stems).map(track => track.samples.buffer)]);
  }).finally(() => {signal.removeEventListener('abort', abort); worker.terminate();});
}

const title = () => tr('MuScriptor 异常检查','MuScriptor anomaly check');
const category = {
  'suspected-missing': () => tr('疑似漏音','Possible missing notes'),
  'suspected-label': () => tr('疑似轨名错标','Possible track mislabel'),
  'insufficient-evidence': () => tr('证据不足','Inconclusive')
};
const actions = {
  scan: () => tr('检查当前候选','Check candidate'),
  cancel: () => tr('取消','Cancel'),
  original: () => tr('循环听原曲','Loop original audio'),
  before: () => tr('循环听原候选','Loop original candidate'),
  retry: () => tr('重识别这段','Retranscribe this range'),
  after: () => tr('循环听重识别版本','Loop retried candidate')
};

export function installMuReview(host, {context, getInput, retry, audition, formatTime}) {
  let scan = null, work = null, status = null, picked = null;
  const patches = new Map();
  const reason = {
    'suspected-missing': () => tr('持续音高在原始 MIDI 中缺少对应音。','Sustained pitches are missing from the raw MIDI.'),
    'suspected-label': () => tr('持续音高有对应音，但主要被归到贝斯轨。','Matching pitches are mostly labelled as bass.'),
    'insufficient-evidence': () => tr('现有音频和 MIDI 证据不足以判断。','The audio and MIDI evidence is inconclusive.')
  };
  const key = (info, point) => JSON.stringify([info.candidate.id, info.revision, point.from, point.to]);
  const scanKey = info => JSON.stringify([info.revision, info.candidate.analysisId, info.candidate.resourceId, info.from, info.to]);
  const action = (name, fn, disabled = false) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = actions[name]();
    button.disabled = disabled;
    button.addEventListener('click', fn);
    return button;
  };
  function run(info, point = null) {
    if (work) return;
    const controller = new AbortController(), {signal} = controller;
    work = controller;
    status = null;
    render();
    (async () => {
      if (point) {
        const patch = await retry(info, point, scan.input, controller);
        patches.set(key(info, point), patch);
        status = () => tr('重识别版本已加入本段备选。','Retranscribed version added to this section.');
      } else {
        const {audio, result, stems, input} = await getInput(info, signal);
        const report = await scanInWorker(audio, result, stems, signal);
        signal.throwIfAborted();
        scan = {key: scanKey(info), report, input, stems: Object.keys(stems)};
      }
    })().catch(error => {
      status = signal.aborted
        ? () => tr('已取消。','Cancelled.')
        : () => error.message;
    }).finally(() => {work = null; if (picked) picked.retrying = false; render();});
  }
  function render() {
    const info = context([...patches.values()]);
    host.hidden = !info;
    if (!info) {host.replaceChildren(); return;}
    function row(className) {
      const element = document.createElement('div');
      element.className = className;
      return element;
    }
    const heading = document.createElement('strong');
    heading.textContent = title();
    const header = row('mu-review-actions');
    header.append(heading, work ? action('cancel', () => work?.abort()) : action('scan', () => run(info)));
    const message = document.createElement('p');
    message.className = 'hint';
    message.setAttribute('role', 'status');
    message.textContent = work
      ? picked?.retrying ? tr('正在重识别选中区段…','Retranscribing the selected range…')
        : tr('正在比对音频与已保存的 MIDI…','Comparing audio with cached MIDI…')
      : status?.() || '';
    host.replaceChildren(header, message);
    if (!scan || scan.key !== scanKey(info)) return;
    const points = reviewPoints(scan.report, info.from, info.sectionRange);
    const description = document.createElement('p');
    description.className = 'hint';
    description.textContent = points.length
      ? scan.stems.length ? tr('已用对齐分轨辅助核对。点击时间段试听。','Checked with aligned stems. Choose a range to listen.')
        : tr('按当前分析音轨核对。点击时间段试听。','Checked against the analysis input. Choose a range to listen.')
      : tr('此段没有检出的疑点。','No anomalies flagged in this section.');
    host.append(description);
    if (!points.length) return;
    const ranges = row('mu-review-ranges');
    const rangeText = point => formatTime(point.from) + '–' + formatTime(point.to);
    for (const point of points) {
      const id = key(info, point), button = document.createElement('button');
      button.type = 'button';
      button.dataset.reviewKind = point.status;
      button.textContent = rangeText(point) + ' · ' + category[point.status]();
      button.setAttribute('aria-pressed', String(picked?.id === id));
      button.addEventListener('click', () => {
        picked = {id};
        if (info.canAudition) audition(info, point, 'original');
        render();
        host.querySelector('[aria-pressed="true"]')?.focus({preventScroll: true});
      });
      ranges.append(button);
    }
    host.append(ranges);
    const point = points.find(point => picked?.id === key(info, point));
    if (!point) return;
    const detail = document.createElement('p');
    detail.className = 'hint';
    detail.textContent = reason[point.status]();
    host.append(detail);
    const controls = row('mu-review-actions');
    controls.append(action('original', () => audition(info, point, 'original'), !info.canAudition),
      action('before', () => audition(info, point, 'notes', info.candidate.id)));
    const patch = patches.get(picked.id);
    if (patch) controls.append(action('after', () => audition(info, point, 'notes', patch.id)));
    if (point.status === 'suspected-missing') {
      controls.append(action('retry', () => {picked.retrying = true; run(info, point);}, Boolean(work) || Boolean(patch)));
      const clip = document.createElement('span');
      clip.className = 'hint';
      clip.textContent = tr('送入模型','Model input') + ' ' + rangeText({from: point.clipFrom, to: point.clipTo});
      controls.append(clip);
    }
    host.append(controls);
  }
  onLanguageChange(render);
  return {render, cancel: () => work?.abort()};
}
