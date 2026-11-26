// MusicXML 导出的「零依赖契约测试」：只读产品代码，不联网、不调 python、不引入第三方依赖。
// 既有 tests/score-musicxml.test.mjs 只做正则弱断言；本文件固化导出端对外承诺的结构契约。
import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDemo, validateProject} from '../public/music.mjs';
import {prepareEngraving} from '../public/engraving.mjs';
import {scoreMusicXML} from '../public/score-musicxml.mjs';

const DIVISIONS = 48;
const note = (id, start, duration = 1, midi = 60) => ({id, start, duration, midi});
const project = (notes, extra = {}) => validateProject({...makeDemo(), notes, key: 0, keyChanges: [], lyrics: [], sections: [], timeAnchors: [], ...extra});
const xml = (p, options = {}) => scoreMusicXML(prepareEngraving(p, {step: 0, ...options}));
const measures = s => [...s.matchAll(/<measure([^>]*)>([\s\S]*?)<\/measure>/g)].map(m => ({open: m[1], body: m[2], number: (m[1].match(/number="(\d+)"/) || [])[1]}));
const notesOf = s => [...s.matchAll(/<note>([\s\S]*?)<\/note>/g)].map(m => m[1]);
const sum = s => [...s.matchAll(/<duration>(\d+)<\/duration>/g)].reduce((total, m) => total + Number(m[1]), 0);
const barBeats = meter => { const [b, t] = meter.split('/').map(Number); return b * 4 / t; };
const count = (s, re) => (s.match(re) || []).length;
const pitchOf = n => (/<pitch>[\s\S]*?<\/pitch>/.exec(n) || ['<rest/>'])[0];
// 记录每个 <attributes> 的位置：首个 <note> 之前 = 小节首（bar-start），之后 = 小节中间（mid-bar）。
const attributePositions = body => [...body.matchAll(/<attributes>/g)].map(m => (body.slice(0, m.index).includes('<note>') ? 'mid-bar' : 'bar-start'));

// 最小 XML 校验器：标签配平、自闭合、属性引号、文本实体转义、单一根元素；不联网、不依赖 xmllint。
function wellFormed(source) {
  const stack = []; let i = 0, roots = 0;
  const fail = why => { throw new Error(`XML 不合法（${why}）@${i}`); };
  while (i < source.length) {
    const lt = source.indexOf('<', i), text = source.slice(i, lt < 0 ? source.length : lt);
    if (!stack.length && text.trim()) fail('根元素外出现文本');
    if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/.test(text)) fail('未转义的 &');
    if (lt < 0) break;
    if (source.startsWith('<?', lt)) { i = source.indexOf('?>', lt) + 2; continue; }
    let j = lt + 1; const close = source[j] === '/'; if (close) j++;
    const name = (/^[A-Za-z_][\w.:-]*/.exec(source.slice(j)) || fail('标签名非法'))[0]; j += name.length;
    let quote = null;
    while (j < source.length && (quote || source[j] !== '>')) {
      const c = source[j++];
      if (quote) { if (c === quote) quote = null; } else if (c === '"' || c === "'") quote = c; else if (c === '<') fail('属性未闭合');
    }
    if (j >= source.length) fail('标签未闭合');
    const selfClose = source[j - 1] === '/';
    if (close) { if (selfClose) fail(`</${name}/> 非法`); if (stack.pop() !== name) fail(`</${name}> 没有匹配的开始标签`); }
    else if (!selfClose) { if (!stack.length) roots++; stack.push(name); }
    i = j + 1;
  }
  if (stack.length || roots !== 1) fail(`未闭合 ${stack.join(' > ')} / 根元素数 ${roots}`);
  return true;
}

test('良构：根元素 score-partwise 4.0，标签配平/自闭合，转义正确', () => {
  const p = project([note('a', 0, 1.5), note('b', 1.5, .5, 61), note('c', 2, 6, 63), note('d', 8, 4, null)]);
  p.title = '中 & English <日本語> 한국어 "q"'; p.bpm = 92; p.keyChanges = [{beat: 2, key: 8}];
  p.lyrics = [{id: 'word', text: '啊 & <hello> 日本語 한국어', noteIds: ['a', 'b']}];
  p.notes[2].vocal = {breath: true, fermata: true, accent: true, dynamic: 'mf', text: '轻柔 & <soft>'};
  p.vocalSlurs = [{start: 'a', end: 'c'}];
  const output = xml(p);
  assert.match(output, /^<\?xml version="1\.0" encoding="utf-8"\?>\n<score-partwise version="4\.0">/);
  assert.equal(wellFormed(output), true);
  assert.equal(count(output, /<part id="P1">/g), 1); assert.equal(count(output, /<score-part id="P1">/g), 1);
  assert.doesNotMatch(output, /undefined|NaN/);
  assert.match(output, /<work-title>中 &amp; English &lt;日本語&gt; 한국어 &quot;q&quot;<\/work-title>/);
  // 校验器本身不是空转：坏输入必须被拒绝。
  assert.throws(() => wellFormed('<a><b></a>'), /没有匹配的开始标签|未闭合/);
  assert.throws(() => wellFormed('<a>'), /未闭合/);
  assert.throws(() => wellFormed('<a>&</a>'), /未转义的 &/);
});

