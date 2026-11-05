import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Collector } from '../src/collector.js';
import * as aitags from '../src/sources/aitags.js';
import * as orzice from '../src/sources/orzice.js';

const fx = f => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url)));

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'dfg-'));
  const config = {
    dataDir: join(dir, 'pub'), cacheDir: join(dir, 'cache'), manualFile: join(dir, 'none.json'),
    intervals: { aitags: 10, orzice: 60 }, orziceToken: 'T', orziceMaxPages: 5, orziceDelayMs: 0,
    orziceBlackTide: false, fetchTimeoutMs: 1000, userAgent: 'test', maxChanges: 100,
  };
  let aitagsData = fx('aitags.json');
  let fail = new Set();
  const fetchImpl = async url => {
    const host = new URL(url).host;
    if (fail.has(host)) return { ok: false, status: 503 };
    if (host === 'g.aitags.cn') return { ok: true, json: async () => aitagsData };
    const u = new URL(url);
    const page = Number(u.searchParams.get('p'));
    const st = u.searchParams.get('solutionType');
    const body = fx('orzice_gun.json');
    if (st === 'operator' || page > 1) return { ok: true, json: async () => ({ code: 0, count: 0, data: [] }) };
    return { ok: true, json: async () => body };
  };
  const c = new Collector(config, { fetchImpl, sources: [aitags, orzice] });
  await c.load();
  return { c, config, setAitags: d => { aitagsData = d; }, fail };
}

test('首轮建库 + 落盘', async () => {
  const { c, config } = await setup();
  const s = await c.run({ force: true });
  assert.equal(s.total, 9);
  const codes = JSON.parse(await readFile(join(config.dataDir, 'codes.json'), 'utf8'));
  assert.equal(codes.items.length, 9);
  assert.equal(codes.sources.find(x => x.id === 'orzice').count, 2);
  const ch = JSON.parse(await readFile(join(config.dataDir, 'changes.json'), 'utf8'));
  assert.equal(ch.events[0].type, 'init');
});

test('增量变更 + 推送事件', async () => {
  const { c, setAitags } = await setup();
  await c.run({ force: true });
  const got = [];
  c.onChange((sum, ev) => got.push({ sum, ev }));
  const d = fx('aitags.json');
  d[2].modcodes.push({ code: 'VSS射手步枪-烽火地带-6NEWNEWNEWNEWNEWNEWNE', desc: '新方案', value: '30W', copy_count: 1, like_count: 0 });
  setAitags(d);
  const s = await c.run({ force: true });
  assert.equal(s.added, 1);
  assert.equal(got[0].ev[0].type, 'added');
  assert.equal(c.changes[0].code, 'VSS射手步枪-烽火地带-6NEWNEWNEWNEWNEWNEWNE');
});

test('数据源失败时保留上一轮数据', async () => {
  const { c, fail } = await setup();
  await c.run({ force: true });
  fail.add('g.aitags.cn');
  const s = await c.run({ force: true });
  assert.equal(s.total, 9);   // orzice 成功、aitags 用缓存
  assert.equal(c.snapshot().sources.find(x => x.id === 'aitags').ok, false);
  fail.add('orzice.com');
  assert.equal(await c.run({ force: true }), null); // 全挂：不改数据
  assert.equal(c.items.size, 9);
});

test('重启后从磁盘恢复', async () => {
  const { c, config } = await setup();
  await c.run({ force: true });
  const c2 = new Collector(config, { fetchImpl: async () => ({ ok: false, status: 500 }), sources: [aitags, orzice] });
  await c2.load();
  assert.equal(c2.items.size, 9);
  assert.equal(c2.raws.aitags.length, 8);
});

import * as streamer from '../src/sources/aitags-streamer.js';

test('主播页仅在 modified 变化时重抓', async () => {
  const html = readFileSync(new URL('./fixtures/streamer.html', import.meta.url), 'utf8');
  let modified = '2026-09-10T20:37:52', pageHits = 0;
  const list = () => [{ id: 1, slug: 'bbfps', link: 'https://g.aitags.cn/streamer/bbfps', title: { rendered: 'bbFps' }, modified }];
  const fetchImpl = async url => {
    if (url.includes('/wp-json/')) return { ok: true, json: async () => list() };
    pageHits++; return { ok: true, text: async () => html };
  };
  const dir = await mkdtemp(join(tmpdir(), 'dfg-'));
  const c = new Collector({ dataDir: join(dir, 'p'), cacheDir: join(dir, 'c'), intervals: {}, streamerDelayMs: 0, fetchTimeoutMs: 1000, userAgent: 't', maxChanges: 50 }, { fetchImpl, sources: [streamer] });
  await c.load();
  assert.equal((await c.run({ force: true })).total, 3);
  await c.run({ force: true });
  assert.equal(pageHits, 1);           // 未变化：不重抓
  modified = '2026-11-05T00:00:00';
  await c.run({ force: true });
  assert.equal(pageHits, 2);           // 变化：重抓
  assert.equal(c.snapshot().sources[0].count, 3);
});
