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

export function clientKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  return (xff ? xff.split(",")[0].trim() : req.headers.get("x-real-ip")) || "anon";
}
