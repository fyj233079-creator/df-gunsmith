// 数据源：三角洲数据帝 / 小涛查 开放平台（orzice.com）
// 官方付费 API，需要在 https://orzice.com/work/ 开通「改枪码V2」并获取 token。
// 文档：https://work-api.apifox.cn/  （改枪码V2 - 烽火/大战场、改枪码 - 黑潮爆破）
// 注意：每页请求扣 1 次资源（黑潮 2 次），官方要求服务端调用并做好缓存。
import { MODES, coinsToWan, parsePrefixed } from '../normalize.js';

export const id = 'orzice';
export const label = '数据帝/小涛查 (orzice)';
export const homepage = 'https://orzice.com/v/gun_gqm';
const BASE = 'https://orzice.com/workApi/v1/sjz_api';

function stats(arr) {
  return (arr || []).map(p => ({ name: p.name, value: Number(p.value) || 0, change: p.change ?? '' }));
}

/** gun_gqm_v2 单页 data → RawItem[] */
export function transformV2(list, solutionType) {
  const mode = solutionType === 'operator' ? MODES.QM : MODES.FH;
  return (list || []).filter(r => r?.solutionCode).map(r => {
    const pre = parsePrefixed(r.solutionCode);
    return {
      source: id,
      code: String(r.solutionCode).trim(),
      weapon: r.objectName || pre?.weapon || '',
      category: r.m_type || '',
      mode: pre?.mode || mode,
      price: coinsToWan(r.price),
      priceLive: true,
      title: (r.name || '').trim(),
      desc: (r.authorComment || '').trim(),
      author: (r.authorNickname || '').trim(),
      copies: Number(r.applyNum) || 0,
      likes: Number(r.likeNum) || 0,
      image: r.pic || '',
      stats: stats(r.properties_data),
      url: homepage,
    };
  });
}

/** bd_gqm（黑潮爆破）单页 data.list → RawItem[] */
export function transformBD(list) {
  return (list || []).filter(r => r?.solutionCode).map(r => ({
    source: id,
    code: String(r.solutionCode).trim(),
    weapon: r.objectName || '',
    category: r.m_type || '',
    mode: MODES.HC,
    price: coinsToWan(r.price),
    priceLive: true,
    title: (r.name || '').trim(),
    desc: r.parentName ? `干员：${r.parentName}` : '',
    copies: 0, likes: 0,
    image: r.pic || '',
    stats: stats(r.properties_data),
    url: 'https://orzice.com/v/bd_gqm',
  }));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function fetchAll({ fetchJson, config, log }) {
  const token = config.orziceToken;
  if (!token) throw Object.assign(new Error('未配置 ORZICE_TOKEN，跳过'), { skip: true });
  const q = o => new URLSearchParams({ ...o, token }).toString();
  const items = [];
  const maxPages = config.orziceMaxPages;

  for (const solutionType of ['gun', 'operator']) {
    let total = Infinity, got = 0;
    for (let p = 1; p <= maxPages && got < total; p++) {
      const res = await fetchJson(`${BASE}/gun_gqm_v2?${q({ key1: '全部', key2: '全部', p, top: 0, top2: 0, n: '', solutionType, limit: 50 })}`);
      if (res.code !== 0) throw new Error(`orzice gun_gqm_v2(${solutionType}) 返回错误：${res.msg || res.message || res.code}`);
      const page = Array.isArray(res.data) ? res.data : [];
      if (!page.length) break;
      total = Number(res.count) || total;
      got += page.length;
      items.push(...transformV2(page, solutionType));
      await sleep(config.orziceDelayMs);
    }
    log?.(`orzice ${solutionType}: ${got}/${total === Infinity ? '?' : total}`);
  }

  if (config.orziceBlackTide) {
    for (const group of [1, 2, 3, 4]) {
      for (let page = 1; page <= maxPages; page++) {
        const res = await fetchJson(`${BASE}/bd_gqm?${q({ group, page })}`);
        if (res.code !== 0) throw new Error(`orzice bd_gqm 返回错误：${res.msg || res.message || res.code}`);
        const d = res.data || {};
        items.push(...transformBD(d.list));
        if (!d.list?.length || page >= (d.total_pages || 1)) break;
        await sleep(config.orziceDelayMs);
      }
    }
  }
  return items;
}
