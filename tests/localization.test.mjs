import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

const read = path => readFile(path, 'utf8');
async function sourceFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, {withFileTypes:true})) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (/\.(?:tsx?|js|html|webmanifest)$/.test(path)) files.push(path);
  }
  return files;
}

test('owned UI copy does not regress to Simplified Chinese or mainland UI terminology', async () => {
  // This scans source-owned copy only. Never apply conversion to user data or dictionary results.
  const simplifiedOnly = /[与个为义习仅从会写内动单发变国图头实对导将层应开张录忆态总扩护报择换据断无旧时显暂术机条来样标档检没测浏点现环电线组经结络统绪续编缩网补览词识试语误说读请调贝资转轮软过还这进远连选递钟错长闭间闻队随难页项顺题风飞马验汇复练记认载释储辑笔离见签类区设够话逻]/;
  for (const path of (await Promise.all(['app','lib','public'].map(sourceFiles))).flat()) {
    const text = await read(path);
    assert.doesNotMatch(text, simplifiedOnly, path);
    assert.doesNotMatch(text, /私人云端|保存|導出|搜索|短語|單詞/, path);
  }
});

test('document, PWA and offline fallback consistently declare Taiwan Traditional Chinese', async () => {
  const layout = await read('app/layout.tsx');
  assert.match(layout, /lang="zh-TW"/);
  assert.match(layout, /English Vocabulary · 我的詞彙/);
  assert.equal(JSON.parse(await read('public/manifest.webmanifest')).lang, 'zh-TW');
  const offline = await read('public/offline.html');
  assert.match(offline, /lang="zh-TW"/);
  assert.match(offline, /目前離線/);
  assert.match(offline, /詞彙與複習紀錄/);
  assert.match(await read('public/sw.js'), /vocabulary-shell-v2-zh-tw/);
});

test('learning content, pronunciation and stored field values remain unchanged', async () => {
  const app = await read('app/vocabulary-app.tsx');
  assert.match(app, /Small, consistent efforts compound over time\./);
  assert.match(app, /utterance\.lang='en-US'/);
  assert.match(app, /return w\.definition\|\|w\.dictionary\[0\]\?\.definition\|\|''/);
  assert.match(app, /words:selected\.map\(\(\{term,context,sense\}\)=>\(\{term,context,sense\}\)\)/);
  assert.match(app, /toLocaleString\('zh-TW'/);
  assert.match(app, /toLocaleDateString\('zh-TW'/);
  assert.doesNotMatch(app, /opencc|convertToTraditional|translate\(/i);
});
