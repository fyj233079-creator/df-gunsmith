// 采集器：按各自间隔拉取数据源 → 合并去重 → 与上一轮对比 → 落盘 → 产出变更事件
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { mergeItems, diffItems, MODES } from './normalize.js';
import * as aitags from './sources/aitags.js';
import * as orzice from './sources/orzice.js';
import * as aitagsStreamer from './sources/aitags-streamer.js';
import * as manual from './sources/manual.js';

export const SOURCES = [aitags, aitagsStreamer, orzice, manual];

const log = (...a) => console.log(new Date().toISOString(), '[collector]', ...a);

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}
async function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(data));
  await rename(tmp, file);
}

export function makeFetchJson(config, fetchImpl = globalThis.fetch, as = 'json') {
  return async function fetchJson(url, tries = 3) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
      try {
        const res = await fetchImpl(url, {
          headers: { 'User-Agent': config.userAgent, Accept: as === 'json' ? 'application/json' : 'text/html' },
          signal: AbortSignal.timeout(config.fetchTimeoutMs),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return as === 'json' ? await res.json() : await res.text();
      } catch (e) {
        lastErr = e;
        if (i < tries - 1) await new Promise(r => setTimeout(r, 1000 * 2 ** i));
      }
    }
    throw new Error(`${new URL(url).host}: ${lastErr?.message || lastErr}`);
  };
}

export class Collector {
  constructor(config, { fetchImpl, sources = SOURCES } = {}) {
    this.config = config;
    this.sources = sources;
    this.fetchJson = makeFetchJson(config, fetchImpl);
    this.fetchText = makeFetchJson(config, fetchImpl, 'text');
    this.state = {};          // sourceId → {ok, count, fetchedAt, error, skipped}
    this.raws = {};           // sourceId → RawItem[]（最近一次成功结果）
    this.items = new Map();   // key → item
    this.changes = [];
    this.updatedAt = null;
    this.running = null;
    this.listeners = new Set();
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  async load() {
    const c = this.config;
    await mkdir(c.dataDir, { recursive: true });
    await mkdir(c.cacheDir, { recursive: true });
    const codes = await readJson(join(c.dataDir, 'codes.json'), null);
    if (codes?.items) {
      this.items = new Map(codes.items.map(it => [it.key, it]));
      this.updatedAt = codes.updatedAt;
      for (const s of codes.sources || []) this.state[s.id] = s;
    }
    this.changes = (await readJson(join(c.dataDir, 'changes.json'), { events: [] })).events || [];
    for (const s of this.sources) {
      const cached = await readJson(join(c.cacheDir, `${s.id}.json`), null);
      if (cached?.items) this.raws[s.id] = cached.items;
    }
    log(`已载入 ${this.items.size} 条，变更记录 ${this.changes.length} 条`);
  }

  isDue(s, now = Date.now()) {
    const st = this.state[s.id];
    const min = this.config.intervals[s.id] ?? 10;
    if (!st?.fetchedAt) return true;
    // 失败后 2 分钟重试，成功后按配置间隔
    const wait = st.ok ? min * 60e3 : Math.min(min * 60e3, 2 * 60e3);
    return now - Date.parse(st.attemptAt || st.fetchedAt) >= wait;
  }

  /** 执行一轮采集；force=true 时忽略间隔全部拉取 */
  run({ force = false } = {}) {
    if (!this.running) this.running = this._run(force).finally(() => { this.running = null; });
    return this.running;
  }

  async _run(force) {
    const c = this.config;
    const due = this.sources.filter(s => force || this.isDue(s));
    if (!due.length) return null;

    let anyFetched = false;
    await Promise.all(due.map(async s => {
      const attemptAt = new Date().toISOString();
      try {
        const items = await s.fetchAll({ fetchJson: this.fetchJson, fetchText: this.fetchText, config: c, log });
        if (!items.length) throw new Error('返回 0 条，疑似接口异常，保留上一轮数据');
        this.raws[s.id] = items;
        this.state[s.id] = { id: s.id, label: s.label, homepage: s.homepage, ok: true, count: items.length, fetchedAt: attemptAt, attemptAt, error: '' };
        await writeJsonAtomic(join(c.cacheDir, `${s.id}.json`), { fetchedAt: attemptAt, items });
        anyFetched = true;
        log(`${s.id}: ${items.length} 条`);
      } catch (e) {
        const prev = this.state[s.id] || {};
        this.state[s.id] = { ...prev, id: s.id, label: s.label, homepage: s.homepage, ok: !!e.skip ? prev.ok ?? false : false, skipped: !!e.skip, attemptAt, fetchedAt: prev.fetchedAt || attemptAt, error: e.message, count: this.raws[s.id]?.length || 0 };
        if (!e.skip) log(`${s.id} 失败：${e.message}`);
      }
    }));
    // 本轮没有任何源成功：只保存源状态（便于排查），数据与更新时间保持不变
    if (!anyFetched) { await this.save(); return null; }

    const now = new Date().toISOString();
    const next = mergeItems(Object.values(this.raws).flat(), this.items, now);
    const diff = diffItems(this.items, next, now);
    this.items = next;
    this.updatedAt = now;

    const events = [
      ...diff.added.map(it => ({ type: 'added', at: now, key: it.key, weapon: it.weapon, mode: it.mode, code: it.code, price: it.price })),
      ...diff.updated.map(u => ({ type: 'updated', at: now, key: u.item.key, weapon: u.item.weapon, mode: u.item.mode, code: u.item.code, changed: u.changed, before: u.before })),
      ...diff.removed.map(it => ({ type: 'removed', at: now, key: it.key, weapon: it.weapon, mode: it.mode, code: it.code })),
    ];
    // 首次建库不刷屏：只记一条汇总
    const firstBuild = this.changes.length === 0 && diff.added.length === next.size;
    const toLog = firstBuild ? [{ type: 'init', at: now, count: next.size }] : events;
    // 价格类更新很频繁，变更日志只保留非纯价格更新
    const meaningful = toLog.filter(e => !(e.type === 'updated' && e.changed.every(f => f === 'price')));
    this.changes = [...meaningful.reverse(), ...this.changes].slice(0, c.maxChanges);

    await this.save();
    const summary = { at: now, added: diff.added.length, updated: diff.updated.length, removed: diff.removed.length, total: next.size };
    log(`合并完成：共 ${next.size} 条（+${summary.added} ~${summary.updated} -${summary.removed}）`);
    summary.changed = events.length > 0;
    for (const fn of this.listeners) { try { fn(summary, firstBuild ? [] : events); } catch { } }
    return summary;
  }

  snapshot() {
    const items = [...this.items.values()].sort((a, b) => b.hot - a.hot);
    const byMode = {};
    for (const m of Object.values(MODES)) byMode[m] = 0;
    for (const it of items) byMode[it.mode] = (byMode[it.mode] || 0) + 1;
    return {
      version: 1,
      updatedAt: this.updatedAt,
      sources: this.sources.map(s => this.state[s.id] || { id: s.id, label: s.label, homepage: s.homepage, ok: false, count: 0, error: '尚未采集' }),
      counts: { total: items.length, byMode },
      items,
    };
  }

  async save() {
    const c = this.config;
    await writeJsonAtomic(join(c.dataDir, 'codes.json'), this.snapshot());
    await writeJsonAtomic(join(c.dataDir, 'changes.json'), { updatedAt: this.updatedAt, events: this.changes });
  }
}
