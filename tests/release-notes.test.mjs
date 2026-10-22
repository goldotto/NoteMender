import test from 'node:test';
import assert from 'node:assert/strict';
import {releaseNotesHTML} from '../public/release-notes.mjs';
test('release notes render headings, lists, emphasis and code without executing HTML',()=>{
  const html=releaseNotesHTML('# 标题\n\n## 修复\n- **音量**正常\n- `MIDI`\n<script>alert(1)</script>\n```\n<img src=x onerror=bad>\n```');
  assert.match(html,/<h3>标题<\/h3>/);assert.match(html,/<h4>修复<\/h4>/);assert.match(html,/<li><strong>音量<\/strong>正常/);assert.match(html,/<code>MIDI<\/code>/);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.match(html,/&lt;script&gt;/);
});
test('release notes link labels and URLs are escaped and unsafe schemes are never linked',()=>{
  const html=releaseNotesHTML('[下载](https://example.com/a?x=1&y=2) [危险](javascript:bad) [<img>](https://example.com)');
  assert.match(html,/<a href="https:\/\/example.com\/a\?x=1&amp;y=2" target="_blank" rel="noopener noreferrer">下载<\/a>/);
  assert.ok(!html.includes('javascript:'));assert.ok(!html.includes('<img>'));assert.ok(!html.includes('[下载]'));
  assert.match(releaseNotesHTML('**[下载](https://example.com)**'),/<strong><a /);
  assert.match(releaseNotesHTML('[`校验`](https://example.com)'),/><code>校验<\/code><\/a>/);
});
