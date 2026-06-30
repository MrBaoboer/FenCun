// 氛寸 · 数据构建（零依赖，node 运行）
// 读取 .scratch/_selected.json（extract 产出）+ data/zh-map/*.json（中文映射）
// → 产出 public/data/perfumes.min.json（前端只读静态资产）
// 预计算：季节拉普拉斯平滑占比、日夜占比、sillage 四档、风格标签；香调同时保留英文键(打分)与中文(展示)。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SELECTED = path.join(ROOT, '.scratch', '_selected.json');
const MAP_DIR = path.join(ROOT, 'data', 'zh-map');
const OUT_DIR = path.join(ROOT, 'public', 'data');
const ALPHA = 5; // 季节拉普拉斯平滑系数

function loadMap(name) {
  const p = path.join(MAP_DIR, name);
  if (!fs.existsSync(p)) { console.warn(`⚠ 缺映射 ${name}，将回退英文`); return {}; }
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { console.warn(`⚠ ${name} 非法 JSON，回退英文`); return {}; }
}

if (!fs.existsSync(SELECTED)) { console.error(`找不到 ${SELECTED}，请先 npm run extract:terms`); process.exit(1); }

const selected = JSON.parse(fs.readFileSync(SELECTED, 'utf8'));
const accordMap = loadMap('accords.json');
const brandMap = loadMap('brands.json');
const noteMap = loadMap('notes.json');
const nameMap = loadMap('names.json'); // 按 id 键，值 {zh, aliases, source}

const zhAccord = (en) => accordMap[en] || en;
const zhBrand = (en) => brandMap[en] || en;
const zhNote = (en) => noteMap[en] || en;

function dedupe(arr) { return [...new Set(arr.filter(Boolean))]; }

// 季节占比（拉普拉斯平滑，防低票噪声）
function seasonPct(s) {
  const w = s.winter || 0, sp = s.spring || 0, su = s.summer || 0, au = s.autumn || 0;
  const sum = w + sp + su + au;
  const d = sum + 4 * ALPHA;
  const r = (x) => Number(((x + ALPHA) / d).toFixed(3));
  return { winter: r(w), spring: r(sp), summer: r(su), autumn: r(au) };
}
function daypartPct(dp) {
  const day = dp.day || 0, night = dp.night || 0, sum = day + night;
  if (sum === 0) return { day: 0.5, night: 0.5 };
  return { day: Number((day / sum).toFixed(3)), night: Number((night / sum).toFixed(3)) };
}
// sillage 1..4 → 四档（1 贴肤 / 4 外放）
function sillageTier(s) {
  if (s == null) return 2;
  if (s < 1.75) return 1;
  if (s < 2.5) return 2;
  if (s < 3.25) return 3;
  return 4;
}

// 用英文 accord 键做规则匹配
function accStrength(accords, en) { const a = accords.find((x) => x.name === en); return a ? a.strength : 0; }
function anyStrength(accords, names, min) { return names.some((n) => accStrength(accords, n) >= min); }

function styleTags(raw) {
  const a = raw.accords;
  const dp = daypartPct(raw.daypart);
  const sp = seasonPct(raw.seasons);
  const sil = raw.sillage ?? 2.5;
  const tags = [];
  if (anyStrength(a, ['citrus', 'aquatic', 'marine', 'green', 'fresh'], 55) && accStrength(a, 'sweet') < 40 && dp.day >= 0.55)
    tags.push('清新通勤');
  if (anyStrength(a, ['sweet', 'vanilla', 'amber', 'caramel', 'honey'], 50) && dp.night >= 0.5)
    tags.push('暖甜约会');
  if (anyStrength(a, ['woody', 'aromatic', 'leather'], 50) && accStrength(a, 'sweet') < 38 && sil >= 1.9 && sil <= 3.1)
    tags.push('正式商务');
  if (sil >= 3.2 && anyStrength(a, ['sweet', 'amber', 'oud', 'leather', 'tobacco', 'resinous'], 50))
    tags.push('浓郁夜场');
  if (sp.summer >= 0.36 && anyStrength(a, ['citrus', 'aquatic', 'marine', 'green'], 45))
    tags.push('盛夏轻盈');
  if ((sp.winter + sp.autumn) >= 0.58 && anyStrength(a, ['amber', 'warm spicy', 'woody', 'vanilla', 'resinous', 'oud'], 45))
    tags.push('秋冬暖香');
  return tags.length ? tags : ['日常百搭'];
}

