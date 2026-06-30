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
