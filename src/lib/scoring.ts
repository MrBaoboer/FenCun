// 规则打分引擎（确定性，可解释）—— 决策权在这里，LLM 不参与
import type { Perfume, Context, Feel, Season } from "./types";

function accStrength(p: Perfume, en: string): number {
  const a = p.accords.find((x) => x.en === en);
  return a ? a.strength : 0;
}
function anyStrength(p: Perfume, names: string[], min: number): boolean {
  return names.some((n) => accStrength(p, n) >= min);
}
function maxStrength(p: Perfume, names: string[]): number {
  return Math.max(0, ...names.map((n) => accStrength(p, n)));
}

// 季节适配：当前季占比 ÷ 该香最高季占比 → 0..1（在主场得 1）
export function seasonFit(p: Perfume, season: Season): number {
  const vals = Object.values(p.seasonPct);
  const max = Math.max(...vals);
  if (max <= 0) return 0.5;
  return p.seasonPct[season] / max;
}

// 时段适配：直接用平滑占比
export function daypartFit(p: Perfume, ctx: Context): number {
  return ctx.daypart === "day" ? p.daypartPct.day : p.daypartPct.night;
}

// 天气乘性修正系数 W ∈ [0.7, 1.3]
export function weatherMultiplier(p: Perfume, feel: Feel): number {
  let w = 1;
  const heavy = ["sweet", "vanilla", "amber", "resinous", "animalic", "oud", "tobacco", "honey", "caramel"];
  const fresh = ["citrus", "aquatic", "marine", "green", "aromatic", "fresh", "ozonic"];
  const warm = ["amber", "warm spicy", "vanilla", "resinous", "leather", "woody"];
  if (feel === "hot_humid") {
    if (anyStrength(p, heavy, 50)) w *= 0.82;
    if (anyStrength(p, fresh, 45)) w *= 1.16;
  } else if (feel === "hot_dry") {
    if (maxStrength(p, ["sweet", "amber", "resinous"]) >= 55) w *= 0.92;
    if (anyStrength(p, ["citrus", "aromatic", "woody"], 45)) w *= 1.1;
  } else if (feel === "cold") {
    if (anyStrength(p, ["aquatic", "marine", "ozonic"], 50) && !anyStrength(p, warm, 40)) w *= 0.9;
    if (anyStrength(p, warm, 45)) w *= 1.15;
  }
  return Math.max(0.7, Math.min(1.3, w));
}

// 场景适配 0..1（基于预计算风格标签 + 关键香调）
export function occasionFit(p: Perfume, ctx: Context): number {
  const t = new Set(p.styleTags);
  const tier = p.sillageTier;
  let s = 0.55; // 基线
  const has = (x: string) => t.has(x);
  switch (ctx.occasion) {
    case "commute":
    case "work":
      if (has("清新通勤")) s += 0.3;
      if (has("正式商务")) s += 0.2;
      if (has("浓郁夜场")) s -= 0.3;
      if (tier >= 4) s -= 0.2; // 上班不宜过张扬
      break;
    case "formal":
      if (has("正式商务")) s += 0.35;
      if (has("浓郁夜场")) s -= 0.1;
      if (has("盛夏轻盈")) s -= 0.05;
      if (tier === 1) s -= 0.05;
      break;
    case "date":
      if (has("暖甜约会")) s += 0.32;
      if (has("浓郁夜场")) s += 0.1;
      if (tier >= 2 && tier <= 3) s += 0.08;
      break;
    case "social":
      if (has("暖甜约会") || has("浓郁夜场")) s += 0.2;
      if (tier >= 3) s += 0.08;
      break;
    case "sport":
      if (has("清新通勤") || has("盛夏轻盈")) s += 0.3;
      if (has("浓郁夜场") || has("秋冬暖香")) s -= 0.25;
      break;
    case "home":
    case "casual":
      if (has("日常百搭") || has("清新通勤")) s += 0.15;
      if (tier >= 4) s -= 0.12; // 居家无需外放
      break;
  }
  return Math.max(0, Math.min(1, s));
}

// 质量先验：贝叶斯收缩，低票降权（floor 0.3，不归零）
export function qualityPrior(p: Perfume): number {
  if (p.rating == null) return 0.6;
  const C = 30; // 伪计数
  const M = 3.6; // 全局先验均值
  const shrunk = (p.rating * p.people + M * C) / (p.people + C);
  return Math.max(0.3, Math.min(1, (shrunk - 2.8) / 1.6));
}

export interface ScoreParts {
  total: number;
  season: number;
  daypart: number;
  occasion: number;
  weather: number;
  quality: number;
}

// 场景规避惩罚：自然语言解析出的 avoid（别太甜/太冲/太正式…）→ 乘性降权
export function avoidPenalty(p: Perfume, avoid?: string[]): number {
  if (!avoid || avoid.length === 0) return 1;
  let m = 1;
  const has = (t: string) => avoid.includes(t);
  if (has("too_sweet") || has("cloying")) {
    if (maxStrength(p, ["sweet", "vanilla", "amber", "honey", "caramel"]) >= 50) m *= 0.68;
  }
  if (has("too_strong")) {
    if (p.sillageTier >= 4) m *= 0.6;
    else if (p.sillageTier === 3) m *= 0.8;
  }
  if (has("too_formal") && p.styleTags.includes("正式商务")) m *= 0.8;
  if (has("too_casual") && (p.styleTags.includes("日常百搭") || p.styleTags.includes("清新通勤"))) m *= 0.85;
  return m;
}

// 个人偏置：likeScore ∈ [-1,1] → 居中 0.5..1.5 的乘子；perceivedStrength 影响后续用法（此处不用）
export function score(
  p: Perfume,
  ctx: Context,
  bias?: { likeScore: number; perceivedStrength: number }
): ScoreParts {
  const sSeason = seasonFit(p, ctx.season);
  const sDay = daypartFit(p, ctx);
  const sOcc = occasionFit(p, ctx);
  const W = weatherMultiplier(p, ctx.feel);
  const Q = qualityPrior(p);

  // 线性组合（权重显式、可单测、可向用户解释）
  const linear = 0.34 * sSeason + 0.16 * sDay + 0.32 * sOcc + 0.18 * 0.5;
  const biasMul = 1 + (bias?.likeScore ?? 0) * 0.25;
  const total = linear * W * Q * biasMul * avoidPenalty(p, ctx.avoid);
  return { total, season: sSeason, daypart: sDay, occasion: sOcc, weather: W, quality: Q };
}