const out = selected.map((r) => {
  const accords = (r.accords || []).slice().sort((x, y) => y.strength - x.strength).slice(0, 8);
  const notesTop = dedupe((r.notes.top || []).map(zhNote)).slice(0, 8);
  const notesMid = dedupe((r.notes.middle || []).map(zhNote)).slice(0, 8);
  const notesBase = dedupe((r.notes.base || []).map(zhNote)).slice(0, 8);
  const notesFlatRaw = dedupe([...(r.notes.flat || [])].map(zhNote)).slice(0, 12);
  const allNotes = dedupe([...notesTop, ...notesMid, ...notesBase, ...notesFlatRaw]);
  const nameEntry = nameMap[String(r.id)] || {};
  return {
    id: r.id,
    name: r.name,
    nameZh: nameEntry.zh ?? null,
    aliases: Array.isArray(nameEntry.aliases) ? nameEntry.aliases : [],
    brand: r.brand,
    brandZh: zhBrand(r.brand),
    gender: r.gender,
    year: r.year,
    rating: r.rating != null ? Number(r.rating.toFixed(2)) : null,
    longevity: r.longevity != null ? Number(r.longevity.toFixed(2)) : null,
    sillage: r.sillage != null ? Number(r.sillage.toFixed(2)) : null,
    sillageTier: sillageTier(r.sillage),
    priceValue: r.priceValue != null ? Number(r.priceValue.toFixed(2)) : null,
    seasonPct: seasonPct(r.seasons),
    daypartPct: daypartPct(r.daypart),
    accords: accords.map((a) => ({ en: a.name, zh: zhAccord(a.name), strength: a.strength })),
    notes: { top: notesTop, middle: notesMid, base: notesBase },
    notesFlat: allNotes,
    styleTags: styleTags(r),
    popularity: r.popularity,
    people: r.people,
  };
});

fs.mkdirSync(OUT_DIR, { recursive: true });
const outFile = path.join(OUT_DIR, 'perfumes.min.json');
fs.writeFileSync(outFile, JSON.stringify(out));

// 覆盖率统计
const totalAccord = new Set(), totalBrand = new Set(), totalNote = new Set();
const missAccord = new Set(), missBrand = new Set(), missNote = new Set();
for (const r of selected) {
  totalBrand.add(r.brand); if (!brandMap[r.brand]) missBrand.add(r.brand);
  for (const a of r.accords) { totalAccord.add(a.name); if (!accordMap[a.name]) missAccord.add(a.name); }
  for (const g of [r.notes.top, r.notes.middle, r.notes.base, r.notes.flat])
    for (const n of g) { totalNote.add(n); if (!noteMap[n]) missNote.add(n); }
}
const pct = (miss, tot) => tot ? (100 * (1 - miss / tot)).toFixed(1) : '0';
const sizeMB = (fs.statSync(outFile).size / 1e6).toFixed(2);
const withZhName = out.filter((p) => p.nameZh).length;
console.log(`✓ 构建 ${out.length} 款 → public/data/perfumes.min.json (${sizeMB} MB)`);
console.log(`  中文香名覆盖 ${(100 * withZhName / out.length).toFixed(1)}%  (${withZhName}/${out.length}，其余回退英文)`);
console.log(`  香调中文覆盖 ${pct(missAccord.size, totalAccord.size)}%  (${totalAccord.size - missAccord.size}/${totalAccord.size})`);
console.log(`  品牌中文覆盖 ${pct(missBrand.size, totalBrand.size)}%  (${totalBrand.size - missBrand.size}/${totalBrand.size})`);
console.log(`  气味中文覆盖 ${pct(missNote.size, totalNote.size)}%  (${totalNote.size - missNote.size}/${totalNote.size})`);
if (missNote.size) console.log(`  未译气味示例: ${[...missNote].slice(0, 12).join(', ')}`);
