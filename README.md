# DF Gunsmith · 三角洲改枪码实时库

不开通任何付费服务也能用：默认免费源（aitags 全站 + 主播同款）合计约 580 条。

把多个改枪码站点的数据**自动采集 → 去重合并 → 实时推送**到一个页面，一键复制改枪码。
零依赖（只需 Node.js 18+），自带前端，可 Docker / 服务器 / GitHub Pages 部署。

## 数据源

| 数据源 | 接口 | 费用 | 内容 | 默认刷新 |
|---|---|---|---|---|
| 改枪码大全 g.aitags.cn | `GET https://g.aitags.cn/wp-json/weaponmod/v1/modcodes`（公开 REST，免鉴权） | 免费 | 约 67 把枪 / 450+ 条，烽火 + 全面战场，含复制数、点赞、造价、配装图 | 10 分钟 |
| 改枪码大全 · 主播同款 | 主播列表 `GET /wp-json/wp/v2/streamer_weapon`（公开 REST）+ 各主播页面表格解析 | 免费 | 14 位主播约 150 条（老飞宇、杨齐家、林树、昊天、白泽、南波万等），带主播名、造价、配装图；只在主播页更新时才重抓 | 30 分钟 |
| 数据帝/小涛查 orzice.com | 官方开放平台 `https://orzice.com/workApi/v1/sjz_api/gun_gqm_v2`（需 token） | 付费，每页扣 1 次资源 | 800+ 条，**作者、实时市场造价、属性数值**；可选黑潮爆破 | 60 分钟 |
| 手工录入 | `data/manual.json` | — | 战队/主播自录方案 | 1 分钟 |

> 关于 orzice：它网页上用的接口是加密 + 签名的，本项目**不做破解**，只对接其官方开放平台。
> 开通：<https://orzice.com/work/> → 控制台 → 开通「改枪码V2 - 烽火/大战场」→ 拿 token 填到 `.env`。文档：<https://work-api.apifox.cn/>。
> 官方要求 token 只在服务端使用并做缓存，本项目已满足（token 不会出现在前端）。

> 关于 playdeltaforce.com（三角洲总部工具站）：是**国际服**官方站，接口 `ListGunCodeSchemes` 每次请求带签名，且国际服与国服改枪码不通用，所以没有接入。

同一条改枪码在多个源出现时会合并成一条：优先用带「武器-模式-」前缀的完整码、实时造价优先、复制/使用量相加，并保留每个来源的链接。

## 快速开始

```bash
cp .env.example .env        # 按需填 ORZICE_TOKEN
node src/server.js          # 或 npm start
# 打开 http://localhost:8080
```

Docker：

```bash
docker build -t df-gunsmith .
docker run -d -p 8080:8080 --env-file .env \
  -v $PWD/store/public-data:/app/public/data -v $PWD/store/data:/app/data \
  --restart unless-stopped df-gunsmith
```

> 注意：服务器需要能访问 `g.aitags.cn` 和 `orzice.com`（国内/香港/日本节点均可）。

### 无服务器方案：GitHub Actions + Pages

1. 把本项目推到 GitHub 仓库（main 分支）
2. Settings → Pages → Source 选 **GitHub Actions**
3. （可选）Settings → Secrets → Actions 添加 `ORZICE_TOKEN`
4. Actions 每 10 分钟自动采集并发布；前端会每 5 分钟自动拉新数据

这种模式没有 SSE 推送（页面顶部显示「定时刷新」），其余功能一致。

## “实时”是怎么做到的

- 服务端调度器每 30 秒检查一次，各数据源按自己的间隔拉取；失败 2 分钟后重试
- 某个源挂了或返回 0 条时，**保留它上一轮的数据**，不会把码误判成下架
- 每轮对比新旧数据，产出 新增 / 下架 / 变动 事件，写入 `public/data/changes.json`
- 浏览器通过 SSE（`/api/stream`）长连接，有新码时立即推送：页面自动刷新、新卡片高亮、“动态”角标 +N
- 进程重启后从磁盘恢复，`firstSeen`（首次收录时间）不会丢

## API

所有接口均允许跨域（CORS `*`），方便你在其他项目（小程序、机器人、官网）里直接调用。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/codes` | 改枪码列表。参数：`mode`（烽火地带/全面战场/黑潮爆破）、`category`、`weapon`、`author`、`source`、`q`、`min`/`max`（万）、`sort`（hot/new/updated/price_asc/price_desc）、`limit`、`offset` |
| GET | `/api/weapons` | 武器列表及各模式方案数 |
| GET | `/api/meta` | 更新时间、各数据源状态、统计 |
| GET | `/api/changes?since=ISO时间` | 变更记录 |
| GET | `/api/stream` | SSE：`update`（有变化，含事件列表）、`tick`（无变化的心跳） |
| POST | `/api/refresh` | 立即全量采集，需 `Authorization: Bearer <ADMIN_TOKEN>` |
| GET | `/data/codes.json` | 全量快照（静态文件） |

单条记录：

```json
{
  "key": "烽火地带|6G94D100FHI6PKF6C3P0U",
  "code": "PKM通用机枪-烽火地带-6G94D100FHI6PKF6C3P0U",
  "weapon": "PKM通用机枪", "category": "轻机枪", "mode": "烽火地带",
  "price": 23.1, "priceLive": true,
  "title": "猛攻PKM", "desc": "低成本猛攻", "author": "昊天",
  "copies": 20137, "likes": 101, "hot": 22157,
  "stats": [{ "name": "后坐力控制", "value": 66, "change": "+5" }],
  "sources": [{ "id": "aitags", "url": "https://g.aitags.cn/weapons/pkm" }, { "id": "orzice", "url": "…" }],
  "firstSeen": "…", "updatedAt": "…"
}
```

## 加新数据源

在 `src/sources/` 新建一个文件，导出 `id`、`label`、`homepage` 和 `fetchAll({ fetchJson, config })`（返回 RawItem 数组，字段见 `src/normalize.js` 顶部注释），然后加到 `src/collector.js` 的 `SOURCES` 里，并在 `config.js` 的 `intervals` 设置刷新间隔。

## 测试

```bash
npm test     # 归一化、跨源合并、变更检测、失败容错、重启恢复
```

## 说明

- 改枪码版权归原作者与原站点所有，页面上每条都标注并链接了来源；对外运营前建议与数据源站长沟通授权（orzice 开放平台本身就是授权渠道）。
- aitags 采集频率默认 10 分钟一次（单次请求约 100KB），请勿调得过低。
- 游戏版本更新后旧码可能失效或配件被替换，以游戏内导入结果为准。

字体：页面使用 [Rajdhani](https://fonts.google.com/specimen/Rajdhani)（SIL Open Font License），已放在 `public/fonts/` 本地加载，国内访问无需 Google Fonts。
