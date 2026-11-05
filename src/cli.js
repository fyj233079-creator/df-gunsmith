// 单次采集（GitHub Actions / crontab 用）：node src/cli.js
import { config } from './config.js';
import { Collector } from './collector.js';

const c = new Collector(config);
await c.load();
const summary = await c.run({ force: true });
console.log(JSON.stringify(summary || { message: '没有成功的数据源，未更新' }));
const snap = c.snapshot();
for (const s of snap.sources) console.log(`  ${s.ok ? '✓' : s.skipped ? '–' : '✗'} ${s.id}: ${s.count} 条 ${s.error || ''}`);
// 所有已配置的源都失败时返回非 0，方便 CI 报警
if (snap.sources.every(s => !s.ok)) process.exit(1);
