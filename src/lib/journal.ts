// SPDX-FileCopyrightText: 2026 MrBaoboer
// SPDX-License-Identifier: AGPL-3.0-only
// Additional terms under AGPL-3.0 §7 — see LICENSE.

// 香历（穿香日历）与备选对比的纯函数层——可单测，无副作用。
// 香历是这个产品的记录资产：气味 × 日期 = 记忆索引。系统自动生成骨架，用户零写作负担。
import type { Perfume, Context, WearEntry } from "./types";

// ---------- 日期 ----------

export function dateKey(ts: number): string {
  const dt = new Date(ts);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/** 月视图网格：周一起始，每行 7 格，格值 = 当月日号或 null（补位） */
export function monthGrid(year: number, monthIdx: number): (number | null)[][] {
  const first = new Date(year, monthIdx, 1);
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // 周一=0
  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// ---------- 香调族群 → 色点 ----------
// 色值取中明度土色系：在宣纸暖白与炭黑两套主题上都可读，饱和度压低不抢版面。

// 色点同时要在明韵卡面(#fffefb)与暗香卡面(#26262a)上看得见。
// 实测原来的 spicy(#9a5b33) 在暗色下只有 2.81、dark(#6e6257) 只有 2.55，
// 低于 WCAG 1.4.11 的 3:1——而月视图里只有色点，看不清就等于这一天没有记录。
// 两者各提亮一点即可两边都过（现为 3.09 / 4.84），其余九族原本就达标。
const FAMILY_GROUPS: { key: string; color: string; accords: string[] }[] = [
  { key: "citrus", color: "#b98a2e", accords: ["citrus", "fresh", "aromatic", "lavender"] },
  { key: "aquatic", color: "#5f8291", accords: ["aquatic", "marine", "ozonic", "watery", "salty"] },
  { key: "green", color: "#6b7f57", accords: ["green", "herbal", "mossy", "earthy"] },
  { key: "floral", color: "#b07683", accords: ["floral", "white floral", "yellow floral", "rose", "jasmine", "iris", "violet", "tuberose"] },
  { key: "fruity", color: "#a86a56", accords: ["fruity", "tropical", "cherry", "coconut"] },
  { key: "sweet", color: "#a9713f", accords: ["sweet", "vanilla", "caramel", "honey", "chocolate", "coffee", "gourmand", "lactonic", "almond", "nutty"] },
  { key: "woody", color: "#8a6a4f", accords: ["woody", "sandalwood", "cedar", "patchouli"] },
  { key: "spicy", color: "#a36036", accords: ["warm spicy", "fresh spicy", "soft spicy", "spicy", "cinnamon"] },
  { key: "amber", color: "#a66a2e", accords: ["amber", "balsamic", "resinous", "incense"] },
  { key: "dark", color: "#7c6f62", accords: ["leather", "suede", "smoky", "oud", "tobacco", "animalic"] },
  { key: "musky", color: "#948b7d", accords: ["powdery", "musky", "soapy", "aldehydic"] },
];
const DEFAULT_FAMILY = { key: "other", color: "#8f8779" };

const ACCORD_TO_GROUP = new Map<string, { key: string; color: string }>();
for (const g of FAMILY_GROUPS) for (const a of g.accords) ACCORD_TO_GROUP.set(a, g);

/** 主香调族群（取强度最高且能归族的 accord；空/未知 → other） */
export function dominantFamily(p: Pick<Perfume, "accords">): { key: string; color: string } {
  for (const a of p.accords) {
    const hit = ACCORD_TO_GROUP.get(a.en);
    if (hit) return hit;
  }
  return DEFAULT_FAMILY;
}

export function familyColor(famKey: string): string {
  return FAMILY_GROUPS.find((g) => g.key === famKey)?.color ?? DEFAULT_FAMILY.color;
}

// ---------- 香历条目 ----------

export function wearEntryFrom(p: Perfume, ctx: Context, at = Date.now()): WearEntry {
  return {
    d: dateKey(at),
    perfumeId: p.id,
    name: p.nameZh || p.name,
    fam: dominantFamily(p).key,
    occasion: ctx.occasion,
    tempC: ctx.approximate ? null : Math.round(ctx.tempC),
    weatherText: ctx.weatherText,
    feel: ctx.feel,
  };
}

// ---------- 备选差异标签 ----------
// 备选不该只是名字的罗列——一句话说清"它和主推差在哪"，换瓶才是有信息量的选择。

export function altDiffLabel(alt: Perfume, base: Perfume): string {
  if (alt.sillageTier <= base.sillageTier - 1) return "更收敛";
  if (alt.sillageTier >= base.sillageTier + 1) return "更有存在感";
  const dLong = (alt.longevity ?? 0) - (base.longevity ?? 0);
  if (alt.longevity != null && base.longevity != null) {
    if (dLong >= 0.7) return "留香更久";
    if (dLong <= -0.7) return "更轻盈";
  }
  if (dominantFamily(alt).key !== dominantFamily(base).key) return "换个气质";
  return "同路数替补";
}
