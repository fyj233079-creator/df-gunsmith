// 数据源：三角洲改枪码大全 g.aitags.cn
// 公开 WordPress REST 接口，免鉴权，一次返回全站所有武器的改枪码。
import { guessMode, parsePrefixed, parseWan } from '../normalize.js';

export const id = 'aitags';
export const label = '改枪码大全 (aitags)';
export const homepage = 'https://g.aitags.cn/';
const ENDPOINT = 'https://g.aitags.cn/wp-json/weaponmod/v1/modcodes';

/** 原始 JSON → RawItem[]（纯函数，便于测试） */
export function transform(json) {
  if (!Array.isArray(json)) throw new Error('aitags: 返回格式不是数组');
  const items = [];
  for (const w of json) {
    const category = w.categories?.[0]?.name || '';
    for (const m of w.modcodes || []) {
      if (!m?.code) continue;
      const pre = parsePrefixed(m.code);
      items.push({
        source: id,
        code: String(m.code).trim(),
        weapon: pre?.weapon || w.weapon_name,
        category,
        mode: pre?.mode || guessMode(m.value, m.desc),
        price: parseWan(m.value),
        priceLive: false,
        desc: (m.desc || '').trim(),
        copies: Number(m.copy_count) || 0,
        likes: Number(m.like_count) || 0,
        image: m.image || '',
        url: w.weapon_url || homepage,
      });
    }
  }
  return items;
}

export async function fetchAll({ fetchJson }) {
  const json = await fetchJson(ENDPOINT);
  return transform(json);
}
