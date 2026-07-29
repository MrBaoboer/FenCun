// 中英文搜索（搜名秒加的引擎）。
// 目录与分片的取数在 lib/catalog.ts —— 拆开是为了让 MiniSearch 只进用得上它的那一页，
// 见那个文件的说明。
import MiniSearch from "minisearch";
import type { Perfume } from "./types";

let searchCache: MiniSearch<Perfume> | null = null;

// 自定义分词：拉丁词整体小写，CJK 拆成单字，使中文也可检索
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const re = /[a-zA-Z0-9]+|[一-鿿]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) tokens.push(m[0].toLowerCase());
  return tokens;
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

// ===== 扩展目录（Top1500 之外的 3.6 万款，含国货白名单）=====
// 索引在首次搜索时懒加载一次（gzip ~748KB，此后走内存），详情按 id%64 分片按需取（单片 gzip ≤95KB）。
// 扩展候选与主目录候选合并成一张榜单（见 rankSearchHits），让"搜名秒加"对长尾香也成立——
// 搜到英文原名，永远好过搜到一个错误的中文匹配。

export interface ExtIndexEntry {
  i: number; // perfume id
  n: string; // 英文名
  b: string; // 品牌原名
  z?: string; // 品牌中文（有才给）
  p: number; // 投票人数（排序用）
}

let extIndexPromise: Promise<MiniSearch<ExtIndexEntry> | null> | null = null;
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
        // addAllAsync 而不是 addAll：3.6 万条同步建索引实测独占主线程约 0.5 秒，
        // 而它恰好发生在搜索框获得焦点的那一刻——「搜名秒加」这条冷启动承诺的入口上，
        // 用户此时正准备打字，输入却半秒没有反应。
        // addAllAsync 分片让出事件循环，总耗时相当，但每一片之间都能响应输入。
        await ms.addAllAsync(entries, { chunkSize: 1000 });
        return ms;
      } catch {
        extIndexPromise = null; // 失败允许下次重试
        return null;
      }
    })();
  }
  return extIndexPromise;
}

// ===== 统一排序：主目录与扩展集合并成一张榜单（纯函数，可单测）=====
// 两次教训沉淀于此：
// ① 「观夏」搜不到——主目录 OR+fuzzy 用无关单字命中凑数，"主目录不足才兜底"的触发条件永远不成立；
// ② 「闻献」被折叠——把扩展集放进「更多结果」区隔，用户会以为上面没有匹配、根本注意不到底部。
// 因此：两个索引的候选**合并重排、不分区**。排序原则（产品定案）：
// - 文本匹配档位优先：查询整体命中名称(3) > 命中名称+品牌(2) > 仅模糊命中(1)——
//   高度匹配的结果必须靠前，不许被别的信号淹没；
// - 同档位内按投票人数（主流度）：同名多版本时，更常用、更主流的版本在前。
export interface RankCandidate<T> {
  item: T;
  nameHay: string; // 名称类字段拼串（中文名/别名/英文名）
  fullHay: string; // 名称 + 品牌全串
  people: number; // 社区投票人数（跨索引可比的主流度信号）
}

export function rankSearchHits<T>(query: string, cands: RankCandidate<T>[], limit = 9): T[] {
  const segs = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (segs.length === 0) return [];
  const joined = segs.join("");
  const tierOf = (c: RankCandidate<T>): number => {
    const nameHay = c.nameHay.toLowerCase();
    if (segs.every((s) => nameHay.includes(s)) || nameHay.includes(joined)) return 3;
    const fullHay = c.fullHay.toLowerCase();
    if (segs.every((s) => fullHay.includes(s)) || fullHay.includes(joined)) return 2;
    return 1;
  };
  return cands
    .map((c) => ({ c, tier: tierOf(c) }))
    .sort((a, b) => b.tier - a.tier || b.c.people - a.c.people)
    .slice(0, limit)
    .map((x) => x.c.item);
}

