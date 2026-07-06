// 推荐编排：打分 → 排序 → 主推 + 备选，并为每个候选附上用法/风险/理由/裁决
import type { Perfume, Context, ScoredPick, Verdict } from "./types";
import { score, type ScoreParts } from "./scoring";
import { computeUsage, computeRisks, buildReasons } from "./usage";

export interface Bias {
  likeScore: number;
  perceivedStrength: number;
}

// 用香裁决 —— 不迁就用户：确实不合的场景明确判 avoid
function computeVerdict(p: Perfume, ctx: Context, parts: ScoreParts, risks: string[]): Verdict {
  const entries = Object.entries(p.seasonPct) as [keyof typeof p.seasonPct, number][];
  const best = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
  const seasonMiss = best[0] !== ctx.season && best[1] - p.seasonPct[ctx.season] >= 0.22;
  const closed = ctx.occasion === "commute" || ctx.occasion === "work" || ctx.occasion === "formal";
  const tooLoudClosed = p.sillageTier === 4 && closed;
  if (parts.weather <= 0.82 || seasonMiss || tooLoudClosed) return "avoid";
  if (risks.length > 0 || parts.weather < 0.95) return "caution";
  return "good";
}

export function buildPick(p: Perfume, ctx: Context, bias?: Bias): ScoredPick {
  const parts = score(p, ctx, bias);
  const risks = computeRisks(p, ctx);
  return {
    perfume: p,
    score: parts.total,
    breakdown: {
      season: parts.season,
      daypart: parts.daypart,
      occasion: parts.occasion,
      weather: parts.weather,
      quality: parts.quality,
    },
    usage: computeUsage(p, ctx, bias),
    risks,
    reasons: buildReasons(p, ctx, {
      season: parts.season,
      weather: parts.weather,
      occasion: parts.occasion,
    }),
    verdict: computeVerdict(p, ctx, parts, risks),
  };
}

export function recommend(
  perfumes: Perfume[],
  ctx: Context,
  biasMap?: Map<number, Bias>,
  daySeed = 0
): { primary: ScoredPick | null; alternatives: ScoredPick[]; ranked: ScoredPick[] } {
  // 近似同分（|Δ| < EPS）时按 hash(perfumeId, 日期) 稳定轮换：同日确定、跨天旋转，
  // 兑现"今天喷哪瓶每天不一样"，又不引入真随机、可解释、可复现。
  const EPS = 0.012;
  const rot = (id: number) => (((id * 2654435761 + daySeed * 40503) >>> 0) % 1000) / 1000;
  const ranked = perfumes
    .map((p) => buildPick(p, ctx, biasMap?.get(p.id)))
    .sort((a, b) => {
      const d = b.score - a.score;
      if (Math.abs(d) > EPS) return d;
      return rot(a.perfume.id) - rot(b.perfume.id);
    });

  const primary = ranked[0] ?? null;
  const rest = ranked.slice(1);
  const alternatives: ScoredPick[] = [];
  const usedBrand = new Set(primary ? [primary.perfume.brand] : []);
  // 第一趟：优先换品牌，制造"另一种选择"的感觉
  for (const pk of rest) {
    if (alternatives.length >= 3) break;
    if (usedBrand.has(pk.perfume.brand)) continue;
    usedBrand.add(pk.perfume.brand);
    alternatives.push(pk);
  }
  // 第二趟：按分补满到 3（含同品牌），确保不丢全库第 2 名、也不凑不满
  for (const pk of rest) {
    if (alternatives.length >= 3) break;
    if (alternatives.includes(pk)) continue;
    alternatives.push(pk);
  }
  return { primary, alternatives, ranked };
}

// 由反馈聚合为个人偏置（简单、可感、不需大数据）
import type { Feedback } from "./types";
export function aggregateBias(feedbacks: Feedback[]): Map<number, Bias> {
  const map = new Map<number, Bias>();
  const grouped = new Map<number, Feedback[]>();
  for (const f of feedbacks) {
    if (!grouped.has(f.perfumeId)) grouped.set(f.perfumeId, []);
    grouped.get(f.perfumeId)!.push(f);
  }
  for (const [id, fs] of grouped) {
    let like = 0;
    let strength = 0;
    for (const f of fs) {
      if (f.rating === "perfect") like += 0.3;
      if (f.rating === "too_strong") strength += 0.4;
      if (f.rating === "too_weak") strength -= 0.4;
    }
    map.set(id, {
      likeScore: Math.max(-1, Math.min(1, like)),
      perceivedStrength: Math.max(-1, Math.min(1, strength)),
    });
  }
  return map;
}