test('小节时值：每小节 <duration> 之和 == 分子 × (4/分母) × 48（4/4、3/4、6/8）', () => {
  const fixtures = {'4/4': [1, 1, 1, 1, 2, .5, .5, 1, .25, .5, 1.25, 2], '3/4': [1, 1, 1, .5, .5, .5, 1.5, 3], '6/8': [1.5, 1.5, 3, .75, .75, .75, .75, 1.5, 1.5]};
  for (const [meter, durations] of Object.entries(fixtures)) {
    const p = project(durations.map((d, i) => note('n' + i, durations.slice(0, i).reduce((a, b) => a + b, 0), d, 60 + i)), {meter});
    const output = xml(p), bars = measures(output), expected = barBeats(meter) * DIVISIONS;
    assert.equal(bars.length, Math.round(durations.reduce((a, b) => a + b, 0) / barBeats(meter)), `${meter} 小节数`);
    assert.match(bars[0].body, new RegExp(`<time><beats>${meter.split('/')[0]}</beats><beat-type>${meter.split('/')[1]}</beat-type></time>`));
    for (const bar of bars) {
      assert.equal(sum(bar.body), expected, `${meter} 小节 ${bar.number} 时值`);
      assert.equal(count(bar.body, /<duration>0<\/duration>/g), 0, '不允许零时值');
      assert.equal(count(bar.body, /<duration>/g), count(bar.body, /<note>/g), '每个 note 恰好一个 duration');
      assert.equal(bar.open.includes('implicit'), false, '无弱起时不应出现 implicit');
    }
    assert.equal(sum(output), bars.length * expected);
  }
});

test('弱起：首小节 number="0" + implicit="yes"，时值 == pickup × 48', () => {
  for (const [meter, pickup] of [['4/4', 1], ['3/4', 1], ['6/8', 1.5]]) {
    const p = project([note('a', 0, pickup), note('b', pickup, barBeats(meter) * 2, 62)], {meter});
    const output = xml(p, {pickup}), bars = measures(output);
    assert.equal(bars[0].number, '0', `${meter} 首小节编号`);
    assert.match(bars[0].open, /implicit="yes"/, `${meter} 弱起小节应 implicit`);
    assert.equal(sum(bars[0].body), pickup * DIVISIONS, `${meter} 弱起时值`);
    assert.equal(count(output, /implicit="yes"/g), 1, '只有首小节 implicit');
    for (const bar of bars.slice(1)) assert.equal(sum(bar.body), barBeats(meter) * DIVISIONS);
    assert.deepEqual(bars.map(b => b.number), bars.map((_, i) => String(i)), '弱起后编号连续');
  }
  const plain = measures(xml(project([note('a', 0, 1), note('b', 1, 3, 62)])));
  assert.equal(plain[0].number, '1'); assert.equal(plain[0].open.includes('implicit'), false);
});

