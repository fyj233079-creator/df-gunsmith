// 数据源：手工/社区录入（自己团队维护的码、主播同款等）
// 编辑 data/manual.json 即可，格式见 data/manual.example.json；文件变化后下一轮采集自动生效。
import { readFile } from 'node:fs/promises';
import { guessMode, parsePrefixed, parseWan } from '../normalize.js';

export const id = 'manual';
export const label = '手工录入';
export const homepage = '';

export function transform(list) {
  return (list || []).filter(r => r?.code).map(r => {
    const pre = parsePrefixed(r.code);
    return {
      source: id,
      code: String(r.code).trim(),
      weapon: r.weapon || pre?.weapon || '',
      category: r.category || '',
      mode: r.mode || pre?.mode || guessMode(r.desc),
      price: typeof r.price === 'number' ? r.price : parseWan(r.price),
      title: r.title || '', desc: r.desc || '', author: r.author || '',
      image: r.image || '', url: r.url || '',
    };
  });
}

export async function fetchAll({ config }) {
  try {
    return transform(JSON.parse(await readFile(config.manualFile, 'utf8')));
  } catch (e) {
    if (e.code === 'ENOENT') throw Object.assign(new Error('无 manual.json，跳过'), { skip: true });
    throw e;
  }
}
