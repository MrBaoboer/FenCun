// 香水目录加载 + 中英文搜索（搜名秒加的引擎）
import MiniSearch from "minisearch";
import type { Perfume } from "./types";

let cache: Perfume[] | null = null;
let searchCache: MiniSearch<Perfume> | null = null;

// 自定义分词：拉丁词整体小写，CJK 拆成单字，使中文也可检索
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const re = /[a-zA-Z0-9]+|[一-鿿]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) tokens.push(m[0].toLowerCase());
  return tokens;
}

export async function loadCatalog(): Promise<Perfume[]> {
  if (cache) return cache;
  const res = await fetch("/data/perfumes.min.json");
  if (!res.ok) throw new Error("香水目录加载失败");
  cache = (await res.json()) as Perfume[];
  return cache;
}

export function buildSearch(perfumes: Perfume[]): MiniSearch<Perfume> {
  if (searchCache) return searchCache;
  const ms = new MiniSearch<Perfume>({
    idField: "id",
    fields: ["nameZh", "aliasText", "name", "brand", "brandZh", "notesText"],
    storeFields: ["id"],
    tokenize,
    processTerm: (t) => t.toLowerCase(),
    searchOptions: {
      tokenize,
      processTerm: (t) => t.toLowerCase(),
      prefix: true,
      fuzzy: 0.15,
      boost: { nameZh: 4, aliasText: 4, name: 3, brandZh: 2, brand: 2 },
      combineWith: "OR",
    },
  });
  ms.addAll(
    perfumes.map((p) => ({
      ...p,
      nameZh: p.nameZh ?? "",
      aliasText: (p.aliases ?? []).join(" "),
      notesText: p.notesFlat.join(" "),
    })) as unknown as Perfume[]
  );
  searchCache = ms;
  return ms;
}

export function getById(perfumes: Perfume[], id: number): Perfume | undefined {
  return perfumes.find((p) => p.id === id);
}

// ===== 扩展目录（Top1500 之外的 3.6 万款，含国货白名单）=====
// 索引懒加载（gzip ~745KB，只在主目录搜不出来时才取），详情按 id%64 分片按需取（单片 gzip ≤95KB）。
// 这层兜底让"搜名秒加"对长尾香也成立——搜到英文原名，永远好过搜到一个错误的中文匹配。

export interface ExtIndexEntry {
  i: number; // perfume id
  n: string; // 英文名
  b: string; // 品牌原名
  z?: string; // 品牌中文（有才给）
  p: number; // 投票人数（排序用）
}

let extIndexPromise: Promise<MiniSearch<ExtIndexEntry> | null> | null = null;
const extShardCache = new Map<number, Perfume[]>();

export function loadExtSearch(): Promise<MiniSearch<ExtIndexEntry> | null> {
  if (!extIndexPromise) {
    extIndexPromise = (async () => {
      try {
        const res = await fetch("/data/ext-index.json");
        if (!res.ok) throw new Error("ext index failed");
        const entries = (await res.json()) as ExtIndexEntry[];
        const ms = new MiniSearch<ExtIndexEntry>({
          idField: "i",
          fields: ["n", "b", "z"],
          storeFields: ["i", "n", "b", "z", "p"],
          tokenize,
          processTerm: (t) => t.toLowerCase(),
          searchOptions: {
            tokenize,
            processTerm: (t) => t.toLowerCase(),
            prefix: true,
            fuzzy: 0.15,
            boost: { n: 3, z: 2, b: 2 },
            combineWith: "OR",
          },
        });
        ms.addAll(entries);
        return ms;
      } catch {
        extIndexPromise = null; // 失败允许下次重试
        return null;
      }
    })();
  }
  return extIndexPromise;
}

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
