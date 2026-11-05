// 数据源：改枪码大全 · 主播同款（g.aitags.cn/streamer/*）
// 主播列表来自公开 WordPress REST（streamer_weapon），每位主播的码在其页面表格里（服务端渲染）。
// 只在主播页 modified 时间变化时才重新抓该页，平时每轮只请求 1 次列表接口。
import { guessCategory, guessMode, parsePrefixed, parseWan } from '../normalize.js';

export const id = 'aitags-streamer';
export const label = '主播同款 (aitags)';
export const homepage = 'https://g.aitags.cn/live';
const LIST = 'https://g.aitags.cn/wp-json/wp/v2/streamer_weapon?per_page=100&_fields=id,slug,link,title,modified';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#038': '&', nbsp: ' ' };
const decode = s => String(s || '').replace(/&(#?\w+);/g, (m, e) => ENT[e] ?? (e[0] === '#' ? String.fromCodePoint(parseInt(e.slice(1), e[1] === 'x' ? 16 : 10) || 32) : m));
const text = html => decode(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** 解析主播页 HTML → RawItem[]（纯函数，便于测试） */
export function parsePage(html, streamer, url) {
  const items = [];
  let last = null;
  for (const chunk of String(html).split(/<tr\b/i).slice(1)) {
    const row = chunk.split(/<\/tr>/i)[0];
    const code = row.match(/data-code="([^"]+)"/)?.[1];
    if (code) {
      const tds = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => text(m[1]));
      const c = decode(code).trim();
      const pre = parsePrefixed(c);
      const weapon = pre?.weapon || '';
      last = {
        source: id,
        code: c,
        weapon: weapon || '未标注武器',
        category: guessCategory(weapon),
        mode: pre?.mode || guessMode(tds[2], tds[1]),
        price: parseWan(tds[2]),
        priceLive: false,
        title: `${streamer} 同款`,
        desc: tds[1] || '',
        author: streamer,
        image: '',
        url,
      };
      items.push(last);
    } else if (last && /image-row/.test(row) && !last.image) {
      last.image = row.match(/<img[^>]+src="(https:[^"]+)"/i)?.[1] || '';
    }
  }
  return items;
}

const pageCache = new Map();   // link → { modified, items }
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function fetchAll({ fetchJson, fetchText, config, log }) {
  const list = await fetchJson(LIST);
  if (!Array.isArray(list)) throw new Error('主播列表格式异常');
  const out = [];
  let fetched = 0, failed = 0;
  for (const s of list) {
    const link = s.link;
    if (!/^https:\/\/g\.aitags\.cn\//.test(link || '')) continue;
    const name = decode(s.title?.rendered) || s.slug;
    const hit = pageCache.get(link);
    if (hit && hit.modified === s.modified) { out.push(...hit.items); continue; }
    try {
      if (fetched) await sleep(config.streamerDelayMs ?? 800);
      const items = parsePage(await fetchText(link), name, link);
      pageCache.set(link, { modified: s.modified, items });
      out.push(...items);
      fetched++;
    } catch (e) {
      failed++;
      if (hit) out.push(...hit.items);   // 单页失败沿用旧数据
      log?.(`主播页 ${name} 抓取失败：${e.message}`);
    }
  }
  log?.(`aitags-streamer: ${list.length} 位主播，本轮抓取 ${fetched} 页${failed ? `，失败 ${failed}` : ''}，共 ${out.length} 条`);
  return out;
}
