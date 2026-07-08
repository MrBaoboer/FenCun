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
