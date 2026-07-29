// 氛寸 · 全量扩展索引 + 详情分片（零依赖，node 运行）
// 流式扫描 ledecanteur/perfumes.jsonl，选取：
//   (people>=50 且 id 不在 Top1500 集合) OR (brand 含 CJK 字符——国货，不设票数门槛)
// 复用 scripts/derive.mjs 做与 Top1500 完全相同的派生，产出：
//   public/data/ext-index.json      轻量搜索索引 [{i,n,b,z?,p}]
//   public/data/ext/{00..63}.json   按 id % 64 分片，每片为 Perfume 形状记录数组
// 中文尽力而为：accords/brand/notes 走 zh-map（缺则回退英文），nameZh 一律 null，aliases 一律 []。
// people<50 的国货记录额外带 lowVotes: true。
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { toPerfume, voteAvg } from './derive.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'ledecanteur', 'perfumes.jsonl');
const MAP_DIR = path.join(ROOT, 'data', 'zh-map');
const MIN_FILE = path.join(ROOT, 'public', 'data', 'perfumes.min.json');
const OUT_DIR = path.join(ROOT, 'public', 'data');
const EXT_DIR = path.join(OUT_DIR, 'ext');
const SHARDS = 64;
const MIN_PEOPLE = 50;

if (!fs.existsSync(SRC)) { console.error(`找不到数据源: ${SRC}`); process.exit(1); }
if (!fs.existsSync(MIN_FILE)) { console.error(`找不到 ${MIN_FILE}，请先 npm run build:data（需要 Top1500 集合做排除）`); process.exit(1); }

function loadMap(name) {
  const p = path.join(MAP_DIR, name);
  if (!fs.existsSync(p)) { console.warn(`⚠ 缺映射 ${name}，将回退英文`); return {}; }
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { console.warn(`⚠ ${name} 非法 JSON，回退英文`); return {}; }
}

const accordMap = loadMap('accords.json');
const brandMap = loadMap('brands.json');
const noteMap = loadMap('notes.json');
// 扩展集没有人工香名映射：nameZh 一律 null、aliases 一律 []（nameMap 传空即为该回退）
const maps = { accordMap, brandMap, noteMap, nameMap: {} };

const topIds = new Set(JSON.parse(fs.readFileSync(MIN_FILE, 'utf8')).map((p) => p.id));
console.log(`Top1500 排除集：${topIds.size} 个 id（来自 perfumes.min.json）`);

const hasCJK = (s) => typeof s === 'string' && /\p{Script=Han}/u.test(s);

async function* readLines(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) yield line;
}
function safeParse(line) { try { return JSON.parse(line); } catch { return null; } }

// 与 extract-terms.mjs Pass2 完全一致的精简记录形状（toPerfume 的输入契约）
function toRaw(d) {
  const tiered = d?.notes?.tiered || null;
  const flat = d?.notes?.flat || [];
  return {
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
    // voteAvg：0 是"没有票"的哨兵值，不是评分（量表下界是 1）。见 derive.mjs:voteAvg
    rating: voteAvg(d?.rating),
    longevity: voteAvg(d?.longevity),
    sillage: voteAvg(d?.sillage),
    priceValue: voteAvg(d?.price_value),
    seasons: d.seasons || { winter: 0, spring: 0, summer: 0, autumn: 0 },
    daypart: d.daypart || { day: 0, night: 0 },
    people: d.people ?? 0,
    popularity: d?.popularity?.magnitude ?? 0,
  };
}

console.time('scan');
const shards = Array.from({ length: SHARDS }, () => []);
const popById = new Map();
const index = [];
let total = 0, picked = 0, cjkCount = 0, cjkLowVotes = 0;

for await (const line of readLines(SRC)) {
  total++;
  const d = safeParse(line);
  if (!d) continue;
  const people = d.people ?? 0;
  const isCJK = hasCJK(d.brand);
  if (topIds.has(d.id)) continue; // Top1500 已在 perfumes.min.json，扩展集必须与其零交集
  if (!(people >= MIN_PEOPLE || isCJK)) continue;

  picked++;
  if (isCJK) cjkCount++;
  const rec = toPerfume(toRaw(d), maps);
  if (isCJK && people < MIN_PEOPLE) { rec.lowVotes = true; cjkLowVotes++; }
  // 热度只用于排序，**不进产出**（见 derive.mjs 的说明）：单独记一张表，不挂在记录上
  popById.set(rec.id, d?.popularity?.magnitude ?? 0);
  shards[rec.id % SHARDS].push(rec);

  const entry = { i: rec.id, n: rec.name, b: rec.brand };
  if (rec.brandZh !== rec.brand) entry.z = rec.brandZh;
  entry.p = rec.people;
  index.push(entry);

  if (total % 20000 === 0) process.stdout.write(`\r  扫描 ${total} 行，已选 ${picked} 款…`);
}
process.stdout.write('\n');
console.timeEnd('scan');

// 分片内按热度降序（前端取片后无需再排）；索引按热度降序（搜索命中即近似热度序）
for (const s of shards) s.sort((a, b) => (popById.get(b.id) || 0) - (popById.get(a.id) || 0));
index.sort((a, b) => (popById.get(b.i) || 0) - (popById.get(a.i) || 0));

fs.mkdirSync(EXT_DIR, { recursive: true });
const indexFile = path.join(OUT_DIR, 'ext-index.json');
fs.writeFileSync(indexFile, JSON.stringify(index));
let maxShard = { name: '', raw: 0, gz: 0, count: 0 };
for (let i = 0; i < SHARDS; i++) {
  const name = String(i).padStart(2, '0') + '.json';
  const buf = Buffer.from(JSON.stringify(shards[i]));
  fs.writeFileSync(path.join(EXT_DIR, name), buf);
  const gz = zlib.gzipSync(buf).length;
  if (buf.length > maxShard.raw) maxShard = { name, raw: buf.length, gz, count: shards[i].length };
}

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
const idxBuf = fs.readFileSync(indexFile);
const idxGz = zlib.gzipSync(idxBuf).length;
console.log(`✓ 扫描 ${total} 行，选入扩展集 ${picked} 款（国货 ${cjkCount} 款，其中低票 lowVotes ${cjkLowVotes} 款）`);
console.log(`✓ ext-index.json：${index.length} 条，${kb(idxBuf.length)} 原始 / ${kb(idxGz)} gzip`);
console.log(`✓ ext/ 分片 ${SHARDS} 个，最大 ${maxShard.name}（${maxShard.count} 条）：${kb(maxShard.raw)} 原始 / ${kb(maxShard.gz)} gzip`);