test('tie / tied / slur 成对：跨小节延音必须闭合，不出现只有 start', () => {
  const p = project([note('a', 0, 1, 60), note('b', 1, 7, 62), note('c', 8, 1, 64)]);
  p.vocalSlurs = [{start: 'a', end: 'c'}];
  const output = xml(p), bars = measures(output), open = [];
  assert.equal(count(output, /<tie type="start"\/>/g), count(output, /<tie type="stop"\/>/g), 'tie 起止数量相等');
  assert.ok(count(output, /<tie type="start"\/>/g) > 0, 'fixture 必须真的产生延音线');
  assert.equal(count(output, /<tied type="start"\/>/g), count(output, /<tie type="start"\/>/g), '<tie> 与 <notations><tied> 成对');
  assert.equal(count(output, /<tied type="stop"\/>/g), count(output, /<tie type="stop"\/>/g));
  for (const n of notesOf(output)) {
    if (n.includes('<tie type="stop"/>')) { assert.ok(open.length, '出现没有 start 的 tie stop'); assert.equal(open.pop(), pitchOf(n), 'tie stop 音高须与 start 一致'); }
    if (n.includes('<tie type="start"/>')) open.push(pitchOf(n));
  }
  assert.deepEqual(open, [], '不得有未闭合的 tie start');
  const slurs = new Map();
  for (const n of notesOf(output)) for (const m of n.matchAll(/<slur type="(start|stop)" number="(\d+)"/g))
    if (m[1] === 'start') { assert.ok(!slurs.has(m[2]), `slur ${m[2]} 重复 start`); slurs.set(m[2], true); } else assert.ok(slurs.delete(m[2]), `slur ${m[2]} stop 无对应 start`);
  assert.equal(slurs.size, 0);
  const started = bars.findIndex(b => b.body.includes('<tie type="start"/>')), stopped = bars.findIndex(b => b.body.includes('<tie type="stop"/>'));
  assert.ok(started >= 0 && stopped > started, '跨小节延音应在后一小节闭合');
  const split = project([note('a', 0, 4, 60), note('b', 4, 4, 62)]); split.keyChanges = [{beat: 2, key: 5}];
  const splitBar = measures(xml(split))[0];
  assert.equal(count(splitBar.body, /<tie type="start"\/>/g), count(splitBar.body, /<tie type="stop"\/>/g));
  assert.equal(count(splitBar.body, /<tie type="start"\/>/g), 1, '小节内转调切开长音仍成对');
});

test('歌词只在词首音：一字多音与跨小节长音都不重复挂词', () => {
  const melisma = project([note('a', 0, 1), note('b', 1, 1, 62), note('c', 2, 1, 64)]);
  melisma.lyrics = [{id: 'w1', text: '啊', noteIds: ['a', 'b', 'c']}];
  const output = xml(melisma), sung = notesOf(output);
  assert.equal(count(output, /<lyric number="1">/g), 1, '一字多音只输出一次歌词');
  assert.match(sung[0], /<lyric number="1"><text>啊<\/text><\/lyric>/);
  for (const n of sung.slice(1)) assert.ok(!n.includes('<lyric'), '延音音不应重复输出歌词');
  const held = project([note('a', 0, 6, 60)]); held.notes[0].lyric = '字';
  const long = xml(held);
  assert.ok(notesOf(long).length > 1, 'fixture 必须真的被小节线切成多个 atom');
  assert.equal(count(long, /<lyric number="1">/g), 1, '跨小节长音只挂一次词');
  assert.match(notesOf(long)[0], /<lyric number="1"><text>字<\/text><\/lyric>/);
});

test('attributes 位置：首小节小节首，转调处可落在小节中间（现状，待真机验证）', () => {
  const mid = project([note('a', 0, 4, 60), note('b', 4, 4, 62)]); mid.keyChanges = [{beat: 2, key: 5}];
  const midOutput = xml(mid), midBars = measures(midOutput);
  assert.equal(count(midOutput, /<divisions>48<\/divisions>/g), 1, 'divisions 只在首小节声明一次');
  assert.deepEqual(attributePositions(midBars[0].body), ['bar-start', 'mid-bar']);
  assert.match(midBars[0].body, /^<attributes><divisions>48<\/divisions>/, '首小节属性在小节首');
  // 现状（已知行为，不写成失败用例）：转调落在长音中间时，<attributes><key> 紧跟 tie start 之后、
  // 停在小节中间。合法 MusicXML，但导入端兼容性风险，待 Dolce 真机验证：部分导入器只认小节线处的属性。
  assert.match(midBars[0].body, /<tie type="start"\/>[\s\S]*?<attributes><key><fifths>-1<\/fifths><mode>major<\/mode><\/key><\/attributes>/);
  assert.deepEqual(attributePositions(midBars[1].body), [], '调号未变化的小节不重复输出 attributes');
  // 转调正好落小节线时，属性回到小节首（合法首选位置）。
  const edge = project([note('a', 0, 4, 60), note('b', 4, 4, 62)]); edge.keyChanges = [{beat: 4, key: 5}];
  const edgeBars = measures(xml(edge));
  assert.deepEqual(edgeBars.map(b => attributePositions(b.body)), [['bar-start'], ['bar-start']]);
  assert.match(edgeBars[1].body, /^<attributes><key><fifths>-1<\/fifths>/);
});
