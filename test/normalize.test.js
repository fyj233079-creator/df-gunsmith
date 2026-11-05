import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { weaponKey, extractCore, parsePrefixed, parseWan, coinsToWan, mergeItems, diffItems, MODES } from '../src/normalize.js';
import * as aitags from '../src/sources/aitags.js';
import * as orzice from '../src/sources/orzice.js';

const fx = f => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url)));

test('weaponKey 跨站对齐', () => {
  assert.equal(weaponKey('PKM通用机枪'), weaponKey('PKM'));
  assert.equal(weaponKey('AK-12突击步枪'), weaponKey('AK-12'));
  assert.equal(weaponKey('QJB-201轻机枪'), weaponKey('QJB201'));
  assert.equal(weaponKey('M82 狙击步枪'), weaponKey('M82狙击步枪'));
  assert.equal(weaponKey('.357左轮'), '357左轮');
  assert.equal(weaponKey('SR-3M紧凑突击步枪'), weaponKey('SR-3M'));
  assert.notEqual(weaponKey('手枪'), '');
});

test('改枪码解析', () => {
  assert.equal(extractCore('VSS射手步枪-烽火地带-6IRTOU8003UFIEML66NPP'), '6IRTOU8003UFIEML66NPP');
  assert.equal(extractCore(' 6g94d100fhi6pkf6c3p0u '), '6G94D100FHI6PKF6C3P0U');
  assert.equal(extractCore('abc'), null);
  assert.deepEqual(parsePrefixed('AK-12突击步枪-烽火地带-6L9KO4O06V69DR6QR5IN5'), { weapon: 'AK-12突击步枪', mode: '烽火地带', core: '6L9KO4O06V69DR6QR5IN5' });
  assert.equal(parsePrefixed('6L9KO4O06V69DR6QR5IN5'), null);
  assert.equal(parseWan('24W'), 24); assert.equal(parseWan('1.5w'), 1.5); assert.equal(parseWan('（全面战场）'), null);
  assert.equal(coinsToWan(231000), 23.1); assert.equal(coinsToWan(0), null);
});

test('aitags 转换', () => {
  const items = aitags.transform(fx('aitags.json'));
  assert.equal(items.length, 8);
  const qm = items.find(i => i.code === '6GTVLVK08QM0P04IG7BJ6');
  assert.equal(qm.mode, MODES.QM); assert.equal(qm.price, null);
  const ak = items.find(i => i.code.startsWith('AK-12突击步枪'));
  assert.equal(ak.weapon, 'AK-12突击步枪'); assert.equal(ak.category, '步枪'); assert.equal(ak.price, 25);
});

test('orzice 转换', () => {
  const items = orzice.transformV2(fx('orzice_gun.json').data, 'gun');
  assert.equal(items.length, 2);
  assert.equal(items[0].price, 23.1); assert.equal(items[0].priceLive, true);
  assert.equal(items[0].author, '昊天'); assert.equal(items[0].stats[0].name, '后坐力控制');
  assert.equal(orzice.transformV2([{ solutionCode: '6AAAAAAAAAAAAAAAAAAAA', objectName: 'X', price: 1 }], 'operator')[0].mode, MODES.QM);
});

test('跨源合并去重', () => {
  const raws = [...aitags.transform(fx('aitags.json')), ...orzice.transformV2(fx('orzice_gun.json').data, 'gun')];
  const merged = mergeItems(raws, new Map(), '2026-11-05T00:00:00Z');
  assert.equal(merged.size, 9); // 8 + 2 - 1 重复（PKM 低配）
  const pkm = merged.get(`${MODES.FH}|6G94D100FHI6PKF6C3P0U`);
  assert.equal(pkm.sources.length, 2);
  assert.equal(pkm.code, 'PKM通用机枪-烽火地带-6G94D100FHI6PKF6C3P0U'); // 优先完整码
  assert.equal(pkm.weapon, 'PKM通用机枪');
  assert.equal(pkm.price, 23.1); assert.equal(pkm.priceLive, true);   // 实时价优先
  assert.equal(pkm.author, '昊天'); assert.equal(pkm.desc, '低成本猛攻');
  assert.equal(pkm.copies, 18937 + 1200);
});

test('变更检测', () => {
  const a = aitags.transform(fx('aitags.json'));
  const t0 = '2026-11-05T00:00:00Z', t1 = '2026-11-05T00:10:00Z';
  const prev = mergeItems(a, new Map(), t0);
  const changed = a.slice(1).map(x => x.code === '6H9482404FDE6PGQOMNGT' ? { ...x, value: 0, price: 26 } : x);
  changed.push({ ...a[0], code: '6ZZZZZZZZZZZZZZZZZZZZ' });
  const next = mergeItems(changed, prev, t1);
  const d = diffItems(prev, next, t1);
  assert.equal(d.added.length, 1); assert.equal(d.removed.length, 1); assert.equal(d.updated.length, 1);
  assert.deepEqual(d.updated[0].changed, ['price']);
  // firstSeen 保留
  assert.equal(next.get(`${MODES.FH}|6H9482404FDE6PGQOMNGT`).firstSeen, t0);
});

import * as streamer from '../src/sources/aitags-streamer.js';
import { guessCategory } from '../src/normalize.js';

test('主播同款页面解析', () => {
  const html = readFileSync(new URL('./fixtures/streamer.html', import.meta.url), 'utf8');
  const items = streamer.parsePage(html, 'bbFps', 'https://g.aitags.cn/streamer/bbfps');
  assert.equal(items.length, 3);
  const [a, b, c] = items;
  assert.equal(a.weapon, 'QCQ171冲锋枪'); assert.equal(a.category, '冲锋枪'); assert.equal(a.price, 69);
  assert.equal(a.author, 'bbFps'); assert.equal(a.title, 'bbFps 同款');
  assert.match(a.image, /image-8\.webp$/);
  assert.equal(b.desc, '半改 & 3倍镜'); assert.equal(b.category, '狙击步枪'); assert.match(b.image, /image-25/);
  assert.equal(c.mode, MODES.QM); assert.equal(c.weapon, '未标注武器'); assert.equal(c.image, '');
});

test('分类推断', () => {
  assert.equal(guessCategory('M14射手步枪'), '精确射手步枪');
  assert.equal(guessCategory('SVCH精确射手步枪'), '精确射手步枪');
  assert.equal(guessCategory('PKM通用机枪'), '轻机枪');
  assert.equal(guessCategory('.357左轮'), '手枪');
  assert.equal(guessCategory('G17'), '');
});

test('主播码与主表合并后补上作者', () => {
  const html = readFileSync(new URL('./fixtures/streamer.html', import.meta.url), 'utf8');
  const raws = [...aitags.transform(fx('aitags.json')), ...streamer.parsePage(html, 'bbFps', 'u')];
  const m = mergeItems(raws);
  const pkmQM = [...m.values()].find(i => i.core === '6G94D100FHI6PKF6C3P0U' && i.mode === MODES.QM);
  assert.equal(pkmQM.author, 'bbFps');
  const pkmFH = m.get(`${MODES.FH}|6G94D100FHI6PKF6C3P0U`);
  assert.equal(pkmFH.author, '');   // 不同模式不会误合并
});
