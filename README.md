# 氛寸 Fēn Cùn

> 别人帮你**挑**香水，氛寸帮你**用好**香水。
>
> 基于实时天气、体感与场合，从你已有的香水里告诉你——**今天该喷哪一瓶、喷多少、喷在哪、能维持多久，以及为什么。**

氛寸是一个**用香决策 Agent**：它不做导购、不做调香，只解决用户拥有香水之后、每天真实发生的那个问题——站在香柜前，今天用哪瓶、怎么用得恰到好处。

- **今天喷哪瓶** 是入口：你的香柜 × 当前情境 → 此刻最适合的一瓶（可一键换成任意一瓶）。
- **这瓶怎么用** 是灵魂：喷量档位 / 喷洒位置 / 社交距离 / 留香区间 / 风险提示，全程**不伪精确**（不给「留香 6.2 小时」这类无法验证的假数字）。

完整产品方案见 [`docs/氛寸-产品方案.md`](docs/氛寸-产品方案.md)。

## 它怎么工作

```
搜名秒加建香柜 → 和风天气自动感知此刻情境 → 规则引擎从你库里打分推一瓶
  → 不认同?一键换任意一瓶（用法即时重算）→ 拿到「分寸建议」
  → 出门 → 回来答「今天，刚好吗?」→ 个人偏移收敛，越用越懂你
```

**决策权在规则引擎，表达权在 LLM。** 匹配打分、喷量/距离/留香判定全部由确定性规则计算（可解释、可复现）；DeepSeek 只负责两件事——听懂自然语言场景、把规则算好的事实翻译成有温度的人话。天气永远来自和风天气 API，绝不让 LLM 编造。即便 DeepSeek 超时，规则引擎仍能给出推荐与模板用法，产品不白屏。

## 技术栈

- **Next.js 16（App Router）+ TypeScript** —— 一仓库承载前端与轻后端（Route Handlers 代理外部 API、保护 key）
- **Tailwind v4 + 设计 token** —— 宣纸暖白 / 墨绿 / 香槟金，Fraunces 衬线配英文与数字
- **规则引擎前端本地打分** —— 静态裁剪 JSON，浏览器毫秒完成，零延迟零成本
- **MiniSearch（中英文分词）** —— 搜名秒加
- **Zustand + localStorage** —— 香柜与反馈本地持久化（接口已抽象，可平滑换 Supabase）
- **DeepSeek API** —— 语义解析与自然语言解释
- **和风天气 QWeather API** —— 实时天气，服务端调用 + 30 分钟网格缓存
- 部署：**Vercel**

## 数据

香水数据来自 **ledecanteur**（Fragrantica 社区抓取），含真实社区投票：扩散 sillage(1–4)、留香 longevity(1–5)、四季 / 日夜投票、带强度香调、前中后调等。

- 原始 13.2 万款 → 按投票数 ≥50 筛得约 3.67 万款。
- MVP 精选**热度 Top 1500 款**，香调 / 品牌 / 气味词**100% 中文化**（原始数据为全英文）。
- 构建期由 `scripts/` 流式裁剪为静态 JSON（`public/data/perfumes.min.json`），原始数据不入仓库。

```bash
npm install
npm run extract:terms   # 从 ledecanteur 流式抽取精选子集与词表（需本地放置 ledecanteur/）
npm run build:data      # 应用中文映射 + 预计算 → public/data/perfumes.min.json
npm run dev             # http://localhost:3000
```

## 环境变量

复制为 `.env.local`（已被 git 忽略）：

```
QWEATHER_HOST=你的和风天气-API-HOST
QWEATHER_KEY=你的和风天气-KEY
DEEPSEEK_API_KEY=你的-DeepSeek-key
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

## 目录

```
src/
  app/                今日 / 香柜(library) / 我的(profile) 三个页面 + api 路由
    api/context       和风天气代理（保护 key + 缓存 + 降级）
    api/explain       DeepSeek 解释（只翻译规则事实，失败降级模板）
  components/          AppProvider / 导航 / 推荐卡 / 搜索添加 等
  lib/                types / scoring(打分) / usage(用法) / recommend(编排) / season / store
scripts/              数据构建管线（零依赖 Node）
data/zh-map/          英文→中文映射（accords / notes / brands）
docs/                 产品方案
```
