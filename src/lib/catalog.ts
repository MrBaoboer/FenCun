// 目录与分片的取数层。**刻意不 import MiniSearch**。
//
// 这两个函数原本和搜索住在同一个模块（lib/perfumes.ts），而 AppProvider 只需要
// loadCatalog——AppProvider 在根 layout 里，于是 MiniSearch 跟着上到了全部四页，
// 而只有 /library 的搜索框会用到它。今日 / 香历 / 我的三页各白背约 6KB gzip。
// 按依赖拆开比把 import 改成动态更干净：调用方一个字都不用改，也不会把
// buildSearch 的同步签名逼成异步。
import type { Perfume } from "./types";

let cache: Perfume[] | null = null;

export async function loadCatalog(): Promise<Perfume[]> {
  if (cache) return cache;
  const res = await fetch("/data/perfumes.min.json");
  if (!res.ok) throw new Error("香水目录加载失败");
  cache = (await res.json()) as Perfume[];
  return cache;
}

// 扩展集详情按 id % 64 分片，取过的整片留在内存里（一片约 580KB raw，取一次够用很久）
const extShardCache = new Map<number, Perfume[]>();

export async function fetchExtPerfume(id: number): Promise<Perfume | null> {
  const shardNo = ((id % 64) + 64) % 64;
  let shard = extShardCache.get(shardNo) ?? null;
  if (!shard) {
    try {
      const res = await fetch(`/data/ext/${String(shardNo).padStart(2, "0")}.json`);
      if (!res.ok) return null;
      shard = (await res.json()) as Perfume[];
      extShardCache.set(shardNo, shard);
    } catch {
      return null;
    }
  }
  return shard.find((p) => p.id === id) ?? null;
}
