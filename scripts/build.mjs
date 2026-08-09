// SPDX-FileCopyrightText: 2026 MrBaoboer
// SPDX-License-Identifier: AGPL-3.0-only
// Additional terms under AGPL-3.0 §7 — see LICENSE.

// 氛寸 · 数据构建（零依赖，node 运行）
// 读取 .scratch/_selected.json（extract 产出）+ data/zh-map/*.json（中文映射）
// → 产出 public/data/perfumes.min.json（前端只读静态资产）
// 派生逻辑（季节拉普拉斯平滑占比、日夜占比、sillage 四档、风格标签、Perfume 装配）
// 全部在 scripts/derive.mjs，与 build-ext.mjs 共用同一口径。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPerfume } from './derive.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SELECTED = path.join(ROOT, '.scratch', '_selected.json');
const MAP_DIR = path.join(ROOT, 'data', 'zh-map');
const OUT_DIR = path.join(ROOT, 'public', 'data');

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

const out = selected.map((r) => toPerfume(r, { accordMap, brandMap, noteMap, nameMap }));

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
