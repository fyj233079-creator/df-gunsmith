import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 读取 .env（无依赖的简易实现；已存在的环境变量优先）
try {
  for (const line of readFileSync(resolve('.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch { /* 没有 .env 就用默认值 */ }

const env = (k, d) => process.env[k] ?? d;
const num = (k, d) => Number(env(k, d));
const bool = (k, d) => /^(1|true|yes|on)$/i.test(env(k, d ? '1' : '0'));

export const config = {
  port: num('PORT', 8080),
  host: env('HOST', '0.0.0.0'),
  publicDir: resolve(env('PUBLIC_DIR', 'public')),
  dataDir: resolve(env('DATA_DIR', 'public/data')),   // 对外公开的数据（codes.json / changes.json）
  cacheDir: resolve(env('CACHE_DIR', 'data/cache')),   // 各数据源最近一次成功的原始结果
  manualFile: resolve(env('MANUAL_FILE', 'data/manual.json')),

  // 各数据源刷新间隔（分钟）
  intervals: {
    aitags: num('AITAGS_INTERVAL_MIN', 10),
    'aitags-streamer': num('AITAGS_STREAMER_INTERVAL_MIN', 30),
    orzice: num('ORZICE_INTERVAL_MIN', 60),   // 按页扣费，默认 1 小时
    manual: num('MANUAL_INTERVAL_MIN', 1),
  },
  tickSeconds: num('TICK_SECONDS', 30),        // 调度器检查周期

  orziceToken: env('ORZICE_TOKEN', ''),
  orziceBlackTide: bool('ORZICE_BLACKTIDE', false),
  orziceMaxPages: num('ORZICE_MAX_PAGES', 100),
  orziceDelayMs: num('ORZICE_DELAY_MS', 400),

  streamerDelayMs: num('STREAMER_DELAY_MS', 800),   // 主播页之间的间隔，避免给对方压力

  fetchTimeoutMs: num('FETCH_TIMEOUT_MS', 20000),
  userAgent: env('USER_AGENT', 'DF-Gunsmith/1.0 (self-hosted gun-code aggregator)'),
  adminToken: env('ADMIN_TOKEN', ''),          // POST /api/refresh 需要
  maxChanges: num('MAX_CHANGES', 500),
};
