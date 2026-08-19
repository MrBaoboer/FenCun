// SPDX-FileCopyrightText: 2026 MrBaoboer
// SPDX-License-Identifier: AGPL-3.0-only
// Additional terms under AGPL-3.0 §7 — see LICENSE.

// 简易内存限流（每个 serverless 实例内，无需外部依赖）
// 用途：挡住单客户端狂刷 / 直接 curl 滥用，保护 DeepSeek 与和风额度。
// 局限：Vercel 多实例时为"每实例"限流、非全局；若要强一致改用 Upstash Redis 等。

const buckets = new Map<string, number[]>();

export function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    buckets.set(key, arr);
    return false;
  }
  arr.push(now);
  buckets.set(key, arr);
  // 偶发清理，防 Map 无限增长
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (v.length === 0 || now - v[v.length - 1] > windowMs) buckets.delete(k);
    }
  }
  return true;
}

// 全局日闸门：上面的 allow() 是「每客户端」的，挡得住单机狂刷，挡不住换 IP 的分布式刷量——
// 而 LLM 路由的每一次调用都是真金白银。这道闸门按「每实例每天」封顶总调用数，触顶后全部走模板：
// 宁可解释降级成规则模板，也不让账单在一夜之间失控。
//
// 诚实说明它的局限（与 allow() 同源）：Vercel 多实例时这是「每实例」上限，不是全局上限，
// 实例越多总量越高。它是纵深防御的一层，不是硬保险。**真正的硬保险是在 DeepSeek 控制台
// 给账户设消费上限**——那一层在我们的代码之外，任何实例数都绕不过去。
// 环境变量用裸 Number() 解析会有两个静默方向：留空得 0（全站永久降级）、
// 写错格式得 NaN（`dayCount >= NaN` 恒为 false，闸门被彻底关掉）。
// 两种都不会有人发现，所以在这里收口：取不到有效正整数就用默认值，并说一声。
export function capFrom(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.warn(`[ratelimit] ${name}="${raw}" 不是有效的正整数，回退到默认值 ${fallback}`);
    return fallback;
  }
  return Math.floor(n);
}

/**
 * 「每实例每天最多打多少次上游」的闸门工厂。
 *
 * 抽成工厂而不是一个全局计数器，是因为两类上游的额度是分开的：
 * DeepSeek 按 token 计费，和风按调用次数计配额，一方触顶不该把另一方也拖下水。
 */
function makeDailyGate(envName: string, fallback: number): () => boolean {
  const cap = capFrom(envName, fallback);
  let dayKey = "";
  let count = 0;
  return () => {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== dayKey) {
      dayKey = today;
      count = 0;
    }
    if (count >= cap) return false;
    count++;
    return true;
  };
}

export const withinDailyBudget = makeDailyGate("LLM_DAILY_CAP", 3000);

/**
 * 天气这条路此前**没有**日闸门——三条代理付费上游的路由里，只有它漏了。
 *
 * 它还是最容易被放大的一条：坐标按 0.01 步进就能保证每次都 miss 网格缓存，
 * 而一次 miss 要打两次和风（反查城市名 + 取实况）。单客户端 20 次/60 秒的口径，
 * 折算下来是每分钟 40 次上游调用，且没有任何一天的封顶。
 * 额度耗尽之后全站天气退化成 weather_unavailable——实时天气是这个产品的核心输入。
 *
 * 与 LLM 那道一样，诚实说明它的局限：Vercel 多实例时这是「每实例」上限，不是全局上限。
 * 它是纵深防御的一层，真正的硬保险是在和风控制台给账户设配额告警与上限。
 *
 * 默认值从 5000 下调到 800，卡的是两条真实存在的线：
 * · **免费额度**：和风给 5 万次/月，而天气与 GeoAPI 属同一个价格组、共用这 5 万次，
 *   摊到每天约 1600 次。5000/天/实例意味着不到十天烧穿全月额度，之后按 0.0007 元/次计费。
 * · **帐号级硬顶**：用 API KEY 认证时，和风自 2027-01-01 起限制 1000 次/天——注意那是
 *   帐号级、不是每实例，超限返回 403/429，持续超限会封 IP 或冻结帐号。
 *   （改用 JWT 认证不受这条限制，但那是另一件事，届时把这个默认值调回去即可。）
 * 多实例会把这个数叠加，所以还要留余量：800 是「同时跑两个实例也不撞 1000」的取值。
 */
export const withinWeatherBudget = makeDailyGate("WEATHER_DAILY_CAP", 800);

/**
 * 这个 POST 是不是本站页面发来的。
 *
 * 两条付费上游此前完全不看来源，而 `Content-Type: text/plain` 让 POST 成为 CORS
 * **简单请求**——不触发预检，任意第三方网页都能从每个访客的浏览器里静默发起调用。
 * 限流键是访客自己的 IP，所以挂了脚本的页面有 N 个访客就等于 N 份合法额度；
 * 剩下的日闸门又是每实例的，流量越大实例越多、总额度越高，方向也是反的。
 *
 * 两道一起用，各挡一半：
 * · Content-Type 必须是 JSON —— 跨源想带这个头就必须过预检，而我们不发任何 CORS 头，
 *   预检直接被浏览器判死。这一条不依赖任何请求头的可信度，是真正的闸。
 * · Sec-Fetch-Site 存在时必须是 same-origin —— 它由浏览器写、页面脚本改不了。
 *   不存在时（curl、老浏览器、服务端互调）不拦：那不是这条防线要解决的问题，
 *   而且拦了会顺手把自托管者的健康检查也拦掉。
 *
 * 注意这不是"防刷"的全部，只是把「一个网页就能做到」退回到「得自己准备 IP」。
 */
export function fromOwnPage(req: Request): boolean {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().includes("application/json")) return false;
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  return true;
}

// 客户端标识（IP）的信任模型：
// - Vercel 部署（默认场景）：平台会覆写 x-forwarded-for / x-real-ip / x-vercel-forwarded-for，
//   客户端伪造的同名请求头会被丢弃，直接读是安全的。
// - AGPL 自托管注意：若部署在 append 型反向代理（nginx 默认 proxy_add_x_forwarded_for 等）后面，
//   x-forwarded-for 的首元素来自客户端、可任意伪造，攻击者每次换首元素即可绕过限流。
//   自托管时应在最外层入口代理上覆写（而非追加）x-real-ip / x-forwarded-for，
//   或改用可信跳数解析（从右往左数固定跳数取 IP）。
// 这里优先读 Vercel 平台头，再回退 x-real-ip，最后才用 xff 首元素兜底。
export function clientKey(req: Request): string {
  return (
    req.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    "anon"
  );
}
