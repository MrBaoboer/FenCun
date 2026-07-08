// 搜索端到端回归（真实构建产物）：主目录 + 扩展集合并重排后，
// 国货与长尾必须出现在榜单头部——「观夏搜不到」「闻献被折叠到看不见」两个真实事故的守门员。
// 依赖 public/data/（构建产物已入库），构建 3.6 万条索引约 1–2 秒，可接受。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import MiniSearch from "minisearch";
import { rankSearchHits, type RankCandidate, type ExtIndexEntry } from "./perfumes";
import type { Perfume } from "./types";

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const re = /[a-zA-Z0-9]+|[一-鿿]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) tokens.push(m[0].toLowerCase());
  return tokens;
}

// 与 src/lib/perfumes.ts buildSearch / loadExtSearch 相同的索引配置（此处独立构建以脱离 fetch）
function buildIndexes() {
  const catalog = JSON.parse(fs.readFileSync("public/data/perfumes.min.json", "utf8")) as Perfume[];
  const main = new MiniSearch({
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
  main.addAll(
    catalog.map((p) => ({
      ...p,
      nameZh: p.nameZh ?? "",
      aliasText: (p.aliases ?? []).join(" "),
      notesText: p.notesFlat.join(" "),
    })) as unknown as Perfume[]
  );
  const ext = JSON.parse(fs.readFileSync("public/data/ext-index.json", "utf8")) as ExtIndexEntry[];
  const extMs = new MiniSearch<ExtIndexEntry>({
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
  extMs.addAll(ext);
  const byId = new Map(catalog.map((p) => [p.id, p]));
  return { main, extMs, byId };
}

// 复刻 SearchAdd 的合并逻辑（候选规模与字段拼串保持一致）
function searchMerged(idx: ReturnType<typeof buildIndexes>, query: string): { label: string; source: string }[] {
  const mainCands: RankCandidate<{ label: string; source: string }>[] = idx.main
    .search(query)
    .slice(0, 12)
    .map((h) => idx.byId.get(h.id as number)!)
    .filter(Boolean)
    .map((p) => ({
      item: { label: p.nameZh || p.name, source: "main" },
      nameHay: `${p.nameZh ?? ""} ${(p.aliases ?? []).join(" ")} ${p.name}`,
      fullHay: `${p.nameZh ?? ""} ${(p.aliases ?? []).join(" ")} ${p.name} ${p.brandZh} ${p.brand}`,
      people: p.people,
    }));
  const mainIds = new Set(idx.main.search(query).slice(0, 12).map((h) => h.id as number));
  const extCands: RankCandidate<{ label: string; source: string }>[] = (
    idx.extMs.search(query).slice(0, 50) as unknown as ExtIndexEntry[]
  )
    .filter((e) => !mainIds.has(e.i))
    .map((e) => ({
      item: { label: `${e.n} / ${e.z || e.b}`, source: "ext" },
      nameHay: e.n,
      fullHay: `${e.n} ${e.b} ${e.z ?? ""}`,
      people: e.p,
    }));
  return rankSearchHits(query, [...mainCands, ...extCands]);
}

test("E2E 真实数据：国货与长尾在统一榜单头部，主流版本优先", () => {
  const idx = buildIndexes();

  // 观夏：品牌命中必须占据榜首（此前被 7 条单字垃圾命中压到看不见）
  const gx = searchMerged(idx, "观夏");
  assert.ok(gx.length > 0, "观夏应有结果");
  assert.ok(gx[0].label.includes("观夏"), `观夏榜首应为观夏产品，实际：${gx[0].label}`);
  assert.ok(
    gx.slice(0, 3).every((r) => r.label.includes("观夏")),
    `观夏前三应全部相关：${gx.slice(0, 3).map((r) => r.label).join(" | ")}`
  );

  // 闻献：同为国货白名单（此前被折叠进「更多结果」区隔）
  const wx = searchMerged(idx, "闻献");
  assert.ok(wx[0].label.includes("闻献"), `闻献榜首应为闻献产品，实际：${wx[0].label}`);

  // 昆仑煮雪：名称直接命中 → 榜首
  const kl = searchMerged(idx, "昆仑煮雪");
  assert.ok(kl[0].label.includes("昆仑煮雪"), `昆仑煮雪榜首错误：${kl[0].label}`);

  // 大地：主流版本（爱马仕大地主线）优先于各种衍生版本
  const dd = searchMerged(idx, "大地");
  assert.ok(dd[0].label.includes("大地"), `大地榜首错误：${dd[0].label}`);
  assert.equal(dd[0].source, "main", "大地主线来自主目录（最主流版本）");

  // 蓝风铃：主目录经典款不受合并影响
  const bell = searchMerged(idx, "蓝风铃");
  assert.ok(bell[0].label.includes("蓝风铃"), `蓝风铃榜首错误：${bell[0].label}`);
});
