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

// 场景适配 0..1（按真实香调家族判定，让不同气质的香在不同场合明显拉开）
export function occasionFit(p: Perfume, ctx: Context): number {
  const fresh = maxStrength(p, ["citrus", "aquatic", "marine", "ozonic", "green", "fresh", "watery"]);
  const sweet = maxStrength(p, ["sweet", "vanilla", "caramel", "honey", "chocolate", "coffee", "gourmand"]);
  const amberWoody = maxStrength(p, ["amber", "woody", "oud", "sandalwood", "cedar", "resinous", "balsamic"]);
  const floral = maxStrength(p, ["floral", "white floral", "yellow floral", "rose", "jasmine", "tuberose", "violet", "iris"]);
  const earthyDark = maxStrength(p, ["earthy", "leather", "tobacco", "smoky", "animalic", "patchouli"]);
  const spicy = maxStrength(p, ["warm spicy", "spicy", "fresh spicy", "cinnamon", "soft spicy"]);
  const tier = p.sillageTier;
  const n = (v: number) => v / 100;
  let s = 0.5;
  switch (ctx.occasion) {
    case "date":
    case "social":
      // 浪漫/social：甜、花最讨喜；泥土/木质/辛辣不浪漫；纯清冽也不够暧昧
      s += 0.4 * n(Math.max(sweet, floral));
      s += 0.12 * n(amberWoody > 60 ? 0 : amberWoody);
      s -= 0.3 * n(Math.max(earthyDark, spicy * 0.5));
      if (fresh > 70 && sweet < 30 && floral < 30) s -= 0.15;
      if (ctx.occasion === "date" && tier >= 4) s -= 0.15;
      break;
    case "formal":
    case "work":
    case "commute":
      // 得体：干净木质/柑橘/草本；反甜、反花、反脏气、反爆炸
      s += 0.3 * n(Math.max(amberWoody * 0.75, fresh, spicy * 0.6));
      s -= 0.42 * n(sweet);
      s -= 0.22 * n(floral);
      s -= 0.18 * n(earthyDark);
      if (tier >= 4) s -= 0.2;
      break;
    case "sport":
      // 清爽：清新/柑橘/水生；强烈反甜、反重、反木
      s += 0.42 * n(fresh);
      s -= 0.45 * n(Math.max(sweet, amberWoody, earthyDark));
      if (tier >= 3) s -= 0.1;
      break;
    case "home":
    case "casual":
      // 放松：柔和舒适皆可，反强扩散
      s += 0.18 * n(Math.max(sweet * 0.7, amberWoody * 0.6, fresh * 0.6, floral * 0.6));
      if (tier >= 4) s -= 0.15;
      break;
  }
  return Math.max(0.05, Math.min(1, s));
}

// 质量先验：贝叶斯收缩后压成 ±4% 的温和微调（0.96~1.04，中心 1.0）。
// 关键：同一用户库内，"今天喷哪瓶"该由场景/季节/天气决定，社区评分只作轻微 tiebreak，
// 不能让某瓶高分香跨场景通吃（否则又回到"永远推荐大地"）。未评分记 1.0，不惩罚。
export function qualityPrior(p: Perfume): number {
  if (p.rating == null) return 1;
  const C = 30, M = 3.6;
  const shrunk = (p.rating * p.people + M * C) / (p.people + C);
  return Math.max(0.96, Math.min(1.04, 1 + (shrunk - 4.0) * 0.08));
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

  // 线性组合（权重显式、归一到 1、可单测、可向用户解释）；occasion 略高于 season——
  // "今天去哪儿"比"现在什么季"更该决定喷哪瓶（急性温度已由乘性 W 兜底），让场景赢下真正的平局。
  // 个人偏好不占加性权重，改由下方 biasMul 乘性承担。
  const linear = 0.38 * sSeason + 0.19 * sDay + 0.43 * sOcc;
  const biasMul = 1 + (bias?.likeScore ?? 0) * 0.25;
  const total = linear * W * Q * biasMul * avoidPenalty(p, ctx.avoid);
  return { total, season: sSeason, daypart: sDay, occasion: sOcc, weather: W, quality: Q };
}
