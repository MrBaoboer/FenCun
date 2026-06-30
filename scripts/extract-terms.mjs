// 氛寸 · 数据抽取（零依赖，可直接 node 运行）
// 两遍流式扫描 ledecanteur/perfumes.jsonl（~509MB）：
//   Pass1: 按 people>=50 过滤，收集 {id, popularity}
//   Pass2: 取热度 Top-N，落地精简子集 .scratch/_selected.json + 去重词表 .scratch/_terms.json
// 用途：_selected.json 给 build.mjs 消费；_terms.json 给中文映射（人工/子代理翻译）。
import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'ledecanteur', 'perfumes.jsonl');
const OUT_DIR = path.join(ROOT, '.scratch');
const N = Number(process.argv[2] || 1500);
const MIN_PEOPLE = 50;

if (!fs.existsSync(SRC)) {
  console.error(`找不到数据源: ${SRC}`);
  process.exit(1);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

async function* readLines(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) yield line;
}

function safeParse(line) {
  try { return JSON.parse(line); } catch { return null; }
}

// ---------- Pass 1: 收集合格记录的 {id, pop} ----------
console.time('pass1');
let total = 0, qualified = 0;
const cands = [];
for await (const line of readLines(SRC)) {
  total++;
  const d = safeParse(line);
  if (!d) continue;
  const people = d.people ?? 0;
  if (people >= MIN_PEOPLE) {
    qualified++;
    cands.push({ id: d.id, pop: d?.popularity?.magnitude ?? 0 });
  }
  if (total % 20000 === 0) process.stdout.write(`\r  扫描 ${total} 行…`);
}
process.stdout.write('\n');
console.timeEnd('pass1');
console.log(`总计 ${total} 行，people>=${MIN_PEOPLE} 合格 ${qualified} 款`);

cands.sort((a, b) => b.pop - a.pop);
const topIds = new Set(cands.slice(0, N).map((c) => c.id));
console.log(`取热度 Top ${topIds.size} 款进入精选子集`);

// ---------- Pass 2: 落地精简子集 + 词表 ----------
console.time('pass2');
const selected = [];
const accordSet = new Set();
const brandCount = new Map();
const noteCount = new Map();

function bump(map, key) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + 1);
}

for await (const line of readLines(SRC)) {
  const d = safeParse(line);
  if (!d || !topIds.has(d.id)) continue;

  // 精简记录：只留推荐/卡片/解释所需字段，丢弃 histogram/similar/description/ai_summary
  const tiered = d?.notes?.tiered || null;
  const flat = d?.notes?.flat || [];
  const rec = {
    id: d.id,
    name: d.name,
    brand: d.brand,
    gender: d.gender,
    year: d.year ?? null,
    accords: (d.accords || []).map((a) => ({ name: a.name, strength: a.strength })),
    notes: {
      top: (tiered?.top || []).map((n) => n.name),
      middle: (tiered?.middle || []).map((n) => n.name),
      base: (tiered?.base || []).map((n) => n.name),
      flat: (flat || []).map((n) => n.name),
    },
    rating: d?.rating?.average ?? null,
    longevity: d?.longevity?.average ?? null,
    sillage: d?.sillage?.average ?? null,
    priceValue: d?.price_value?.average ?? null,
    seasons: d.seasons || { winter: 0, spring: 0, summer: 0, autumn: 0 },
    daypart: d.daypart || { day: 0, night: 0 },
    people: d.people ?? 0,
    popularity: d?.popularity?.magnitude ?? 0,
  };
  selected.push(rec);

  // 词表
  for (const a of rec.accords) accordSet.add(a.name);
  bump(brandCount, rec.brand);
  for (const group of [rec.notes.top, rec.notes.middle, rec.notes.base, rec.notes.flat])
    for (const n of group) bump(noteCount, n);
}
console.timeEnd('pass2');

// 排序输出（按热度降序，方便 build 直接用）
selected.sort((a, b) => b.popularity - a.popularity);

const terms = {
  meta: { selected: selected.length, generatedFrom: 'ledecanteur/perfumes.jsonl', minPeople: MIN_PEOPLE, topN: N },
  accords: [...accordSet].sort(),
  brands: [...brandCount.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
  notes: [...noteCount.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
};

fs.writeFileSync(path.join(OUT_DIR, '_selected.json'), JSON.stringify(selected));
fs.writeFileSync(path.join(OUT_DIR, '_terms.json'), JSON.stringify(terms, null, 2));

const sizeMB = (fs.statSync(path.join(OUT_DIR, '_selected.json')).size / 1e6).toFixed(1);
console.log(`\n✓ 精选子集 ${selected.length} 款 → .scratch/_selected.json (${sizeMB} MB)`);
console.log(`✓ 词表 → .scratch/_terms.json  | 香调 ${terms.accords.length} 个，品牌 ${terms.brands.length} 个，气味 ${terms.notes.length} 个`);
