// HTTP 服务：静态前端 + 查询 API + SSE 实时推送 + 定时采集
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { config } from './config.js';
import { Collector } from './collector.js';
import { weaponKey } from './normalize.js';

const collector = new Collector(config);
await collector.load();

// ---------- 查询 ----------
function query(params) {
  let list = [...collector.items.values()];
  const mode = params.get('mode');
  const cat = params.get('category');
  const weapon = params.get('weapon');
  const source = params.get('source');
  const q = (params.get('q') || '').trim().toLowerCase();
  const min = params.has('min') ? Number(params.get('min')) : null;
  const max = params.has('max') ? Number(params.get('max')) : null;
  if (mode) list = list.filter(it => it.mode === mode);
  if (cat) list = list.filter(it => it.category === cat);
  if (weapon) { const k = weaponKey(weapon); list = list.filter(it => it.weaponKey === k); }
  if (source) list = list.filter(it => it.sources.some(s => s.id === source));
  const author = params.get('author');
  if (author) list = list.filter(it => it.author === author);
  if (min != null) list = list.filter(it => it.price != null && it.price >= min);
  if (max != null) list = list.filter(it => it.price != null && it.price <= max);
  if (q) list = list.filter(it => [it.weapon, it.title, it.desc, it.author, it.code].join(' ').toLowerCase().includes(q));
  const sorters = {
    hot: (a, b) => b.hot - a.hot,
    new: (a, b) => b.firstSeen.localeCompare(a.firstSeen),
    updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    price_asc: (a, b) => (a.price ?? 1e9) - (b.price ?? 1e9),
    price_desc: (a, b) => (b.price ?? -1) - (a.price ?? -1),
  };
  list.sort(sorters[params.get('sort')] || sorters.hot);
  const total = list.length;
  const offset = Math.max(0, Number(params.get('offset')) || 0);
  const limit = Math.min(2000, Math.max(1, Number(params.get('limit')) || 2000));
  return { total, offset, limit, items: list.slice(offset, offset + limit) };
}

function weapons() {
  const map = new Map();
  for (const it of collector.items.values()) {
    let w = map.get(it.weaponKey);
    if (!w) map.set(it.weaponKey, w = { key: it.weaponKey, name: it.weapon, category: it.category, count: 0, modes: {} });
    if (it.weapon.length > w.name.length) w.name = it.weapon;
    if (!w.category) w.category = it.category;
    w.count++; w.modes[it.mode] = (w.modes[it.mode] || 0) + 1;
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

// ---------- SSE ----------
const clients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
collector.onChange((summary, events) => {
  if (summary.changed) broadcast('update', { ...summary, events: events.slice(0, 50) });
  else broadcast('tick', { at: summary.at, total: summary.total });   // 无变化：只同步“更新时间”
});
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25e3).unref();

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp' };

function send(res, code, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(code, { 'Content-Type': isObj ? MIME['.json'] : 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache', ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}

async function serveStatic(res, pathname) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(config.publicDir, rel);
  if (!file.startsWith(config.publicDir)) return send(res, 403, 'forbidden');
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const buf = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': extname(file) === '.html' || extname(file) === '.json' ? 'no-cache' : 'public, max-age=3600' });
    res.end(buf);
  } catch { send(res, 404, 'not found'); }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (req.method === 'OPTIONS') return send(res, 204, '', { 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Authorization' });
    if (p === '/api/codes') return send(res, 200, query(url.searchParams));
    if (p === '/api/weapons') return send(res, 200, weapons());
    if (p === '/api/meta') { const { items, ...meta } = collector.snapshot(); return send(res, 200, { ...meta, clients: clients.size }); }
    if (p === '/api/changes') {
      const since = url.searchParams.get('since');
      return send(res, 200, { events: since ? collector.changes.filter(e => e.at > since) : collector.changes.slice(0, 100) });
    }
    if (p === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*', 'X-Accel-Buffering': 'no' });
      res.write(`event: hello\ndata: ${JSON.stringify({ updatedAt: collector.updatedAt, total: collector.items.size })}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (p === '/api/refresh' && req.method === 'POST') {
      if (!config.adminToken || req.headers.authorization !== `Bearer ${config.adminToken}`) return send(res, 401, { error: 'unauthorized' });
      return send(res, 200, (await collector.run({ force: true })) || { message: '无变化' });
    }
    if (p === '/healthz') return send(res, 200, { ok: true, updatedAt: collector.updatedAt });
    if (p.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    return serveStatic(res, p);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`DF Gunsmith 已启动：http://localhost:${config.port}`);
});

// ---------- 调度 ----------
const tick = () => collector.run().catch(e => console.error('采集异常', e));
tick();
setInterval(tick, config.tickSeconds * 1000);

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); process.exit(0); });
