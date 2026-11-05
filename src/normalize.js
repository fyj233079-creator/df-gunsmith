// 统一数据结构 + 跨数据源归一化（纯函数，无 IO，可在浏览器/Node 中运行）

export const MODES = { FH: '烽火地带', QM: '全面战场', HC: '黑潮爆破' };

export const CATEGORIES = ['步枪', '冲锋枪', '精确射手步枪', '狙击步枪', '轻机枪', '霰弹枪', '手枪', '特殊武器'];

// 武器名称后缀（按长度降序，先匹配长的）
const WEAPON_SUFFIXES = [
  '精确射手步枪', '精準射手步槍', '紧凑突击步枪', '通用机枪', '突击步枪', '战斗步枪', '射手步枪', '狙击步枪',
  '杠杆步枪', '冲锋枪', '轻机枪', '霰弹枪', '手枪', '步枪', '机枪',
];

/** 武器归一化 key：用于跨站合并同一把枪（"PKM通用机枪" 与 "PKM" → "PKM"） */
export function weaponKey(name = '') {
  let s = String(name).trim().replace(/\s+/g, '');
  for (const suf of WEAPON_SUFFIXES) {
    if (s.length > suf.length && s.endsWith(suf)) { s = s.slice(0, -suf.length); break; }
  }
  return s.replace(/[-_.·・]/g, '').toUpperCase();
}

/** 从任意改枪码字符串中提取核心码（最后一段 18-24 位大写字母数字） */
export function extractCore(code = '') {
  const m = String(code).trim().toUpperCase().match(/([0-9A-Z]{18,24})\s*$/);
  return m ? m[1] : null;
}

/** 从带前缀的改枪码中解析 "武器-模式-码" */
export function parsePrefixed(code = '') {
  const parts = String(code).trim().split('-');
  if (parts.length < 3) return null;
  const core = parts.pop();
  const mode = parts.pop();
  if (!Object.values(MODES).includes(mode)) return null;
  return { weapon: parts.join('-'), mode, core: core.toUpperCase() };
}

/** "24W" / "24w" / "24万" / "1.5W" → 24（单位：万）；无法解析返回 null */
export function parseWan(v) {
  if (v == null) return null;
  const m = String(v).replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*[wW万]/);
  return m ? Number(m[1]) : null;
}

/** 游戏币原值 → 万（保留 1 位小数） */
export function coinsToWan(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return null;
  return Math.round(x / 1000) / 10;
}

/** 从武器全名推断分类（如 "QCQ171冲锋枪" → 冲锋枪）；推不出返回 '' */
export function guessCategory(name = '') {
  const s = String(name);
  if (/精确射手步枪|射手步枪/.test(s)) return '精确射手步枪';
  if (/狙击步枪/.test(s)) return '狙击步枪';
  if (/突击步枪|战斗步枪|杠杆步枪/.test(s)) return '步枪';
  if (/冲锋枪/.test(s)) return '冲锋枪';
  if (/轻机枪|通用机枪/.test(s)) return '轻机枪';
  if (/霰弹枪/.test(s)) return '霰弹枪';
  if (/手枪|左轮|沙漠之鹰/.test(s)) return '手枪';
  if (/弓/.test(s)) return '特殊武器';
  return '';
}

export function guessMode(...hints) {
  const s = hints.filter(Boolean).join(' ');
  if (/全面战场|全面戰場|大战场|operator/i.test(s)) return MODES.QM;
  if (/黑潮/.test(s)) return MODES.HC;
  return MODES.FH;
}

/**
 * 统一记录结构（单个数据源产出的原始条目）
 * @typedef {Object} RawItem
 * @property {string} source       数据源 id
 * @property {string} code         原始改枪码（复制用）
 * @property {string} weapon       武器名
 * @property {string} [category]   武器分类
 * @property {string} mode         烽火地带 / 全面战场 / 黑潮爆破
 * @property {number|null} price   造价（万）
 * @property {boolean} [priceLive] 是否为实时市场价
 * @property {string} [title]      方案名
 * @property {string} [desc]       描述
 * @property {string} [author]
 * @property {number} [copies]     复制/使用次数
 * @property {number} [likes]
 * @property {string} [image]
 * @property {Array<{name:string,value:number,change:string}>} [stats]
 * @property {string} [url]        来源页面
 */

/** 记录的合并 key：模式 + 核心码（同一码在不同模式理论上不会冲突，加模式更稳） */
export function itemKey(mode, core) { return `${mode}|${core}`; }

/**
 * 把多个数据源的 RawItem 合并成去重后的统一列表
 * @param {RawItem[]} raws
 * @param {Map<string,object>} [prev] 上一轮结果（key → item），用于保留 firstSeen
 * @param {string} now ISO 时间
 */
export function mergeItems(raws, prev = new Map(), now = new Date().toISOString()) {
  const out = new Map();
  for (const r of raws) {
    const core = extractCore(r.code);
    if (!core) continue;
    const key = itemKey(r.mode, core);
    let it = out.get(key);
    if (!it) {
      const old = prev.get(key);
      it = {
        key, core, mode: r.mode,
        code: r.code, weapon: r.weapon, weaponKey: weaponKey(r.weapon), category: r.category || '',
        price: null, priceLive: false,
        title: '', desc: '', author: '',
        copies: 0, likes: 0, image: '', stats: [],
        sources: [],
        firstSeen: old?.firstSeen || now,
        updatedAt: old?.updatedAt || now,
      };
      out.set(key, it);
    }
    // 复制用码：优先带 "武器-模式-" 前缀的完整码（游戏内导入更稳）
    if (!parsePrefixed(it.code) && parsePrefixed(r.code)) it.code = r.code;
    // 武器名：取更长（更完整）的那个，如 "PKM通用机枪" 优于 "PKM"
    if ((r.weapon || '').length > (it.weapon || '').length) it.weapon = r.weapon;
    if (!it.category && r.category) it.category = r.category;
    // 价格：实时价优先
    if (r.price != null && (it.price == null || (r.priceLive && !it.priceLive))) {
      it.price = r.price; it.priceLive = !!r.priceLive;
    }
    if (!it.title && r.title) it.title = r.title;
    if (r.desc && r.desc.length > it.desc.length) it.desc = r.desc;
    if (!it.author && r.author) it.author = r.author;
    it.copies += r.copies || 0;
    it.likes += r.likes || 0;
    if (!it.image && r.image) it.image = r.image;
    if (r.stats?.length && !it.stats.length) it.stats = r.stats;
    it.sources.push({ id: r.source, url: r.url || '', copies: r.copies || 0, likes: r.likes || 0 });
  }
  // 热度：复制/使用量 + 点赞加权
  for (const it of out.values()) it.hot = it.copies + it.likes * 20;
  return out;
}

const WATCH_FIELDS = ['code', 'price', 'title', 'desc', 'author', 'image'];

/** 对比两轮结果，产出变更事件；同时给有变化的条目刷新 updatedAt */
export function diffItems(prev, next, now = new Date().toISOString()) {
  const added = [], removed = [], updated = [];
  for (const [k, it] of next) {
    const old = prev.get(k);
    if (!old) { it.updatedAt = now; added.push(it); continue; }
    const changed = WATCH_FIELDS.filter(f => (old[f] ?? null) !== (it[f] ?? null));
    if (changed.length) { it.updatedAt = now; updated.push({ item: it, changed, before: Object.fromEntries(changed.map(f => [f, old[f]])) }); }
  }
  for (const [k, old] of prev) if (!next.has(k)) removed.push(old);
  return { added, removed, updated };
}
